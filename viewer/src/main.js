import './style.css'
import { createGraph } from './graph-ui'
import cytoscape from 'cytoscape'
import coseBilkent from 'cytoscape-cose-bilkent'

cytoscape.use(coseBilkent)
createGraph()