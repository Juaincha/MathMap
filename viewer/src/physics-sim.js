// physics-sim.js
// d3-force live simulation used ONLY for drag interactions.
// fcose handles the initial layout; this module handles post-layout physics.
//
// Responsibilities:
//   - Build a d3 simulation from current Cytoscape node positions.
//   - Run while the user is dragging a node.
//   - Write updated positions back to Cytoscape each tick.
//   - Stop cleanly when alpha drops below REST_THRESHOLD (GUARDA 3).
//   - Coordinate drag so d3 is the sole position authority (GUARDA 2).

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceCenter
} from 'd3-force'

import {
  SIM_ALPHA_START,
  SIM_ALPHA_DECAY,
  SIM_ALPHA_MIN,
  REST_THRESHOLD,
  LINK_DISTANCE,
  LINK_STRENGTH,
  LINK_ITERATIONS,
  CHARGE_STRENGTH,
  CHARGE_THETA,
  CHARGE_DIST_MAX,
  COLLISION_RADIUS_PAD,
  COLLISION_STRENGTH,
  COLLISION_ITERATIONS,
  CENTER_STRENGTH,
  VELOCITY_DECAY
} from './physics-config.js'

// ── module-level state ─────────────────────────────────────────────────────────
let simulation   = null  // active d3 simulation (null when idle)
let nodeMap      = {}    // id → d3 node object { id, x, y, fx, fy, r }
let dragging     = null  // id of the node currently being dragged (null when idle)
let rafId        = null  // requestAnimationFrame handle (null when idle)
let cyRef        = null  // reference to the Cytoscape instance

// ── internal helpers ───────────────────────────────────────────────────────────

/**
 * Cancel the rAF loop and mark it cleared.
 * Called on simulation rest and on teardown.
 */
function cancelRaf() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

/**
 * Stop the simulation, cancel rAF, and clear the dragging pin.
 * This is the single authoritative "go idle" path.
 */
function stopSimulation() {
  if (simulation) {
    simulation.stop()
  }
  cancelRaf()
  dragging = null
  // CPU idle: no rAF running
}

/**
 * Write d3 node positions back to Cytoscape in a single batch.
 * Skips the node being dragged (Cytoscape already mirrors the cursor
 * position because we manually set it on grabmove).
 */
function flushPositionsToCy() {
  if (!cyRef) return
  cyRef.batch(() => {
    for (const id in nodeMap) {
      // Never overwrite the dragged node — the user's cursor IS the position.
      if (id === dragging) continue
      const n = nodeMap[id]
      if (n.x == null || n.y == null) continue
      const cyNode = cyRef.getElementById(id)
      if (cyNode.length) {
        cyNode.position({ x: n.x, y: n.y })
      }
    }
  })
}

/**
 * The rAF tick loop: writes positions to Cytoscape while the simulation
 * is still warm, then stops cleanly when it cools down.
 */
function tick() {
  if (!simulation) {
    // CPU idle: no rAF running
    rafId = null
    return
  }

  const alpha = simulation.alpha()

  // Flush positions to Cytoscape each frame.
  flushPositionsToCy()

  if (alpha < REST_THRESHOLD) {
    stopSimulation()
    // CPU idle: no rAF running
    return
  }

  // Schedule next frame only if simulation is still warm.
  rafId = requestAnimationFrame(tick)
}

// ── public API ─────────────────────────────────────────────────────────────────

/**
 * Must be called once after fcose layout is done.
 * Snapshots all node positions from Cytoscape into the d3 node map.
 * Does NOT start the simulation — stays idle until first drag.
 *
 * @param {cytoscape.Core} cy
 */
export function initPhysics(cy) {
  cyRef = cy
  nodeMap = {}

  cy.nodes().forEach(node => {
    const pos = node.position()
    const r   = node.width() / 2
    nodeMap[node.id()] = {
      id: node.id(),
      x: pos.x,
      y: pos.y,
      fx: null,
      fy: null,
      r
    }
  })

  // Build link data from Cytoscape edges.
  // Stored for re-use when the simulation is (re-)created on drag.
  initPhysics._links = cy.edges().map(edge => ({
    source: edge.data('source'),
    target: edge.data('target')
  }))
}

/**
 * Called on Cytoscape `grabon` — a drag has started on `nodeId`.
 * (Re)creates the d3 simulation seeded from current Cytoscape positions,
 * pins the dragged node at its current position, and starts the rAF loop.
 *
 * GUARDA 2: the dragged node is fixed (fx/fy) so d3 never moves it;
 * Cytoscape mirrors the cursor directly via `grabmove`.
 *
 * @param {string} nodeId
 * @param {{ x: number, y: number }} position  current Cytoscape position
 */
export function onDragStart(nodeId, position) {
  // Refresh all positions from Cytoscape before we start so d3
  // starts from the current visual state.
  if (cyRef) {
    cyRef.nodes().forEach(node => {
      const n = nodeMap[node.id()]
      if (!n) return
      const pos = node.position()
      n.x  = pos.x
      n.y  = pos.y
      n.fx = null
      n.fy = null
    })
  }

  dragging = nodeId

  // Pin the dragged node at its current position (GUARDA 2).
  const dn = nodeMap[nodeId]
  if (dn) {
    dn.fx = position.x
    dn.fy = position.y
  }

  // Tear down any previous simulation before building a new one.
  if (simulation) {
    simulation.stop()
    simulation = null
  }
  cancelRaf()

  const nodes = Object.values(nodeMap)
  const links = (initPhysics._links || [])
    .map(l => ({ source: l.source, target: l.target }))

  // Resolve link sources/targets to node objects (d3 requires object refs).
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  const resolvedLinks = links
    .filter(l => nodeById[l.source] && nodeById[l.target])
    .map(l => ({ source: nodeById[l.source], target: nodeById[l.target] }))

  simulation = forceSimulation(nodes)
    .alphaStart(SIM_ALPHA_START)
    .alphaDecay(SIM_ALPHA_DECAY)
    .alphaMin(SIM_ALPHA_MIN)
    .velocityDecay(VELOCITY_DECAY)
    .force('link', forceLink(resolvedLinks)
      .distance(LINK_DISTANCE)
      .strength(LINK_STRENGTH)
      .iterations(LINK_ITERATIONS)
    )
    .force('charge', forceManyBody()
      .strength(CHARGE_STRENGTH)
      .theta(CHARGE_THETA)
      .distanceMax(CHARGE_DIST_MAX)
    )
    .force('collide', forceCollide()
      .radius(n => (n.r || 7) + COLLISION_RADIUS_PAD)
      .strength(COLLISION_STRENGTH)
      .iterations(COLLISION_ITERATIONS)
    )
    .force('center', forceCenter(position.x, position.y)
      .strength(CENTER_STRENGTH)
    )
    // Stop the built-in d3 timer — we drive ticks via rAF.
    .stop()

  // Kick off our rAF-driven tick loop.
  rafId = requestAnimationFrame(tick)
}

/**
 * Called on Cytoscape `grabmove` — updates the pinned position of the
 * dragged node so d3 keeps its neighbors reacting to the cursor.
 *
 * GUARDA 2: only updates fx/fy (pin), never writes back to Cytoscape.
 * Cytoscape is moving the node natively because it's being grabbed;
 * we do not fight it.
 *
 * @param {string} nodeId
 * @param {{ x: number, y: number }} position
 */
export function onDragMove(nodeId, position) {
  const n = nodeMap[nodeId]
  if (!n) return
  n.fx = position.x
  n.fy = position.y
  // Manually advance the simulation one step each move event
  // so neighbors react even before the next rAF fires.
  if (simulation) {
    simulation.tick()
  }
}

/**
 * Called on Cytoscape `graboff` — the user released the node.
 * Releases the d3 pin (fx/fy = null) and lets the simulation decay naturally.
 * Does NOT force any position — GUARDA 2 smooth handoff.
 *
 * @param {string} nodeId
 */
export function onDragEnd(nodeId) {
  const n = nodeMap[nodeId]
  if (n) {
    // Release the pin — d3 will carry momentum from velocity naturally.
    n.fx = null
    n.fy = null
  }
  dragging = null
  // The rAF loop continues running until alpha < REST_THRESHOLD,
  // at which point stopSimulation() is called automatically.
}

/**
 * Tear down everything. Call this before destroying the Cytoscape instance.
 */
export function destroyPhysics() {
  stopSimulation()
  simulation = null
  nodeMap    = {}
  cyRef      = null
  initPhysics._links = []
}
