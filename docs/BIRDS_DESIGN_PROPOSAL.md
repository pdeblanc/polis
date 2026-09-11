# Birds Model Design

> **Status: Canonical — currently being implemented.**
>
> This document is the normative design for the current Birds implementation. Earlier
> Birds design, Q&A, and review-feedback documents are historical context. If they
> conflict with this document, this document controls.
>
> Active implementation discoveries and provisional limitations are recorded separately
> in [`BIRDS_IMPLEMENTATION_NOTES.md`](./BIRDS_IMPLEMENTATION_NOTES.md).

## 1. Purpose

Birds is a synchronous, deterministic, random-access model of an effectively unbounded
population moving through one-dimensional space and time. It extends Polis with integer
cell populations and integer flows between cells.

The intended reference process is a spatial Poisson population whose members move by
Brownian motion. Version 1 is not an exact lazy representation of that process. It is a
finite-coarseness hierarchical approximation designed to preserve stronger computational
invariants:

1. populations and flows are nonnegative integers;
2. population is conserved exactly at every subdivision and aggregation;
3. every stochastic fact has one canonical owner and addressed-random identity;
4. results are independent of query order and cache state;
5. recursive queries use finite, explicit dependency sets for fixed model parameters;
6. the query graph is acyclic and terminates at deterministic coarse data; and
7. public queries return bounded data and hide hierarchy mechanics.

Approximation quality is measured against the Poisson–Brownian reference after the model
exists. Those measurements characterize version 1 and inform later models; they do not
silently redefine this hierarchy.

## 2. Scope

Version 1 includes an unbounded one-dimensional space and time within JavaScript numeric
limits, deterministic coarse flows, inward dyadic refinement, Brownian-bridge-inspired
temporal subdivision, exact integer conservation, random-access queries, bounded public
population and flow APIs, a spacetime visualization, and a tagged-bird helper.

It does not include persistent identity as a model fact, stored trajectories, stochastic
coarse initialization, scales coarser than the fixed lattice, exact continuous Brownian
consistency, higher spatial dimensions, smooth velocity, latent state, or terrain-driven
movement.

## 3. Architecture

The implementation follows the existing Polis layers:

- model-independent geometry, addressed randomness, distributions, and caches belong in
  `utils/`;
- a technical internal Birds engine owns hierarchy queries, stochastic facts, and caches;
- `Birds` is the consumer-facing synchronous model and hides epochs, stages, owners, and
  stochastic addresses;
- tagged tracking and debug extraction belong in `helpers/`; and
- React and Canvas code remains in `components/` and `pages/`.

The model constructor accepts a string seed, `populationDensity`, and `diffusionRate`.
Both numeric parameters accept every finite nonnegative JavaScript number, including
zero. Negative values, infinities, and `NaN` are rejected. There is no artificial
positive minimum or performance-derived maximum.

Model methods are synchronous. Each instance owns bounded LRU caches and exposes cache
usage and `clearCache()`. Cache contents affect work only, never semantics.
Each distinct cache type initially has a capacity defined by a named global constant;
constructor-level tuning may be added only when a concrete consumer needs it.

“Bounded” does not mean bounded by one parameter-independent constant. For fixed model
parameters, stochastic support and dependency enumeration are finite; their sizes may
grow with `diffusionRate`, approximately as `sqrt(D)`. Public result ceilings may reject
requests whose complete finite result would be impractically large.

## 4. Numeric representation and scales

World coordinates, cell widths, times, durations, and counts use JavaScript `number`.
The hierarchy uses dyadic arithmetic but no explicit dyadic wrapper. There is no fixed
maximum epoch or refinement depth.

Exact conservation claims apply while relevant integers are exactly representable.
`bigint` and pervasive numeric-boundary checks are out of scope. Semantically legal
parameters may eventually exceed useful binary64 precision; experiments must identify
and document such boundaries.

All fixed dimensions are named constants. Initially:

```ts
const BIRDS_COARSE_CELL_LENGTH = 16;
const BIRDS_COARSE_FLOW_DURATION = 256;
```

Write these as `L_0` and `T_0`, with `T_0 = L_0^2`. For `n >= 0`:

```text
L_n = L_0 / 2^n
T_n = T_0 / 4^n = L_n^2
```

This relationship keeps normalized Brownian displacement and local dependency width
independent of refinement depth.

## 5. Geometric entities

A length-`L_n` cell is the half-open interval:

```text
[i L_n, (i + 1) L_n), for integer i
```

A cell is identified by its interval and one hierarchy time. An ordinary flow is
identified by source cell, destination cell, start time, and end time. A two-stage flow
also identifies a midpoint cell at the arithmetic midpoint time.

Entities store raw geometry, not epoch, stage, dependency rank, or random address. Pure
classifiers derive structural facts when required.

## 6. Coarse domain and initialization

Coarse roots exist for every integer spatial index and coarse-time index:

```text
cell: [i L_0, (i + 1) L_0) at time m T_0
flow interval: [m T_0, (m + 1) T_0]
```

There is no finite spatial or temporal root window. Expansion to coarser scales is
deferred.

### 6.1 Coarse populations

For density `rho`, every coarse cell has deterministic population:

```text
N = Math.round(rho L_0)
```

If `N` is zero, the initial model is empty. This is a prototype device, not a claim that
the coarse marginal is Poisson.

### 6.2 Coarse flow kernel

Let `D` be `diffusionRate`. A source-uniform position contributes normalized variance
`1/12`, and forward Brownian displacement contributes `D T_0/L_0^2 = D`. The target
destination-offset table is a clamped rounded normal with mean zero and normalized
variance `1/12 + D`. This moment-matches, but does not exactly reproduce, the
uniform-normal convolution.

For target probabilities `p_d`, choose nonnegative integer counts `n_d` such that:

```text
sum_d n_d = N
n_d = n_-d
```

Minimize `sum_d |n_d - N p_d|`. If several symmetric vectors minimize it, compare
`(n_0, n_1, n_2, ...)` and choose the lexicographically smallest. Reflection symmetry
prevents drift; translation invariance gives every coarse cell equal total inflow and
outflow.

The rounded population and the sum of deterministic coarse outflows are the same fact.
Motion support begins with the complete reflection-symmetrized probability support even
when integer allocation assigns zero birds to some offsets. Support depends on `D`, not
on density.

## 7. Brownian innovation and rounded-normal kernels

`diffusionRate = D` controls innovation variance, not the empirical variance of every
observable. A forward increment of duration `T` has variance `D T`. Conditional on exact
endpoints, a Brownian-bridge midpoint has innovation variance `D T/4`.

Temporal subdivision represents endpoint cells by their centers. It does not add latent
uniform endpoint variance to midpoint noise. Within-cell mixing belongs to spatial
subdivision. The hierarchy may therefore have additional displacement variance,
especially near `D = 0`.

Normal support is clamped at the existing Polis cutoff `K = 6`. `roundedNormal` is a
probability-table utility, not a sampler. It integrates the normal CDF over `Math.round`
bins, puts truncated tails on the clamp points, assigns those atoms by the same bin rule,
and normalizes the finite table. It accepts integer and half-integer means.

For positive variance, ties at `n + 1/2` round toward positive infinity. A continuous tie
has zero mass, though a clamped atom may land on a boundary and make an extreme support
bin asymmetric.

For parent duration `T` and width `L`, midpoint normalized deviation is:

```text
sigma/L = sqrt(D (T/L^2) / 4)
```

Two canonical tables are required:

- a **mid-cell kernel** when the average endpoint center is a cell center; and
- a **cell-boundary kernel** when it lies between two cells.

Endpoint-index parity selects the table. Only normalized durations `1` and `1/2` occur.
At `D = 0`, the mid-cell table is a point mass; the boundary table is its `D -> 0+`
limit, with probability `1/2` in each adjacent cell. Its nonzero integer bins are the
normative midpoint support.

## 8. Hierarchy-closed motion support

The direct envelope `K sqrt(DT)` is not closed under temporal and spatial subdivision.
Birds constructs a finite integer offset set closed under a complete epoch.

Let `M_q(d)` be midpoint offsets for flow offset `d` and normalized duration `q`. For
each epoch offset `d` and `k in M_1(d)`, the four quarter-flow offset sets are:

```text
M_1/2(k)
k - M_1/2(k)
M_1/2(d - k)
(d - k) - M_1/2(d - k)
```

For any quarter offset `h`, spatially splitting both endpoints produces:

```text
2 h + delta, where delta is -1, 0, or 1
```

Start with symmetrized coarse probability support. Repeatedly add every transformed
offset until the set stops changing. This minimal fixed point is canonical epoch-flow
support. The enumeration also produces half- and quarter-duration sets, unioned across
legal alignments and directions.

Termination follows from contraction. A parent magnitude bounded by `E` transforms to
at most:

```text
E/2 + rho_1 + 2 rho_1/2 + 5/2

rho_1 = K sqrt(D)/2
rho_1/2 = rho_1/sqrt(2)
```

Thus a sufficient finite bound is:

```text
E >= 5 + (1 + sqrt(2)) K sqrt(D)
```

or the larger interval required by coarse support. The explicit fixed-point set remains
normative even if it happens to be contiguous and symmetric.

Pure helpers expose only concrete query domains:

```ts
possibleMidpointCells(flow, diffusionRate)
possibleParentFlows(halfOrQuarterFlow, diffusionRate)
possibleFlowDestinations(sourceCell, duration, diffusionRate)
possibleFlowSources(destinationCell, duration, diffusionRate)
isPossibleFlow(flow, diffusionRate)
```

Forward and inverse helpers are algebraic views of the same finite sets. A legal entity
outside support has count zero; invalid geometry does not denote an entity.

## 9. One refinement epoch

Epoch `n` consumes length-`L_n` cells at `T_n`-aligned times and equal-resolution flows
of duration `T_n`. It produces entry objects at `L_(n+1) = L_n/2` and
`T_(n+1) = T_n/4`.

### Stage A: first temporal subdivision

For a parent flow `A -> C` of duration `T_n` and count `N`, enumerate supported midpoint
cells `B` and sample one owned multinomial:

```text
(N_B)_B ~ Multinomial(N; (p_B)_B)
sum_B N_B = N
```

### Stage B: half-duration aggregation

Length-`L_n` flows of duration `T_n/2` aggregate Stage-A facts:

```text
F(A, B) = sum_C G(A, B, C)
F(B, C) = sum_A G(A, B, C)
```

Alignment selects the applicable first- or second-leg equation. Inverse support provides
the finite parent set.

### Stage C: second temporal subdivision

Every Stage-B flow owns another midpoint multinomial, now using normalized duration
`1/2`, splitting it into two quarter-duration legs.

### Stage D: quarter-duration aggregation

Length-`L_n` flows of duration `T_n/4 = T_(n+1)` aggregate Stage-C facts using the same
leg and inverse-support rules.

### Stage E: newly timed coarse-space cells

Length-`L_n` cells now exist at all `T_(n+1)`-aligned times. A newly timed cell is:

```text
C(A, t) = sum_B F(A, B; t, t + T_(n+1))
```

The equal incoming sum is a conservation test, not another stochastic definition.

### Stage F: spatial cell subdivision

Each legal length-`L_n` cell at such a time owns:

```text
left ~ Binomial(N, 1/2)
right = N - left
```

### Stage G1: source-side flow subdivision

For source `A` with children `A_0,A_1`, jointly split every supported `F(A,B_j)` using a
multivariate hypergeometric with capacities `F(A,B_j)` and sample size `C(A_0)`. The
complements belong to `A_1`. The source cell owns the complete batch. Independent
per-flow splits are forbidden because they would not conserve child populations.

### Stage G2: destination-side flow subdivision

Transpose G1. Destination `B` owns a multivariate hypergeometric split of every incoming
flow, using sample size `C(B_0)`. G1 and G2 establish row and column margins.

### Stage H: full spatial reconciliation

For one coarse flow of count `N`, let rows be `r_0,r_1` and columns `c_0,c_1`. Sample:

```text
x ~ Hypergeometric(population=N, subpopulation=r_0, draws=c_0)
```

Define:

```text
F(A_0, B_0) = x
F(A_0, B_1) = r_0 - x
F(A_1, B_0) = c_0 - x
F(A_1, B_1) = N - r_0 - c_0 + x
```

The hypergeometric law makes an explicit exchangeability approximation: conditional on
the G1 row margins and G2 column margins, source-child and destination-child memberships
inside the coarse flow are coupled by a uniformly random matching. The containing flow
owns this `2 x 2` reconciliation. The result reproduces both margins and becomes epoch
`n+1` entry flow data.

## 10. Finite-support samplers and addressing

Samplers are deterministic functions of seed, canonical address, and parameters.
Variable-work algorithms derive private child addresses beneath the caller's prefix.

The initial arbitrary-probability binomial uses
`@stdlib/stats-base-dists-binomial-quantile` with one addressed uniform. Multinomials use
sequential conditional binomials in increasing category order. Zero-probability
categories consume no draw; the final active category receives the exact remainder.

The initial scalar hypergeometric uses an addressed H2PE implementation. Rejection attempts
have deterministic child addresses, factorial overflow is avoided, and an attempt cap of
1,024 throws rather than returning biased output. A direct exact urn path handles narrow
support. The `@stdlib` HIN algorithm is only a small-count reference within a proven-safe
factorial range.

Multivariate hypergeometric sampling uses sequential scalar draws in increasing category
order. Zero-capacity categories consume no draw; the final category receives the
remainder.

Temporal multinomials order midpoint cells by increasing index. G1 orders destinations;
G2 orders sources. Addresses identify semantic categories, never temporary array
positions. Inverse, transposed, and entry queries retrieve the canonical owned batch.

The initial sequential multinomial does not claim global likelihood-ratio monotonicity
when probabilities change. For an old distribution `P`, new distribution `Q`, and the
same address producing outcomes `x` and `y`, respectively, the desired condition is:

```text
Q(y) / P(y) >= Q(x) / P(x)
```

with extended-value handling when support changes. After the main model and UI, the
project must investigate Gumbel-max, exponential-race, categorical-trial, batched, or
count-space alternatives.
The milestone ends with a practical tested sampler or an explicit justification for
retaining sequential binomials.

The current research direction and additional open questions about sampled-ratio
monotonicity are recorded in the
[gamma-process and Poisson-race investigation](./BIRDS_ANALYSIS.md#multinomial-coupling-gamma-processes-and-poisson-races).
This is a candidate under investigation, not an adopted replacement sampler.

Approximate binomial or hypergeometric fast paths are deferred until end-to-end profiling
identifies real parameter regimes. Any approximation must specify error, feasible bounds,
addressing, maximum work, and dispatch threshold.

## 11. Legal entity classification

Pure classifiers validate raw geometry and return one unique construction case:

```ts
classifyCell(cell)
classifyFlow(flow)
classifyTwoStageFlow(flow)
```

Results contain every parent, owner, alignment role, duration, and support-search input
needed by queries. Epoch and stage labels may appear diagnostically, but queries never
calculate geometry from them.

### 11.1 Cells

A length-`L_n` cell exists only at a time in `T_(n+1) Z`:

- `n = 0` at `T_0` alignment is coarse initialized;
- `n > 0` at `T_n` alignment is Stage `F_(n-1)`; and
- every other legal alignment is Stage `E_n`.

Negative times use Euclidean modulo.

### 11.2 Equal-resolution flows

For width `L_n`:

- duration `T_n` is initialization for `n = 0`, otherwise Stage `H_(n-1)`;
- duration `T_n/2` is Stage `B_n`; and
- duration `T_n/4` is Stage `D_n`.

Start time aligns to duration. Parity of `startTime/duration` selects the first or second
leg of the unique enclosing interval of twice the duration.

### 11.3 Mixed flows and two-stage flows

Only adjacent mixed scales are legal:

```text
L_(n+1) -> L_n, duration T_(n+1): G1_n
L_n -> L_(n+1), duration T_(n+1): G2_n
```

A fine-to-fine `L_(n+1)` flow of duration `T_(n+1)` is Stage `H_n`. Two-stage flows have
one width `L_n`, an exact midpoint time, and total duration `T_n` for Stage A or `T_n/2`
for Stage C.

### 11.4 Construction and capability

Construction and owned subdivision capabilities are independent. Every legal
length-`L_n` cell owns its epoch-`n` F, G1, and G2 subdivisions regardless of how that
cell was constructed. A geometrically eligible equal-resolution flow owns temporal
subdivision even if it was initialized or constructed by an earlier H stage.

Thin projections return complete owner metadata:

```ts
classifyFlowTimeSubdivisionOwner(flow)
classifyCellSubdivisionOwner(cell)
classifyCellOutflowSubdivisionOwner(cell)
classifyCellInflowSubdivisionOwner(cell)
classifyFlowSpaceSubdivisionOwner(flow)
```

Queries do not infer capabilities from construction labels.

## 12. Recursive ownership, caching, and acyclicity

The internal engine has narrow queries for cells, ordinary flows, two-stage flows, and
owned batches. Each query classifies geometry, checks support, and evaluates one
construction case.

Every stochastic subdivision has one owner:

- a parent flow owns A or C midpoint multinomials;
- a parent cell owns its F spatial split;
- a source cell owns its G1 incidence batch;
- a destination cell owns its G2 incidence batch; and
- a containing flow owns its H reconciliation.

An entry query retrieves its owner's complete batch. It never resamples in caller,
reverse, enumeration, or cache order. Model-scoped LRU caches use canonical geometry
keys and affect performance only.

For tests and specification, facts have conceptual rank:

```text
(introducing epoch, construction order, query role)
```

with:

```text
entry < A < B < C < D < E < F < G1/G2 < H
```

Entry objects retain their introducing rank from the previous epoch. Coarse flows are
leaves; coarse cells rank after them. G1 and G2 share a rank and do not depend on one
another. H depends on their margins. Within a stage, an owned batch precedes an entry
retrieved from it. Every recursive edge must strictly decrease rank. Production queries
receive dependencies from classifiers and never calculate with ranks.

## 13. Public `Birds` API

The public model exposes bounded operations conceptually named:

```ts
queryPopulation(...)
queryFlow(...)
queryOutflows(...)
queryInflows(...)
```

Public values contain world intervals, exact sampled times, selected resolutions, and
counts—never hierarchy addresses, owners, stages, epochs, or ranks.

### 13.1 Resolution capabilities

Consumers obtain model-instance-scoped resolution capabilities through operations
conceptually like:

```ts
resolvePopulationResolution({ targetCellWidth, targetTimeStep })
resolveFlowResolution({ targetSourceWidth, targetDestinationWidth, targetDuration })
getNearbyResolutions(request)
```

Resolvers select the coarsest supported resolution at least as fine as each supplied
bound and report exact widths, duration, and temporal lattice. A flow resolver returns
`undefined` when no equal- or adjacent-resolution flow fits. Nearby enumeration is finite
and intended for controls.

The semantic contract above is normative; these method names, argument objects, and the
decision to use branded capability objects are provisional. Actual visualization and
tracker consumers may motivate a simpler syntax. Any syntax must still let consumers
request an approximate resolution, learn the exact legal resolution selected, and
continue from that exact lattice without independently snapping again.

Capabilities expose supported refinement relationships, or model methods return finer
population and compatible flow capabilities. Consumers never reproduce scale formulas.

Viewport requests may snap a desired time and resolution, always reporting actual
choices. Exact continuation accepts an existing capability and canonical cell/time from
the same model and never snaps independently. This prevents flow chains and tagged paths
from breaking conservation.

### 13.2 Population and flow queries

`queryPopulation` returns an ordered spatial profile at one sampled time. A spacetime
view requests several timestamped profiles. There is no rectangular “population during
an interval” result, because that would obscure intermediate entry and exit.

`queryFlow` returns one canonical source-to-destination count. `queryOutflows` discovers
the destination envelope and returns all nonzero flows in destination order.
`queryInflows` is the transpose in source order. Consumers never enumerate support.

Plural queries have hard result limits. If a complete result is too large, the method
returns a size-limit result rather than a misleading partial conservation total.

Exact TypeScript names and result unions may evolve while preserving these semantics.

## 14. Tagged-bird helper

Birds have no persistent model identity. The helper selects one exchangeable unit and
searches already-determined hierarchy facts for a **singleton spacetime tube** around it.
Its fundamental invariant is:

> Every committed waypoint is a cell containing exactly one bird.

The helper's only independent random choice is one starting population rank. Cumulative
child counts map that rank through spatial refinement until it reaches a singleton cell,
which becomes the first committed waypoint.

From a committed singleton source, conservation guarantees exactly one populated
outflow at any chosen legal flow resolution. The helper first proposes the coarsest cell
and longest legal segment allowed by the consumer's requested precision. If the unique
populated flow reaches a singleton destination, it commits that destination and
continues.

If the destination population is at least two, the proposed segment does not preserve
recoverable identity: the model stores no incoming-to-outgoing correspondence among
multiple exchangeable birds. The helper discards that candidate segment, returns to its
last committed singleton source, and refines only the uncommitted segment. It may:

- request an asymmetric flow with a finer destination and follow the unique populated
  child flow;
- subdivide the singleton source, select its unique populated child, and request a
  compatible finer flow;
- temporally subdivide the segment; or
- combine these operations as allowed by public resolution semantics.

The search continues until the destination is singleton. It should never need to
backtrack across two committed waypoints: failure says only that the segment leaving the
most recent singleton was too coarse. This is a proof obligation, not an assumption to
embed without tests.

The helper also coarsens aggressively. If a parent of a singleton cell has population
one, both cells identify the same unique unit, so unnecessary spatial refinement is
removed. Subject to requested output precision, the returned tube uses the coarsest
singleton cells and longest legal singleton-to-singleton segments it can establish. It
may omit finer internal search steps from the returned trajectory.

Refinement, backtracking, and coarsening query addressed facts already defined by Birds;
they introduce no traversal-dependent randomness. Inputs include starting-selection
seed, starting region and time, requested spatial precision and temporal step, duration
or step count, and a work/refinement budget. Exhausting the budget returns an explicit
unresolved step. The variable-work helper is not a model method and should be implemented
only after real population and flow consumers have exercised the public resolution API.

## 15. Visualization and diagnostics

The Birds page uses horizontal space and vertical time. It builds aggregate spacetime
display from explicitly timestamped population profiles. Flow overlays show incident
flows for selected cells, and tagged trajectories may overlay the field.

The page exposes seed, density, diffusion, coordinates, actual resolutions, cache usage,
cache reset, queries per frame, FPS, and cursor-following hierarchy/dependency overlays.
Debug overlays are early correctness tools and may use dedicated internal helper data;
ordinary rendering uses the public model.

## 16. Verification

### 16.1 Normative tests

Version 1 tests:

- parameter validation;
- rounded-normal normalization, clamp atoms, parity, and zero-diffusion behavior;
- deterministic coarse allocation and equal incidence totals;
- fixed-point closure and forward/inverse support agreement;
- structural classification and invalid-geometry rejection;
- unique ownership at positive and negative alignments;
- exact conservation through every stage;
- sampler feasible bounds and batch remainders;
- determinism across query order, cache state, and inverse paths;
- decreasing dependency rank and finite heterogeneous ancestry;
- public resolution selection, snapping disclosure, and result ceilings;
- the singleton-waypoint invariant throughout tagged tracking;
- local backtracking without crossing two committed waypoints;
- asymmetric refinement paths that recover a singleton destination;
- aggressive coarsening without changing the selected unit; and
- query complexity over epoch depth, density, diffusion, and separation.

Early epochs and alignment residues receive exhaustive tests. Seeded generated ancestry
tests cover positive and negative indices and many scales. Numeric failure limits are not
invented in advance; observed boundaries receive focused regressions or public limits.

### 16.2 Statistical characterization

The external reference for cell `A` is:

```text
N(A) ~ Poisson(rho width(A))
```

For flow `A -> B` over `T`, its reference mean is:

```text
rho width(A) P(X_T in B | X_0 is uniform on A)
```

This Brownian probability integrates over the complete source and destination intervals,
even where the implementation differs. The ideal flow marginal is Poisson with that
mean.

Measure cell and flow distributions, increment means and variances, one- and multi-step
displacements, independence of disjoint increments, bridge behavior, child crossing and
retention, tagged trajectories, and dependence on scale, density, and diffusion.

Near the end of the Birds project, compare tracker behavior with a finite population of
labeled reference Brownian motions on a quotient space. Run the same finite-resolution,
budgeted tracking procedure against both systems, including cases where two trajectories
meet, separate, and meet again. This experiment should distinguish limitations inherent
to observing recurrent one-dimensional paths through anonymous population counts from
additional recurrence or work introduced by the hierarchical approximation. A matching
failure in the reference system is an explanatory result, not a requirement to suppress
the meetings.

These measurements do not gate version 1. Deterministic coarse initialization and
conditional subdivision of fixed totals prevent exact Poisson marginals and are expected
sources of discrepancy.

### 16.3 Benchmarks

CLI benchmarks vary epoch depth, count magnitude, diffusion and support width,
separation, cache state, query type, result limit, and tracker work. Report recursive
calls, evaluated owners/entities, cache hits, sampler calls, maximum depth, result size,
and throughput. Node timing gives order-of-magnitude guidance, not browser guarantees.

The internal engine records model-scoped counters sufficient to produce those
measurements, including cache hits, recursive entities and owned batches evaluated,
sampler calls, maximum dependency depth, and public result size. Instrumentation is not
part of stochastic semantics and may be disabled or simplified after the model is stable.

### 16.4 Population bounds and materialization

Derive, or determine that there is no useful derivation of, a deterministic upper bound
on a cell population as a function of cell width or epoch, `populationDensity`,
`diffusionRate`, and every distribution truncation constant used by the construction.
The analysis must follow the actual finite-support dependency and conservation rules,
including concentration caused by temporal incidence and flow-space reconciliation; a
marginal Poisson quantile is not by itself a valid worst-case bound.

Record the bound, its domain, and its looseness, or document why no useful bound could be
obtained. A bound that falls to a practical constant after some parameter-dependent epoch
could later support materializing every population beyond that epoch instead of using a
population cutoff. Choosing between those policies is explicitly deferred to planning
the next major Birds revision.

## 17. Implementation sequence

1. Implement `roundedNormal` tables and both midpoint alignments.
2. Implement addressed arbitrary-`p` binomial and sequential multinomial.
3. Finish H2PE hypergeometric and sequential multivariate hypergeometric utilities.
4. Implement raw entities, scale rules, construction classifiers, and owner projections.
5. Implement exact fixed-point support and forward/inverse helpers.
6. Implement deterministic coarse flows and cells.
7. Implement A–D and temporal conservation tests.
8. Implement E–F and cell conservation tests.
9. Implement G1, G2, and H and full incidence conservation tests.
10. Add order, cache, ownership, ancestry, and complexity tests.
11. Implement resolution capabilities and bounded public queries.
12. Add the spacetime view and early dependency overlays.
13. After the public API has been exercised by the visualization, implement singleton-
    tube tracking and trajectory display.
14. Run Poisson–Brownian characterization, including the finite-population quotient-space
    tracker comparison.
15. Analyze deterministic cell-population bounds as input to a future materialization
    design.
16. Investigate likelihood-ratio-monotone multinomial coupling and document its properties,
    performance, and adoption status. Investigation completed; adoption is explicitly
    deferred and sequential binomials remain in the running model. See the
    [analysis summary](./BIRDS_ANALYSIS_SUMMARY.md).
17. Audit Starfield and Terrain for structural classifiers; each must adopt applicable
    changes or document why not. Completed with explicit no-refactor decisions in the
    [implementation audit](./BIRDS_IMPLEMENTATION_NOTES.md#starfieldterrain-structural-classifier-audit).
18. Produce a high-level analysis summary separating reusable, model-agnostic evaluation
    metrics from version-1-specific investigations and root causes. Published as the
    [summary](./BIRDS_ANALYSIS_SUMMARY.md) and [scorecard](./BIRDS_EVALUATION.md); the
    scorecard identifies unmeasured items and is not a claim of complete automation.

## 18. Acceptance criteria

The initial model milestone requires several full inward epochs to terminate at coarse
data, conserve exactly within the safe-integer domain, use only canonical finite support,
remain deterministic across order and caches, have one owner per stochastic batch, pass
structural and acyclicity tests, expose bounded hierarchy-free APIs, and support a working
spacetime visualization with debug overlays.

The broader Birds project additionally requires a budgeted singleton-tube tracker,
Poisson–Brownian characterization including the reference tracker comparison,
end-to-end performance measurements, a documented population-bound analysis, the
completed multinomial monotonicity investigation, and the documented Starfield/Terrain
classifier audit. Before analysis is closed, publish a high-level synthesis and a
reusable metric suite defined independently of the version-1 hierarchy and its known
pathologies.

Any later approximate sampler requires a separate specification and tests. Any follow-up
not implemented must be closed by an explicit documented decision rather than silently
forgotten.
