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
  forceCollide
} from 'd3-force'

import {
  SIM_ALPHA_START,
  SIM_ALPHA_DECAY,
  SIM_ALPHA_MIN,
  REST_THRESHOLD,
  DRAG_ALPHA_TARGET,
  LINK_DISTANCE,
  LINK_STRENGTH,
  LINK_ITERATIONS,
  COLLISION_RADIUS_PAD,
  COLLISION_STRENGTH,
  COLLISION_ITERATIONS,
  VELOCITY_DECAY,
  PHYSICS_STOP_DELAY_MS
} from './physics-config.js'

// ── module-level state ─────────────────────────────────────────────────────────
let simulation   = null   // active d3 simulation (null when idle)
let nodeMap      = {}     // id → d3 node object { id, x, y, fx, fy, r }
let dragging     = null   // id of the node currently being dragged (null when idle)
let rafId        = null   // requestAnimationFrame handle (null when idle)
let cyRef        = null   // reference to the Cytoscape instance
let running      = false  // kill-switch: tick() exits immediately when false
let dragEndTime  = null   // performance.now() when drag ended; null while dragging

// ── internal helpers ───────────────────────────────────────────────────────────

/**
 * Single authoritative "go idle" path.
 * Sets running=false so the next tick() call exits without scheduling another frame.
 */
function stopSimulation() {
  running = false
  if (simulation) simulation.stop()
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  dragging    = null
  dragEndTime = null
  for (const id in nodeMap) {
    nodeMap[id].fx = null  // unfreeze all nodes fixed during drag
    nodeMap[id].fy = null
    nodeMap[id].vx = 0
    nodeMap[id].vy = 0
  }
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
 * The rAF tick loop: advances d3, flushes positions, stops when idle.
 * `running` is the authoritative kill-switch — setting it false guarantees
 * this loop exits at the next frame boundary without relying on setTimeout.
 */
function tick() {
  if (!running || !simulation) {
    rafId = null
    return
  }

  simulation.tick()
  flushPositionsToCy()

  const alpha   = simulation.alpha()
  const elapsed = dragEndTime !== null ? performance.now() - dragEndTime : 0
  const timeout = dragEndTime !== null && elapsed >= PHYSICS_STOP_DELAY_MS

  if (alpha < REST_THRESHOLD || timeout) {
    stopSimulation()
    return
  }

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
  dragEndTime = null

  // Refresh all positions from Cytoscape.
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

  // Fix every node that is NOT a direct neighbor of the dragged node.
  // Only the immediate neighborhood participates in the simulation;
  // the rest of the graph stays frozen — no global cascade.
  if (cyRef) {
    const cyNode = cyRef.getElementById(nodeId)
    const freeIds = new Set()
    freeIds.add(nodeId)
    cyNode.connectedEdges().connectedNodes().forEach(nb => freeIds.add(nb.id()))

    Object.values(nodeMap).forEach(n => {
      if (!freeIds.has(n.id)) {
        n.fx = n.x
        n.fy = n.y
      }
    })
  }

  // Pin the dragged node at cursor (GUARDA 2).
  const dn = nodeMap[nodeId]
  if (dn) {
    dn.fx = position.x
    dn.fy = position.y
  }

  // Tear down any previous simulation.
  running = false
  if (simulation) { simulation.stop(); simulation = null }
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }

  const nodes = Object.values(nodeMap)
  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  const resolvedLinks = (initPhysics._links || [])
    .filter(l => nodeById[l.source] && nodeById[l.target])
    .map(l => ({ source: nodeById[l.source], target: nodeById[l.target] }))

  simulation = forceSimulation(nodes)
    .alpha(SIM_ALPHA_START)
    .alphaDecay(SIM_ALPHA_DECAY)
    .alphaMin(SIM_ALPHA_MIN)
    .velocityDecay(VELOCITY_DECAY)
    .force('link', forceLink(resolvedLinks)
      .distance(LINK_DISTANCE)
      .strength(LINK_STRENGTH)
      .iterations(LINK_ITERATIONS)
    )
    .force('collide', forceCollide()
      .radius(n => (n.r || 7) + COLLISION_RADIUS_PAD)
      .strength(COLLISION_STRENGTH)
      .iterations(COLLISION_ITERATIONS)
    )
    // No forceManyBody: charge force is global and causes cascades across all nodes.
    // No forceCenter: unnecessary pull that keeps energy in the system.
    .stop()

  simulation.alphaTarget(DRAG_ALPHA_TARGET)

  running = true
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
    n.fx = null
    n.fy = null
  }
  dragging    = null
  dragEndTime = performance.now()  // tick() uses this to enforce PHYSICS_STOP_DELAY_MS
  if (simulation) simulation.alphaTarget(0)
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
