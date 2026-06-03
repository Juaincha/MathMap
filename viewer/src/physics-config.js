// physics-config.js
// Central source of truth for all force-simulation constants.
// Changing a value here propagates everywhere without touching logic.

// ── fcose layout (runs ONCE on load) ──────────────────────────────────────────
export const FCOSE_QUALITY          = 'proof'     // 'draft' | 'default' | 'proof'
export const FCOSE_RANDOMIZE        = true        // random seed → mejor separación inicial
export const FCOSE_NODE_REPULSION   = 18000       // más repulsión → nodos más separados
export const FCOSE_IDEAL_EDGE_LEN   = 150         // distancia de resorte más larga
export const FCOSE_EDGE_ELASTICITY  = 0.40
export const FCOSE_GRAVITY          = 0.15        // gravedad más suave → más espacio
export const FCOSE_ITERATIONS       = 5000        // más iteraciones → layout más resuelto
export const FCOSE_ANIMATE          = false       // we handle positioning, skip anim
export const FCOSE_FIT              = true
export const FCOSE_PADDING          = 80

// ── d3-force live simulation (drag interactions) ───────────────────────────────
// Alpha controls "energy"; simulation decays until REST_THRESHOLD.
export const SIM_ALPHA_START        = 0.3         // energy injected on drag start
export const SIM_ALPHA_DECAY        = 0.028       // rate at which alpha decays per tick
export const SIM_ALPHA_MIN          = 0.001       // alpha where d3 auto-stops (library default)
export const REST_THRESHOLD         = 0.02        // stop earlier → menos movimiento post-drag
export const DRAG_ALPHA_TARGET      = 0.12        // alpha target while dragging (keeps simulation warm)

// Link (spring) force
export const LINK_DISTANCE          = 80          // rest length matches fcose ideal
export const LINK_STRENGTH          = 0.4         // spring stiffness [0-1]
export const LINK_ITERATIONS        = 1           // solver iterations per tick

// Many-body (charge) repulsion — applied only during drag to push neighbors
export const CHARGE_STRENGTH        = -80         // negative = repulsion
export const CHARGE_THETA           = 0.9         // Barnes-Hut theta (accuracy vs speed)
export const CHARGE_DIST_MAX        = 300         // cut off charge beyond this radius

// Collision avoidance — prevents overlap during drag shake
export const COLLISION_RADIUS_PAD   = 14          // extra px beyond node visual radius
export const COLLISION_STRENGTH     = 0.9
export const COLLISION_ITERATIONS   = 3

// Center-of-mass force — gentle pull keeping the dragged cluster visible
export const CENTER_STRENGTH        = 0.02

// Velocity damping applied each tick [0-1]; lower = more fluid
export const VELOCITY_DECAY         = 0.65        // amortiguación agresiva → nodos paran rápido

// Seconds after releasing a drag before the simulation is force-stopped
export const PHYSICS_STOP_DELAY_MS  = 2000
