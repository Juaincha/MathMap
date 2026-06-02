import Fuse from 'fuse.js'

export function initializeSearch(cy, nodes) {

  const searchBox =
    document.getElementById('search')

  const suggestions =
    document.getElementById('suggestions')

  const fuse = new Fuse(nodes, {

    keys: ['label'],

    threshold: 0.3
  })

  searchBox.addEventListener('input', () => {

    const query = searchBox.value.trim()

    suggestions.innerHTML = ''

    if (!query) return

    const results =
      fuse.search(query).slice(0, 8)

    results.forEach(result => {

      const div =
        document.createElement('div')

      div.className = 'suggestion'

      div.textContent =
        result.item.label

      div.onclick = () => {

        const node =
          cy.getElementById(result.item.id)

        cy.animate({

          center: {
            eles: node
          },

          zoom: 2.5

        }, {
          duration: 600
        })

        suggestions.innerHTML = ''
      }

      suggestions.appendChild(div)
    })
  })
}