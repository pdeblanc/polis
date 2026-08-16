# Polis Starter Project — Technical Design

## 1. Overview

**Polis** is an experimental framework for procedural world simulation built around a different notion of causality from conventional simulation.

A conventional simulation begins with an initial state and advances it forward through time. Querying a state far in the future therefore generally requires computing the states that came before it.

Polis instead aims to define a world as a deterministic function of:

- a **world seed**,
- a **location or region**,
- a **resolution**, and, for dynamic models,
- a **time or time interval**.

The central idea is that computational dependence runs primarily from **low resolution to high resolution**, rather than from past to future. A coarse description of a region can be refined into a more detailed description when needed.

The same query must always produce the same result for the same seed, regardless of:

- the order in which queries are made,
- which other regions have previously been queried, or
- whether results from previous queries have been cached.

Persistent caching must therefore never be required for correctness. Bounded model-scoped caching across queries is allowed and expected.

The long-term goal is for individual model queries to return an amount of data, measured in bits, polynomially bounded in the encoded size of their inputs. Query runtime should also be investigated for polylogarithmic behavior with respect to numeric coordinate magnitude, distance, temporal extent, and requested resolution, but such runtime bounds are conjectural until established.

The starter project will focus on two static models that exercise the core ideas without introducing time-dependent simulation:

1. a **2D bounded Poisson-like starfield**, and
2. a **2D diamond-square terrain field**.

Both models will be exposed through interactive browser visualizations.

---

## 2. Goals

The initial project should establish a small, understandable foundation for later Polis models.

The main goals are:

- deterministic procedural generation from a seed and hierarchical addresses;
- no dependence on global mutable PRNG state;
- random access to local parts of a much larger implicit world;
- hierarchical generation and subdivision;
- model implementations that are independent of the visualization code;
- instrumentation that lets us investigate query complexity;
- interactive visualizations that make the models and their consistency easy to inspect;
- a TypeScript codebase that runs entirely in the browser.

The first version should favor transparency and experimentation over optimization.

Where an algorithm or complexity bound is conjectural rather than proved, the implementation and documentation should say so explicitly.

---

## 3. Non-goals for the starter project

The initial project does **not** need to implement:

- moving agents;
- time-dependent worlds;
- birds, goats, comets, or other dynamic population models;
- persistence of generated world state;
- server-side simulation;
- multiplayer or shared worlds;
- procedural cities, societies, or fantasy-world content;
- a generalized framework capable of representing every future Polis model;
- mathematically optimal implementations.

The architecture should leave room for these directions without attempting to anticipate all of their requirements.

---

## 4. Application architecture

Polis will initially be a client-side TypeScript application using React.

The server has no simulation responsibilities. It only needs to serve the application's static assets and support client-side routing.

A lightweight build system such as **Vite** is appropriate.

For routing, use **React Router**. The application only needs a few conventional client-side routes, and adopting a larger full-stack framework would add concepts that are not useful to the project at this stage.

The initial routes are:

```text
/
    Model index

/starfield
    Interactive bounded Poisson-like starfield demo

/terrain
    Interactive diamond-square terrain demo
```

Additional models can later add additional top-level demo routes.

---

## 5. Proposed source layout

```text
src/
  components/
    Viewport2D.tsx
    CoordinateControls.tsx
    SeedControl.tsx
    ModelStats.tsx
    ...

  helpers/
    ...

  models/
    starfield/
      Starfield.ts
      types.ts
      ...

    terrain/
      DiamondSquareTerrain.ts
      types.ts
      ...

  utils/
    rng/
      address.ts
      addressedRandom.ts
      ...

    distributions/
      uniform.ts
      boundedPoisson.ts
      boundedBinomial.ts
      ...

    geometry/
      ...

    math/
      ...

  pages/
    HomePage.tsx
    StarfieldPage.tsx
    TerrainPage.tsx

  App.tsx
  main.tsx
```

`pages/` is used here because React Router does not impose a filesystem-based route structure. The files represent page-level React components rather than defining routes implicitly from their filenames.

If the routing solution changes later, this directory can be renamed or reorganized without affecting the model implementations.

The directory layout is a working convention rather than an architectural contract. `utils/` contains lower-level facilities on which models may depend. `helpers/` contains higher-level logic that coordinates model queries for views or other consumers.

---

## 6. Separation between models and visualization

The code under `models/` must not depend on React.

Each model has two layers:

- an internal stochastic layer that owns addressed randomness and the minimal recursive queries that define the model; and
- a public API layer that synchronously composes internal facts into operations motivated by concrete consumers.

The public API layer must not have access to random-number generation capabilities. It cannot introduce new stochastic facts. This boundary should be structural: the API layer receives a narrow internal-query interface rather than an RNG or a general context containing one.

All internal and public model APIs are synchronous. Potentially large collections of model calls, scheduling, and rendering loops belong to viewports or higher-level helpers. The starter project does not require cancellation or Web Workers; those should be introduced only in response to measured performance problems.

A model should be usable from:

- a React visualization;
- a unit test;
- a benchmark;
- a command-line experiment; or
- a future simulation model that treats it as a dependency.

For example, the starfield visualization might ask a `Starfield` instance for all points required to render the current viewport, but `Starfield` should know nothing about pixels, mouse events, or React state.

Likewise, the terrain model should expose elevations or terrain samples in world coordinates rather than colors.

Conversion from model values to pixels belongs in `components/` or the relevant page.

---

## 7. World seeds and addressed randomness

Polis must not use a conventional mutable random-number stream as its fundamental source of randomness.

Every model constructor accepts a seed of one shared project-wide `Seed` type, represented initially as an opaque string. The initial models share a synchronous addressed RNG based on the version-specific RapidHash v3.0 entry point.

Instead, random values are addressed.

Conceptually:

[
R(\text{seed},\text{address})\rightarrow\text{random bits}.
]

For example:

```ts
randomU64(seed, address): bigint
```

The same seed and address must always return the same value.

Evaluation order must not matter.

An address describes the identity of a random variable in the implicit world. For example:

```text
starfield / cell / edges (-4, -2, -2, 0) / count

terrain / level 12 / vertex (938, 421) / displacement
```

The RNG accepts an address prefix general enough for each model to describe its random-variable identities. Address components may be strings, finite JavaScript numbers, `bigint` values, or byte arrays. The canonical encoder uses explicit type tags and lengths, normalizes `-0`, rejects malformed Unicode and non-finite numbers, and produces a `Uint8Array` for hashing. Arbitrary JavaScript object serialization is not acceptable.

The user seed string is encoded under a `polis.seed` domain and hashed with RapidHash and a fixed project constant. The resulting 64-bit value seeds RapidHash for model-address queries. A 64-bit collision between user seeds may produce identical worlds; this is an accepted non-cryptographic limitation.

Model-specific addresses should use domain separation so that unrelated random variables cannot accidentally share the same underlying random value.

For example, the following should be distinct random domains even if their remaining address components happen to match:

```text
starfield.count
terrain.vertex-displacement
normal.internal
poisson.internal
```

Distribution parameters should generally **not** be part of the identity of the underlying random choice. Changing the mean or standard deviation of a distribution should reinterpret the same addressed quantile rather than implicitly select an unrelated random variable.

The starter project does not include RNG or address versions. If compatibility versions are needed later, they belong to model construction and are never supplied to individual queries or RNG calls. For now, determinism applies to the same implementation, model configuration, seed, and query; permanent compatibility across future algorithm changes is not promised.

---

## 8. Distribution utilities

Distribution code belongs under `src/utils/distributions/`.

The eventual project is expected to make extensive use of bounded random variables. The starter project should therefore establish the convention that distribution samplers are themselves addressed functions. Only distributions required by the initial models should be implemented.

Examples include:

```ts
uniform(seed, addressPrefix, min, max);

boundedNormal(seed, addressPrefix, mean, standardDeviation);

boundedPoisson(seed, addressPrefix, mean);

boundedBinomial(seed, addressPrefix, n, p);
```

A distribution sampler receives an address prefix and may require multiple underlying random numbers. Those should be generated through private, canonically indexed child addresses derived from that prefix. Algorithms with retries must have a bounded attempt count.

No distribution implementation should consume values from shared mutable PRNG state.

### Bounded distributions

Every primitive distribution with mathematically unbounded support must have explicitly bounded output and worst-case sampling work in Polis. The initial implementation may define one project-wide truncation constant for each distribution family.

For example:

```ts
const MAX_DEVIATIONS = 6;
```

The exact bounding rule must be documented for each distribution. Conditioning, clamping, and finite-support approximation have different effects and must not be treated as interchangeable merely because they use the same constant.

For samplers with an ordered mean parameter, fixing the seed, address prefix, and all other parameters while increasing the mean must never decrease the result. Bounding rules must preserve this pointwise monotonicity. Analogous monotonicity should be specified for other naturally ordered parameters when those samplers are introduced. If this requirement makes a useful bounded distribution substantially more difficult or distorts it unacceptably, bring the tradeoff back for design review rather than silently weakening the distribution or contorting the implementation.

Certified or heuristic region bounds have no consumer in the starter project. Safety factors for such bounds are therefore out of scope and can be designed alongside a future feature that consumes them.

---

## 9. Model 1: Bounded Poisson-like starfield

### 9.1 Purpose

The starfield is the simplest example of a Polis-style spatial population.

It represents an implicit bounded Poisson-like point process in two-dimensional space. It deliberately does not claim to be an exact homogeneous Poisson point process because all primitive distributions with unbounded support are bounded in Polis.

Before bounding, the motivating distribution for a region (A) with area (|A|) is:

[
N(A)\sim\operatorname{Poisson}(\lambda |A|),
]

where (\lambda) is the star density.

The implemented count distribution is determined by the selected bounding rule and must be documented precisely. It should approximate the motivating Poisson behavior while preserving the hierarchy's deterministic consistency and hard bounds.

### 9.2 Hierarchy

Space is represented by a hierarchy of axis-aligned squares. A hierarchy box is characterized geometrically by its four edge coordinates. Its side length is a supported power of two, and each edge coordinate is an integer multiple of that side length. A box's dependency generation need not be part of its identity: boxes with equal side length may have different heights in the dependency graph.

The hierarchy begins with four unit-square cells, one in each quadrant and each having `(0, 0)` as a corner. Each quadrant has a canonical chain of outward expansions with side lengths `1, 2, 4, ...`, anchored at the origin. An expansion preserves the existing cell and samples bounded Poisson-like population for the newly added three quarters. Equivalently, the expanded cell consists of the old cell and three new equal-size siblings, and its count is their sum.

Inward refinement subdivides a box into four equal children. Its population is divided among them using a bounded conditional multinomial distribution so that child counts sum exactly to the parent count. Expansion and subdivision must be inverse views of one canonical parent/child relationship, not alternative ways to generate the same box.

Neighboring hierarchy cells may both own occurrences on a shared geometric boundary. Counts retain generating-cell ownership and are combined additively. Returned coordinates form a multiset and must not be deduplicated.

Stars are stateless, indistinguishable occurrences and have no identity. When a cell's inherited count is at or below a fixed materialization threshold, the internal model materializes positions uniformly inside that cell rather than stochastically subdividing it further.

Every box obtains its population through its immediate canonical dependency ancestor:

- If the dependency ancestor is smaller than the requested box, evaluation performs an outward-expansion step. The smaller box supplies one child population, and three bounded Poisson-like samples supply the other child populations. Together they determine the requested box's population and immediate subdivision. If the expanded box is eligible for materialization, preserve any positions already materialized in the existing child, materialize each new child within its own bounds, and return their union; never rematerialize the existing population across the larger box.
- If the dependency ancestor is larger than the requested box, its query result supplies the requested box's count through the appropriate entry in `childCounts`. If the ancestor has materialized positions, filter those positions into the requested box. Otherwise, materialize uniformly inside the requested box when its inherited count is at or below the threshold.

Once a box has materialized positions, its four child counts are determined by classifying those positions into the immediate child cells. Boundary classification within one parent must use a canonical tie-breaking rule so each occurrence contributes to exactly one child. If a box has not materialized, its immediate child counts are a canonical bounded multinomial/binomial stochastic fact addressed to that parent box.

This immediate-ancestor recursion makes the first sufficiently small population the materialization point without requiring a separate ancestor search. Querying a descendant discovers any materialized ancestor through ordinary recursion and filters the same point multiset, so query strategy and cache state cannot change positions.

The first implementation should use this natural threshold-based scheme and instrument observed recursion depth. It need not select a scale-dependent occupancy cap or maximum-depth fallback before implementation begins. This does not establish a hard worst-case termination bound: experiments can characterize practical behavior but cannot prove the absence of arbitrarily deep paths. If Polis later requires such a bound for this query, revisit a scale-dependent capacity schedule or forced-materialization depth explicitly.

The implementation must guarantee consistency between:

- a count query on a parent;
- count queries on its children; and
- point queries derived from those counts.

### 9.3 Initial API

The internal hierarchy layer needs one foundational query for a supported hierarchy box. The returned four-way subdivision is a stochastic fact owned by the queried parent box:

```ts
type StarfieldCellResult = {
  count: PopulationCount;
  childCounts: readonly [
    PopulationCount,
    PopulationCount,
    PopulationCount,
    PopulationCount,
  ];
  positions?: readonly Coords[];
};

starfield.queryCell(box);
```

`count` is redundant with the sum of `childCounts` but convenient. `PopulationCount` must exactly represent counts throughout the supported coordinate range; its concrete numeric representation is an implementation choice. `positions` is present when this box has materialized its population or inherited materialized positions from an ancestor.

The public API layer adds operations only when required by concrete consumers. It may accept arbitrary boxes or other region shapes, decompose them into internal hierarchy queries, and return counts, materialized positions, or aggregate cells. It has no RNG capability and must not return a position list proportional to an arbitrarily large population.

### 9.4 Demo

The starfield page should render stars in a pannable and zoomable 2D viewport.

As the user zooms in, more precise spatial information should be generated while preserving previously visible coarse facts.

Changing the seed should generate a completely different field.

The page should make it easy to verify that navigating away from a region and returning to it produces the same stars.

When zoomed far out, the renderer may query the count corresponding to each pixel footprint and derive brightness from it rather than materializing individual stars.

---

## 10. Model 2: Diamond-square terrain

### 10.1 Purpose

The terrain model is intended to demonstrate a hierarchical random field whose local values depend on a small DAG of coarser values.

Unlike the starfield, nearby terrain values are correlated.

The implementation should use a random-access version of diamond-square subdivision rather than eagerly generating an entire finite height map. The starter model has a fixed coarsest lattice whose vertex values are i.i.d. addressed random variables. An outward-expanding coarse hierarchy is deferred.

### 10.2 Random-access evaluation

A canonical terrain lattice vertex should be computable recursively from its parent vertices.

Conceptually:

```ts
height(vertex):
    parents = parentsOf(vertex)
    values = parents.map(height)
    return interpolate(values) + addressedRandomDisplacement(vertex)
```

The initial dependency construction should adapt the earlier project's 2-adic lattice rule. For an integer lattice point `(x, y)`, let `d` be the smallest power of two such that `x` and `y` are not both divisible by `2d`. This determines the point's introduction scale.

- If `(x / d) + (y / d)` is even, it is a square-step point. Its four parents are the diagonal points at offsets `(±d, ±d)` on the next coarser lattice.
- If `(x / d) + (y / d)` is odd, it is a diamond-step point. Its four parents are the axial points at offsets `(±d, 0)` and `(0, ±d)`. Some are square-step points introduced at the same scale.

Coarser scales precede finer scales, and square-step values precede diamond-step values within one scale. This ordering must form an acyclic dependency graph even though a diamond-step vertex may depend on square-step vertices introduced at the same scale.

The construction must work for negative coordinates and dyadic refinements below the integer lattice. Terrain coordinates may use finite JavaScript numbers in the prototype because power-of-two subdivision remains exact within supported magnitude and refinement limits. Structural addresses must nevertheless be canonical: normalize `-0`, reject non-finite coordinates, and never infer identity from incidental decimal formatting.

The exact interpolation formula, displacement scale, coordinate encoding, and worked dependency examples will be validated during the terrain implementation. Independently requested neighboring regions must compute identical shared vertices, and recursion must terminate at the fixed coarse lattice.

Repeated dependencies should be memoized in a model-scoped cache using the shared caching policy described below.

### 10.3 Random displacement

Each newly introduced terrain value gets a random displacement determined from:

- the world seed;
- its hierarchical level; and
- its canonical vertex coordinates.

The displacement scale decreases with refinement level.

The random variable should preferably use the bounded/truncated distribution infrastructure established under `utils/`.

### 10.4 Query complexity instrumentation

Previous informal analysis suggests that the number of distinct dependency vertices for a single point may grow only linearly with hierarchy depth, giving approximately logarithmic complexity in world resolution.

The starter implementation should **measure rather than assume** this.

For each explicit terrain API call, instrumentation should be able to report:

- number of unique terrain vertices evaluated;
- cache hits;
- maximum recursion depth;
- number of random values requested.

This will allow empirical plots of query cost versus hierarchy depth and can later support a formal complexity analysis.

The public terrain API is consumer-driven and may later add regular grids, aligned tiles, or arbitrary-coordinate samples. An off-lattice sample uses the nearest vertex on a specified lattice level; the level is required because the union of all dyadic refinement lattices is dense. The visualization derives this level from viewport area and pixel dimensions, subject to a maximum supported terrain refinement level.

### 10.5 Demo

The terrain page should display the height field as either:

- a grayscale or color-mapped height image; or
- another simple 2D terrain visualization.

The first version does not need 3D rendering.

Panning and zooming should trigger only the terrain queries required for the visible region and display resolution.

The visualization should make continuity across tile and viewport boundaries easy to inspect.

---

## 11. Shared 2D viewport

Both demos should use a common `Viewport2D` component rather than implementing independent navigation behavior.

The viewport is described by its center and depicted world-space area, or equivalently the square root of that area:

```ts
type ViewportState = {
  centerX: number;
  centerY: number;
  area: number;
};
```

The component should support:

- click-and-drag panning;
- mouse-wheel or trackpad zooming;
- touch panning;
- pinch-to-zoom where practical;
- programmatic movement to a specified coordinate.

Zooming should preferably preserve the world coordinate under the pointer or gesture center.

World coordinates should remain distinct from screen coordinates throughout the implementation.

Resizing or reshaping the browser preserves depicted world area. World-space width and height adjust to the new screen aspect ratio while keeping their product constant.

Develop viewport behavior alongside the starfield demo, then extract or generalize the shared component before implementing the terrain demo.

---

## 12. Coordinate controls

Each model page should show the current world location as editable controls.

At minimum:

```text
X: [              ]
Y: [              ]
```

The displayed values should update as the viewport pans.

A user can manually enter new values and submit them to move the viewport center to that world coordinate.

A depicted-area control may also be displayed:

```text
Area: [           ]
```

The browser URL should encode the seed, viewport center, and depicted area so an observed view can be reproduced and shared.

---

## 13. Seed controls

Each demo should expose the current world seed.

For example:

```text
Seed: [ polis-demo-1 ]
```

Changing the seed regenerates the logical world.

The seed should be treated as an opaque user-provided value of the shared `Seed` type. The UI converts its text representation into that type, and the addressed RNG maps it to whatever fixed-size representation it requires.

The application should ship with a stable default seed so screenshots and demonstrations are reproducible.

---

## 14. Model statistics and debugging

Interactive visualization is also intended to help investigate algorithmic behavior.

Each demo should have an optional statistics panel.

The initial visible performance display may be limited to model queries issued per frame and frames per second. Detailed model counters should remain available programmatically for tests and CLI benchmarks.

Useful values include:

### Starfield

- hierarchy nodes visited;
- bounded Poisson-like samples generated;
- population splits generated;
- stars materialized;
- maximum hierarchy depth.

### Terrain

- unique vertices evaluated;
- memoization hits;
- random samples generated;
- maximum dependency depth.

These values should represent the current render or most recent explicit query rather than accumulate indefinitely.

Each demo should have a toggleable cursor-following debug overlay. The starfield overlay shows hierarchy information near the cursor, and the terrain overlay shows relevant lattice dependencies near the cursor.

Model-scoped caches use LRU eviction with a project-wide capacity constant for each cache type. Cache capacities may become model-constructor parameters later if a concrete consumer requires it.

Every cached model exposes `clearCache()` for cold benchmarks, tests, and debugging. Clearing or evicting cached values must never alter results.

---

## 15. Rendering strategy

The model should not depend on a particular rendering API.

The first version should use Canvas 2D for the starfield and raster-like terrain. Procedural model evaluation is expected to be the initial CPU bottleneck, so GPU rendering APIs are not justified without profiling evidence.

React should control viewport state and application UI, while imperative canvas drawing can happen inside a dedicated React component.

Interactive controls, labels, text, and accessible UI elements should be ordinary React/HTML elements placed around or layered above the canvas rather than painted into it.

The model should return world-space information; the renderer performs the world-to-screen transformation.

---

## 16. Numerical coordinates and world extent

The conceptual Polis world may be extremely large or unbounded.

The starter implementation uses finite JavaScript `number` coordinates and may document and enforce practical magnitude and refinement limits. It does not initially need arbitrary-precision viewport coordinates.

Hierarchical model addresses should use integer level/cell coordinates wherever practical. Terrain may canonically address finite dyadic coordinates as JavaScript numbers within the supported range, provided it normalizes `-0`, rejects non-finite values, and hashes a canonical representation rather than incidental decimal formatting.

Rendering uses JavaScript `number` values in world coordinates or relative to the current viewport.

A future version may use `bigint` or an exact cell origin plus floating local offset if demos begin exploring locations beyond JavaScript's useful precision range.

---

## 17. Correctness properties

The following properties should be treated as fundamental invariants.

### Determinism

The same model, seed, and query always produce the same result.

### Query-order independence

For queries (A) and (B),

```text
query(A); query(B)
```

must produce the same individual results as:

```text
query(B); query(A)
```

### Cache independence

Clearing every cache between queries must not alter results.

Cache capacity and LRU eviction order must also be semantically invisible.

### Hierarchical consistency

Coarse and fine observations must agree where the model says they describe the same underlying object.

For example, star counts must satisfy:

[
N(P)=\sum_{C\in children(P)}N(C).
]

### Structural addressing

Mathematically identical hierarchy nodes must always have identical random addresses.

### Reproducibility

Tests should be able to use fixed seeds and compare against stable expected values.

### Bounded output

The encoded output size of an individual model query must be polynomially bounded in the encoded size of its input. Large populations are returned as scalar counts or aggregates, never as proportional-size point lists.

### Sampler monotonicity

For samplers with an ordered mean parameter, increasing the mean while holding the seed, address prefix, and other parameters fixed must never decrease the result.

---

## 18. Testing strategy

Unit tests should focus first on invariants rather than visual appearance.

Tests should cover Polis-owned code and integration semantics rather than duplicate the test suites of established libraries. Suitable library implementations should be preferred for prototype infrastructure and mathematical primitives. Polis remains responsible for testing its adapters, canonical addressing, configuration, model invariants, and project-specific bounds.

Important RNG tests include:

- identical address + seed produces identical output;
- evaluation order has no effect;
- independent domains produce distinct addressed random variables;
- distribution samplers are deterministic;
- distribution sampler internals do not perturb unrelated values;
- bounded samplers stay within their declared output and work limits;
- samplers with ordered mean parameters are pointwise monotone, including near truncation boundaries.

Starfield tests should include:

- parent count equals sum of child counts;
- querying children before the parent gives the same result;
- overlapping query strategies recover consistent stars;
- clearing caches changes no results;
- materialized position lists obey the threshold-based materialization rule;
- child counts derived from materialized positions equal the canonical classification of those positions;
- immediate-ancestor recursion produces the same result for expansion and refinement query strategies;
- observed recursion depth is recorded for the natural threshold-based scheme.

Terrain tests should include:

- the same vertex always has the same height;
- parent dependencies are stable;
- querying nearby vertices in different orders gives identical values;
- memoization changes performance but not output;
- recursively generated neighboring regions meet consistently;
- refinement never exceeds the configured maximum level.

Cache tests should verify that:

- clearing a cache changes no result;
- LRU eviction changes no result; and
- each cache remains within its configured capacity.

Statistical tests are needed only for transformations or bounding rules implemented by Polis. They can check that deterministic collections of addressed samples approximately follow their intended distributions, but should remain separate from deterministic correctness tests.

---

## 19. Complexity experiments

One purpose of the starter project is to develop empirical intuition about random-access procedural models.

Benchmarks should therefore parameterize hierarchy depth and record work performed per query.

For the terrain model, evaluate a single finest-scale point at increasing depths and measure:

[
D(k)=
\text{number of distinct dependency vertices visited}.
]

For the starfield, measure the number of hierarchy nodes needed for viewport and box queries as spatial resolution and viewport scale change.

These experiments should produce raw numerical measurements first. Formal asymptotic claims can be added only after the relevant behavior is understood.

Initial experiments may use small Node-based CLI benchmarks. Node and browser runtime characteristics differ, so their timings are comparative order-of-magnitude estimates rather than browser performance guarantees. A dedicated browser benchmark page is deferred.

---

## 20. Initial user experience

The index page should provide a short explanation of Polis and link to the available experiments.

For example:

### Starfield

An infinite-looking field of randomly distributed points generated lazily from a world seed. Explore it by panning and zooming.

### Diamond-square terrain

A correlated procedural height field evaluated locally through hierarchical dependencies rather than generated as one complete map.

Each demo page should include:

- a link back to the model index;
- seed input;
- X coordinate input;
- Y coordinate input;
- depicted-area display or input;
- the main interactive viewport;
- an optional statistics/debug section;
- a short explanation of what the model demonstrates.

The UI should be intentionally simple. The project's main purpose is to make the procedural models inspectable.

---

## 21. Future directions

The initial architecture should leave room for later experiments including:

- higher-dimensional diamond-square-like fields;
- bounded random fields with certified coarse-region bounds;
- moving Poisson populations;
- Brownian-like birds;
- smooth motion using velocity processes;
- queryable latent state attached to populations;
- hierarchical product spaces;
- terrain-dependent movement;
- interval-valued queries whose results tighten during refinement;
- approximate models with explicitly marked safety bounds;
- unbounded spatial and temporal hierarchies.

These should be treated as later models rather than requirements imposed on the starter abstractions.

In particular, we should avoid prematurely creating a single generic "world object" or universal hierarchy interface. The starfield and terrain models can share utilities while retaining model-specific data structures until genuine common abstractions become apparent.

Initial shared machinery should be limited to concrete needs demonstrated by these models: seeds and addressing, the addressed RNG, required distributions, geometry and math utilities, LRU caching and statistics infrastructure, helpers, and UI components. Do not introduce a generic hierarchical stochastic-model framework in the starter project.

---

## 22. Initial implementation sequence

A reasonable first implementation sequence is:

1. Create the Vite + React + TypeScript application and routes.
2. Select the shared seed type, canonical address representation, and addressed RNG primitive after evaluating viable libraries and allocation cost.
3. Implement only the bounded distribution utilities required by the starfield.
4. Implement the bounded Poisson-like starfield model using immediate-ancestor recursion and natural threshold materialization, with recursion-depth instrumentation.
5. Develop the 2D viewport, controls, Canvas renderer, URL state, and cursor-following hierarchy overlay alongside the starfield demo.
6. Extract or generalize shared viewport behavior.
7. Implement the additional bounded distribution utilities required by terrain.
8. Validate and implement the random-access 2D diamond-square dependency graph.
9. Add the terrain Canvas visualization and cursor-following dependency overlay.
10. Add deterministic correctness tests, bound tests, sampler monotonicity tests, and CLI query-complexity experiments throughout implementation.

At the end of this milestone, Polis should already demonstrate its central idea: a user can navigate around an apparently much larger world while the browser computes only the pieces needed for the current query, and every piece remains reproducible solely from its world seed and hierarchical address.
