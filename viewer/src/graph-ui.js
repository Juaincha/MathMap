// graph-ui.js
// Builds the Cytoscape instance, runs fcose layout ONCE (GUARDA 1),
// wires hover/selection/click interactions, and delegates drag physics
// to physics-sim.js.
//
// NOTE: cytoscape.use(fcose) is called in main.js — NOT here.

import cytoscape from 'cytoscape'
import { initializeSearch } from './search.js'
import { initPhysics, onDragStart, onDragMove, onDragEnd } from './physics-sim.js'

import {
  FCOSE_QUALITY,
  FCOSE_RANDOMIZE,
  FCOSE_NODE_REPULSION,
  FCOSE_IDEAL_EDGE_LEN,
  FCOSE_EDGE_ELASTICITY,
  FCOSE_GRAVITY,
  FCOSE_ITERATIONS,
  FCOSE_ANIMATE,
  FCOSE_FIT,
  FCOSE_PADDING,
  ZOOM_LABEL_NONE,
  ZOOM_LABEL_HUBS_ONLY,
  HUB_DEGREE_PERCENTILE,
  ZOOM_DEBOUNCE_MS
} from './physics-config.js'

// ── GUARDA 1: layout runs at most once ────────────────────────────────────────
let layoutDone = false

/**
 * Triggers the fcose layout on `cy`.
 * If called a second time the call is a silent no-op (GUARDA 1).
 * After the layout finishes, initialises the d3 physics snapshot.
 *
 * @param {cytoscape.Core} cy
 * @returns {Promise<void>}
 */
function runLayoutOnce(cy) {
  if (layoutDone) {
    // GUARDA 1: second call is a silent no-op.
    return Promise.resolve()
  }
  layoutDone = true

  return new Promise(resolve => {
    const layout = cy.layout({
      name: 'fcose',

      quality:         FCOSE_QUALITY,
      randomize:       FCOSE_RANDOMIZE,
      animate:         FCOSE_ANIMATE,
      fit:             FCOSE_FIT,
      padding:         FCOSE_PADDING,

      nodeRepulsion:   FCOSE_NODE_REPULSION,
      idealEdgeLength: FCOSE_IDEAL_EDGE_LEN,
      edgeElasticity:  FCOSE_EDGE_ELASTICITY,
      gravity:         FCOSE_GRAVITY,
      numIter:         FCOSE_ITERATIONS,

      nodeSeparation:  30,
      packComponents:  true
    })

    layout.on('layoutstop', () => {
      // Snapshot all positions into the d3 node map right after layout finishes.
      initPhysics(cy)
      resolve()
    })

    layout.run()
  })
}

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

    <div id="tooltip"></div>
  `

  const tooltip = document.getElementById('tooltip')

  // ── Fetch graph data ──────────────────────────────────────────────────────────
  const graph = await fetch(import.meta.env.BASE_URL + 'graph.json')
    .then(r => r.json())

  // ── Degree map for node sizing and hub classification ────────────────────────
  const degreeMap = {}
  graph.nodes.forEach(node => { degreeMap[node.id] = 0 })
  graph.edges.forEach(edge => {
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

  // ── Cluster pre-positioning ───────────────────────────────────────────────────
  // Tags listed in priority order — first match across all groups wins.
  const CLUSTER_GROUPS = [
    ['foundations', 'logic', 'set-theory', 'order-theory'],
    ['algebra', 'abstract-algebra', 'linear-algebra'],
    ['number-theory'],
    ['analysis', 'calculus', 'real-analysis', 'complex-analysis',
     'functional-analysis', 'measure-theory', 'differential-equations'],
    ['geometry', 'differential-geometry', 'topology'],
    ['combinatorics', 'graph-theory', 'algorithms'],
    ['probability'],
  ]

  const TAG_TO_CI = {}
  CLUSTER_GROUPS.forEach((tags, ci) => tags.forEach(t => { TAG_TO_CI[t] = ci }))

  const nodeCI = {}
  graph.nodes.forEach(node => {
    let ci = 0
    let found = false
    ;(node.tags || []).forEach(tag => {
      const t = TAG_TO_CI[tag]
      if (t !== undefined && (!found || t < ci)) { ci = t; found = true }
    })
    nodeCI[node.id] = ci
  })

  // Place cluster centers evenly on a circle, starting at top (−π/2).
  const CLUSTER_R = 5000
  const SCATTER_R = 800
  const clusterCenters = CLUSTER_GROUPS.map((_, i) => {
    const a = (2 * Math.PI * i) / CLUSTER_GROUPS.length - Math.PI / 2
    return { x: Math.cos(a) * CLUSTER_R, y: Math.sin(a) * CLUSTER_R }
  })

  // ── Build Cytoscape elements ──────────────────────────────────────────────────
  const tagsByNode = {}
  graph.nodes.forEach(n => { tagsByNode[n.id] = n.tags || [] })

  const elements = []
  graph.nodes.forEach(node => {
    const firstTag = (node.tags || [])[0]
    const tagColor = firstTag ? TAG_COLORS[firstTag] : '#7f8c8d'
    const center = clusterCenters[nodeCI[node.id]]
    const a = Math.random() * 2 * Math.PI
    const r = Math.sqrt(Math.random()) * SCATTER_R
    elements.push({
      data: { ...node, tagColor },
      position: { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r }
    })
  })
  graph.edges.forEach(edge => {
    const srcTags = tagsByNode[edge.source] || []
    const tgtTags = new Set(tagsByNode[edge.target] || [])
    const crossTag = srcTags.length > 0 && tgtTags.size > 0 && !srcTags.some(t => tgtTags.has(t))
    elements.push({ data: { source: edge.source, target: edge.target, crossTag } })
  })

  // ── Create Cytoscape instance ─────────────────────────────────────────────────
  // Initial layout is 'preset' (no-op); fcose runs below via runLayoutOnce().
  const cy = cytoscape({

    container: document.getElementById('cy'),

    elements,

    wheelSensitivity: 2,

    layout: { name: 'preset' },

    style: [

      {
        selector: 'node',
        style: {
          label: 'data(label)',

          width:  ele => 14 + (degreeMap[ele.id()] || 0) * 2,
          height: ele => 14 + (degreeMap[ele.id()] || 0) * 2,

          'font-size': 10,
          color: '#222',
          'text-valign': 'bottom',
          'text-margin-y': 5,
          // Labels hidden by default — zoom system reveals them selectively.
          'text-opacity': 0,

          'background-color': 'data(tagColor)',

          'transition-property': 'opacity, background-color, text-opacity',
          'transition-duration': '150ms',
          'transition-timing-function': 'ease'
        }
      },


      {
        selector: 'edge',
        style: {
          width: 1.5,
          opacity: 0.35,
          'curve-style': 'bezier',
          'line-color': '#999',
          'target-arrow-color': '#999',
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

      // ── Zoom label classes ──────────────────────────────────────────────────
      // Applied dynamically by the zoom handler.
      // .label-all    → all nodes visible (zoom > ZOOM_LABEL_HUBS_ONLY)
      // .label-hub    → hub nodes only (ZOOM_LABEL_NONE < zoom ≤ ZOOM_LABEL_HUBS_ONLY)
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

      // ── Interaction classes ─────────────────────────────────────────────────
      // Preserved exactly — hover, search.js, and selection depend on these.

      {
        selector: '.hover',
        style: { 'background-color': '#ff9500' }
      },
      {
        selector: '.neighbor',
        style: { opacity: 1 }
      },
      {
        selector: '.faded',
        style: {
          opacity: 0.08,
          'transition-property': 'opacity',
          'transition-duration': '150ms'
        }
      }
    ]
  })

  // ── Run fcose layout ONCE (GUARDA 1) ─────────────────────────────────────────
  await runLayoutOnce(cy)

  // ── Mark hub nodes (computed once; immutable for the session) ─────────────────
  // Hub = top (1 - HUB_DEGREE_PERCENTILE) % by total degree.
  // The class is used by the zoom-label system to show labels at medium zoom.
  cy.batch(() => {
    cy.nodes().forEach(node => {
      const deg = degreeMap[node.id()] || 0
      if (deg >= hubDegreeThreshold) node.addClass('hub')
    })
  })

  // ── Smart zoom label system ───────────────────────────────────────────────────
  // Labels are hidden by default (text-opacity: 0 in base style).
  // Three zoom tiers control which nodes show their label:
  //   < ZOOM_LABEL_NONE      → no labels
  //   ZOOM_LABEL_NONE–ZOOM_LABEL_HUBS_ONLY → hub nodes only (.label-hub)
  //   > ZOOM_LABEL_HUBS_ONLY → all nodes (.label-all)
  // Hover always adds .label-visible to the hovered node regardless of zoom tier.

  let zoomRafId = null
  let lastZoomTier = null   // 'none' | 'hubs' | 'all'

  // ── Edge viewport culling state ───────────────────────────────────────────────
  // Tracks which edges were visible in the last culling pass so we can skip
  // redundant batches. Uses edge id → boolean (true = display:element).
  // Separate from the filter-driven display state — both must agree for an
  // edge to be shown (filterVisible AND inViewport).
  // During hover, hovered node's edges bypass viewport culling.

  // Set of edge IDs that pass the filter (maintained by applyFilters).
  // Pre-populated with ALL edges on init (all filters are active by default).
  // applyFilters() rebuilds this set whenever the filter state changes.
  const filterVisibleEdges = new Set()
  cy.edges().forEach(edge => filterVisibleEdges.add(edge.id()))

  // Set of edge IDs hidden by the viewport culler (subset of filterVisibleEdges).
  let culledEdgeIds = new Set()          // currently culled (display:none) by us

  // Edge IDs force-shown during hover (bypass viewport culling).
  let hoverForcedEdgeIds = new Set()

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
   * - zoom < ZOOM_LABEL_NONE → hide ALL edges (no arrows at cluster zoom)
   * - otherwise → hide edges where BOTH endpoints are outside the viewport
   * Filter-hidden edges (not in filterVisibleEdges) are never touched here.
   * Edges in hoverForcedEdgeIds bypass culling and are always shown.
   */
  function applyEdgeCulling() {
    const zoom = cy.zoom()
    const hideAll = zoom < ZOOM_LABEL_NONE

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
      zoom < ZOOM_LABEL_NONE       ? 'none' :
      zoom < ZOOM_LABEL_HUBS_ONLY  ? 'hubs' :
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
  function onViewportChange() {
    if (zoomRafId !== null) return
    zoomRafId = requestAnimationFrame(() => {
      zoomRafId = null
      applyZoomLabels()
      applyEdgeCulling()
    })
  }

  cy.on('zoom pan', onViewportChange)

  // Apply the initial label + culling state based on the post-layout zoom level.
  applyZoomLabels()
  applyEdgeCulling()

  // ── Wire search ───────────────────────────────────────────────────────────────
  initializeSearch(cy, graph.nodes)

  // ── Reset button ──────────────────────────────────────────────────────────────
  document.getElementById('resetBtn').onclick = () => {
    pinnedNode = null
    tooltip.style.display = 'none'
    clearHighlight()
    cy.fit()
  }

  document.getElementById('tag-filters').innerHTML = allTags.map(t => `
    <button class="filter-btn active" data-tag="${t}"
      style="--type-color:${TAG_COLORS[t]}">
      ${t}
    </button>`).join('')

  // ── Combined filter state ─────────────────────────────────────────────────────
  const activeTypes = new Set(ALL_TYPES)
  const activeTags  = new Set(allTags)

  function nodeVisible(node) {
    if (!activeTypes.has(node.data('type'))) return false
    const tags = node.data('tags') || []
    // Tag-less nodes pass the tag filter; tagged nodes need at least one active tag.
    return tags.length === 0 || tags.some(t => activeTags.has(t))
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
        const visible = nodeVisible(edge.source()) && nodeVisible(edge.target())
        if (visible) {
          filterVisibleEdges.add(edge.id())
          // Viewport culling will set display below; start as element.
          edge.style('display', 'element')
        } else {
          edge.style('display', 'none')
        }
      })
    })
    // Re-apply viewport culling now that filter state is rebuilt.
    applyEdgeCulling()
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
    if (activeTags.has(tag)) { activeTags.delete(tag); btn.classList.remove('active') }
    else                      { activeTags.add(tag);    btn.classList.add('active')    }
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

  function applyHighlight(node) {
    const related =
      hoverMode === 'tree-both'          ? node.predecessors().union(node.successors()) :
      hoverMode === 'tree-dependents'    ? node.successors()                            :
      hoverMode === 'tree-dependencies'  ? node.predecessors()                          :
      hoverMode === 'near-both'          ? node.incomers().union(node.outgoers())       :
      hoverMode === 'near-dependents'    ? node.outgoers()                              :
                                           node.incomers()

    const lit = node.union(related)

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

    cy.batch(() => {
      cy.elements().difference(lit).addClass('faded')
      node.addClass('hover')
      related.nodes().addClass('neighbor')
      related.edges().addClass('neighbor')
      node.addClass('label-visible')
    })
  }

  function clearHighlight() {
    cy.batch(() => {
      cy.elements().removeClass('hover neighbor faded label-visible')
    })
    hoverForcedEdgeIds = new Set()
    applyEdgeCulling()
  }

  // ── Hover interactions ────────────────────────────────────────────────────────

  cy.on('mouseover', 'node', e => {
    if (pinnedNode) return
    const node = e.target
    applyHighlight(node)

    const pos = e.renderedPosition
    const tags = (node.data('tags') || []).join(', ') || '—'
    tooltip.innerHTML = `<span class="tt-row"><b>Type:</b> ${node.data('type')}</span><span class="tt-row"><b>Tags:</b> ${tags}</span>`
    tooltip.style.left    = `${pos.x + 15}px`
    tooltip.style.top     = `${pos.y + 15}px`
    tooltip.style.display = 'flex'
  })

  cy.on('mouseout', 'node', () => {
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
    const wiki = e.target.data('wikipedia')
    if (wiki) window.open(wiki, '_blank')
  })

  // ── Drag hooks — GUARDA 2 ─────────────────────────────────────────────────────
  // d3 is the sole position authority for *neighbor* nodes during drag.
  // The dragged node itself is moved natively by Cytoscape (cursor tracking);
  // we pin it in d3 via fx/fy so d3 never fights Cytoscape for its position.
  // On release we free the pin — no forced position assignment, no jitter.

  cy.on('grabon', 'node', e => {
    const node = e.target
    const pos  = node.position()
    onDragStart(node.id(), { x: pos.x, y: pos.y })
  })

  cy.on('drag', 'node', e => {
    const node = e.target
    const pos  = node.position()
    // Mirror cursor into d3 pin only — do NOT write position back to Cytoscape.
    onDragMove(node.id(), { x: pos.x, y: pos.y })
  })

  cy.on('graboff', 'node', e => {
    // Free d3 pin — smooth handoff, zero position jump (GUARDA 2).
    onDragEnd(e.target.id())
  })
}
