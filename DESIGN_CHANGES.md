# Changes from the Technical Design

This document records differences between `DESIGN.md` and the current implementation.
It covers deliberate changes, concrete resolutions of choices left open by the design,
and omissions that still require review. Features added without changing a mathematical
or architectural contract are not catalogued here.

## Model nomenclature

The consumer-facing classes are named `Starfield` and `Terrain`. Their internal stochastic
engines are named `HierarchicalStarfield` and `DiamondSquareTerrain`.

The design described public and internal layers but did not settle this naming convention.
The implementation reserves the simple domain names for consumer APIs and gives the
implementation-specific names to classes that expose recursive stochastic facts. This
makes ordinary consumers depend on model concepts rather than on algorithms.

## Starfield public API

### Implemented tiled query

The public API is narrower and more concrete than the arbitrary-region API contemplated
by the design:

```ts
starfield.queryTiles(rectangle, maximumEdgeLength);
```

It selects the coarsest power-of-two grid no coarser than the requested edge length and
returns every aligned tile intersecting the rectangle. Public tiles contain geometric
bounds, a count, and optional positions; they do not expose hierarchy ancestors or
dependency addresses.

This choice is motivated by the Canvas consumer. The renderer requires spatial aggregates
at a requested scale, not one exact count for an arbitrary clipping rectangle. A tiled
query moves grid selection out of the renderer while keeping dependency structure private.
It also has predictable work proportional to the returned tiles and their internal query
costs.

The consumer does not receive hierarchy cells and pass them back to a second method. The
wrapper performs both selection and querying in one operation. This avoids making a
model-owned addressing object part of the public protocol.

### Exact arbitrary-rectangle query omitted

The public model does not implement an exact count-and-positions query for an arbitrary
rectangle.

An exact query would recursively subdivide every hierarchy cell that partially intersects
the target. For a target with non-dyadic edges, boundary cells cannot become geometrically
contained or disjoint after any finite number of subdivisions. They must instead recurse
until their populations are empty or materialized. Under the current threshold-only
materialization rule, that gives useful empirical behavior but no independent hard
termination bound. Pixel-scale consumers could also repeat this boundary traversal many
times.

No implemented consumer requires those semantics, so the method is omitted rather than
exposing a potentially expensive contract without a termination policy.

### Fixed public tile limit

A `queryTiles` call returns at most 65,536 tiles. The design required polynomially bounded
query output but did not specify a public request limit. Without a limit, a small encoded
rectangle and very fine requested edge length could request an exponentially large grid.
The fixed ceiling makes the public output bound explicit and fails before model evaluation.

## Starfield internal API

The design's API sketch used one `queryCell` result containing the parent count and all
four child counts. The implementation instead has:

```ts
hierarchy.queryCell(cell);
hierarchy.querySubdivision(cell);
```

`queryCell` returns only the whole-cell count and optional positions.
`querySubdivision` additionally returns the four immediate child results.

This split follows from outward expansion. For an ordinary refinement, subdivision depends
on the whole-cell result. For an origin-anchored expansion, the whole-cell result depends
on the expansion subdivision because the smaller ancestor supplies one child and three new
Poisson populations supply the others. Separate operations represent this reversal
directly and avoid generating child populations for consumers that only require an
aggregate count.

The four-way subdivision remains a canonical stochastic fact owned by its parent. The API
split changes evaluation structure, not hierarchy semantics.

## Public-layer coupling

The design suggested that a public layer receive a narrow internal-query interface. The
implemented public classes directly construct and own their concrete internal engines.
They still have no RNG reference and cannot create stochastic facts except by invoking the
engine.

This is a deliberate simplification. There is one engine per public model and no alternate
implementation or dependency-injection consumer. Introducing interfaces solely between
these pairs would add abstraction without changing the enforced RNG boundary. Tests and
benchmarks can instantiate the internal engines directly when they need technical queries.

## Distribution algorithms

The design required bounded addressed samplers and parameter monotonicity but left their
exact algorithms open. The implementation resolves those choices as follows.

### Normal

Normal sampling uses an inverse CDF with both quantile tails clamped at six standard
deviations. It consumes one addressed uniform quantile.

### Poisson

Poisson sampling clamps the upper quantile to a tail probability of `2^-32`. Means up to
1,000 use the stdlib inverse CDF. Larger means use a rounded normal approximation with
matching mean and variance.

At large means the returned value is the maximum of the rounded-normal result and the
exact inverse-CDF result at mean 1,000 using the same quantile. The exact transition value
anchors the approximation so switching algorithms does not violate pointwise monotonicity.

### Binomial subdivision

The implementation provides only the equal-probability binomial sampler required by the
starfield. Trial counts up to 1,000 use the stdlib inverse CDF. Larger counts use a rounded
normal approximation with mean `n/2` and variance `n/4`, anchored by the exact result at
1,000 trials for transition monotonicity.

A general `binomial(n, p)` or direct multinomial sampler is omitted because neither model
uses one. Starfield four-way subdivision is expressed as a west/east half split followed
by a south/north half split within each side. This guarantees that the four integer counts
sum exactly to the parent while reusing the minimal sampler required by the artifact.

### Approximation consequences

The large-parameter Poisson and binomial distributions are deterministic bounded
approximations, not exact truncated versions of the corresponding distributions. The
normal approximation changes skewness and discrete tail probabilities. This loss was
accepted in exchange for the measured large-parameter throughput improvement that made
far-zoomed starfield queries practical.

The implementation does not apply a variance correction for rounding the normal sample.
The rounding error is dependent on the sampled value, so treating it as independent
uniform noise with variance `1/12` would not provide a justified correction. This remains
an approximation characteristic rather than an unverified adjustment.

## Starfield materialization and termination

The implementation uses the design's natural materialization threshold without a
scale-dependent occupancy cap or forced maximum depth. Counts at or below 64 materialize;
larger counts remain aggregate populations and subdivide when finer information is
requested.

This is not a change from the permitted initial scheme, but it leaves the same limitation:
there is no proved worst-case recursion bound for every possible seed and arbitrarily deep
query. Complexity instrumentation and tests cover representative depth families rather
than proving termination universally.

## Terrain recurrence

The terrain implementation follows the distance-based recurrence incorporated into the
design:

```text
height(v) = weight(d) × mean(parent heights) + sqrt(d) × Z(v)
```

where displacement variance per world unit is one and `Z(v)` is the shared six-sigma
clamped standard-normal sample. Integer-lattice vertices are independent coarse samples.

Distance-only weights are table-calibrated for the dyadic distances exercised by the
viewer, with a linear asymptotic continuation. This approximates stable marginal variance
without recursively calculating the position-dependent covariance matrix for every
vertex. Because parent values are correlated and innovations are bounded rather than
exactly Gaussian, equal marginal distributions are approximate rather than exact.

This is a resolved mathematical approximation, not a claim that the unweighted
diamond-square recurrence has scale-independent marginals.

## Terrain refinement limits

**Issue for review:** the design refers to a minimum supported terrain spacing and includes
a test requirement that refinement never exceed a configured maximum level. The current
`Terrain` API accepts any positive finite power-of-two spacing that remains representable,
and `DiamondSquareTerrain` recurses until the integer lattice. There is no explicit terrain
minimum spacing or maximum dependency depth.

The shared viewport constrains zoom according to floating-point precision around the
current center, which prevents the UI from requesting indefinitely smaller visible spans.
That is a presentation constraint, not a model-level refinement contract. We should decide
whether finite binary64 representation is the intended model limit or whether `Terrain`
must enforce a named minimum spacing.

## Numeric population representation

**Issue for review:** `PopulationCount` is currently an alias for JavaScript `number`.
The design requires exact counts throughout the supported coordinate range, but the
implementation does not define that range or reject a query whose population can exceed
`Number.MAX_SAFE_INTEGER`.

The public API validates tile indices and limits tile count, but those checks do not bound
the population scalar of a very large tile. We should either establish and enforce a
maximum supported starfield edge length, prove that the bounded sampler stays within safe
integer range over that domain, or change the count representation.

## Cache configuration and verification

Default cache capacities remain project constants: two 20,000-entry caches for the
starfield and one 50,000-entry cache for terrain.

`HierarchicalStarfield` additionally accepts internal cache-capacity options. These exist
to force LRU eviction in inexpensive invariant tests; they are not exposed by the public
`Starfield` constructor and do not make cache sizing part of ordinary model semantics.

Starfield tests verify semantic independence under clearing and forced LRU eviction.
Terrain tests verify clearing and repeated-query cache behavior.

**Issue for review:** terrain does not yet have a forced small-capacity eviction test.
Testing the default 50,000-entry capacity directly would make the unit test unnecessarily
large. The terrain engine could receive the same internal testable-capacity option as the
starfield, or the existing clearing test could be considered sufficient for this artifact.

## Terrain region and seam tests

The design mentions independently generated neighboring regions meeting consistently.
The public terrain API currently samples individual nearest lattice vertices and has no
region or tile result with duplicated boundary storage. Shared vertices are canonical
engine queries, and order-independence tests cover nearby vertices.

No separate region-seam test exists because there is no terrain region abstraction whose
seam behavior could differ. This omission is considered justified for the current API.

## Coordinate control semantics

The design describes editable X and Y controls as moving the viewport center. The
implemented values instead describe the last cursor position in world space. Applying an
edit moves the viewport so the requested coordinate appears at that same screen-space
cursor anchor.

This change keeps the meaning of the displayed and edited quantities consistent. Moving
the requested point to the center would make an input labeled with cursor coordinates act
as a different center-coordinate control. The motion uses the same coupled flight as view
reset, and the draft remains frozen until the flight completes or is interrupted.

## Performance display semantics

The visible `FPS` value is an estimated sustainable draw rate derived from the latest
Canvas draw duration and capped at 60. It is not the inverse of time between redraws.

The application does not continuously redraw a stationary deterministic view, so an
interval-based counter would fall toward zero when no rendering work is necessary. The
implemented metric instead answers whether the latest required draw fit within a nominal
60 Hz frame budget.

`Queries/frame` counts model tiles or samples processed by the renderer, even though one
public `Starfield.queryTiles` call may return many tiles. This preserves a useful measure
of spatial model work after moving grid selection behind the public wrapper.

## Complexity experiments

The terrain benchmark does not refine one vertex through different query parameters,
because a terrain vertex has one intrinsic parent set. It queries different square-step
and diamond-step vertex families whose dyadic introduction spacing becomes finer while
remaining in approximately the same world region.

The CLI emits raw counters and timings. Tests additionally impose conservative linear
guardrails on the measured families. These assertions are regression bounds for the
implemented dependency construction, not formal asymptotic proofs for every dyadic
coordinate.

The dedicated browser benchmark page remains omitted. Node CLI timings are used only for
comparative order-of-magnitude measurements, as allowed by the design.

## Generic framework abstractions

No universal stochastic hierarchy, model context, or world-object interface was added.
The models share seeds, addressed randomness, distributions, geometry, caching libraries,
viewport helpers, and UI components while retaining model-specific recursive types.

This follows the design's instruction to let common model abstractions emerge from
concrete consumers rather than creating a framework in advance.
