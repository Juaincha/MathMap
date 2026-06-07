// physics-config.js
// Central source of truth for all force-simulation constants.
// Changing a value here propagates everywhere without touching logic.

// ── fcose layout constants — unused after init-sim refactor ───────────────────
// export const FCOSE_QUALITY          = 'default'
// export const FCOSE_RANDOMIZE        = false
// export const FCOSE_NODE_REPULSION   = 14000
// export const FCOSE_IDEAL_EDGE_LEN   = 150
// export const FCOSE_EDGE_ELASTICITY  = 0.40
// export const FCOSE_GRAVITY          = 0.02
// export const FCOSE_ITERATIONS       = 2500
// export const FCOSE_ANIMATE          = false
// export const FCOSE_FIT              = false
// export const FCOSE_PADDING          = 80
// export const TAG_LINK_IDEAL_LEN     = 90
// export const DEP_EDGE_IDEAL_LEN     = 220
// export const TAG_LINK_ELASTICITY    = 0.80
// export const DEP_EDGE_ELASTICITY    = 0.25
// export const RING_NODE_REPULSION    = 80000
// export const CONCEPT_NODE_REPULSION = 14000

// ── Node sizing ───────────────────────────────────────────────────────────────
// Concept node size = NODE_SIZE_BASE + degree * NODE_SIZE_PER_DEG, capped at NODE_SIZE_MAX.
export const NODE_SIZE_BASE         = 10
export const NODE_SIZE_PER_DEG      = 2
export const NODE_SIZE_MAX          = 30

// ── Ring node spiral seeding ──────────────────────────────────────────────────
// Ring (tag) nodes are seeded on an Archimedean spiral: r(θ) = r₀ + b·θ
// with equal Δθ between consecutive nodes (uniform angular spacing).
// SPIRAL_SPACING: radial gap between consecutive turns — also the primary size
//   dial for the whole spiral (r_max ≈ SPIRAL_SPACING × (1 + SPIRAL_TURNS)).
//   Reduce to compress the spiral; increase to spread it out.
// SPIRAL_TURNS: how many full rotations the spiral spans across all ring nodes.
export const SPIRAL_SPACING         = 500
export const SPIRAL_TURNS           = 2.5

// ── SEED_SCATTER — unused after init-sim refactor (replaced by INIT_SCATTER) ──
// export const SEED_SCATTER           = 25

// ── Initial camera ────────────────────────────────────────────────────────────
// After layout, fit camera to the innermost N% of concept nodes by distance
// from centroid. Guarantees at least this fraction is visible on first load.
export const INITIAL_VIEW_FRACTION  = 0.40

// ── d3-force live simulation (drag interactions) ──────────────────────────────
// Only link springs + collision are used — no global charge force.
// The simulation acts on the dragged node and its direct neighbors only.
export const SIM_ALPHA_START        = 0.4         // energy injected on drag start
export const SIM_ALPHA_DECAY        = 0.06        // fast decay → equilibrium in ~1 s
export const SIM_ALPHA_MIN          = 0.001
export const REST_THRESHOLD         = 0.03        // stop when sufficiently settled
export const DRAG_ALPHA_TARGET      = 0.1         // keeps simulation warm while dragging

// Link (spring) force — pulls neighbors back to rest distance
export const LINK_DISTANCE          = 150         // dep-edge rest length during drag
export const LINK_STRENGTH          = 0.3         // dep-edge spring strength during drag
export const LINK_ITERATIONS        = 2
// tag-link springs are stiffer and shorter: ring node acts as local attractor during drag.
export const TAG_LINK_SIM_DISTANCE  = 160         // rest length of tag-link spring during drag
export const TAG_LINK_SIM_STRENGTH  = 0.8         // strong pull toward ring (linear spring)
// Quadratic ring gravity: applied on top of the linear spring.
// Force magnitude = RING_GRAVITY_STRENGTH × (dist / TAG_LINK_SIM_DISTANCE) per unit.
// At 2× rest distance the force is 2× the linear spring; at 4× it dominates completely.
// Tune upward if distant nodes still escape their ring; tune down if clusters over-collapse.
export const RING_GRAVITY_STRENGTH  = 0.08

// Collision avoidance — only pushes actually-overlapping nodes
export const COLLISION_RADIUS_PAD   = 10
export const COLLISION_STRENGTH     = 1.0
export const COLLISION_ITERATIONS   = 3

// Velocity damping — high value = fast stop
export const VELOCITY_DECAY         = 0.75

// Hard stop: max ms the simulation runs after drag ends
export const PHYSICS_STOP_DELAY_MS  = 1500

// ── Ring-drag attraction loop ─────────────────────────────────────────────────
// While the user drags a ring (tag) node, its concept neighbors are pulled
// toward the ring's current position each rAF frame.
// DRAG_PULL_STRENGTH: fraction of the distance-to-ring moved per frame.
//   0.12 ≈ responsive without overshooting; raise for snappier pull.
export const DRAG_PULL_STRENGTH     = 0.15
// DRAG_PULL_MIN_DIST: nodes already within this many graph-units of the ring
//   are not moved (prevents micro-jitter when nearly touching).
export const DRAG_PULL_MIN_DIST     = 10
// Strength of ring→member attraction during isolated ring-drag simulation.
// Separate from DRAG_PULL_STRENGTH (rAF-shift) — this is a d3-force strength.
export const RING_DRAG_STRENGTH     = 0.5

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

// ── Init-only layout simulation ───────────────────────────────────────────────
// A dedicated d3-force simulation that runs ONCE at startup, before any user
// interaction. Forces: ring attraction + collision only. No dep-edges, no charge.
// After settling, positions are frozen and handed to the normal drag simulation.

// Strength of the target-distance spring toward the clusterTag ring shell.
// Force = INIT_RING_STRENGTH × (dist − INIT_RING_TARGET_DIST) × alpha.
// Nodes farther than target are pulled in; nodes closer than target are pushed out.
// This guarantees convergence to the shell and prevents cross-cluster drift.
export const INIT_RING_STRENGTH    = 0.10

// Target shell distance from ring center to concept node (graph units).
// Nodes settle at approximately this radius around their ring after init layout.
export const INIT_RING_TARGET_DIST = 100

// Extra padding added to each node's radius in the init collision force.
// Larger values push same-ring nodes further apart from each other.
export const INIT_COLLISION_PAD    = 22

// Base scatter radius multiplier for seeding concept nodes around their ring.
// scatter = INIT_SCATTER * sqrt(clusterSize)   (uniform disk)
export const INIT_SCATTER          = 50

// Init simulation stops when alpha drops below this threshold.
export const INIT_ALPHA_THRESHOLD  = 0.01

// Max ticks for the init simulation (safety cap — normal convergence is <300).
export const INIT_MAX_TICKS        = 600
