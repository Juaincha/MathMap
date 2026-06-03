// physics-config.js
// Central source of truth for all force-simulation constants.
// Changing a value here propagates everywhere without touching logic.

// ── fcose layout (runs ONCE on load) ──────────────────────────────────────────
export const FCOSE_QUALITY          = 'default'   // 'draft' | 'default' | 'proof'
export const FCOSE_RANDOMIZE        = false
export const FCOSE_NODE_REPULSION   = 14000
export const FCOSE_IDEAL_EDGE_LEN   = 150
export const FCOSE_EDGE_ELASTICITY  = 0.40
export const FCOSE_GRAVITY          = 0.08        // central pull; higher → tighter cluster
export const FCOSE_ITERATIONS       = 2500
export const FCOSE_ANIMATE          = false       // we handle positioning, skip anim
export const FCOSE_FIT              = false       // initial camera handled by INITIAL_VIEW_FRACTION
export const FCOSE_PADDING          = 80

// ── Initial seeding geometry ──────────────────────────────────────────────────
// Radius of the circle on which tag-ring nodes are pre-seeded before layout.
// Smaller → clusters start closer to center → gravity needs less work.
export const RING_CIRCLE_R          = 6000

// Power applied to memberCount when computing angular arc widths for ring nodes.
// 0 = equal spacing · 0.5 = sqrt (default, balanced) · 1 = linear to count.
export const RING_SPACING_POWER     = 0.8

// ── Initial camera ────────────────────────────────────────────────────────────
// After layout, fit camera to the innermost N% of concept nodes by distance
// from centroid. Guarantees at least this fraction is visible on first load.
export const INITIAL_VIEW_FRACTION  = 0.40

// ── d3-force live simulation (drag interactions) ───────────────────────────────
// Only link springs + collision are used — no global charge force.
// The simulation acts on the dragged node and its direct neighbors only.
export const SIM_ALPHA_START        = 0.4         // energy injected on drag start
export const SIM_ALPHA_DECAY        = 0.06        // fast decay → equilibrium in ~1 s
export const SIM_ALPHA_MIN          = 0.001
export const REST_THRESHOLD         = 0.03        // stop when sufficiently settled
export const DRAG_ALPHA_TARGET      = 0.1         // keeps simulation warm while dragging

// Link (spring) force — pulls neighbors back to rest distance
export const LINK_DISTANCE          = 150         // matches fcose ideal edge length
export const LINK_STRENGTH          = 0.5
export const LINK_ITERATIONS        = 2

// Collision avoidance — only pushes actually-overlapping nodes
export const COLLISION_RADIUS_PAD   = 10
export const COLLISION_STRENGTH     = 1.0
export const COLLISION_ITERATIONS   = 3

// Velocity damping — high value = fast stop
export const VELOCITY_DECAY         = 0.75

// Hard stop: max ms the simulation runs after drag ends
export const PHYSICS_STOP_DELAY_MS  = 1500

// ── Smart zoom label thresholds ───────────────────────────────────────────────
// Zoom levels that control label visibility.
export const ZOOM_LABEL_NONE        = 0.5   // below this: no labels at all
export const ZOOM_LABEL_HUBS_ONLY   = 1.2   // 0.5–1.2: only hub labels
                                             // above 1.2: all labels
// Top N% by degree are considered hubs (shown at medium zoom).
export const HUB_DEGREE_PERCENTILE  = 0.85  // top 15 % → hubs
// Debounce delay for the zoom handler (ms).
export const ZOOM_DEBOUNCE_MS       = 80

// ── Smooth zoom (continuous, cursor-anchored) ─────────────────────────────────
// ZOOM_WHEEL_SENSITIVITY: log-scale multiplier per normalized pixel of scroll.
//   Higher → faster zoom per scroll tick. Tune first.
export const ZOOM_WHEEL_SENSITIVITY = 0.002
// ZOOM_EASE_FACTOR: lerp factor per frame (0–1). Higher → snappier, lower → smoother.
//   0.12 ≈ Obsidian feel; 0.06 ≈ very liquid.
export const ZOOM_EASE_FACTOR       = 0.12
// ZOOM_REST_EPSILON: stop the rAF loop when |target − current| < this value.
export const ZOOM_REST_EPSILON      = 0.0005
