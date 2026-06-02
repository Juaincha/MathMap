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

      nodeSeparation:  12,
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

  document.querySelector('#app').innerHTML = `
    <div id="toolbar">
      <input id="search" placeholder="Search..." autocomplete="off">
      <div id="suggestions"></div>
      <button id="resetBtn">Reset</button>
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
        selector: '.selected',
        style: { 'background-color': '#ff3b30' }
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
    cy.elements().removeClass('selected neighbor faded hover')
  }

  // ── Hover interactions (preserved exactly from original) ──────────────────────

  cy.on('mouseover', 'node', e => {
    const node = e.target
    const lit  = node.closedNeighborhood()

    cy.batch(() => {
      cy.elements().difference(lit).addClass('faded')
      node.addClass('hover')
      lit.nodes().not(node).addClass('neighbor')
      node.connectedEdges().addClass('neighbor')
    })

    const pos = e.renderedPosition
    tooltip.innerHTML     = `<b>${node.data('label')}</b><br>${node.data('type')}`
    tooltip.style.left    = `${pos.x + 15}px`
    tooltip.style.top     = `${pos.y + 15}px`
    tooltip.style.display = 'block'
  })

  cy.on('mouseout', 'node', () => {
    tooltip.style.display = 'none'

    const selected = cy.$('.selected')

    if (selected.length > 0) {
      const neighborhood = selected.closedNeighborhood()
        .union(selected.predecessors())
        .union(selected.successors())

      cy.batch(() => {
        cy.elements().removeClass('hover neighbor faded')
        neighborhood.addClass('neighbor')
        cy.elements().difference(neighborhood).addClass('faded')
        selected.addClass('selected')
      })
    } else {
      cy.batch(() => {
        cy.elements().removeClass('hover neighbor faded')
      })
    }
  })

  // ── Click / tap (preserved exactly from original) ─────────────────────────────

  cy.on('tap', 'node', e => {
    cy.elements().removeClass('selected neighbor faded')

    const node = e.target
    node.addClass('selected')

    const neighborhood = node.closedNeighborhood()
      .union(node.predecessors())
      .union(node.successors())

    neighborhood.addClass('neighbor')
    cy.elements().difference(neighborhood).addClass('faded')

    const wiki = node.data('wikipedia')
    if (wiki) {
      setTimeout(() => window.open(wiki, '_blank'), 200)
    }
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
