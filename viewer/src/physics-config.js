// physics-config.js
// Central source of truth for all force-simulation constants.
// Changing a value here propagates everywhere without touching logic.

// ── fcose layout (runs ONCE on load) ──────────────────────────────────────────
export const FCOSE_QUALITY          = 'default'   // 'draft' | 'default' | 'proof'
export const FCOSE_RANDOMIZE        = false
export const FCOSE_NODE_REPULSION   = 4500        // inter-node push
export const FCOSE_IDEAL_EDGE_LEN   = 80          // spring rest length (px)
export const FCOSE_EDGE_ELASTICITY  = 0.45
export const FCOSE_GRAVITY          = 0.25
export const FCOSE_ITERATIONS       = 2500        // max iterations before stop
export const FCOSE_ANIMATE          = false       // we handle positioning, skip anim
export const FCOSE_FIT              = true
export const FCOSE_PADDING          = 60

// ── d3-force live simulation (drag interactions) ───────────────────────────────
// Alpha controls "energy"; simulation decays until REST_THRESHOLD.
export const SIM_ALPHA_START        = 0.3         // energy injected on drag start
export const SIM_ALPHA_DECAY        = 0.028       // rate at which alpha decays per tick
export const SIM_ALPHA_MIN          = 0.001       // alpha where d3 auto-stops (library default)
export const REST_THRESHOLD         = 0.01        // we stop() explicitly at this alpha

// Link (spring) force
export const LINK_DISTANCE          = 80          // rest length matches fcose ideal
export const LINK_STRENGTH          = 0.4         // spring stiffness [0-1]
export const LINK_ITERATIONS        = 1           // solver iterations per tick

// Many-body (charge) repulsion — applied only during drag to push neighbors
export const CHARGE_STRENGTH        = -120        // negative = repulsion
export const CHARGE_THETA           = 0.9         // Barnes-Hut theta (accuracy vs speed)
export const CHARGE_DIST_MAX        = 300         // cut off charge beyond this radius

// Collision avoidance — prevents overlap during drag shake
export const COLLISION_RADIUS_PAD   = 8           // extra px beyond node visual radius
export const COLLISION_STRENGTH     = 0.7
export const COLLISION_ITERATIONS   = 2

// Center-of-mass force — gentle pull keeping the dragged cluster visible
export const CENTER_STRENGTH        = 0.02

// Velocity damping applied each tick [0-1]; lower = more fluid
export const VELOCITY_DECAY         = 0.4
