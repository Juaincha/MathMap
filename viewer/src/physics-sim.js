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
  TAG_LINK_SIM_DISTANCE,
  TAG_LINK_SIM_STRENGTH,
  RING_GRAVITY_STRENGTH,
  COLLISION_RADIUS_PAD,
  COLLISION_STRENGTH,
  COLLISION_ITERATIONS,
  VELOCITY_DECAY,
  PHYSICS_STOP_DELAY_MS,
  INIT_RING_STRENGTH,
  INIT_RING_TARGET_DIST,
  INIT_COLLISION_PAD,
  DRAG_LIT_PULL_STRENGTH
} from './physics-config.js'

// ── module-level state ─────────────────────────────────────────────────────────
let simulation   = null   // active d3 simulation (null when idle)
let nodeMap      = {}     // id → d3 node object { id, x, y, fx, fy, r }
let dragging     = null   // id of the node currently being dragged (null when idle)
let rafId        = null   // requestAnimationFrame handle (null when idle)
let cyRef        = null   // reference to the Cytoscape instance
let running      = false  // kill-switch: tick() exits immediately when false
let dragEndTime  = null   // performance.now() when drag ended; null while dragging

let ringDragMode  = false  // true while a ring is being dragged in isolated mode
let ringMemberIds = null   // Set<string> of clusterTag-member ids for the active ring drag

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
  ringDragMode  = false
  ringMemberIds = null
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
      if (id === dragging) continue          // never overwrite cursor node
      // In ring-drag mode, only update cluster members — all other nodes stay frozen.
      if (ringDragMode && ringMemberIds && !ringMemberIds.has(id)) continue
      const n = nodeMap[id]
      if (n.x == null || n.y == null) continue
      const cyNode = cyRef.getElementById(id)
      if (cyNode.length) cyNode.position({ x: n.x, y: n.y })
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
    target: edge.data('target'),
    kind:   edge.data('kind') || null
  }))

  // Build ring-concept pairs for the quadratic gravity force.
  // For each tag-link edge, identify which end is the ring and which is the concept.
  initPhysics._ringPairs = cy.edges()
    .filter(e => e.data('kind') === 'tag-link')
    .map(e => {
      const isRingSrc = e.source().data('type') === 'tag'
      return {
        ringId:    isRingSrc ? e.source().id() : e.target().id(),
        conceptId: isRingSrc ? e.target().id() : e.source().id()
      }
    })
}

/**
 * Called on 'grabon' for a ring (tag) node.
 * Creates an isolated d3 simulation: ring pinned at cursor,
 * members attracted to ring, collision between members only.
 * All other nodes are NOT in the simulation and do not move.
 *
 * @param {string}   ringNodeId  — id of the ring node being dragged
 * @param {{x,y}}    position    — initial cursor position
 * @param {string[]} memberIds   — ids of nodes whose clusterTag === this ring's label
 */
export function onRingDragStart(ringNodeId, position, memberIds) {
  // Tear down any previous simulation cleanly.
  running = false
  if (simulation) { simulation.stop(); simulation = null }
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }

  dragEndTime   = null
  ringDragMode  = true
  ringMemberIds = new Set(memberIds)
  dragging      = ringNodeId

  // Refresh positions from Cytoscape for ring + members only.
  if (cyRef) {
    cyRef.nodes().forEach(node => {
      const nid = node.id()
      if (nid !== ringNodeId && !ringMemberIds.has(nid)) return
      const n = nodeMap[nid]
      if (!n) return
      const pos = node.position()
      n.x = pos.x; n.y = pos.y
      n.fx = null; n.fy = null
      n.vx = 0;    n.vy = 0
    })
  }

  // Build d3 node list: ring + members only.
  const simNodes = []
  const simById  = {}

  // Ring node — pinned at cursor
  const ringN = nodeMap[ringNodeId]
  if (ringN) {
    ringN.fx = position.x
    ringN.fy = position.y
    simNodes.push(ringN)
    simById[ringNodeId] = ringN
  }

  // Member nodes — free
  memberIds.forEach(mid => {
    const n = nodeMap[mid]
    if (n) { simNodes.push(n); simById[mid] = n }
  })

  // Target-distance spring identical to runInitLayout — same strength, same target.
  // Nodes settle at INIT_RING_TARGET_DIST from the ring (pushed out by collision
  // if the cluster is dense, just as in the startup layout).
  function forceRingPull(alpha) {
    const ring = simById[ringNodeId]
    if (!ring) return
    for (const mid of ringMemberIds) {
      const m = simById[mid]
      if (!m) continue
      const dx   = ring.x - m.x
      const dy   = ring.y - m.y
      const dist = Math.hypot(dx, dy) || 0.001
      const f    = INIT_RING_STRENGTH * (dist - INIT_RING_TARGET_DIST) / dist * alpha
      m.vx += dx * f
      m.vy += dy * f
    }
  }

  simulation = forceSimulation(simNodes)
    .alpha(DRAG_ALPHA_TARGET)
    .alphaTarget(DRAG_ALPHA_TARGET)   // stays warm while dragging
    .alphaDecay(0)
    .velocityDecay(0.4)               // matches init layout — lower damping lets nodes spread angularly
    .force('ringPull', forceRingPull)
    .force('collide',  forceCollide()
      .radius(n => (n.r || 7) + INIT_COLLISION_PAD)   // same padding as init layout
      .strength(COLLISION_STRENGTH)
      .iterations(COLLISION_ITERATIONS)
    )
    .stop()

  running = true
  rafId   = requestAnimationFrame(tick)
}

/**
 * Called on Cytoscape `grabon` — a drag has started on `nodeId`.
 * Pins the dragged node at cursor; lit neighbors strongly attract toward it.
 * All other nodes are frozen. No link springs or ring gravity — only direct
 * pull + collision, so lit nodes cluster tightly around the dragged node.
 *
 * @param {string}   nodeId    id of the dragged node
 * @param {{ x, y }} position  cursor position
 * @param {string[]} litIds    ids of nodes to attract (from current hoverMode)
 */
export function onDragStart(nodeId, position, litIds = []) {
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

  const litIdSet = new Set(litIds)
  const freeIds  = new Set([nodeId, ...litIds])

  // Freeze every node outside the lit set — no global cascade.
  Object.values(nodeMap).forEach(n => {
    if (!freeIds.has(n.id)) {
      n.fx = n.x
      n.fy = n.y
    }
  })

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

  // Simulation runs only on dragged node + lit nodes for efficiency.
  const simNodes = Array.from(freeIds).map(id => nodeMap[id]).filter(Boolean)
  const nodeById = {}
  simNodes.forEach(n => { nodeById[n.id] = n })

  // Target-distance spring: nodes settle at INIT_RING_TARGET_DIST from the dragged node,
  // with the same spacing as ring clusters. DRAG_LIT_PULL_STRENGTH controls speed.
  function forceLitPull(alpha) {
    const anchor = nodeById[nodeId]
    if (!anchor) return
    for (const id of litIdSet) {
      const m = nodeById[id]
      if (!m) continue
      const dx   = anchor.x - m.x
      const dy   = anchor.y - m.y
      const dist = Math.hypot(dx, dy) || 0.001
      const f    = DRAG_LIT_PULL_STRENGTH * (dist - INIT_RING_TARGET_DIST) / dist * alpha
      m.vx += dx * f
      m.vy += dy * f
    }
  }

  simulation = forceSimulation(simNodes)
    .alpha(DRAG_ALPHA_TARGET)
    .alphaTarget(DRAG_ALPHA_TARGET)
    .alphaDecay(0)
    .velocityDecay(0.4)
    .force('litPull', forceLitPull)
    .force('collide', forceCollide()
      .radius(n => (n.r || 7) + INIT_COLLISION_PAD)
      .strength(COLLISION_STRENGTH)
      .iterations(COLLISION_ITERATIONS)
    )
    .stop()

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
