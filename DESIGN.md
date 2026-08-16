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

Persistent caching must therefore never be required for correctness. Caching of intermediate results during a single query is allowed and expected.

The long-term goal is to make many queries take time polynomial in the logarithm of the size, distance, temporal extent, or requested resolution of the simulated world.

The starter project will focus on two static models that exercise the core ideas without introducing time-dependent simulation:

1. a **2D Poisson starfield**, and
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
    Interactive Poisson starfield demo

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
      randomBits.ts
      address.ts
      ...

    distributions/
      uniform.ts
      normal.ts
      truncatedNormal.ts
      poisson.ts
      truncatedPoisson.ts
      binomial.ts
      truncatedBinomial.ts
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

---

## 6. Separation between models and visualization

The code under `models/` must not depend on React.

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
starfield / root-cell / (3, -7) / count

terrain / level 12 / vertex (938, 421) / displacement
```

Addresses should have a canonical structured representation. Floating-point world coordinates should not be used directly as random addresses.

Model-specific addresses should use domain separation so that unrelated random variables cannot accidentally share the same underlying random value.

For example, the following should be distinct random domains even if their remaining address components happen to match:

```text
starfield.count
terrain.vertex-displacement
normal.internal
poisson.internal
```

Distribution parameters should generally **not** be part of the identity of the underlying random choice. Changing the mean or standard deviation of a distribution should reinterpret the same addressed quantile rather than implicitly select an unrelated random variable.

---

## 8. Distribution utilities

Distribution code belongs under `src/utils/distributions/`.

The eventual project is expected to make extensive use of bounded random variables. The starter project should therefore establish the convention that distribution samplers are themselves addressed functions.

Examples include:

```ts
uniform(seed, address, min, max);

normal(seed, address, mean, standardDeviation);

truncatedNormal(seed, address, mean, standardDeviation, maxDeviations);

poisson(seed, address, mean);

truncatedPoisson(seed, address, mean, maxDeviations);

binomial(seed, address, n, p);

truncatedBinomial(seed, address, n, p, maxDeviations);
```

A distribution sampler may require multiple underlying random numbers. Those should be generated through private child addresses derived from the distribution's input address.

No distribution implementation should consume values from shared mutable PRNG state.

### Global truncation policy

A later Polis model may establish a global maximum standardized deviation for primitive distributions.

For example:

```ts
const MAX_DEVIATIONS = 6;
```

The exact policy does not need to be finalized for the initial starfield and terrain models, but the utilities should be designed with this use case in mind.

Separately, algorithms that rely on conjectured geometric or probabilistic bounds should use an explicit multiplier such as:

```ts
const SAFETY_FACTOR = ...;
```

A guessed mathematical coefficient should remain distinct from the operational safety factor.

---

## 9. Model 1: Poisson starfield

### 9.1 Purpose

The starfield is the simplest example of a Polis-style spatial population.

It represents an implicit homogeneous Poisson point process in two-dimensional space.

For a region (A) with area (|A|),

[
N(A)\sim\operatorname{Poisson}(\lambda |A|),
]

where (\lambda) is the star density.

Counts in disjoint regions are independent.

### 9.2 Hierarchy

Space will be represented by a hierarchy of axis-aligned boxes.

A box has a stable structural address derived from:

- its hierarchy level; and
- its integer coordinates at that level.

A coarse box has a Poisson-distributed population count.

When subdivided, its population is divided among its children using a conditional multinomial distribution so that child counts sum exactly to the parent count.

In 2D, a box can initially subdivide into four equal children.

If a node contains very few stars, the implementation may directly assign continuous positions to those stars rather than continuing to subdivide indefinitely.

The implementation must guarantee consistency between:

- a count query on a parent;
- count queries on its children; and
- point queries derived from those counts.

### 9.3 Initial API

The exact API can evolve, but the model should support operations conceptually similar to:

```ts
starfield.count(box);
starfield.points(box, resolution);
```

`count(box)` returns the exact implicit population of a supported hierarchical box.

`points(box, resolution)` returns the point locations needed to display that region at the requested resolution.

The implementation should avoid generating points outside the region required by the query.

### 9.4 Demo

The starfield page should render stars in a pannable and zoomable 2D viewport.

As the user zooms in, more precise spatial information should be generated while preserving previously visible coarse facts.

Changing the seed should generate a completely different field.

The page should make it easy to verify that navigating away from a region and returning to it produces the same stars.

---

## 10. Model 2: Diamond-square terrain

### 10.1 Purpose

The terrain model is intended to demonstrate a hierarchical random field whose local values depend on a small DAG of coarser values.

Unlike the starfield, nearby terrain values are correlated.

The implementation should use a random-access version of diamond-square subdivision rather than eagerly generating an entire finite height map.

### 10.2 Random-access evaluation

A terrain vertex should be computable recursively from its parent vertices.

Conceptually:

```ts
height(vertex):
    parents = parentsOf(vertex)
    values = parents.map(height)
    return interpolate(values) + addressedRandomDisplacement(vertex)
```

Repeated dependencies during a query should be memoized.

Caching across separate queries is allowed as a performance optimization later but must never be required for correctness.

The first implementation should preferably use a per-query cache so query complexity can be measured directly.

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

For each terrain query, instrumentation should be able to report:

- number of unique terrain vertices evaluated;
- cache hits;
- maximum recursion depth;
- number of random values requested.

This will allow empirical plots of query cost versus hierarchy depth and can later support a formal complexity analysis.

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

The viewport state should include at least:

```ts
type ViewportState = {
  centerX: number;
  centerY: number;
  zoom: number;
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

A zoom or scale control may also be displayed:

```text
Scale: [          ]
```

or

```text
Zoom: [           ]
```

The browser URL does not initially need to encode coordinates, although that could be useful later for shareable views.

---

## 13. Seed controls

Each demo should expose the current world seed.

For example:

```text
Seed: [ polis-demo-1 ]
```

Changing the seed regenerates the logical world.

The seed should be treated as an opaque user-provided value. A utility can deterministically map strings to the fixed-size key representation needed by the underlying RNG.

The application should ship with a stable default seed so screenshots and demonstrations are reproducible.

---

## 14. Model statistics and debugging

Interactive visualization is also intended to help investigate algorithmic behavior.

Each demo should have an optional statistics panel.

Useful values include:

### Starfield

- hierarchy nodes visited;
- Poisson samples generated;
- population splits generated;
- stars materialized;
- maximum hierarchy depth.

### Terrain

- unique vertices evaluated;
- memoization hits;
- random samples generated;
- maximum dependency depth.

These values should represent the current render or most recent explicit query rather than accumulate indefinitely.

A later development/debug mode can visualize hierarchy boundaries and dependency nodes directly.

---

## 15. Rendering strategy

The model should not depend on a particular rendering API.

For the first version, the visualization may use either:

- HTML Canvas, or
- SVG where the number of visible objects remains manageable.

Canvas is likely preferable for the starfield and raster-like terrain because it handles large numbers of primitives efficiently.

React should control viewport state and application UI, while imperative canvas drawing can happen inside a dedicated React component.

The model should return world-space information; the renderer performs the world-to-screen transformation.

---

## 16. Numerical coordinates and world extent

The conceptual Polis world may be extremely large or unbounded.

The starter implementation does not need arbitrary-precision spatial coordinates everywhere, but coordinate representation should be chosen carefully.

Hierarchical model addresses should use integer level/cell coordinates wherever possible.

Rendering can convert those coordinates to JavaScript `number` values relative to the current viewport.

This avoids making the identity of procedural objects depend on floating-point rounding.

A future version may use `bigint` for hierarchical coordinates if demos begin exploring locations beyond JavaScript's exact integer range.

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

---

## 18. Testing strategy

Unit tests should focus first on invariants rather than visual appearance.

Important RNG tests include:

- identical address + seed produces identical output;
- evaluation order has no effect;
- independent domains produce distinct addressed random variables;
- distribution samplers are deterministic;
- distribution sampler internals do not perturb unrelated values.

Starfield tests should include:

- parent count equals sum of child counts;
- querying children before the parent gives the same result;
- overlapping query strategies recover consistent stars;
- clearing caches changes no results.

Terrain tests should include:

- the same vertex always has the same height;
- parent dependencies are stable;
- querying nearby vertices in different orders gives identical values;
- memoization changes performance but not output;
- recursively generated neighboring regions meet consistently.

Statistical tests can additionally check that large collections of addressed samples approximately follow their intended distributions, but these should be separate from deterministic correctness tests.

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
- zoom/scale display or input;
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

---

## 22. Initial implementation sequence

A reasonable first implementation sequence is:

1. Create the Vite + React + TypeScript application and routes.
2. Implement typed procedural addresses and the addressed RNG primitive.
3. Implement uniform and basic distribution utilities.
4. Implement the 2D viewport, panning, zooming, coordinates, and seed controls.
5. Implement the Poisson starfield model and demo.
6. Add model instrumentation.
7. Implement truncated distribution utilities needed by terrain generation.
8. Implement random-access 2D diamond-square terrain.
9. Add the terrain visualization.
10. Add deterministic correctness tests and query-complexity experiments.

At the end of this milestone, Polis should already demonstrate its central idea: a user can navigate around an apparently much larger world while the browser computes only the pieces needed for the current query, and every piece remains reproducible solely from its world seed and hierarchical address.
