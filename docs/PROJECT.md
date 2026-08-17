# Polis

Polis is a browser application for exploring deterministic, random-access procedural
fields. A model is constructed from a string seed and answers synchronous spatial
queries. It does not advance a shared pseudorandom stream or generate a world eagerly.
Instead, each stochastic fact has a structured address, so the same seed and address
always produce the same value regardless of query order, cache state, or navigation
history.

The application contains two models:

- a bounded Poisson-like starfield over an effectively unbounded plane; and
- a random-access diamond-square terrain field on a dyadic lattice.

Both models use the same world-coordinate system and the same addressed-randomness
infrastructure. Their public APIs hide the recursive structures used to calculate their
answers.

## Architecture

The source tree has four main layers:

- `utils/` contains model-independent addressed randomness, distributions, and geometry;
- `models/` contains public model APIs and their internal stochastic engines;
- `helpers/` contains browser- and presentation-facing coordination such as viewport
  state, URL state, performance measurement, and debug dependency extraction; and
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

The public models expose cache usage and `clearCache()`. Cache management affects only
performance; it is not part of either model's semantics.

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
in the half-open interval `[0, 1)`. Other samplers treat this value as a quantile.

Normal samples use an inverse normal CDF with both tails clamped at six standard
deviations. The Poisson sampler clamps its upper quantile at a tail probability of
`2^-32`. Exact stdlib quantiles are used for Poisson means and binomial trial counts up to
1,000.

Above 1,000, Poisson and equal-probability binomial samples use rounded normal
approximations with matching mean and variance. Each approximation is the maximum of its
rounded-normal value and the exact sample at the transition parameter. This anchor keeps
the sampler pointwise monotone across the algorithm switch when the seed and address are
held fixed. These are bounded, deterministic approximations rather than claims of exact
unbounded Poisson or binomial behavior.

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

## Caching and instrumentation

The starfield has separate LRU caches for whole-cell and subdivision results, each with a
capacity of 20,000 entries. The terrain has one 50,000-entry LRU vertex cache. Cache keys
are canonical geometric identities. Clearing a cache or evicting an entry can increase
recursive work but cannot change a returned count, position, or height.

Both internal engines record per-query statistics. Starfield counters include cache hits,
cells evaluated, maximum recursion depth, Poisson samples, population splits, and stars
materialized. Terrain counters include cache hits, vertices evaluated, random values, and
maximum dependency depth.

Each demo displays combined cache occupancy, a cache reset button, estimated sustainable
Canvas draw FPS, and model tile or sample queries per frame. The FPS estimate is derived
from the latest draw duration and capped at 60, so it remains meaningful when a stationary
view requires no redraws.

The CLI complexity benchmark prints tab-separated raw measurements for terrain point
families, inward and outward starfield box queries, and fixed-grid starfield viewport
queries. Separate distribution benchmarks compare exact transforms and complete addressed
samplers.

## User interface

The index links to separate starfield and terrain pages. Each demo has a deterministic
default seed—`Polis 1` for the starfield and `Polis 2` for terrain—and places the live seed
in the browser title. Editing the seed creates a different model instance.

The shared Canvas viewport supports:

- panning with WASD, arrow keys, mouse dragging, or touch dragging;
- zooming with `-` and `=`, a mouse wheel, a trackpad gesture, or a mobile pinch;
- smooth keyboard motion and inertial drag motion;
- a reset flight to the origin and initial scale;
- editable cursor world coordinates; and
- shareable URL state.

Keyboard panning uses a common speed proportional to the square root of visible viewport
area, independent of screen aspect ratio. Zoom is exponential in time. View reset and
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
8. **Sampler monotonicity.** Increasing an ordered sampler parameter while holding its
   seed and address fixed cannot lower its sample in the supported sampler adapters.
9. **Bounded public starfield output.** Large populations remain scalar aggregates, and a
   tile query has a fixed tile-count ceiling.
10. **Synchronous model semantics.** Model calls complete synchronously and do not depend
    on workers, network access, React state, or a global random stream.

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
