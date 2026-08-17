# Polis Design Q&A and Decision Log

This document records questions, feedback, and decisions from the review of
[`DESIGN.md`](./DESIGN.md). The accepted conclusions have been incorporated into the
design. This file remains as rationale and a record of deferred implementation
questions; `DESIGN.md` is the normative specification if the two documents diverge.

Future decisions should be recorded here and incorporated into `DESIGN.md` when they
change the specification. Decisions that remain experimental should say so explicitly.

## Status key

- **Open** — needs discussion.
- **Proposed** — a concrete answer has been suggested but not accepted.
- **Decided** — a conclusion has been accepted.
- **Deferred** — intentionally postponed, with a stated reason or trigger for revisiting it.
- **Validated** — a previously uncertain conclusion has been supported by an experiment or implementation.

## Decision principles

When resolving these questions, prefer:

- a precise mathematical model before an implementation-specific API;
- deterministic and query-order-independent behavior;
- explicit approximation or truncation rather than implicit deviation from the model;
- output-sensitive complexity claims;
- small, model-specific interfaces until genuine shared abstractions emerge;
- experiments where the relevant complexity or behavior is not yet understood.

---

## Discussion batch 1: Starfield foundations

### Q1. What hierarchy supports an unbounded Poisson starfield?

**Status:** Decided

`DESIGN.md` describes a coarse box whose population is subdivided among its children,
while also describing an extremely large or unbounded plane. An unbounded plane cannot
have a single finite root box with a finite Poisson population.

**Conclusion:** The hierarchy begins with four unit-square root cells, one in each
quadrant, each having `(0, 0)` as a corner. Each quadrant has a canonical chain of
outward expansions with side lengths `1, 2, 4, ...`, anchored at the origin. For
example, the positive-positive unit cell expands to `[0, 2) × [0, 2)`.

An expansion preserves the existing cell and samples an independent Poisson count for
the newly added three quarters. Equivalently, the expanded cell consists of the old
cell and three new equal-size siblings, and its count is their sum. Refinement in the
opposite direction subdivides a cell into four equal children and conditionally splits
its known count among them.

The implementation must define one canonical parent/child address for every hierarchy
cell; expansion and subdivision are inverse views of that same relationship, not two
alternative ways to generate a cell. Regions that cross an axis may combine results
from multiple quadrant hierarchies.

Hierarchy cells are allowed to overlap at their boundaries. Two neighboring cells may
both own stars whose coordinates lie on their shared boundary. Counts belong to the
generating cells and are combined additively, so shared geometric boundaries do not
cause a generated occurrence to be counted twice. Public spatial queries must preserve
that ownership semantics rather than deduplicating equal coordinates.

### Q2. What constitutes the stable identity of a star?

**Status:** Decided

Count consistency does not by itself specify which individual stars are observed when
the same area is reached through different refinement or query strategies.

**Conclusion:** Stars have no identity. They are stateless, indistinguishable
occurrences in a spatial point process, analogous to indistinguishable particles rather
than persistent objects. The model exposes a point multiset: each occurrence has a
position, but neither an object ID nor mutable state. Equal coordinate values must not
be deduplicated, because separate generated occurrences may coincide.

Position materialization must be canonical and query-order independent. Each primitive
cell query recursively evaluates its immediate canonical dependency ancestor. A
descendant therefore discovers an ancestor's materialized point multiset through
ordinary recursion and filters it spatially; no separate materializing-ancestor search
or identity scheme is needed.

### Q3. What does `points(box, resolution)` return?

**Status:** Decided

The term `resolution` could mean positional precision, hierarchy depth, world-space
tolerance, or projected screen-space tolerance. An exact query may also have an
arbitrarily large output.

**Conclusion:** Remove `points(box, resolution)` from the foundational model API. The
starfield has two interface layers:

1. The internal hierarchy layer accepts one canonical hierarchy box and returns:

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
   ```

   The four immediate child counts are a stochastic fact owned by the queried parent.
   `count` is their sum but may be returned for convenience. `positions` is present
   when the cell has materialized its population or inherited materialized positions
   from an ancestor. The threshold is a model/implementation constant chosen from
   performance experiments, not a caller-selected resolution.

2. The public query layer provides operations needed by visualizations and other
   clients. It may accept arbitrary boxes or other region shapes, decompose them into
   hierarchy queries, and return corresponding counts, materialized points, or aggregate
   cells. These public operations should be added when concrete consumers establish
   their required semantics. This layer has no random-number generation capability; it
   can only compose facts obtained from the internal hierarchy layer.

The internal layer is the source of deterministic hierarchical facts; the public layer
adapts those facts without introducing new randomness.

The recursion rules are:

- an outward expansion uses the smaller dependency ancestor as one child and samples
  the other three child populations; materialization preserves existing-child positions
  and materializes new occurrences within their respective new child boxes;
- an inward refinement reads its count from the larger ancestor's `childCounts`;
- a low-count inherited population materializes uniformly inside its box;
- materialized positions determine further child counts by canonical spatial
  classification; and
- an unmaterialized parent owns the addressed bounded multinomial/binomial split that
  determines its `childCounts`.

---

## Discussion batch 2: Terrain model definition

### Q4. What is the exact random-access diamond-square dependency graph?

**Status:** Deferred

The conceptual recurrence in `DESIGN.md` does not yet define a complete algorithm.

Questions to resolve:

- What are the coarsest vertices or boundary conditions?
- How are square and diamond phases represented?
- At which unique level is each vertex introduced?
- What are the exact parent coordinates for every vertex type?
- How are negative coordinates canonicalized?
- Why is the dependency graph acyclic?
- How do independently requested neighboring regions share boundary values?

**Required design artifact:** A worked coordinate example across at least two refinement
levels, including negative coordinates and a boundary shared by neighboring query tiles.

**Proposed direction:** Adapt the lattice rule from the earlier project's
[`coordinate.js`](https://github.com/pdeblanc/dark-wizard-kiyoshi/blob/master/scripts/coordinate.js).
For an integer lattice point `(x, y)`, find the smallest power of two `d` such that
`x` and `y` are not both divisible by `2d`. This determines the point's introduction
scale.

- If `(x / d) + (y / d)` is even, the point is a square-step point. Its four parents
  are the diagonal points at offsets `(±d, ±d)`, which lie on the next coarser lattice.
- If `(x / d) + (y / d)` is odd, the point is a diamond-step point. Its four parents
  are the axial points at offsets `(±d, 0)` and `(0, ±d)`. Some of these are square-step
  points introduced at the same refinement scale.

The dependency order is therefore lexicographic: coarser scales precede finer scales,
and square-step values precede diamond-step values within a scale. This supplies an
acyclic ordering even though not every dependency is strictly coarser.

The starter model stops recursion at a fixed coarse lattice scale. Values at those
coarse vertices are i.i.d. addressed random variables. Negative coordinates follow the
same divisibility and parity rules.

To extend the construction below the integer lattice, dyadic coordinates need a
canonical representation. The prototype may use finite JavaScript numbers because
power-of-two subdivision remains exact within documented magnitude and refinement
limits. Addressing must normalize `-0`, reject non-finite values, and hash a canonical
representation rather than incidental decimal formatting.

**Implementation conclusion:** Vertices are identified directly by finite dyadic world
coordinates rather than a semantic level. A vertex averages its four parents and adds a
bounded normal displacement whose variance is proportional to their common Euclidean
distance. The parent average is multiplied by a distance-only normalization weight.

An exact normalization would depend on the six correlations among the four parents and
therefore on the vertex's spatial phase relative to the coarse lattice. A recursive
covariance implementation was measured at roughly `0.8--15.5` milliseconds for one
cold vertex over refinements 1--14, making it unattractive for viewport sampling.
Calibrating one weight per distance from phase-averaged exact covariance calculations
gave at most about `0.5%` marginal-variance error through refinement eight, decreasing
rapidly with finer spacing. The prototype uses those calibrated weights and an
asymptotic continuation. Retain exact covariance normalization, broader calibration,
and a proof or stronger bound on approximation error as possible future work.

### Q5. Is literal diamond-square the right terrain requirement?

**Status:** Decided

An unbounded literal diamond-square construction may require awkward coarse boundary
conditions or an infinite regress toward coarser levels. A different multiscale random
field might preserve the intended Polis properties more cleanly.

**Conclusion:** Use random-access diamond-square with a fixed coarsest lattice and i.i.d.
coarse values for the initial implementation. This is a legitimate bounded-coarseness
model and avoids making unbounded expansion a prerequisite for the first terrain
experiment.

An origin-anchored, expanding-powers-of-two construction analogous to the starfield may
be investigated later. It is not required initially because extending a lattice field
while preserving interpolation dependencies and boundary consistency is less direct
than adding independent Poisson population in newly expanded area.

### Q6. What is the public terrain query API?

**Status:** Decided

The design mentions terrain vertices, arbitrary visible regions, and raster rendering,
but does not define the model operation used by the renderer.

**Conclusion:** As with the starfield, separate the terrain model into an internal
stochastic layer and a consumer-motivated API layer.

The internal layer exposes only the minimal recursive operations needed to define the
field. Initially, its central operation is evaluation of a canonical terrain lattice
vertex. It owns addressed random displacement, recursive dependency evaluation, and
per-query memoization.

The API layer adds operations only in response to concrete consumers, such as regular
sample grids, hierarchy-aligned tiles, arbitrary-coordinate samples, or interpolation.
It may batch and compose internal queries and share a query context, but it has no
random-number generation capability. Therefore it cannot introduce new stochastic
facts; all random choices must originate in canonically addressed internal queries.

This capability boundary should be reflected structurally in the code—for example,
the API layer receives a narrow internal-query interface rather than an RNG object or a
general model context containing randomness.

---

## Discussion batch 3: Addressed randomness and distributions

### Q7. What is the canonical random-address encoding?

**Status:** Validated

Reproducibility requires more than a conceptual tuple. The encoded identity of each
random variable must be unambiguous.

Questions to resolve:

- Which typed address components are supported?
- How are signed integers, lengths, strings, and domain tags encoded?
- How are seed strings converted to keys?
- Which hash or pseudorandom-function primitive is used?
**Conclusion so far:** Every model constructor accepts a seed of one shared project-wide
`Seed` type. The precise representation remains to be chosen; a string is a plausible
initial choice because it is opaque, easy to expose in the UI, and easy to serialize.

Each model owns the decision about which addressed RNG it uses. We should nevertheless
design one shared RNG implementation that is suitable for all initial models rather
than gratuitously choosing a different primitive per model.

The RNG's address input must be general enough for each model to express its own random
variable identities. “Anything hashable” means values admitted by an explicit canonical
hash-input contract; it must not mean arbitrary JavaScript objects serialized according
to property insertion order or other incidental runtime behavior. Candidate contracts
include a typed component sequence or a deliberately encoded byte/string key. The
choice should account for hashing and allocation cost in high-volume terrain queries.

No version value is supplied to individual RNG calls.

**Validated implementation:** `Seed` is an opaque string. Canonical address components
are strings, finite JavaScript numbers, `bigint` values, and byte arrays. Their binary
encoding uses explicit type tags and component lengths, normalizes `-0`, rejects
malformed Unicode and non-finite numbers, and returns a `Uint8Array`.

The shared synchronous RNG uses the version-specific RapidHash v3.0 entry point. It
derives a 64-bit numeric seed by hashing `['polis.seed', userSeed]` with a fixed project
constant, then uses that numeric seed to hash canonical model addresses. A seed-hash
collision may intentionally produce identical worlds; this negligible non-cryptographic
risk is accepted for the prototype.

Local Node 22 benchmarks on Apple Silicon measured complete encode-and-hash throughput
of about 0.72 million starfield-shaped addresses per second and 0.90 million
terrain-shaped addresses per second. XXH64/WASM was about 1.5 times faster end to end,
but canonical encoding dominated total cost and RapidHash avoided asynchronous WASM
initialization. Reconsider the encoder or hash only if profiling identifies this path as
a material bottleneck.

### Q8. What reproducibility guarantee does the project make?

**Status:** Decided

Possible guarantees range from deterministic behavior within one build to permanent
cross-browser compatibility for all generated values.

**Conclusion:** Do not build an explicit versioning scheme into the starter RNG,
addresses, or individual queries. A model instance is initialized with its seed, and
queries inherit all stochastic configuration from that model.

If compatibility versions become necessary, expose version selection at model
construction. A version identifies a model definition, which may include its RNG,
address encoding, distribution algorithms, and other output-affecting behavior. It is
never repeated on individual queries or random-number requests.

For now, determinism means that the same implementation, model configuration, seed,
and query produce the same result. Permanent compatibility across future algorithm
changes is not yet promised. Focused golden tests may pin intentional behavior without
turning every implementation detail into a permanent public compatibility contract.

### Q9. How should distribution parameters affect coupling and identity?

**Status:** Decided

The design proposes that parameters generally reinterpret the same addressed quantile.
This is useful in some cases but may be surprising or underspecified in others.

**Conclusion:** A distribution sampler receives an address prefix rather than the
identity of one indivisible random draw. It may derive as many canonically indexed child
addresses as its algorithm requires, including bounded attempt numbers where relevant.
It never consumes a shared mutable random stream.

Distribution parameters normally reinterpret randomness beneath the same prefix rather
than becoming address components. For a sampler with an ordered mean parameter,
sampling with the same seed and address prefix at a higher mean must never return a
lower result. Analogous monotonicity may be specified for other naturally ordered
parameters, such as binomial probability, when those samplers are introduced.

The precise coupling construction is an implementation concern that must be documented
and tested for each distribution. In particular, the bounded Poisson-like truncation or
clamping rule must preserve monotonicity in its mean. If this cannot be achieved without
unacceptable complexity or distortion, the requirement must be revisited explicitly
rather than silently abandoned.

#### Follow-up: large-parameter discrete samplers

**Status:** Decided for the prototype

The inverse-CDF implementations used initially become unusually expensive at large
Poisson means and binomial trial counts. Above a fixed threshold, approximate either
distribution by rounding a normal variate with the same mean and variance. Begin with a
threshold of `1000` for both families and retain the normal sampler's six-standard-
deviation clamp. At this threshold the clamped approximation remains strictly inside
the distributions' nonnegative finite support where applicable.

Preserve pointwise parameter monotonicity across the algorithm switch by anchoring the
approximation to the exact quantile at the threshold. For a parameter above the
threshold, return the greater of the threshold's exact quantile and the rounded normal
approximation. The rounded normal expression is itself monotone above the threshold
when driven by the same clamped standard-normal quantile. Tests should cover the switch
boundary as well as distributional error and throughput.

Rounding error is not independent of the normal sample, so the common `1/12`
quantization variance must not be justified by an independent-noise argument. Directly
summing the probability in each unit-width rounding cell, or equivalently using the
Poisson-summation expansion for a quantized Gaussian, nevertheless shows that rounding
a sufficiently broad normal adds approximately `1/12` to its variance; the covariance
is included, and the remaining lattice corrections decay extremely quickly with the
normal variance. At the initial threshold this is about `0.0083%` of Poisson variance
and `0.033%` of an even-probability binomial's variance. Do not rescale the normal for
this negligible effect initially; the Poisson approximation's missing skew is a
materially larger source of error. Reconsider variance correction only if empirical
tests show a consumer-relevant discrepancy.

If greater Poisson fidelity is needed, first investigate the leading Cornish--Fisher
skewness correction `(z * z - 1) / 6`. It is independent of the mean and therefore does
not disturb the approximation branch's mean-monotonicity. Faster inverse-Poisson
methods such as Mike Giles's Algorithm 955 are another future option. For binomial
sampling, established rejection algorithms may be fast but consume a variable number
of random draws and do not naturally provide the addressed inverse-quantile coupling
required here. Port and validate a more sophisticated inverse algorithm only if the
simple approximation proves inadequate.

### Q10. Where is truncation allowed?

**Status:** Decided

A truncated Poisson distribution does not produce the exact Poisson point process
claimed by the starfield model. Bounded terrain displacement, on the other hand, can be
part of the terrain's explicit definition.

**Conclusion:** Primitive distributions with mathematically unbounded support must have
bounded behavior in Polis. The initial utilities may define one project-wide truncation
constant for each distinct distribution family. Finer per-model or per-query control is
unnecessary until a concrete consumer requires it.

For each distribution, the specification must distinguish among possible bounding
rules—for example, conditioning on a bounded interval, clamping an unbounded variate,
or defining a separate finite-support approximation. These choices have different
effects on probabilities and monotone coupling and are not interchangeable merely
because they use the same maximum-deviation constant. Both output bounds and worst-case
sampler work must be finite if the intended guarantee covers computational behavior.

As a consequence, the initial starfield is not an exact homogeneous Poisson point
process. It is a bounded Poisson-like hierarchical point process whose precise count
distribution is determined by the selected truncation rule. `DESIGN.md` has been
revised to make this approximation explicit and avoid claiming exact Poisson laws.

Certified or heuristic region bounds have no consumer in the starter project and are
out of scope. The proposed `SAFETY_FACTOR` mechanism therefore needs neither design nor
implementation now. It can return alongside a future feature that consumes such
bounds.

#### Follow-up: scale-dependent starfield split bounds

**Status:** Deferred

A fixed truncation rule for primitive binomial samples may not give a hard bound on
starfield refinement depth. A nonempty cell could continue assigning more than the
materialization threshold to one child through arbitrarily many subdivisions.

A possible solution is a scale-dependent occupancy capacity that becomes stricter as
cells become smaller. Given a parent population, child counts would follow a bounded
conditional multinomial distribution constrained by:

```text
childCount[i] <= capacity(childScale)
```

The capacity schedule must preserve feasibility:

```text
parentCount <= sum(childCapacities)
```

and must eventually fall to the position-materialization threshold. This would provide
a structural termination and per-cell occupancy bound, but it would suppress unusually
dense fine-scale clusters and therefore become part of the starfield's mathematical
definition.

The model should specify the desired bounded joint child-count distribution first. A
sequential implementation may then realize it with bounded binomial samples. This is a
model-level policy, not merely a global binomial-utility setting.

An alternative is to use ordinary bounded multinomial splits until a fixed maximum
depth and then materialize every remaining occurrence regardless of count. That causes
less distributional distortion but permits a larger worst-case materialization burst.

**Conclusion:** Begin with the natural threshold-based recursion and instrument its
observed depth. Do not require either bounding mechanism before implementation starts.
Experiments can characterize practical behavior but cannot establish a worst-case
termination proof. Revisit a capacity schedule or maximum-depth fallback if a hard
query bound becomes a concrete requirement.

---

## Discussion batch 4: Coordinates and scale

### Q11. What coordinate range does the starter project support?

**Status:** Decided

JavaScript `number` viewport centers eventually lose local precision far from the
origin, even if model addresses use exact integers.

**Conclusion:** Use finite JavaScript `number` coordinates for the prototype, including
dyadic terrain coordinates. Every finite binary floating-point value is itself dyadic,
and coordinates reached from integer lattices through power-of-two subdivision remain
exact while they stay within the supported precision and exponent range.

The starter project may document and enforce practical magnitude and refinement limits.
It does not initially need `bigint` viewport controls or an exact-cell-plus-local-offset
viewport representation. Model structural addresses must still be formed canonically;
in particular, normalize `-0` and reject non-finite coordinates.

### Q12. What are the coordinate and hierarchy conventions?

**Status:** Decided

The following terms need one consistent definition:

- world unit and base-cell size;
- hierarchy-level numbering and refinement direction;
- half-open or closed region boundaries;
- treatment of points exactly on boundaries;
- zoom units, such as pixels per world unit;
- relationship between viewport zoom and model resolution.

**Conclusion:** World units form shared spatial language across models so later models
can be composed in the same space. Individual models retain private structural
addressing schemes behind their internal-query interfaces.

For the starfield, a hierarchy box is a square characterized geometrically by its four
edge coordinates. Its side length belongs to the supported power-of-two hierarchy, and
each edge coordinate is an integer multiple of that side length. Boxes with equal side
length need not have equal generation or dependency depth: some may be initial cells
while others are introduced by outward expansion. Generation is not required in the
box's identity if the internal model can derive its canonical dependencies from the
geometry. Neither the box representation nor its addressing rules are exposed beyond
the boundary between the internal model and its public API wrapper.

The viewport is described in world-space area, or equivalently the square root of that
area, together with its center and the screen aspect ratio. Resizing or reshaping the
browser preserves the depicted world area; the world-space width and height change to
match the new aspect ratio while keeping their product constant.

The starfield resolver stops refining empty cells and materializes positions below its
population threshold. It does not need a user-facing maximum refinement setting. The
initial natural recursion has no proven hard depth bound; a nonempty cell can in
principle remain above the threshold through arbitrarily many random splits. A future
hard-bound requirement would require a capacity schedule or bounded fallback.

Terrain API queries at off-lattice coordinates use nearest-neighbor sampling at a
specified dyadic lattice spacing. A spacing is required because the union of all dyadic
refinement lattices is dense and therefore has no nearest vertex to a general
coordinate. The visualization derives the requested spacing from its world area and
pixel dimensions. The terrain model may clamp this to a minimum supported spacing.

---

## Discussion batch 5: Complexity and execution

### Q13. How should complexity goals account for output size?

**Status:** Decided

No query returning a million terrain samples or stars can take time polynomial only in
the logarithm of resolution. The complexity goal should separate random-access overhead
from the amount of requested output.

**Conclusion:** State the model-query bound in terms of encoded input and output size.
The amount of data returned by one model query, measured in bits, must be polynomially
bounded in the size of that query's encoded input, also measured in bits. Relative to
the numeric magnitude of binary-encoded coordinates, this may be described informally
as polylogarithmic output growth.

A query for a huge box may return a huge population count because the count is one
scalar whose encoded bit length grows with the input coordinates' bit length. It must
not return an explicit list proportional to that huge population. Starfield position
lists remain bounded by the fixed materialization threshold; otherwise a query returns
aggregate counts.

The viewport is a consumer that may issue many individually bounded queries. For the
prototype, it may query a star count for each pixel (or corresponding pixel footprint)
and derive brightness from that count when zoomed far out. Work proportional to the
number of output pixels is acceptable. Later rendering optimizations may aggregate
pixels or use other levels of detail without changing the foundational model contract.

This output-size requirement does not by itself prove a runtime bound. Runtime and
dependency growth remain subjects for instrumentation and experiments, with any
polylogarithmic runtime claim labeled conjectural until supported.

### Q14. What is the unit of instrumentation?

**Status:** Decided

“Current render” is not a reliable model-query boundary because React may restart,
batch, or cancel rendering work.

**Conclusion:** Models may own caches whose lifetime spans multiple queries. This cache
serves the memoization role previously assigned to a per-query context and is always an
optimization: clearing it cannot change any result.

Models expose `clearCache()` for benchmarks, correctness tests, and debugging. A cold
benchmark clears the cache immediately before the measured query. Normal application
code does not need to clear it for correctness.

Statistics still belong to one explicit public model/API call rather than to the cache
lifetime. Counters are reset or snapshotted at the query boundary and report both new
work and cache hits for that call. A batch or viewport-facing API operation is one query
when invoked as one operation, even if it performs many internal recursive lookups.

Model-scoped caches use least-recently-used (LRU) eviction so exploration cannot cause
unbounded memory growth. Each distinct cache type initially has a project-wide capacity
constant. Cache capacity may later become a model-constructor argument if consumers or
experiments require finer control. Eviction and capacity changes must remain
semantically invisible.

### Q15. How does the browser avoid obsolete or blocking work?

**Status:** Decided

Panning and zooming can invalidate expensive work before it finishes.

**Conclusion:** Everything within a model is synchronous, including both its internal
stochastic layer and its public API layer. A single model API call obeys the project's
bounded-output contract and does not own an open-ended rendering or scheduling loop.

Potentially large consumer operations—for example, issuing one query per viewport
pixel—belong above the model API. The viewport owns that work and may initially perform
it directly. Shared consumer-side coordination can later live under `helpers/`.

Directory semantics are:

- `utils/` contains lower-level abstractions on which models may depend;
- `models/` defines synchronous procedural models and their APIs;
- `helpers/` contains higher-level logic that consumes or coordinates models for views
  or other applications.

The starter project does not require cancellation, progressive scheduling, stale-result
handling, or Web Workers. These mechanisms should be introduced only in response to
observed slowness and the concrete source of that slowness. Model code must still remain
independent of React and the DOM, as already required for reuse and testing.

---

## Discussion batch 6: Scope, testing, and ambition

### Q16. Which implementation choices are requirements versus defaults?

**Status:** Decided

React, Vite, Canvas, React Router, the proposed directory tree, and a shared viewport are
reasonable defaults. Not all need to be architectural commitments.

Questions to resolve:

- Which choices are intentionally fixed for this project?
- Which may change during implementation without revising the design?
- Should the shared viewport emerge from the first demo instead of preceding it?
- Which distribution utilities are actually required for the first two models?

**Conclusion:** Use Vite, React, React Router, TypeScript, and Canvas 2D for the starter.
React Router and the exact source layout are implementation conveniences rather than
architectural contracts.

Use Canvas 2D for both initial model visualizations. The expected
expensive work is procedural model evaluation on the CPU, so GPU rendering APIs are
unlikely to address the first performance bottlenecks and would add unnecessary
complexity.

Interactive controls, text, labels, and other accessible UI elements should be ordinary
React/HTML elements layered above or placed around the canvas rather than painted into
it. Model code remains independent of Canvas, so the renderer can be replaced later if
profiling shows a rendering bottleneck.

The internal/public model separation, synchronous model API, and prohibition on RNG
access in the public API layer are architectural requirements. Exact component names
and directory details remain working defaults. Add `helpers/` for shared logic that
sits above and coordinates models, while `utils/` remains below models.

Develop the viewport alongside the starfield, then extract or generalize the shared
behavior before implementing the terrain view. Implement only distribution utilities
actually required by the initial models, preferring viable library primitives and
testing Polis-owned adaptations and semantics.

### Q17. What belongs in the initial testing contract?

**Status:** Decided

**Conclusion:** Test code and behavior owned by Polis. Prefer suitable library
implementations for prototype infrastructure and mathematical primitives rather than
reimplementing them merely to control their internals. Upstream libraries are
responsible for testing their own implementation.

Polis tests must still cover integration behavior that the project relies upon,
including configuration, adapters, canonical address construction, deterministic model
invariants, cache independence, hierarchy consistency, negative coordinates, boundary
behavior, and all project-specific bounds. If a library is wrapped to provide addressed
sampling or other Polis semantics, test the wrapper and those semantics rather than
duplicating the library's general test suite.

Keep a small set of fixed RNG vectors only if Polis owns the RNG implementation or
depends on an output contract not already guaranteed by the chosen library. Broad model
snapshots are secondary to invariants. Statistical tests are needed only for
distribution transformations or bounding rules implemented by Polis and remain
separate from deterministic correctness tests.

**Required sampler invariant:** For every sampler with an ordered mean parameter, hold
the seed, address prefix, and all other parameters fixed. Increasing the mean must never
decrease the sampled result. Tests should exercise many deterministic prefixes and
parameter pairs, including values near truncation boundaries. Statistical tests remain
separate: monotonicity is an exact pointwise property, not an approximate distributional
check.

### Q18. Should reproducible and inspectable views be more ambitious?

**Status:** Decided

Potential additions that closely support the project's purpose include:

- seed, location, and zoom encoded in the URL;
- hierarchy and terrain-dependency overlays in the first milestone;
- a “clear caches and rerun” comparison control;
- canonical query-result hashes;
- a headless benchmark entry point;
- comparison between alternative terrain constructions.

**Conclusion:** Encode the seed, viewport center, and depicted world area in the URL so
an observed world location can be reproduced and shared.

Both demos include optional debug overlays. The starfield overlay exposes hierarchy
information near the cursor; the terrain overlay exposes relevant lattice dependencies
near the cursor. The overlays are toggleable and follow pointer movement rather than
attempting to visualize the entire viewport's dependency structure at once.

The browser's initial performance display may remain small: queries issued per frame
and frames per second. Detailed model counters remain available programmatically so
tests and benchmarks can measure unique dependency evaluations, cache hits, and depth.
Queries per frame and FPS describe interactive cost but cannot by themselves establish
algorithmic dependency growth.

Defer a dedicated browser benchmark page. Add small Node-based CLI benchmarks for
order-of-magnitude measurements and complexity experiments. Node and browser timings
are not identical, so report these as comparative estimates rather than browser
performance guarantees.

Canonical result hashes, automatic cache-comparison UI, and alternative terrain-model
comparisons remain future work.

---

## Accepted decisions summary

- **Q1:** Use four origin-anchored unit root cells, one per quadrant, with canonical
  outward power-of-two expansions and inward subdivisions. Neighboring cells may both
  own stars on a shared boundary; counts retain generating-cell ownership.
- **Q2:** Stars are stateless, indistinguishable occurrences with no identity. The model
  exposes a point multiset, and descendants discover canonical materialized positions
  through immediate-ancestor recursion.
- **Q3:** Replace `points(box, resolution)` with an internal cell query returning the
  parent-owned four-way child split and optional materialized positions, plus
  consumer-driven public region-query APIs.
- **Q5:** Initially implement random-access diamond-square with a fixed coarsest lattice
  whose vertex values are i.i.d.; defer an outward-expanding coarse hierarchy.
- **Q6:** Separate terrain into a minimal stochastic vertex-query layer and a
  consumer-driven API layer. The API layer has no random-number generation capability.
- **Q7:** Use opaque string seeds, canonical typed binary addresses, and synchronous
  RapidHash v3.0. Derive its 64-bit seed from the same hash under the `polis.seed`
  domain and a fixed project constant.
- **Q8:** Do not version individual addresses, RNG calls, or queries. If compatibility
  versions are later needed, select them once when constructing a model.
- **Q9:** Distribution samplers receive address prefixes and derive canonical child
  addresses. Samplers with an ordered mean parameter must be pointwise monotone in that
  mean for a fixed seed and prefix, including after bounding or truncation.
- **Q10:** Give every unbounded primitive distribution explicitly bounded behavior,
  initially using one truncation constant per distribution family. The starfield is
  consequently Poisson-like rather than an exact Poisson point process. Defer safety
  factors until a bounds-consuming feature exists.
- **Q11:** Use finite JavaScript numbers, including exact-in-range dyadic terrain
  coordinates, with documented prototype magnitude and refinement limits.
- **Q12:** Share world units but keep model hierarchy addresses private. Identify
  starfield boxes geometrically, preserve viewport world area across resize, and sample
  off-lattice terrain at a requested nearest-neighbor dyadic spacing.
- **Q13:** Bound each query's encoded output size polynomially in its encoded input size;
  large populations return scalar counts, while viewport work may scale with pixels.
- **Q14:** Use model-scoped, correctness-independent caches with `clearCache()` for cold
  benchmarks. Use LRU eviction with a global capacity per cache type, measure statistics
  per explicit API call, and keep eviction invisible.
- **Q15:** Keep all model APIs synchronous. Viewports own potentially large collections
  of model calls, with reusable consumer coordination placed in `helpers/`. Defer
  cancellation and workers until actual performance evidence calls for them.
- **Q16:** Use the selected TypeScript/React/Vite/React Router/Canvas stack as starter
  tooling, generalize the viewport after the starfield establishes its needs, and build
  only currently required distribution utilities. Preserve architectural boundaries
  without treating tooling or file layout as permanent contracts.
- **Q17:** Test Polis-owned code, adapters, and invariants without duplicating upstream
  library suites. Prefer viable libraries for prototype primitives, while testing all
  project-specific determinism, bounds, hierarchy, and monotonicity contracts.
- **Q18:** Put seed, center, and area in the URL; add toggleable cursor-following model
  overlays and a minimal queries-per-frame/FPS display; use small Node CLI benchmarks
  and defer a dedicated browser benchmark page.

## Deferred questions summary

- Browser benchmark page, canonical result hashes, cache-comparison UI, and alternative
  terrain-model comparisons are deferred until concrete needs arise.
- **Q4 details:** Validate the terrain recurrence, interpolation, displacement scaling,
  dyadic representation, worked dependencies, and termination during implementation.
- **Q10 follow-up:** Instrument natural threshold recursion first. Revisit a
  scale-dependent capacity schedule or maximum-depth materialization fallback only if
  a hard starfield query-depth bound becomes a concrete requirement.
