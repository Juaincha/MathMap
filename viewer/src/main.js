import './style.css'
import { createGraph } from './graph-ui'
import coseBilkent from 'cytoscape-cose-bilkent'

cytoscape.use(coseBilkent)
createGraph()