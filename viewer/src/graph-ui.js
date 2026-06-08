// graph-ui.js
// Builds the Cytoscape instance, runs a d3-force init layout ONCE at startup,
// wires hover/selection/click interactions, and delegates drag physics
// to physics-sim.js.

import cytoscape from 'cytoscape'
import { forceSimulation, forceCollide } from 'd3-force'
import { initializeSearch } from './search.js'
import { initPhysics, onDragStart, onDragMove, onDragEnd, onRingDragStart } from './physics-sim.js'

import {
  NODE_SIZE_BASE,
  NODE_SIZE_PER_DEG,
  NODE_SIZE_MAX,
  ZOOM_LABEL_NONE,
  ZOOM_LABEL_HUBS_ONLY,
  HUB_DEGREE_PERCENTILE,
  ZOOM_DEBOUNCE_MS,
  ZOOM_WHEEL_SENSITIVITY,
  ZOOM_EASE_FACTOR,
  ZOOM_REST_EPSILON,
  SPIRAL_BASE_SCALE,
  INIT_SCATTER,
  INIT_RING_STRENGTH,
  INIT_RING_TARGET_DIST,
  INIT_COLLISION_PAD,
  INIT_ALPHA_THRESHOLD,
  INIT_MAX_TICKS,
  INITIAL_VIEW_FRACTION
} from './physics-config.js'

// ── TAG_PRIORITY — mirrors build_graph.py TAG_PRIORITY (lower number = higher priority) ──
const TAG_PRIORITY = {
  'logic':                   1,
  'set-theory':              2,
  'foundations':             3,
  'order-theory':            4,
  'abstract-algebra':        5,
  'algebra':                 6,
  'linear-algebra':          7,
  'number-theory':           8,
  'combinatorics':           9,
  'real-analysis':          10,
  'calculus':               11,
  'topology':               12,
  'geometry':               13,
  'analysis':               14,
  'measure-theory':         15,
  'graph-theory':           16,
  'complex-analysis':       17,
  'differential-equations': 18,
  'differential-geometry':  19,
  'functional-analysis':    20,
  'probability':            21,
  'algorithms':             22,
}

/**
 * Returns the highest-priority tag (lowest TAG_PRIORITY value) from `nodeTags`
 * that is also present in `tagSet`. Returns null if no intersection.
 */
function selectClusterTag(nodeTags, tagSet) {
  let best = null
  let bestPriority = Infinity
  for (const t of nodeTags) {
    if (!tagSet.has(t)) continue
    const p = TAG_PRIORITY[t] ?? 999
    if (p < bestPriority) {
      bestPriority = p
      best = t
    }
  }
  return best
}

/**
 * Init-only layout: pure ring-attraction + collision.
 * clusterRingPos: Map<string, {x, y}> — keyed by "tag:<clusterTag>" ring node id.
 * Returns a Promise that resolves when alpha < INIT_ALPHA_THRESHOLD or ticks exhausted.
 */
function runInitLayout(cy, clusterRingPos) {
  return new Promise(resolve => {
    // Build d3 node list from current cy positions
    const d3Nodes = []
    cy.nodes().forEach(n => {
      const pos = n.position()
      d3Nodes.push({
        id:         n.id(),
        x:          pos.x,
        y:          pos.y,
        r:          n.width() / 2,
        clusterTag: n.data('clusterTag'),
        isRing:     n.data('type') === 'tag',
        fx:         n.data('type') === 'tag' ? pos.x : null,  // freeze rings
        fy:         n.data('type') === 'tag' ? pos.y : null,
      })
    })

    // Custom force: target-distance spring toward clusterTag ring shell.
    // Nodes farther than INIT_RING_TARGET_DIST are pulled in;
    // nodes closer are pushed out. Prevents cross-cluster drift.
    function forceRingAttraction(alpha) {
      for (const n of d3Nodes) {
        if (n.isRing) continue
        if (n.fx != null) continue  // skip pinned
        const tag = n.clusterTag
        if (!tag) continue
        const ringPos = clusterRingPos.get(`tag:${tag}`)
        if (!ringPos) continue
        const dx   = ringPos.x - n.x
        const dy   = ringPos.y - n.y
        const dist = Math.hypot(dx, dy) || 1
        const f    = INIT_RING_STRENGTH * (dist - INIT_RING_TARGET_DIST) / dist * alpha
        n.vx = (n.vx || 0) + dx * f
        n.vy = (n.vy || 0) + dy * f
      }
    }

    const sim = forceSimulation(d3Nodes)
      .alpha(0.8)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .force('ring', forceRingAttraction)
      .force('collide', forceCollide()
        .radius(n => (n.r || 7) + INIT_COLLISION_PAD)
        .strength(1.0)
        .iterations(3)
      )
      .stop()

    let ticks = 0
    while (sim.alpha() > INIT_ALPHA_THRESHOLD && ticks < INIT_MAX_TICKS) {
      sim.tick()
      ticks++
    }

    // Flush final positions to Cytoscape
    cy.batch(() => {
      d3Nodes.forEach(n => {
        if (n.isRing) return
        cy.getElementById(n.id).position({ x: n.x, y: n.y })
      })
    })

    resolve()
  })
}

/**
 * Place N points on an Archimedean spiral r(θ) = startRadius + b·θ
 * with equal chord spacing `spacing` between consecutive points.
 * Uses arc-length parametrisation: dθᵢ = spacing / sqrt(rᵢ² + b²),
 * which keeps the Euclidean distance between adjacent nodes constant
 * regardless of how far out on the spiral they sit.
 */
function spiralPositions(N, startRadius, spacing) {
  const b = spacing / (2 * Math.PI)
  const pts = []
  let theta = 0
  for (let i = 0; i < N; i++) {
    const r     = startRadius + b * theta
    const angle = -Math.PI / 2 + theta
    pts.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    if (i < N - 1) theta += spacing / Math.sqrt(r * r + b * b)
  }
  return pts
}

// ── Module-level reference to the initial clusterRingPos map ─────────────────
// Saved once at startup so restoreGlobalLayout() can re-run the init layout
// without re-computing ring positions from scratch.
let savedClusterRingPos = null

// ── Snapshot of every node's position after the initial layout ────────────────
// Saved once so restoreGlobalLayout() can teleport directly to the original
// state without re-running any simulation. Completely independent of anything
// that applyCompactLayout or applyRegrouping may have done to node positions.
let savedInitialNodePos = null

// ── main export ────────────────────────────────────────────────────────────────
export async function createGraph() {

  const TYPE_COLORS = {
    axiom:      '#e74c3c',
    definition: '#3498db',
    lemma:      '#f39c12',
    theorem:    '#27ae60',
    conjecture: '#8e44ad',
    corollary:  '#16a085',
    structure:  '#2980b9',
    concept:    '#7f8c8d'
  }

  const ALL_TYPES = Object.keys(TYPE_COLORS)

  document.querySelector('#app').innerHTML = `
    <div id="toolbar">
      <div id="top-row">
        <input id="search" placeholder="Search..." autocomplete="off">
        <button id="resetBtn">Reset</button>
      </div>
      <div id="suggestions"></div>
      <div class="filter-group">
        <span class="filter-label">Show near</span>
        <div class="hover-mode-strip">
          <button class="hover-mode-btn active" data-mode="near-both">Both</button>
          <button class="hover-mode-btn" data-mode="near-dependents">Implies</button>
          <button class="hover-mode-btn" data-mode="near-dependencies">Depends on</button>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Show tree</span>
        <div class="hover-mode-strip">
          <button class="hover-mode-btn" data-mode="tree-both">Both</button>
          <button class="hover-mode-btn" data-mode="tree-dependents">Implies</button>
          <button class="hover-mode-btn" data-mode="tree-dependencies">Depends on</button>
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-label-row">
          <span class="filter-label">Type</span>
          <button class="filter-quick" data-target="type" data-action="all">All</button>
          <button class="filter-quick" data-target="type" data-action="none">None</button>
        </div>
        <div class="filter-scroll">
          <div id="filters">
            ${ALL_TYPES.map(t => `
              <button class="filter-btn active" data-type="${t}"
                style="--type-color:${TYPE_COLORS[t]}">
                ${t}
              </button>`).join('')}
          </div>
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-label-row">
          <span class="filter-label">Tag</span>
          <button class="filter-quick" data-target="tag" data-action="all">All</button>
          <button class="filter-quick" data-target="tag" data-action="none">None</button>
        </div>
        <div class="filter-scroll">
          <div id="tag-filters"></div>
        </div>
      </div>
    </div>

    <div id="cy"></div>

    <div id="node-counter"></div>

    <div id="tooltip"></div>
  `

  const tooltip = document.getElementById('tooltip')

  // ── Fetch graph data ──────────────────────────────────────────────────────────
  const graph = await fetch(import.meta.env.BASE_URL + 'graph.json')
    .then(r => r.json())

  // ── Degree map for node sizing and hub classification ────────────────────────
  // Only dependency edges count — tag-link edges are layout scaffolding, not topology.
  const degreeMap = {}
  graph.nodes.forEach(node => { degreeMap[node.id] = 0 })
  graph.edges.forEach(edge => {
    if (edge.kind === 'tag-link') return
    degreeMap[edge.source] = (degreeMap[edge.source] || 0) + 1
    degreeMap[edge.target] = (degreeMap[edge.target] || 0) + 1
  })

  // Compute the degree threshold for hub nodes (top HUB_DEGREE_PERCENTILE %).
  // Sorted ascending; threshold index = floor(n * percentile).
  const degreeSorted = Object.values(degreeMap).slice().sort((a, b) => a - b)
  const hubThresholdIdx = Math.floor(degreeSorted.length * HUB_DEGREE_PERCENTILE)
  const hubDegreeThreshold = degreeSorted[hubThresholdIdx] ?? 0

  // Expose degree on each node's data so the hub class can be set after cy init.
  graph.nodes.forEach(node => {
    node._degree = degreeMap[node.id] || 0
  })

  // ── Tag colors (HSL evenly spaced) — computed early for node coloring ─────────
  const allTags = [...new Set(graph.nodes.flatMap(n => n.tags || []))].sort()
  const TAG_COLORS = {}
  allTags.forEach((tag, i) => {
    const hue = Math.round((i / allTags.length) * 360)
    TAG_COLORS[tag] = `hsl(${hue}, 58%, 42%)`
  })

  // ── Separate ring nodes from regular nodes ────────────────────────────────────
  const ringNodes    = graph.nodes.filter(n => n.type === 'tag')
  const regularNodes = graph.nodes.filter(n => n.type !== 'tag')

  // ── Cluster sizes (for scatter radius scaling) ────────────────────────────────
  const clusterSize = {}
  regularNodes.forEach(n => {
    const ct = n.clusterTag
    if (ct) clusterSize[ct] = (clusterSize[ct] || 0) + 1
  })

  // Map from ring label → array of member node ids (nodes whose clusterTag === label).
  const clusterMembers = {}
  regularNodes.forEach(n => {
    if (n.clusterTag) {
      if (!clusterMembers[n.clusterTag]) clusterMembers[n.clusterTag] = []
      clusterMembers[n.clusterTag].push(n.id)
    }
  })

  // ── Seed positions ────────────────────────────────────────────────────────────
  // Step 1: place ring nodes on an Archimedean spiral — r(θ) = r₀ + b·θ
  // with uniform Δθ between consecutive rings (equal angular spacing).
  // Rings sorted by descending member count so larger clusters sit nearer the
  // centre, where screen density is highest and they can anchor more nodes.
  const clusterRef = {}
  // Only include rings that own at least one concept node (clusterSize > 0).
  // Rings with 0 members are hidden by nodeVisible and need no spiral slot.
  const nonEmptyRings = ringNodes.filter(rn => (clusterSize[rn.label] || 0) > 0)
  const N = nonEmptyRings.length
  if (N > 0) {
    const sortedRings = nonEmptyRings.slice().sort(
      (a, b) => (clusterSize[b.label] || 0) - (clusterSize[a.label] || 0)
    )
    // Chord spacing scales with √(maxClusterSize) so rings spread further apart
    // when clusters are large, keeping concept clouds from overlapping.
    const maxClusterSize = Math.max(...nonEmptyRings.map(rn => clusterSize[rn.label] || 1))
    const spiralSpacing  = SPIRAL_BASE_SCALE * Math.sqrt(maxClusterSize)
    const pts = spiralPositions(N, spiralSpacing, spiralSpacing)
    sortedRings.forEach((rn, i) => {
      clusterRef[rn.id] = pts[i]
    })
  }

  // Step 2: seed concept nodes around their cluster reference center.
  // scatter = INIT_SCATTER × sqrt(clusterSize) → uniform disk proportional to cluster density.
  const conceptSeed = {}
  regularNodes.forEach(node => {
    const ringId = node.clusterTag ? `tag:${node.clusterTag}` : null
    const center = ringId && clusterRef[ringId] ? clusterRef[ringId] : { x: 0, y: 0 }
    const size   = clusterSize[node.clusterTag] || 1
    const scatter = INIT_SCATTER * Math.sqrt(size)
    const a = Math.random() * 2 * Math.PI
    const r = Math.sqrt(Math.random()) * scatter
    conceptSeed[node.id] = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }
  })

  // Step 3: place each ring at its exact spiral position.
  const ringPositions = {}
  ringNodes.forEach(rn => {
    ringPositions[rn.id] = clusterRef[rn.id] || { x: 0, y: 0 }
  })

  // ── Build Cytoscape elements ──────────────────────────────────────────────────
  const tagsByNode = {}
  graph.nodes.forEach(n => { tagsByNode[n.id] = n.tags || [] })

  // elements array is populated below in the pre-compute + rebuild block.
  const elements = []

  // ── Pre-compute node sizes as static data values (avoids per-redraw JS mapper) ──
  // Mapper functions (ele => ...) are re-evaluated on every Cytoscape redraw.
  // Storing size in node data and using 'data(size)' is evaluated once at element
  // creation and cached by Cytoscape's style system.
  regularNodes.forEach(node => {
    node._size = Math.min(NODE_SIZE_MAX, NODE_SIZE_BASE + (degreeMap[node.id] || 0) * NODE_SIZE_PER_DEG)
  })
  // Ring node sizes are computed inline below (need clusterSize lookup).

  // Re-build elements with _size baked into data so stylesheet can reference it.
  elements.length = 0

  regularNodes.forEach(node => {
    const tagColor = node.clusterTag ? TAG_COLORS[node.clusterTag] : '#7f8c8d'
    elements.push({ data: { ...node, tagColor, size: node._size }, position: conceptSeed[node.id] })
  })

  ringNodes.forEach(rn => {
    const tagColor    = TAG_COLORS[rn.label] || '#7f8c8d'
    const memberCount = clusterSize[rn.label] || 0
    const size        = 28 + Math.sqrt(memberCount || 1) * 4
    elements.push({
      data: { ...rn, tagColor, memberCount, size },
      position: ringPositions[rn.id] || { x: 0, y: 0 }
    })
  })

  graph.edges.forEach(edge => {
    const srcTags = tagsByNode[edge.source] || []
    const tgtTags = new Set(tagsByNode[edge.target] || [])
    const crossTag = edge.kind !== 'tag-link' &&
      srcTags.length > 0 && tgtTags.size > 0 && !srcTags.some(t => tgtTags.has(t))
    elements.push({ data: { source: edge.source, target: edge.target, crossTag, kind: edge.kind || null } })
  })

  // ── Create Cytoscape instance ─────────────────────────────────────────────────
  // Initial layout is 'preset' (no-op); d3-force init sim runs below via runInitLayout().
  //
  // PERF: pixelRatio forced to 1 — on HiDPI screens the default devicePixelRatio
  // (2 on Retina, up to 3 on mobile) means the canvas is 4x–9x the pixel count.
  // Forcing 1 halves render cost on HiDPI with minimal visual loss at graph scale.
  // Adjust to 'auto' if crisp text on high-DPI is preferred over performance.
  const cy = cytoscape({

    container: document.getElementById('cy'),

    elements,

    wheelSensitivity: 0.00001,

    // PERF: pixelRatio: 1 — avoids 4x canvas on HiDPI (e.g. Retina 2x → 1x).
    // Tune: set to 'auto' to restore native DPI at the cost of render bandwidth.
    pixelRatio: 1,

    layout: { name: 'preset' },

    style: [

      {
        selector: 'node',
        style: {
          label: 'data(label)',

          // PERF: static data reference instead of JS mapper function.
          // Mapper functions re-evaluate on every redraw; data() is cached.
          width:  'data(size)',
          height: 'data(size)',

          'font-size': 10,
          color: '#222',
          'text-valign': 'bottom',
          'text-margin-y': 5,
          // Labels hidden by default — zoom system reveals them selectively.
          'text-opacity': 0,

          // PERF: border-width: 0 on concept nodes eliminates per-node border stroke.
          // Ring nodes override this below with their own border-width: 3.
          'border-width': 0,

          'background-color': 'data(tagColor)',

          'transition-property': 'opacity, background-color, text-opacity',
          'transition-duration': '150ms',
          'transition-timing-function': 'ease'
        }
      },


      {
        selector: 'edge',
        // PERF: dep-edges use straight lines — cheaper than bezier (no control-point math).
        // Arrows are preserved for semantic directionality.
        // line-opacity replaces opacity to avoid per-element compositing layer.
        style: {
          width: 1.5,
          // PERF: line-opacity instead of opacity — avoids full compositing pass per edge.
          // opacity: 0.35 forces the canvas to allocate a separate compositing layer per edge.
          // line-opacity applies alpha only to the stroke, which is much cheaper.
          'line-opacity': 1,
          'line-color': '#99999959',  // embed alpha in hex color — no compositing overhead
          'curve-style': 'straight',  // PERF: straight is O(1) vs bezier which needs control points
          'target-arrow-color': '#99999959',
          'target-arrow-shape': 'triangle',
          'transition-property': 'opacity',
          'transition-duration': '150ms',
          'transition-timing-function': 'ease'
        }
      },

      {
        selector: 'edge[?crossTag]',
        style: {
          'line-style': 'dashed',
          'line-dash-pattern': [6, 4]
        }
      },

      // ── Ring nodes (tag anchors) ─────────────────────────────────────────────
      {
        selector: 'node[type="tag"]',
        style: {
          'background-opacity':  0,
          // Ring nodes keep their border — it IS their visual identity.
          'border-width':        3,
          'border-color':        'data(tagColor)',
          'border-opacity':      0.85,
          // PERF: static data reference (pre-computed in _size above).
          width:  'data(size)',
          height: 'data(size)',
          'font-size':    11,
          'font-weight':  'bold',
          color:          'data(tagColor)',
          'text-valign':  'center',
          'text-halign':  'center',
          'text-opacity': 1,
          'text-margin-y': 0,
          'transition-property': 'opacity, border-color',
          'transition-duration': '150ms'
        }
      },

      // ── Tag-link edges ────────────────────────────────────────────────────────
      // PERF: haystack is the cheapest curve style — no arrow, no control points.
      // These are decorative clustering edges; visual fidelity matters less.
      {
        selector: 'edge[kind="tag-link"]',
        style: {
          width:                0.8,
          // PERF: color with embedded alpha (no compositing) instead of opacity.
          'line-color':         '#aaaaaa26',  // ~15% opacity embedded in color
          'line-opacity':       1,
          'target-arrow-shape': 'none',
          'source-arrow-shape': 'none',
          // PERF: haystack — the absolute cheapest curve style in Cytoscape.
          // No per-edge control points, no per-edge compositing.
          'curve-style':        'haystack',
          'transition-property': 'opacity',
          'transition-duration': '150ms'
        }
      },

      // ── Zoom label classes ──────────────────────────────────────────────────
      // Applied dynamically by the zoom handler.
      // .label-all    → all nodes visible (zoom > lodLabelHubsOnly)
      // .label-hub    → hub nodes only (lodLabelNone < zoom ≤ lodLabelHubsOnly)
      // .label-visible → hover / selected (always shown, any zoom)

      {
        selector: '.label-all',
        style: { 'text-opacity': 1 }
      },
      {
        selector: '.label-hub',
        style: { 'text-opacity': 1 }
      },
      {
        selector: '.label-visible',
        style: { 'text-opacity': 1 }
      },

      // ── LOD dynamic-visibility classes ─────────────────────────────────────
      // .edges-hidden   → applied to cy.edges() when zoom < lodEdgeThreshold
      // .labels-hidden  → applied to cy.nodes() when zoom < lodLabelNone
      // These classes are toggled by recomputeLodAndApply() via the LOD system.
      // Note: edge culling is handled by the existing applyEdgeCulling() system
      // (style('display', 'none') / 'element') for fine-grained viewport culling.
      // The .edges-hidden class provides a coarse bulk-hide when fully zoomed out.
      {
        selector: '.edges-hidden',
        style: { display: 'none' }
      },
      {
        selector: '.labels-hidden',
        style: { 'text-opacity': 0 }
      },

      // ── Interaction classes ─────────────────────────────────────────────────
      // PERF: all interaction states defined in stylesheet (not computed in JS).
      // Cytoscape caches class-based styles; JS-computed styles bypass the cache.

      {
        selector: '.hover',
        style: { 'background-color': '#ff9500' }
      },
      {
        selector: '.neighbor',
        // PERF: opacity: 1 overrides the dimmed state — no compositing needed.
        style: { opacity: 1 }
      },
      {
        // PERF: dimmed class replaces per-element opacity writes.
        // Defined in stylesheet so Cytoscape style engine caches it.
        // DO NOT use overlay-opacity here — it forces an extra compositing pass.
        selector: '.dimmed',
        style: {
          opacity: 0.08,
          'transition-property': 'opacity',
          'transition-duration': '120ms',
          'transition-timing-function': 'ease'
        }
      },
      {
        // Legacy alias kept for any code that still references .faded.
        selector: '.faded',
        style: {
          opacity: 0.08,
          'transition-property': 'opacity',
          'transition-duration': '120ms'
        }
      }
    ]
  })

  // ── Run d3-force init layout ONCE ─────────────────────────────────────────────
  // Ring nodes are frozen at their Archimedean spiral positions (fx/fy in d3).
  // Concept nodes are attracted toward their clusterTag ring and repel each other.

  // Build the clusterRingPos map from seeded ring positions
  const clusterRingPos = new Map()
  ringNodes.forEach(rn => {
    clusterRingPos.set(rn.id, ringPositions[rn.id] || { x: 0, y: 0 })
  })

  // Save reference so restoreGlobalLayout() can use it later
  savedClusterRingPos = clusterRingPos

  // Run init layout (ring-only attraction + collision), then snapshot for drag
  await runInitLayout(cy, clusterRingPos)
  initPhysics(cy)

  // Freeze the exact post-init positions so restoreGlobalLayout() can always
  // return to this state without re-running any simulation.
  savedInitialNodePos = new Map()
  cy.nodes().forEach(n => {
    const p = n.position()
    savedInitialNodePos.set(n.id(), { x: p.x, y: p.y })
  })

  // ── Initial camera: fit to innermost INITIAL_VIEW_FRACTION of concept nodes ───
  // Concept nodes only — ring nodes are layout scaffolding, not the focal content.
  // Sorts by distance from centroid; fits the densest central cluster so the user
  // opens the map already "inside" the graph, not zoomed out to the full extent.
  {
    const concepts = cy.nodes().filter(n => n.data('type') !== 'tag')
    const pts = concepts.map(n => n.position())
    const cx  = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy0 = pts.reduce((s, p) => s + p.y, 0) / pts.length

    const sorted = concepts.toArray().sort((a, b) => {
      const pa = a.position(), pb = b.position()
      return Math.hypot(pa.x - cx, pa.y - cy0) - Math.hypot(pb.x - cx, pb.y - cy0)
    })

    const innerCount = Math.ceil(sorted.length * INITIAL_VIEW_FRACTION)
    cy.fit(cy.collection(sorted.slice(0, innerCount)), 60)
  }

  // ── Smooth cursor-anchored zoom ───────────────────────────────────────────────
  // Intercepts wheel events before Cytoscape (capture phase) and replaces the
  // discrete native zoom with a lerp-based animation loop.
  // The rAF loop exits as soon as |zoomTarget − current| < ZOOM_REST_EPSILON,
  // so no animation runs at rest and the physics simulation is never touched.

  let zoomTarget      = cy.zoom()   // accumulates wheel input in log-scale
  let zoomAnchor      = null        // { x, y } rendered position of cursor (px)
  let smoothZoomRafId = null        // null when idle

  function smoothZoomTick() {
    const current = cy.zoom()
    const diff    = zoomTarget - current

    if (Math.abs(diff) < ZOOM_REST_EPSILON) {
      cy.zoom({ level: zoomTarget, renderedPosition: zoomAnchor })
      smoothZoomRafId = null
      return
    }

    cy.zoom({ level: current + diff * ZOOM_EASE_FACTOR, renderedPosition: zoomAnchor })
    smoothZoomRafId = requestAnimationFrame(smoothZoomTick)
  }

  function handleWheel(e) {
    e.preventDefault()
    e.stopPropagation()

    // Normalise deltaY to pixels regardless of deltaMode
    let delta = e.deltaY
    if (e.deltaMode === 1) delta *= 20    // line mode
    if (e.deltaMode === 2) delta *= 400   // page mode

    // Accumulate target in log-scale (scroll up → zoom in → larger level)
    const newTarget = zoomTarget * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY)
    zoomTarget = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), newTarget))

    // Anchor: cursor position relative to the cy container
    const rect = document.getElementById('cy').getBoundingClientRect()
    zoomAnchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    // Start loop only if not already running
    if (smoothZoomRafId === null) {
      smoothZoomRafId = requestAnimationFrame(smoothZoomTick)
    }
  }

  // Capture phase ensures we intercept before Cytoscape's bubble-phase listener.
  document.getElementById('cy').addEventListener('wheel', handleWheel, {
    passive: false,
    capture: true
  })

  // ── Mark hub nodes (computed once; immutable for the session) ─────────────────
  // Hub = top (1 - HUB_DEGREE_PERCENTILE) % by total degree.
  // The class is used by the zoom-label system to show labels at medium zoom.
  cy.batch(() => {
    cy.nodes().forEach(node => {
      if (node.data('type') === 'tag') return   // ring nodes: never classified as hub
      const deg = degreeMap[node.id()] || 0
      if (deg >= hubDegreeThreshold) node.addClass('hub')
    })
  })

  // ── Dynamic LOD (Level-of-Detail) thresholds ─────────────────────────────────
  // Instead of static zoom thresholds for labels and edges, the thresholds are
  // computed dynamically based on how many concept nodes are currently visible
  // in the viewport. More nodes visible → higher zoom required before labels/edges
  // appear, reducing visual noise and improving render performance.
  //
  // Density bands → zoom threshold:
  //   ≤  50 visible nodes  → 0.25
  //   51–150               → 0.45
  //  151–400               → 0.65
  //  > 400                 → 0.90

  // Current dynamic thresholds (start with static fallbacks from physics-config).
  let lodEdgeThreshold  = ZOOM_LABEL_NONE        // zoom below which edges hide
  let lodLabelNone      = ZOOM_LABEL_NONE        // zoom below which no labels shown
  let lodLabelHubsOnly  = ZOOM_LABEL_HUBS_ONLY   // zoom below which only hubs shown

  // Timer ID for the 100 ms debounce on the LOD recalculation (separate from rAF).
  let lodDebounceTimer = null

  /**
   * Counts concept nodes (non-tag) whose bounding box centre lies within the
   * current viewport extent. Uses cy.extent() (one call) + node.position()
   * (cheap — no layout calculation) for O(n) efficiency.
   * Returns the count of visible concept nodes.
   */
  function countVisibleConceptNodes() {
    const ext = cy.extent()
    let count = 0
    cy.nodes().forEach(n => {
      if (n.data('type') === 'tag') return      // skip ring nodes
      if (n.style('display') === 'none') return // skip filter-hidden nodes
      const p = n.position()
      if (p.x >= ext.x1 && p.x <= ext.x2 && p.y >= ext.y1 && p.y <= ext.y2) {
        count++
      }
    })
    return count
  }

  /**
   * Recomputes LOD thresholds based on the current viewport density and applies
   * zoom-label + edge-culling immediately.
   * Called via a 100 ms debounce from onViewportChange so it does not run on
   * every animation frame — only after the viewport settles briefly.
   */
  function recomputeLodAndApply() {
    const visible = countVisibleConceptNodes()

    let threshold
    if (visible <= 50)       threshold = 0.25
    else if (visible <= 150) threshold = 0.45
    else if (visible <= 400) threshold = 0.65
    else                     threshold = 0.90

    lodEdgeThreshold = threshold
    lodLabelNone     = threshold
    // Hub-only tier: between the base threshold and 1.5× it (keeps relative spacing).
    lodLabelHubsOnly = threshold * 2.4

    // Force re-evaluation by resetting the tier cache (thresholds changed).
    lastZoomTier = null

    applyZoomLabels()
    applyEdgeCulling()
  }

  // ── Smart zoom label system ───────────────────────────────────────────────────
  // Labels are hidden by default (text-opacity: 0 in base style).
  // Three zoom tiers control which nodes show their label:
  //   < lodLabelNone      → no labels
  //   lodLabelNone–lodLabelHubsOnly → hub nodes only (.label-hub)
  //   > lodLabelHubsOnly  → all nodes (.label-all)
  // Hover always adds .label-visible to the hovered node regardless of zoom tier.
  // Thresholds are dynamic — recomputed via recomputeLodAndApply() on viewport change.

  let zoomRafId = null
  let lastZoomTier = null   // 'none' | 'hubs' | 'all'

  // ── Edge viewport culling state ───────────────────────────────────────────────
  // Tracks which edges were visible in the last culling pass so we can skip
  // redundant batches. Uses edge id → boolean (true = display:element).
  // Separate from the filter-driven display state — both must agree for an
  // edge to be shown (filterVisible AND inViewport).
  // During hover, hovered node's edges bypass viewport culling.

  // Set of edge IDs that pass the filter (maintained by applyFilters).
  // Starts empty — applyFilters() populates it on first call during init.
  const filterVisibleEdges = new Set()

  // Set of edge IDs hidden by the viewport culler (subset of filterVisibleEdges).
  let culledEdgeIds = new Set()          // currently culled (display:none) by us

  // Edge IDs force-shown during hover (bypass viewport culling).
  let hoverForcedEdgeIds = new Set()

  // Nodes/edges temporarily revealed during hover despite being filter-hidden.
  // Restored to display:none on clearHighlight.
  let hoverRevealedNodes = cy.collection()
  let hoverRevealedEdges = cy.collection()

  // Whether the viewport culler is currently active (non-hover context).
  let cullingActive = false

  /**
   * Returns true if the graph-coordinate point (x, y) lies within the
   * current viewport extent (with a small 50-unit margin so edges near the
   * border don't flicker).
   */
  function inExtent(x, y, ext) {
    return x >= ext.x1 && x <= ext.x2 && y >= ext.y1 && y <= ext.y2
  }

  /**
   * Updates edge display based on viewport culling rules:
   * - zoom < lodEdgeThreshold → hide ALL edges (no arrows at cluster zoom)
   * - otherwise → hide edges where either endpoint is outside the viewport
   * Filter-hidden edges (not in filterVisibleEdges) are never touched here.
   * Edges in hoverForcedEdgeIds bypass culling and are always shown.
   * lodEdgeThreshold is set dynamically by recomputeLodAndApply().
   */
  function applyEdgeCulling() {
    const zoom = cy.zoom()
    const hideAll = zoom < lodEdgeThreshold

    const ext = hideAll ? null : cy.extent()
    const newCulled = new Set()

    cy.batch(() => {
      filterVisibleEdges.forEach(edgeId => {
        // Hover override: always show this edge regardless of viewport.
        if (hoverForcedEdgeIds.has(edgeId)) return

        if (hideAll) {
          newCulled.add(edgeId)
          return
        }

        const edge = cy.getElementById(edgeId)
        if (edge.length === 0) return

        const srcPos = edge.source().position()
        const tgtPos = edge.target().position()
        const srcIn  = inExtent(srcPos.x, srcPos.y, ext)
        const tgtIn  = inExtent(tgtPos.x, tgtPos.y, ext)

        // Hide when either endpoint is off-screen (show only fully on-screen edges).
        if (!srcIn || !tgtIn) {
          newCulled.add(edgeId)
        }
      })

      // Apply display changes only where state actually changed.
      newCulled.forEach(id => {
        if (!culledEdgeIds.has(id)) {
          cy.getElementById(id).style('display', 'none')
        }
      })
      culledEdgeIds.forEach(id => {
        if (!newCulled.has(id)) {
          cy.getElementById(id).style('display', 'element')
        }
      })
    })

    culledEdgeIds = newCulled
    cullingActive = true
  }

  function applyZoomLabels() {
    const zoom = cy.zoom()
    const tier =
      zoom < lodLabelNone      ? 'none' :
      zoom < lodLabelHubsOnly  ? 'hubs' :
                                 'all'

    if (tier === lastZoomTier) return   // no change — skip batch
    lastZoomTier = tier

    cy.batch(() => {
      if (tier === 'none') {
        cy.nodes().removeClass('label-all label-hub')
      } else if (tier === 'hubs') {
        cy.nodes().removeClass('label-all')
        cy.nodes('.hub').addClass('label-hub')
        cy.nodes(':not(.hub)').removeClass('label-hub')
      } else {
        // 'all'
        cy.nodes().addClass('label-all')
        cy.nodes().removeClass('label-hub')
      }
    })
  }

  // Combined handler: labels + edge culling together in one rAF gate.
  // Registered on both 'zoom' and 'pan' so culling tracks pan movement too.
  //
  // Two-tier debouncing:
  //   1. rAF gate (immediate, per-frame): applies current thresholds for smooth
  //      visual feedback on every rendered frame while zooming/panning.
  //   2. 100 ms setTimeout (lodDebounceTimer): triggers the more expensive
  //      visible-node count + threshold recalculation after the viewport settles.
  //      This keeps the O(n) node scan off the animation hot path.
  function onViewportChange() {
    // Tier 1: rAF gate — apply current LOD thresholds this frame.
    if (zoomRafId !== null) return
    zoomRafId = requestAnimationFrame(() => {
      zoomRafId = null
      applyZoomLabels()
      applyEdgeCulling()
    })

    // Tier 2: debounced LOD recalculation — runs 100 ms after last viewport event.
    if (lodDebounceTimer !== null) clearTimeout(lodDebounceTimer)
    lodDebounceTimer = setTimeout(() => {
      lodDebounceTimer = null
      recomputeLodAndApply()
    }, 100)
  }

  cy.on('zoom pan', onViewportChange)

  // ── Combined filter state ─────────────────────────────────────────────────────
  const activeTypes = new Set(ALL_TYPES)
  const activeTags  = new Set(allTags)

  // Whether applyFilters is being called for the very first time (init pass).
  // The first call happens during setup before the user has interacted — we skip
  // the regrouping animation then to avoid an awkward snap on load.
  let filtersInitialized = false

  // True when the user has used shift+click to accumulate multiple tags.
  // False when a plain click set an exclusive single tag (or All was restored).
  // Controls whether applyFilters routes to applyCompactLayout vs applyRegrouping.
  let multiTagMode = false

  document.getElementById('tag-filters').innerHTML = allTags.map(t => `
    <button class="filter-btn active" data-tag="${t}"
      style="--type-color:${TAG_COLORS[t]}">
      ${t}
    </button>`).join('')

  // ── Node counter — positioned at graph origin (spiral centre) ────────────────
  const nodeCounter   = document.getElementById('node-counter')
  const totalConcepts = regularNodes.length

  function updateNodeCounter() {
    const visible = cy.nodes().filter(
      n => n.data('type') !== 'tag' && n.style('display') !== 'none'
    ).length
    nodeCounter.textContent = visible === totalConcepts
      ? `${visible.toLocaleString()} nodes`
      : `${visible.toLocaleString()} / ${totalConcepts.toLocaleString()} nodes`
  }

  function updateCounterPosition() {
    const pan  = cy.pan()
    const zoom = cy.zoom()
    nodeCounter.style.left      = pan.x + 'px'
    nodeCounter.style.top       = pan.y + 'px'
    nodeCounter.style.transform = `translate(-50%, -50%) scale(${zoom})`
  }

  cy.on('pan zoom', updateCounterPosition)

  // Apply zoom labels, then filter (which calls applyEdgeCulling internally).
  // recomputeLodAndApply() runs first to set dynamic thresholds from the initial
  // viewport before any zoom/pan event fires, so the first render is correct.
  recomputeLodAndApply()
  applyFilters()

  // Mark initialization complete — subsequent applyFilters() calls will
  // trigger applyRegrouping() / restoreGlobalLayout() as appropriate.
  filtersInitialized = true
  updateNodeCounter()
  updateCounterPosition()

  // ── Wire search ───────────────────────────────────────────────────────────────
  initializeSearch(cy, graph.nodes, node => {
    pinnedNode = node
    clearHighlight()
    applyHighlight(node, 'near-both')

    cy.animate(
      { center: { eles: node }, zoom: 2.5 },
      { duration: 600, complete: () => { zoomTarget = cy.zoom() } }
    )
  })

  // ── Reset button ──────────────────────────────────────────────────────────────
  document.getElementById('resetBtn').onclick = () => {
    pinnedNode = null
    tooltip.style.display = 'none'
    clearHighlight()
    cy.fit()
  }

  function nodeVisible(node) {
    const type = node.data('type')
    if (type === 'tag') {
      // Ring node visible only if its tag is active AND owns at least one concept node.
      const label = node.data('label')
      return activeTags.has(label) && (clusterSize[label] || 0) > 0
    }
    if (!activeTypes.has(type)) return false
    const tags = node.data('tags') || []
    return tags.length === 0 || tags.some(t => activeTags.has(t))
  }

  // ── Regrouping simulation ─────────────────────────────────────────────────────
  // Runs after applyFilters() when a subset of tags is active.
  // Each visible concept node is attracted to its selection clusterTag ring
  // (highest-priority active tag on that node) instead of its global clusterTag.

  function applyRegrouping() {
    if (!savedClusterRingPos) return

    // Collect visible ring nodes (those in activeTags)
    const activeRingNodes = cy.nodes().filter(n =>
      n.data('type') === 'tag' && n.style('display') !== 'none'
    )

    // Build d3 node list — only visible concept nodes + visible ring nodes (fixed)
    const d3Nodes = []

    cy.nodes().forEach(n => {
      if (n.style('display') === 'none') return
      const pos = n.position()
      const isRing = n.data('type') === 'tag'

      // For each concept node, compute its selCluster:
      // highest-priority active tag among this node's own tags
      let selCluster = null
      if (!isRing) {
        const nodeTags = n.data('tags') || []
        selCluster = selectClusterTag(nodeTags, activeTags)
        // Fallback: if no tag of this node is in activeTags, skip ring attraction
        // (the node is visible because of a type filter or has no tags — leave it in place)
      }

      d3Nodes.push({
        id:        n.id(),
        x:         pos.x,
        y:         pos.y,
        r:         n.width() / 2,
        selCluster,
        isRing,
        fx:        isRing ? pos.x : null,
        fy:        isRing ? pos.y : null,
      })
    })

    // Get the current rendered positions of active ring nodes for attraction targets.
    // We use current cy positions (which reflect any prior drag/layout) rather than
    // the savedClusterRingPos so the reagrouping respects the current ring layout.
    const activeRingPos = new Map()
    activeRingNodes.forEach(rn => {
      const pos = rn.position()
      activeRingPos.set(rn.id(), { x: pos.x, y: pos.y })
    })

    function forceSelRingAttraction(alpha) {
      for (const n of d3Nodes) {
        if (n.isRing) continue
        if (n.fx != null) continue
        if (!n.selCluster) continue
        const ringId = `tag:${n.selCluster}`
        const ringPos = activeRingPos.get(ringId)
        if (!ringPos) continue
        const dx   = ringPos.x - n.x
        const dy   = ringPos.y - n.y
        const dist = Math.hypot(dx, dy) || 1
        const f    = INIT_RING_STRENGTH * (dist - INIT_RING_TARGET_DIST) / dist * alpha
        n.vx = (n.vx || 0) + dx * f
        n.vy = (n.vy || 0) + dy * f
      }
    }

    const sim = forceSimulation(d3Nodes)
      .alpha(0.8)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .force('ring', forceSelRingAttraction)
      .force('collide', forceCollide()
        .radius(n => (n.r || 7) + INIT_COLLISION_PAD)
        .strength(1.0)
        .iterations(3)
      )
      .stop()

    let ticks = 0
    while (sim.alpha() > INIT_ALPHA_THRESHOLD && ticks < INIT_MAX_TICKS) {
      sim.tick()
      ticks++
    }

    // Flush computed positions to Cytoscape
    cy.batch(() => {
      d3Nodes.forEach(n => {
        if (n.isRing) return
        cy.getElementById(n.id).position({ x: n.x, y: n.y })
      })
    })

    // Update physics snapshot so drag knows the new positions
    initPhysics(cy)

    // Animate camera to fit visible elements
    const visibleEles = cy.elements().filter(e => e.style('display') !== 'none')
    cy.animate(
      { fit: { eles: visibleEles, padding: 60 } },
      { duration: 600, complete: () => { zoomTarget = cy.zoom() } }
    )
  }

  function restoreGlobalLayout() {
    if (!savedInitialNodePos) return

    // Restore every node to its exact post-init position — no simulation needed.
    // This is completely independent of any state left by applyCompactLayout or
    // applyRegrouping, so it always produces the original layout.
    // Edge visibility is managed by applyFilters, not here.
    cy.batch(() => {
      cy.nodes().forEach(n => {
        const p = savedInitialNodePos.get(n.id())
        if (p) n.position(p)
      })
    })

    initPhysics(cy)

    const visibleEles = cy.elements().filter(e => e.style('display') !== 'none')
    cy.animate(
      { fit: { eles: visibleEles, padding: 60 } },
      { duration: 600, complete: () => { zoomTarget = cy.zoom() } }
    )
  }

  // ── Compact layout for multi-tag shift+click mode ────────────────────────────
  // Moves ring nodes of activeTags into a compact Archimedean spiral (same
  // formula as the global layout but with a reduced SPIRAL_SPACING).
  // Concept nodes are NOT reassigned — each one keeps its original clusterTag
  // and is attracted to the ring's NEW compact position.
  // Ring nodes outside activeTags remain where they are (they are filter-hidden).

  function applyCompactLayout() {
    if (!savedClusterRingPos) return

    // Collect ring nodes whose tag is in activeTags (these will move).
    const activeRingCy = cy.nodes().filter(n =>
      n.data('type') === 'tag' && activeTags.has(n.data('label'))
    )

    if (activeRingCy.length === 0) return

    // Determine which rings actually attract ≥1 visible concept node in this
    // selection (a ring may be active but all its concept nodes prefer a
    // higher-priority active tag, leaving it empty).
    const usedRingTags = new Set()
    cy.nodes().forEach(n => {
      if (n.data('type') === 'tag' || n.style('display') === 'none') return
      const selTag = selectClusterTag(n.data('tags') || [], activeTags)
      if (selTag) usedRingTags.add(selTag)
    })

    // Hide rings with no attracted nodes so they don't clutter the view.
    cy.batch(() => {
      activeRingCy.forEach(rn => {
        rn.style('display', usedRingTags.has(rn.data('label')) ? 'element' : 'none')
      })
    })

    // Sort only the used active rings by descending cluster size (mirrors global spiral sort).
    const activeRingSorted = activeRingCy.toArray()
      .filter(rn => usedRingTags.has(rn.data('label')))
      .sort((a, b) => (clusterSize[b.data('label')] || 0) - (clusterSize[a.data('label')] || 0))

    // Archimedean spiral with fixed small dθ so consecutive rings are angularly
    // close — this is what makes the spiral arm visually obvious for any N.
    // dθ = 60°: each ring advances 60° and grows radially, tracing a clear arm.
    const nActive          = activeRingSorted.length
    const maxActiveCluster = Math.max(...activeRingSorted.map(rn => clusterSize[rn.data('label')] || 1))
    const COMPACT_SPACING  = SPIRAL_BASE_SCALE * Math.sqrt(maxActiveCluster)
    const COMPACT_START_R  = COMPACT_SPACING * 0.8

    const compactPos = new Map()
    const cPts = spiralPositions(nActive, COMPACT_START_R, COMPACT_SPACING)
    activeRingSorted.forEach((rn, i) => {
      compactPos.set(rn.id(), nActive === 1 ? { x: 0, y: 0 } : cPts[i])
    })

    // Move ring nodes to their compact positions immediately (they are fixed in d3).
    cy.batch(() => {
      activeRingSorted.forEach(rn => {
        const pos = compactPos.get(rn.id())
        if (pos) rn.position(pos)
      })
    })

    // Build d3 node list — only visible concept nodes + active ring nodes (fixed).
    // Concept nodes are seeded near their target compact ring (not current cy pos)
    // so the sim converges fast regardless of where they currently are.
    const d3Nodes = []

    cy.nodes().forEach(n => {
      if (n.style('display') === 'none') return
      const isRing = n.data('type') === 'tag'
      const pos    = n.position()   // for rings this is already the compact position

      const nodeTags = n.data('tags') || []
      let startX = pos.x, startY = pos.y
      if (!isRing) {
        const selTag  = selectClusterTag(nodeTags, activeTags)
        const ringPos = selTag ? compactPos.get(`tag:${selTag}`) : null
        if (ringPos) {
          // Seed in a small disk around the compact ring (same pattern as init layout)
          const size    = clusterSize[selTag] || 1
          const scatter = INIT_SCATTER * Math.sqrt(size)
          const angle   = Math.random() * 2 * Math.PI
          const rr      = Math.sqrt(Math.random()) * scatter
          startX = ringPos.x + Math.cos(angle) * rr
          startY = ringPos.y + Math.sin(angle) * rr
        }
      }

      d3Nodes.push({
        id:         n.id(),
        x:          startX,
        y:          startY,
        r:          n.width() / 2,
        clusterTag: n.data('clusterTag'),
        tags:       nodeTags,
        isRing,
        fx:         isRing ? pos.x : null,
        fy:         isRing ? pos.y : null,
      })
    })

    // Build attraction-target map: for active rings use the new compact positions;
    // for any non-active visible ring use its current cy position (defensive).
    const attractionPos = new Map()
    cy.nodes().filter(n => n.data('type') === 'tag').forEach(rn => {
      if (rn.style('display') === 'none') return
      const compact = compactPos.get(rn.id())
      if (compact) {
        attractionPos.set(rn.id(), compact)
      } else {
        const pos = rn.position()
        attractionPos.set(rn.id(), { x: pos.x, y: pos.y })
      }
    })

    function forceCompactRingAttraction(alpha) {
      for (const n of d3Nodes) {
        if (n.isRing) continue
        if (n.fx != null) continue
        // Use highest-priority selected tag, not the global clusterTag.
        const tag = selectClusterTag(n.tags, activeTags)
        if (!tag) continue
        const ringId  = `tag:${tag}`
        const ringPos = attractionPos.get(ringId)
        if (!ringPos) continue
        const dx   = ringPos.x - n.x
        const dy   = ringPos.y - n.y
        const dist = Math.hypot(dx, dy) || 1
        const f    = INIT_RING_STRENGTH * (dist - INIT_RING_TARGET_DIST) / dist * alpha
        n.vx = (n.vx || 0) + dx * f
        n.vy = (n.vy || 0) + dy * f
      }
    }

    const sim = forceSimulation(d3Nodes)
      .alpha(0.8)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .force('ring', forceCompactRingAttraction)
      .force('collide', forceCollide()
        .radius(n => (n.r || 7) + INIT_COLLISION_PAD)
        .strength(1.0)
        .iterations(3)
      )
      .stop()

    let ticks = 0
    while (sim.alpha() > INIT_ALPHA_THRESHOLD && ticks < INIT_MAX_TICKS) {
      sim.tick()
      ticks++
    }

    // Flush positions to Cytoscape
    cy.batch(() => {
      d3Nodes.forEach(n => {
        if (n.isRing) return
        cy.getElementById(n.id).position({ x: n.x, y: n.y })
      })
    })

    initPhysics(cy)

    const visibleEles = cy.elements().filter(e => e.style('display') !== 'none')
    cy.animate(
      { fit: { eles: visibleEles, padding: 60 } },
      { duration: 600, complete: () => { zoomTarget = cy.zoom() } }
    )
  }

  function applyFilters() {
    cy.batch(() => {
      cy.nodes().forEach(node => {
        node.style('display', nodeVisible(node) ? 'element' : 'none')
      })
      // Rebuild filterVisibleEdges and write display in one pass.
      filterVisibleEdges.clear()
      culledEdgeIds.clear()   // culling state is now stale — reset it
      cy.edges().forEach(edge => {
        // tag-link edges are hidden permanently; shown only on ring hover/click
        // via hoverRevealedEdges in applyHighlight().
        if (edge.data('kind') === 'tag-link') {
          edge.style('display', 'none')
          return
        }
        const visible = nodeVisible(edge.source()) && nodeVisible(edge.target())
        if (visible) {
          filterVisibleEdges.add(edge.id())
          edge.style('display', 'element')
        } else {
          edge.style('display', 'none')
        }
      })
    })
    // Re-apply viewport culling now that filter state is rebuilt.
    applyEdgeCulling()

    // Trigger regrouping only after the initial layout is done (filtersInitialized
    // is set to true at the end of createGraph, after runInitLayout has resolved).
    if (!filtersInitialized) return

    if (activeTags.size >= allTags.length) {
      // All tags active → full global layout.
      restoreGlobalLayout()
    } else if (multiTagMode && activeTags.size >= 2) {
      // Shift+click with 2+ tags: bring their ring nodes together in a compact
      // spiral. Concept nodes keep their original clusterTag assignment.
      applyCompactLayout()
    } else {
      // Single exclusive tag (plain click): regroup concept nodes to their
      // highest-priority active ring (original behavior).
      applyRegrouping()
    }
    updateNodeCounter()
  }

  document.getElementById('filters').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn')
    if (!btn) return
    const type = btn.dataset.type
    if (activeTypes.has(type)) { activeTypes.delete(type); btn.classList.remove('active') }
    else                        { activeTypes.add(type);    btn.classList.add('active')    }
    applyFilters()
  })

  document.getElementById('tag-filters').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn')
    if (!btn) return
    const tag = btn.dataset.tag

    if (e.shiftKey) {
      // Shift+click: accumulate tags — enter multi-tag mode.
      // Ring nodes for all selected tags converge in a compact spiral;
      // concept nodes keep their original clusterTag assignment.
      multiTagMode = true
      if (activeTags.has(tag)) { activeTags.delete(tag); btn.classList.remove('active') }
      else                      { activeTags.add(tag);    btn.classList.add('active')    }
    } else {
      // Plain click: exclusive single-tag mode — regroups concept nodes to
      // their highest-priority active ring (original behavior).
      multiTagMode = false
      activeTags.clear()
      activeTags.add(tag)
      document.querySelectorAll('#tag-filters .filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tag === tag)
      })
    }
    applyFilters()
  })

  // ── All / None quick selectors ────────────────────────────────────────────────
  document.getElementById('toolbar').addEventListener('click', e => {
    const btn = e.target.closest('.filter-quick')
    if (!btn) return
    const { target, action } = btn.dataset
    const selectAll = action === 'all'

    if (target === 'type') {
      ALL_TYPES.forEach(t => selectAll ? activeTypes.add(t) : activeTypes.delete(t))
      document.querySelectorAll('#filters .filter-btn').forEach(b => {
        b.classList.toggle('active', selectAll)
      })
    } else {
      if (selectAll) multiTagMode = false
      allTags.forEach(t => selectAll ? activeTags.add(t) : activeTags.delete(t))
      document.querySelectorAll('#tag-filters .filter-btn').forEach(b => {
        b.classList.toggle('active', selectAll)
      })
    }
    applyFilters()
  })

  // ── Hover mode selector (6 mutually exclusive options) ───────────────────────
  let hoverMode = 'near-both'

  document.getElementById('toolbar').addEventListener('click', e => {
    const btn = e.target.closest('.hover-mode-btn')
    if (!btn) return
    document.querySelectorAll('.hover-mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    hoverMode = btn.dataset.mode
  })

  // ── Hover interactions ────────────────────────────────────────────────────────

  // ── Highlight helpers (shared by hover and pin) ───────────────────────────────
  let pinnedNode = null

  function applyHighlight(node, mode = hoverMode) {
    let related

    if (node.data('type') === 'tag') {
      // Ring node: show all tag members regardless of mode
      const memberEdges = node.connectedEdges('[kind="tag-link"]')
      const members     = memberEdges.connectedNodes().not('[type="tag"]')
      related = members.union(memberEdges)
    } else {
      // Regular node: use supplied mode, strip ring nodes and tag-link edges
      const raw =
        mode === 'tree-both'         ? node.predecessors().union(node.successors()) :
        mode === 'tree-dependents'   ? node.successors()                            :
        mode === 'tree-dependencies' ? node.predecessors()                          :
        mode === 'near-both'         ? node.incomers().union(node.outgoers())       :
        mode === 'near-dependents'   ? node.outgoers()                              :
                                       node.incomers()
      related = raw.not('[type="tag"]').not('[kind="tag-link"]')
    }

    const lit = node.union(related)

    // Temporarily reveal any filter-hidden nodes/edges in the lit set.
    hoverRevealedNodes = lit.nodes().filter(n => n.style('display') === 'none')
    hoverRevealedEdges = lit.edges().filter(e => e.style('display') === 'none')

    hoverForcedEdgeIds = new Set()
    node.connectedEdges().forEach(edge => {
      const eid = edge.id()
      if (filterVisibleEdges.has(eid)) {
        hoverForcedEdgeIds.add(eid)
        if (culledEdgeIds.has(eid)) {
          edge.style('display', 'element')
          culledEdgeIds.delete(eid)
        }
      }
    })

    // PERF: use class-toggle pattern for dim/highlight.
    // Instead of iterating all elements and writing individual opacity values,
    // we add .dimmed to the "not lit" collection and .hover/.neighbor to the lit set.
    // Cytoscape's style engine handles this via cached class rules — O(1) per element
    // in the style pass instead of O(n) JS writes.
    // The .dimmed class is defined in the stylesheet above — no JS style computation.
    cy.batch(() => {
      if (hoverRevealedNodes.length > 0) hoverRevealedNodes.style('display', 'element')
      if (hoverRevealedEdges.length > 0) hoverRevealedEdges.style('display', 'element')
      // Add dimmed to everything NOT in the lit set (replaces old .faded approach,
      // but .faded alias in stylesheet still catches legacy references).
      cy.elements().difference(lit).addClass('dimmed')
      node.addClass('hover')
      related.nodes().addClass('neighbor')
      related.edges().addClass('neighbor')
      lit.nodes().addClass('label-visible')
    })
  }

  function clearHighlight() {
    cy.batch(() => {
      // Remove all interaction classes in one batch call.
      // removeClass on a collection is a single style invalidation, not per-element.
      cy.elements().removeClass('hover neighbor faded dimmed label-visible')
      if (hoverRevealedNodes.length > 0) hoverRevealedNodes.style('display', 'none')
      if (hoverRevealedEdges.length > 0) hoverRevealedEdges.style('display', 'none')
    })
    hoverRevealedNodes = cy.collection()
    hoverRevealedEdges = cy.collection()
    hoverForcedEdgeIds = new Set()
    applyEdgeCulling()
  }

  // ── Hover interactions ────────────────────────────────────────────────────────

  // PERF: debounce hover entry by 30 ms.
  // Fast cursor sweeps over many nodes without pausing should not trigger
  // the full highlight/dim cycle. The debounce absorbs these micro-events.
  // mouseout fires immediately (no debounce) so the graph clears without delay.
  let hoverDebounceTimer = null
  let pendingHoverNode   = null

  function scheduleHover(node, e) {
    // Cancel any pending hover for a different node.
    if (hoverDebounceTimer !== null) {
      clearTimeout(hoverDebounceTimer)
      hoverDebounceTimer = null
    }
    pendingHoverNode = node
    const pos = e.renderedPosition

    hoverDebounceTimer = setTimeout(() => {
      hoverDebounceTimer = null
      if (pinnedNode) return
      applyHighlight(pendingHoverNode)

      if (pendingHoverNode.data('type') === 'tag') {
        const count = pendingHoverNode.data('memberCount') || 0
        tooltip.innerHTML = `<span class="tt-row"><b>Tag:</b> ${pendingHoverNode.data('label')}</span><span class="tt-row"><b>Members:</b> ${count}</span>`
      } else {
        const tags = (pendingHoverNode.data('tags') || []).join(', ') || '—'
        tooltip.innerHTML = `<span class="tt-row"><b>Type:</b> ${pendingHoverNode.data('type')}</span><span class="tt-row"><b>Tags:</b> ${tags}</span>`
      }
      tooltip.style.left    = `${pos.x + 15}px`
      tooltip.style.top     = `${pos.y + 15}px`
      tooltip.style.display = 'flex'
    }, 30)
  }

  cy.on('mouseover', 'node', e => {
    scheduleHover(e.target, e)
  })

  cy.on('mouseout', 'node', () => {
    // Cancel pending hover immediately on mouse-out (no delay needed for clear).
    if (hoverDebounceTimer !== null) {
      clearTimeout(hoverDebounceTimer)
      hoverDebounceTimer = null
    }
    if (pinnedNode) return
    tooltip.style.display = 'none'
    clearHighlight()
  })

  // ── Right-click pin ───────────────────────────────────────────────────────────
  // Right-click a node → pin its tree/near highlight permanently.
  // Right-click the same node again, or right-click empty canvas → unpin.

  document.getElementById('cy').addEventListener('contextmenu', e => e.preventDefault())

  cy.on('cxttap', 'node', e => {
    const node = e.target
    tooltip.style.display = 'none'
    if (pinnedNode && pinnedNode.id() === node.id()) {
      pinnedNode = null
      clearHighlight()
    } else {
      pinnedNode = node
      clearHighlight()
      applyHighlight(node)
    }
  })

  cy.on('cxttap', e => {
    if (e.target !== cy) return
    if (!pinnedNode) return
    pinnedNode = null
    clearHighlight()
  })

  // ── Click / tap ───────────────────────────────────────────────────────────────
  // Opens Wikipedia only — no persistent highlight state so returning to the
  // tab shows the map exactly as it was before clicking.

  cy.on('tap', 'node', e => {
    const node = e.target
    if (node.data('type') === 'tag') {
      // Ring node: toggle pin highlight for this tag cluster
      if (pinnedNode && pinnedNode.id() === node.id()) {
        pinnedNode = null
        clearHighlight()
      } else {
        pinnedNode = node
        clearHighlight()
        applyHighlight(node)
      }
      return
    }
    const wiki = node.data('wikipedia')
    if (wiki) window.open(wiki, '_blank')
  })

  // ── Drag hooks — GUARDA 2 ─────────────────────────────────────────────────────
  // d3 is the sole position authority for *neighbor* nodes during drag.
  // The dragged node itself is moved natively by Cytoscape (cursor tracking);
  // we pin it in d3 via fx/fy so d3 never fights Cytoscape for its position.
  // On release we free the pin — no forced position assignment, no jitter.
  //
  // Ring nodes use an isolated simulation (onRingDragStart): only cluster members
  // react, no dep-edge forces propagate to the rest of the graph.
  // Concept nodes use the normal 2-hop simulation (onDragStart).

  cy.on('grabon', 'node', e => {
    const node = e.target
    const pos  = node.position()

    if (node.data('type') === 'tag') {
      // Isolated ring-drag: only cluster members react, no dep-edge forces.
      const label   = node.data('label')
      const members = clusterMembers[label] || []
      onRingDragStart(node.id(), { x: pos.x, y: pos.y }, members)
    } else {
      // Concept-node drag: lit neighbors (per current hoverMode) attract strongly.
      const raw =
        hoverMode === 'tree-both'         ? node.predecessors().union(node.successors()) :
        hoverMode === 'tree-dependents'   ? node.successors()                            :
        hoverMode === 'tree-dependencies' ? node.predecessors()                          :
        hoverMode === 'near-both'         ? node.incomers().union(node.outgoers())       :
        hoverMode === 'near-dependents'   ? node.outgoers()                              :
                                            node.incomers()
      const litIds = raw.not('[type="tag"]').not('[kind="tag-link"]')
        .nodes().map(n => n.id())
      onDragStart(node.id(), { x: pos.x, y: pos.y }, litIds)
    }
  })

  cy.on('drag', 'node', e => {
    const node = e.target
    const pos  = node.position()
    onDragMove(node.id(), { x: pos.x, y: pos.y })
  })

  cy.on('graboff', 'node', e => {
    onDragEnd(e.target.id())
  })
}
