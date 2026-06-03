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
  FCOSE_PADDING
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
        <span class="filter-label">Show tree</span>
        <div class="hover-mode-strip">
          <button class="hover-mode-btn active" data-mode="tree-both">Both</button>
          <button class="hover-mode-btn" data-mode="tree-dependents">Dependents</button>
          <button class="hover-mode-btn" data-mode="tree-dependencies">Dependencies</button>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Show near</span>
        <div class="hover-mode-strip">
          <button class="hover-mode-btn" data-mode="near-both">Both</button>
          <button class="hover-mode-btn" data-mode="near-dependents">Dependents</button>
          <button class="hover-mode-btn" data-mode="near-dependencies">Dependencies</button>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Type</span>
        <div id="filters">
          ${ALL_TYPES.map(t => `
            <button class="filter-btn active" data-type="${t}"
              style="--type-color:${TYPE_COLORS[t]}">
              ${t}
            </button>`).join('')}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Tag</span>
        <div id="tag-filters"></div>
      </div>
    </div>

    <div id="cy"></div>

    <div id="tooltip"></div>
  `

  const tooltip = document.getElementById('tooltip')

  // ── Fetch graph data ──────────────────────────────────────────────────────────
  const graph = await fetch(import.meta.env.BASE_URL + 'graph.json')
    .then(r => r.json())

  // ── Degree map for node sizing ────────────────────────────────────────────────
  const degreeMap = {}
  graph.nodes.forEach(node => { degreeMap[node.id] = 0 })
  graph.edges.forEach(edge => {
    degreeMap[edge.source] = (degreeMap[edge.source] || 0) + 1
    degreeMap[edge.target] = (degreeMap[edge.target] || 0) + 1
  })

  // ── Build Cytoscape elements ──────────────────────────────────────────────────
  const elements = []
  graph.nodes.forEach(node => { elements.push({ data: { ...node } }) })
  graph.edges.forEach(edge => {
    elements.push({ data: { source: edge.source, target: edge.target } })
  })

  // ── Create Cytoscape instance ─────────────────────────────────────────────────
  // Initial layout is 'preset' (no-op); fcose runs below via runLayoutOnce().
  const cy = cytoscape({

    container: document.getElementById('cy'),

    elements,

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

          'background-color': '#888',

          'transition-property': 'opacity, background-color',
          'transition-duration': '150ms',
          'transition-timing-function': 'ease'
        }
      },

      { selector: 'node[type="axiom"]',      style: { 'background-color': '#e74c3c' } },
      { selector: 'node[type="definition"]', style: { 'background-color': '#3498db' } },
      { selector: 'node[type="lemma"]',      style: { 'background-color': '#f39c12' } },
      { selector: 'node[type="theorem"]',    style: { 'background-color': '#27ae60' } },
      { selector: 'node[type="conjecture"]', style: { 'background-color': '#8e44ad' } },
      { selector: 'node[type="corollary"]',  style: { 'background-color': '#16a085' } },
      { selector: 'node[type="structure"]',  style: { 'background-color': '#2980b9' } },
      { selector: 'node[type="concept"]',    style: { 'background-color': '#7f8c8d' } },

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

  // ── Wire search ───────────────────────────────────────────────────────────────
  initializeSearch(cy, graph.nodes)

  // ── Reset button ──────────────────────────────────────────────────────────────
  document.getElementById('resetBtn').onclick = () => {
    cy.fit()
    cy.elements().removeClass('hover neighbor faded')
  }

  // ── Tag colors (HSL evenly spaced) ───────────────────────────────────────────
  const allTags = [...new Set(graph.nodes.flatMap(n => n.tags || []))].sort()

  const TAG_COLORS = {}
  allTags.forEach((tag, i) => {
    const hue = Math.round((i / allTags.length) * 360)
    TAG_COLORS[tag] = `hsl(${hue}, 58%, 42%)`
  })

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
      cy.edges().forEach(edge => {
        const visible = nodeVisible(edge.source()) && nodeVisible(edge.target())
        edge.style('display', visible ? 'element' : 'none')
      })
    })
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

  // ── Hover mode selector (6 mutually exclusive options) ───────────────────────
  let hoverMode = 'tree-both'

  document.getElementById('toolbar').addEventListener('click', e => {
    const btn = e.target.closest('.hover-mode-btn')
    if (!btn) return
    document.querySelectorAll('.hover-mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    hoverMode = btn.dataset.mode
  })

  // ── Hover interactions ────────────────────────────────────────────────────────

  cy.on('mouseover', 'node', e => {
    const node = e.target

    // tree-* modes: transitive (predecessors/successors include nodes + edges).
    // near-* modes: direct 1-hop (incomers/outgoers include nodes + edges).
    const related =
      hoverMode === 'tree-both'          ? node.predecessors().union(node.successors()) :
      hoverMode === 'tree-dependents'    ? node.successors()                            :
      hoverMode === 'tree-dependencies'  ? node.predecessors()                          :
      hoverMode === 'near-both'          ? node.incomers().union(node.outgoers())       :
      hoverMode === 'near-dependents'    ? node.outgoers()                              :
                                           node.incomers()

    const lit = node.union(related)

    cy.batch(() => {
      cy.elements().difference(lit).addClass('faded')
      node.addClass('hover')
      related.nodes().addClass('neighbor')
      related.edges().addClass('neighbor')
    })

    const pos = e.renderedPosition
    tooltip.innerHTML     = `<b>${node.data('label')}</b><br>${node.data('type')}`
    tooltip.style.left    = `${pos.x + 15}px`
    tooltip.style.top     = `${pos.y + 15}px`
    tooltip.style.display = 'block'
  })

  cy.on('mouseout', 'node', () => {
    tooltip.style.display = 'none'
    cy.batch(() => {
      cy.elements().removeClass('hover neighbor faded')
    })
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
