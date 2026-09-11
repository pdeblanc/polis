# Polis

Polis is a browser application for exploring deterministic, random-access procedural
fields and population dynamics. A model is constructed from a string seed and answers synchronous spatial or spacetime
queries. It does not advance a shared pseudorandom stream or generate a world eagerly.
Instead, each stochastic fact has a structured address, so the same seed and address
always produce the same value regardless of query order, cache state, or navigation
history.

The application contains three models:

- a bounded Poisson-like starfield over an effectively unbounded plane;
- a random-access diamond-square terrain field on a dyadic lattice; and
- Birds, an anonymous population moving through one spatial dimension and time.

All models use world-unit coordinates and shared addressed-randomness infrastructure.
Starfield and terrain have two spatial axes; the Birds viewer uses space and time.
Their public APIs hide the recursive structures used to calculate their answers.

## Architecture

The source tree has four main layers:

- `utils/` contains model-independent addressed randomness, distributions, and geometry;
- `models/` contains public model APIs and their internal stochastic engines;
- `helpers/` contains browser- and presentation-facing coordination such as viewport
  state, URL state, performance measurement, debug dependency extraction, and the
  model-consuming Birds tracker; and
- `components/` and `pages/` contain the React and Canvas user interface.

Model code is synchronous and independent of React. Each public model owns its internal
engine and its caches. The presentation layer chooses query resolutions, renders results,
and decides how much work to request per frame.

### Public and internal models

`Starfield` is the consumer-facing starfield model. Its `queryTiles(rectangle,
maximumEdgeLength)` method selects the coarsest power-of-two grid no coarser than the
requested edge length and returns every aligned tile intersecting the rectangle. A tile
contains geometric bounds, a population count, and an optional materialized position
list. The public result does not expose dependency ancestors or stochastic addresses.

A starfield tile query is limited to 65,536 returned tiles. Rectangles must have finite,
strictly increasing bounds, tile sizes must be finite and positive, and derived grid
indices must remain exactly representable as safe integers.

`HierarchicalStarfield` is the internal stochastic engine. It accepts canonical hierarchy
cells and supports separate whole-cell and immediate-subdivision queries. This distinction
allows outward-expansion cells to reverse the ordinary recursion relationship without
forcing every whole-cell query to generate subdivision data.

`Terrain` is the consumer-facing terrain model. Its `sampleNearest(point, spacing)` method
accepts a positive power-of-two spacing, chooses the nearest vertex on that lattice, and
returns the vertex and its height.

`DiamondSquareTerrain` is the internal stochastic engine. It recursively evaluates a
dyadic vertex through its canonical parent set and owns all addressed random displacement.

`Birds` is the consumer-facing population/flow model. It selects instance-scoped
resolution capabilities, returns population profiles at disclosed sampled times, and
answers exact flow and complete incidence queries. Plural results have 65,536-record
ceilings; oversized requests return explicit size-limit results. Refinement/coarsening
and incident-flow methods let consumers continue from canonical cells without exposing
epochs or stages. `queryCachedPopulation` reads cached values without generating missing
populations. `BirdsEngine` owns the stochastic A–H recurrence and its canonical batches.

The public models expose cache usage and `clearCache()`. Cache management affects only
performance; it is not part of any model's semantics.

## Addressed randomness

The shared seed type is `string`. A seed is encoded as the structured address
`["polis.seed", seed]` and hashed with RapidHash using a fixed derivation key. The resulting
64-bit value becomes the RapidHash seed for all model addresses.

Random addresses are arrays whose components may be strings, finite JavaScript numbers,
bigints, or byte arrays. The canonical encoder tags every component by type and uses
length prefixes for variable-sized values. Numbers use their IEEE-754 binary64 encoding,
with negative zero normalized to zero. Bigints use a sign and a big-endian magnitude.
Strings must contain well-formed Unicode. Consequently, values such as `1`, `1n`, and
`"1"` have distinct encodings, and concatenation cannot create ambiguous addresses.

The addressed RNG maps an address directly to a 64-bit value. Distribution samplers may
derive private child addresses when they need multiple values, but model queries do not
carry mutable RNG state.

## Shared distributions

The uniform sampler uses the high 53 bits of an addressed 64-bit value to produce a value
in the half-open interval `[0, 1)`. Inverse-CDF samplers treat this value as a quantile;
rejection samplers can use multiple addressed uniforms.

Normal samples use an inverse normal CDF with both tails clamped at six standard
deviations. The Poisson sampler clamps its upper quantile at a tail probability of
`2^-32`. Exact stdlib quantiles are used for Poisson means and binomial trial counts up to
1,000 in the Poisson and specialized equal-probability binomial adapters.

Above 1,000, Poisson and equal-probability binomial samples use rounded normal
approximations with matching mean and variance. Each approximation is the maximum of its
rounded-normal value and the exact sample at the transition parameter. This anchor keeps
the sampler pointwise monotone across the algorithm switch when the seed and address are
held fixed. These are bounded, deterministic approximations rather than claims of exact
unbounded Poisson or binomial behavior.

Birds additionally uses an arbitrary-probability binomial backed by the stdlib inverse
CDF without that large-count normal approximation. Sequential conditional binomials
produce multinomials with an exact remainder. Addressed H2PE hypergeometric sampling,
with a direct urn path for narrow support and a rejection-attempt cap, supports sequential
multivariate hypergeometric allocations. Exhausting the cap throws instead of fabricating
a sample. The `roundedNormal` utility supplies finite probability tables with clamped
tail atoms and `Math.round` bin semantics; it does not itself sample.

## Starfield model

### Spatial hierarchy

A hierarchy cell is an axis-aligned square. Its edge length is a power of two, and each
edge coordinate is an integer multiple of that length. Four unit cells meet at the origin
and form the roots, one in each quadrant.

Each quadrant has an outward expansion chain with edge lengths `1, 2, 4, ...`, anchored at
the origin. An expanded cell consists of its smaller origin-adjacent ancestor plus three
new siblings of the same size. Every other cell obtains its count from the appropriate
child of its next larger aligned ancestor.

The motivating population density is eight stars per unit area. Root counts and the
three new populations in an expansion use the bounded Poisson sampler. An ordinary
subdivision splits its parent population into west and east halves, then splits each half
into north and south using addressed equal-probability binomial samples. Child counts
therefore sum exactly to their parent count.

The four-way subdivision is a stochastic fact owned by its parent cell. Expansion and
refinement are two views of the same canonical relationship, so query direction cannot
create an alternative population split.

### Materialized stars

When a cell count is at most 64, the engine materializes that many uniformly distributed
positions inside the cell. A materialized ancestor supplies descendants by filtering and
classifying the same position list; positions are not regenerated in each descendant.
Points exactly on a vertical midpoint belong to the eastern child, and points exactly on
a horizontal midpoint belong to the northern child.

Stars have no persistent identity or mutable state; a position is the complete observable
description of an occurrence. Results are multisets. If adjacent generating cells ever
own geometrically equal boundary positions, their occurrences remain additive rather than
being deduplicated.

Cells with larger populations return only scalar counts. The public tiling API therefore
supports large visible populations without returning a list proportional to the number
of stars. Recursive refinement naturally reaches a materialized or empty population in
the workloads exercised by the application. This threshold rule does not impose a
separate fixed maximum recursion depth.

### Rendering

The starfield Canvas requests a power-of-two tile grid chosen from the current world units
per pixel. Materialized stars are drawn individually. A star has a fixed radius in world
units: when its apparent area is at most one pixel, it contributes proportional pixel
brightness; at larger apparent sizes it is drawn as a white disc.

Unmaterialized tiles are drawn as aggregate brightness. Brightness is normalized by tile
area, so zooming out increases population counts without making the average field
artificially brighter.

An optional cursor-following debug overlay displays the canonical hierarchy dependency
chain. The overlay is an explicit diagnostic consumer of the internal hierarchy; normal
starfield rendering uses only the public tiled API.

## Terrain model

### Dyadic dependency graph

Integer-coordinate vertices form the coarse lattice. Their heights are independent,
addressed, clamped-normal values with mean zero and standard deviation one.

For a non-integer dyadic vertex, let `s` be the largest dyadic spacing at which both
coordinates are integer lattice indices. If both indices are odd, the vertex is a square
step and has four diagonal parents at offsets `(±s, ±s)`. Otherwise it is a diamond step
and has four axial parents at offsets `(±s, 0)` and `(0, ±s)`. Integer vertices have no
parents. This relation is acyclic and terminates at the coarse lattice even though some
diamond-step parents belong to the same nominal spacing.

The height recurrence is

```text
height(v) = weight(d) × mean(parent heights) + sqrt(d) × Z(v)
```

where `d` is the geometric distance from the vertex to each parent and `Z(v)` is an
addressed standard-normal displacement clamped at six deviations. Thus displacement
variance, rather than standard deviation, scales linearly with parent distance.

Parent heights are correlated, so an unweighted average would not preserve a stable
marginal variance across resolutions. The implementation uses calibrated weights for the
dyadic distances exercised by the viewer and a distance-based linear continuation beyond
the table. The calibration is a normalization of the existing dependency graph; it does
not add a semantic level field to terrain vertices.

### Rendering

The terrain Canvas selects a power-of-two lattice spacing from the current world units per
pixel and samples the public model at the center of each displayed cell. It deliberately
uses nearest-neighbor presentation: the renderer does not interpolate detail that the
selected lattice has not queried. Height is mapped to a clamped lightness scale.

An optional cursor-following overlay shows the selected vertex, its unique recursive
parents, and dependency edges. Shared ancestors are deduplicated before drawing.

## Birds model

Birds answers random-access population and flow queries without advancing a simulation
clock. Cells are half-open spatial intervals at exact times; flows carry integer counts
between cells. Populations and flows have no persistent individual identities.

The coarse width and duration are 16 and 256. Coarse cells have deterministic population
`Math.round(populationDensity * 16)` and translated, reflection-symmetric coarse flows.
Each refinement epoch halves spatial width and quarters duration. Temporal multinomials
split flows through midpoint cells; spatial binomials split cell populations;
hypergeometric incidence allocations and reconciliation preserve both endpoint margins.
The midpoint innovation variance is `diffusionRate * duration / 4`. Four finite tables
cover the two midpoint alignments and two normalized durations.

A hierarchy-closed finite motion support bounds dependency enumeration for fixed
parameters within the numeric/resource domain. Pure geometry classifiers return
construction and ownership facts. Canonical addressed batches, not query traversal,
determine every stochastic split. Exact conservation applies within the safe-integer
domain; finite output does not guarantee fast queries at every scale or parameter.

The immutable `Sighting` helper retains nested cells ending in a singleton. Its only
random choice selects a starting population rank. Movement follows singleton flows,
tries asymmetric endpoint narrowing before shorter-time refinement, and coarsens when
possible. Public display cells may contain several birds; internal movement is backed
by singleton evidence. Query/refinement budgets and numerical-resolution limits produce
explicit failures, which the viewer presents as partial tracks.

The spacetime Canvas draws timestamped population bands, with the future upward, plus
incident-flow and tracked-path overlays. Birds has internal dependency tracing for tests,
but no visual dependency overlay; that presentation is deferred. Touching bands are a rendering
convention, not an assertion about populations between sample times. Parabolic zoom,
prefetching, and cached-only scale-transition fades support navigation.

The v1 prototype and investigation milestone is complete, with documented limitations.
Measurements found local marginal biases and excess motion from spatial mixing;
the model is not an exact Poisson–Brownian process. The broader evaluation campaign is
not complete. The [Birds overview](./BIRDS_OVERVIEW.md) explains the construction,
features, findings, and departures from its proposal; the
[acceptance audit](./BIRDS_ACCEPTANCE_AUDIT.md) records verification and deferrals.

## Caching and instrumentation

The starfield has separate LRU caches for whole-cell and subdivision results, each with a
capacity of 20,000 entries. The terrain has one 50,000-entry LRU vertex cache. Cache keys
are canonical geometric identities. Clearing a cache or evicting an entry can increase
recursive work but cannot change a returned count, position, or height.

Birds uses bounded approximate-LRU caches for populations, flows, and owned batches.
Its counters include evaluated entities/batches, cache hits, sampler calls, and dependency
depth; optional profiling separates classifier, cache, distribution, and hashing work.

All internal engines record per-query statistics. Starfield counters include cache hits,
cells evaluated, maximum recursion depth, Poisson samples, population splits, and stars
materialized. Terrain counters include cache hits, vertices evaluated, random values, and
maximum dependency depth.

Each demo displays combined cache occupancy, a cache reset button, estimated sustainable
Canvas draw FPS, and model tile or sample queries per frame. The FPS estimate is derived
from the latest draw duration and capped at 60, so it remains meaningful when a stationary
view requires no redraws.

The CLI complexity benchmark prints tab-separated raw measurements for terrain point
families, inward and outward starfield box queries, and fixed-grid starfield viewport
queries, plus Birds entry-flow ancestry by epoch and diffusion. Birds also has tracker
diagnostics and cold/warm engine and viewport profiles. Separate distribution benchmarks
compare exact transforms and complete addressed samplers.

## User interface

The index links to starfield, terrain, and Birds pages. Their deterministic default seeds
are `Polis 1`, `Polis 2`, and `Polis 3`, respectively; each places the live seed in the
browser title. Editing the seed creates a different model instance. Birds also exposes
population density and diffusion rate as editable, URL-persisted model parameters.

The shared Canvas viewport supports:

- panning with WASD, arrow keys, mouse dragging, or touch dragging;
- zooming with `-` and `=`, a mouse wheel, a trackpad gesture, or a mobile pinch;
- smooth keyboard motion and inertial drag motion;
- a reset flight to the origin and initial scale;
- editable cursor world coordinates; and
- shareable URL state.

Starfield and terrain keyboard panning uses a common world-speed factor proportional to
the square root of visible viewport area, independent of screen aspect ratio. Birds
accounts for its different spatial and temporal scales to keep screen-space pan speeds
equal in both axes. Zoom is exponential in time; Birds scales temporal span as the square
of spatial span. View reset and
coordinate jumps use a coupled bounded-acceleration flight. A coordinate edit remains
frozen and read-only during that flight, and the destination is anchored at the same
screen position that supplied the edited cursor coordinates.

Viewport URLs encode the seed, center, and visible area. Values equal to page defaults are
omitted. Updates are debounced and use history replacement so continuous navigation does
not flood the browser's history or navigation IPC. Page overscroll is disabled, Canvas
wheel handling is explicitly non-passive, and held navigation keys are cleared when focus,
visibility, or context-menu state interrupts normal key delivery.

The browser tab title is `Polis` on the index and includes the current seed on each demo.
Interactive HTML controls and status widgets are layered above the Canvas rather than
painted into it.

## Abstract invariants

The implementation maintains the following cross-cutting invariants:

1. **Determinism.** A fixed seed and stochastic address always produce the same fact.
2. **Query-order independence.** Evaluating related regions or vertices in a different
   order does not change their results.
3. **Cache independence.** Empty, populated, cleared, and evicted caches are semantically
   equivalent.
4. **Canonical addressing.** Equivalent mathematical facts use the same typed address,
   while distinct domains and component types remain distinct.
5. **Hierarchical consistency.** Starfield child populations sum to their parent, and
   materialized descendants contain the canonical filtered subset of ancestor positions.
6. **Terrain consistency.** A dyadic vertex has one canonical parent set and one height,
   shared by every query that reaches it.
7. **Bounded stochastic primitives.** Normal and Poisson tails are truncated, and large
   discrete samples use bounded approximations.
8. **Sampler monotonicity.** Scalar inverse-CDF adapters and the anchored approximation
   adapters have their specified ordered-parameter couplings. This is not a blanket
   guarantee for arbitrary multivariate parameter changes: production Birds multinomials
   do not claim complete-outcome likelihood-ratio monotonicity. A separate experimental
   Poisson-race sampler investigates that property.
9. **Bounded public starfield output.** Large populations remain scalar aggregates, and a
   tile query has a fixed tile-count ceiling.
10. **Synchronous model semantics.** Model calls complete synchronously and do not depend
    on workers, network access, React state, or a global random stream.
11. **Birds conservation and ownership.** Spatial child counts and complete incident
    flow totals agree with their cell populations; each random batch has one owner.
    Structurally legal unsupported flows have count zero. Exact arithmetic claims are
    restricted to the safe-integer domain.
12. **Exact Birds continuation.** Capabilities belong to one model instance, population
    snapping is disclosed, and exact flow endpoints are not independently resnapped.

## Verification

The Vitest suite exercises canonical address encoding, addressed RNG determinism,
distribution bounds and transition monotonicity, viewport geometry, URL behavior, model
API validation, hierarchy geometry, query-order and cache independence, population and
position consistency, terrain parent geometry, marginal terrain normalization, debug
dependency extraction, and empirical complexity guardrails.

Complexity tests bound terrain dependency growth by dyadic depth, starfield box recursion
by hierarchy depth, and viewport work by query count and scale. These guards detect
accidental algorithmic explosions without treating Node timing as a browser performance
guarantee. Production verification also includes TypeScript project compilation, ESLint,
and a Vite build.

Birds tests cover support closure, classifiers and owner projections, A–H conservation,
decreasing dependency ranks, order/cache invariance, public capability/limit semantics,
and budgeted singleton tracking. Controlled multi-step traces check collision retries,
identity-preserving rescaling, coarsening, and immutable prior sightings in both directions.
The Birds complexity guardrails bound tested dependency depths, not all recursive work.

Separate characterization reports compare population/flow laws, displacement, bridges,
and trajectories with Poisson–Brownian references, including anonymous tracking over
labeled Brownian paths on a ring. These measure approximation quality rather than
silently redefining the model. A resumable standard-A evaluation collector and separate
saved-data bootstrap/TV analysis have tests; the full campaign, batches B–F, and broader
resource matrix remain outstanding. See the [evaluation runbook](./BIRDS_EVALUATION_RUNBOOK.md).
