import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { initializeSearch } from './search'

cytoscape.use(fcose)

export async function createGraph() {

  document.querySelector('#app').innerHTML = `
    <div id="toolbar">
      <input id="search" placeholder="Buscar..." autocomplete="off">
      <div id="suggestions"></div>
      <button id="resetBtn">Reset</button>
    </div>

    <div id="cy"></div>

    <div id="tooltip"></div>
  `

  const tooltip = document.getElementById("tooltip")

  const graph = await fetch('/graph.json')
    .then(r => r.json())

  const elements = []

  graph.nodes.forEach(node => {

    elements.push({
      data: {
        ...node
      }
    })
  })

  graph.edges.forEach(edge => {

    elements.push({
      data: {
        source: edge.source,
        target: edge.target
      }
    })
  })

  const degreeMap = {}

  graph.nodes.forEach(node => {

    degreeMap[node.id] = 0
  })

  graph.edges.forEach(edge => {

    degreeMap[edge.source]++
    degreeMap[edge.target]++
  })

  const cy = cytoscape({

    container: document.getElementById('cy'),

    elements,

    style: [

      {
        selector: 'node',
        style: {

          label: 'data(label)',

          width: ele => 14 + degreeMap[ele.id()] * 2,
          height: ele => 14 + degreeMap[ele.id()] * 2,

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

      {
        selector: 'node[type="axiom"]',
        style: {
          'background-color': '#e74c3c'
        }
      },

      {
        selector: 'node[type="definition"]',
        style: {
          'background-color': '#3498db'
        }
      },

      {
        selector: 'node[type="lemma"]',
        style: {
          'background-color': '#f39c12'
        }
      },

      {
        selector: 'node[type="theorem"]',
        style: {
          'background-color': '#27ae60'
        }
      },

      {
        selector: 'node[type="conjecture"]',
        style: {
          'background-color': '#8e44ad'
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
        selector: '.hover',
        style: {

          'background-color': '#ff9500'
        }
      },

      {
        selector: '.selected',
        style: {

          'background-color': '#ff3b30'
        }
      },

      {
        selector: '.neighbor',
        style: {

          opacity: 1
        }
      },

      {
        selector: '.faded',
        style: {

          opacity: 0.08,

          'transition-property': 'opacity',
          'transition-duration': '150ms'
        }
      }
    ],

    layout: {

      name: 'cose-bilkent',

      animate: 'end',

      randomize: false,

      fit: true,

      padding: 50

    }
  })

  initializeSearch(cy, graph.nodes)

  document
    .getElementById('resetBtn')
    .onclick = () => {

      cy.fit()

      cy.elements()
        .removeClass('selected')
        .removeClass('neighbor')
        .removeClass('faded')
    }

  cy.on('mouseover', 'node', e => {

    const node = e.target

    const lit = node.closedNeighborhood()

    cy.batch(() => {

      cy.elements()
        .difference(lit)
        .addClass('faded')

      node.addClass('hover')

      lit.nodes()
        .not(node)
        .addClass('neighbor')

      node.connectedEdges()
        .addClass('neighbor')
    })

    const pos = e.renderedPosition

    tooltip.innerHTML = `
      <b>${node.data('label')}</b><br>
      ${node.data('type')}
    `

    tooltip.style.left = `${pos.x + 15}px`
    tooltip.style.top = `${pos.y + 15}px`
    tooltip.style.display = 'block'
  })

  cy.on('mouseout', 'node', () => {

    tooltip.style.display = 'none'

    const selected = cy.$('.selected')

    if (selected.length > 0) {

      const neighborhood =
        selected.closedNeighborhood()
          .union(selected.predecessors())
          .union(selected.successors())

      cy.batch(() => {

        cy.elements().removeClass('hover neighbor faded')

        neighborhood.addClass('neighbor')

        cy.elements()
          .difference(neighborhood)
          .addClass('faded')

        selected.addClass('selected')
      })

    } else {

      cy.batch(() => {

        cy.elements().removeClass('hover neighbor faded')
      })
    }
  })

  cy.on('tap', 'node', e => {

    cy.elements()
      .removeClass('selected')
      .removeClass('neighbor')
      .removeClass('faded')

    const node = e.target

    node.addClass('selected')

    const neighborhood =
      node.closedNeighborhood()
        .union(node.predecessors())
        .union(node.successors())

    neighborhood.addClass('neighbor')

    cy.elements()
      .difference(neighborhood)
      .addClass('faded')

    const wiki = node.data('wikipedia')

    if (wiki) {

      setTimeout(() => {

        window.open(wiki, '_blank')

      }, 200)
    }
  })
}