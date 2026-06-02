// main.js
// Entry point — registers Cytoscape plugins ONCE, then hands off to graph-ui.
// Do NOT call cytoscape.use() anywhere else in the codebase.

import './style.css'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { createGraph } from './graph-ui'

// Single registration point for all Cytoscape extensions.
cytoscape.use(fcose)

createGraph()
