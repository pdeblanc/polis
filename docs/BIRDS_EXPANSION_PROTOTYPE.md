# Birds single-origin expansion prototype

This construction expands the time horizon of one fixed population originating
in one cell at time zero. It lives in the Birds 2a model directory and has a standalone
inspection CLI. It is not part of the production Birds 1 model or GUI. Its retained
records provide the authoritative facts for Birds 2a contraction.

The [Birds 2 expansion-phase proposal](./BIRDS_2_EXPANSION_PROPOSAL.md) records the
architectural conclusions, expansion support bounds, and the planned sequence from
single-channel contraction to global composition and local aggregation.

Implementation: [`expansion.ts`](../src/models/birds2a/expansion.ts).
Tests: [`expansion.test.ts`](../src/models/birds2a/expansion.test.ts).

## Origin and initialization

The caller specifies an aligned dyadic cell `[a,a+L₀)` at time zero: `L₀` is a positive
power of two and `a` is an integer multiple of `L₀`. Examples include `[0,1)`, `[1,2)`,
`[2,4)`, and negative or fractional-scale cells. The default is `[0,1)`.

The [Birds 2 project plan](./BIRDS_2_PROJECT.md) specifies base length 1 and duration 1.

Sample its population once from a Poisson law with mean `populationDensity * L₀`.
Use two separate multinomial allocations of this same total to obtain endpoint
contributions to width-`L₀` cells at `±T₀`, where `T₀=L₀²`. Forward variance is `D*T₀`,
with `D` the diffusion rate. Cell centers stand in for continuous source locations.

The origin and its total population remain fixed through every expansion. No new birds
or origin cells are introduced. Reached-cell counts are this channel's contributions,
not total populations in a global simulation.

The default width and the ratio `T/L²` are named constants. The ratio is currently one.

## One expansion epoch

The input state has endpoint contributions at `±T` in width-`L` cells. On the forward
branch, generate the following at width `L`, in this order:

1. **Extend directly from `T` to `4T`.** Each populated contributing cell allocates its
   count multinomially with forward variance `3DT`. Do not sample three successive
   forward hops; those would accumulate a wider architectural support envelope.
2. **Insert `2T`.** For each positive direct flow from center `x` at `T` to center `y`
   at `4T`, allocate its count among intermediate cells using a rounded-normal kernel
   with mean `(2x+y)/3` and variance `2DT/3`.
3. **Aggregate, then insert `3T`.** Sum `2T → 4T` legs with the same endpoint cells
   across all `T` sources. Allocate each summed count among cells at `3T`,
   with mean `(z+y)/2` and variance `DT/2`, where `z` is the `2T` center.
   The second batch owns just its `2T` and `4T` endpoints. This follows Birds 1's
   aggregate-before-subdivide rule.
4. **Aggregate endpoint cells at `4T`.** Sum adjacent width-`L` cells into globally
   aligned width-`2L` cells. These aggregates are the next epoch's forward input.

Apply the same construction to the backward branch: `-T → -4T`, then insert `-2T`,
then `-3T`. Backward records follow the outward computation; physical chronological
flow is in the opposite direction. Each epoch is one eager batch containing both branches.

After epoch `e`, endpoint width is `L₀ 2^e` and time horizon is `T₀ 4^e`. Initial
allocation is epoch zero. With the default origin, epoch zero reaches `±1`; epoch one
generates `±4`, `±2`, `±3` and ends with width-2 endpoint contributions.

## Kernels and approximation

The conditional means and variances above are the continuous Brownian-bridge formulas.
Their use with cell-center endpoints, rounding, and clamped kernels is an approximation,
not exact conditioning of the discrete forward transition law. Integrating over endpoint
intervals and other statistical fine-tuning are deferred.

In cell-index units, the precomputed kernels are:

| Operation | Mean offset | Variance |
| --- | --- | --- |
| Initial forward allocation | 0 | `D` |
| Direct extension | 0 | `3D` |
| Insert `2T` | 0, 1/3, or 2/3, plus integer translation | `2D/3` |
| Insert `3T` | 0 or 1/2, plus integer translation | `D/2` |

These values use `T/L²=1`; the implementation includes the named ratio in the variances.
Interpolating equal-width cell centers is equivalent to interpolating their integer cell
indices. Floor/remainder arithmetic selects phases correctly for negative displacements.
The same bridge tables serve both time directions. Backward forward-propagation tables
are explicit spatial reflections, including any asymmetric clamp atoms.

Kernels use `roundedNormal`: clamp the normal at six standard deviations and apply
`Math.round`, with tail mass placed at the rounded clamp points. At zero diffusion,
forward propagation stays in the same cell; endpoint coarsening only changes the cell
containing that contribution.

Motion truncation is an architectural finite-search constraint, not a property of the
target Poisson–Brownian law. Intermediate bridges can overshoot the direct endpoint
envelope, so a future support bound must include their excursions and rounding. This
prototype does not yet derive a support envelope for contraction or global-channel pruning.

Poisson initialization uses stdlib's inverse CDF and an addressed uniform, without an
explicit population-tail clamp or large-mean normal approximation. Finite random-bit
precision and safe-integer storage remain numerical limitations; unrepresentable counts
are errors rather than clipped values. All allocations use the shared sequential-binomial
multinomial sampler.

## Inspectable records and ownership

```ts
const experiment = new Birds2aExpansion('example', 2, 0.5, { min: 2, max: 4 });
const initial = experiment.getEpoch(0);
const expanded = experiment.getEpoch(1);
```

Every epoch exposes `origin`, `population`, `cellWidth`, `timeStep`, `forward`, and
`backward`. The last two are the endpoint contribution frames used by the next epoch.

Every epoch also exposes `ordinaryFlows`: eagerly aggregated, sparse flow tables for
all supported ordinary-query geometries introduced by that epoch. Each table uses
`ContributionStep`, whose endpoint frames specify their respective widths. Backward
tables are oriented outwards, like the other expansion records.

For an expansion from horizon `T` and width `L`, each branch adds:

- `0 → 2T` and `2T → 4T` at width `2L`;
- the three adjacent steps between `T` and `4T`, at widths `(L,L)`, `(2L,2L)`,
  `(L,2L)`, and `(2L,L)`;
- `0 → 4T` at widths `(2L,2L)`, `(4L,4L)`, `(2L,4L)`, and `(4L,2L)`.

The `0 → T` tables already belong to the preceding epoch. Initialization stores all
four width combinations for `0 → ±T₀`, using `L₀` and `2L₀`. All these tables are
deterministic aggregates of retained endpoint pairs; single-origin membership supplies
the time-zero endpoint. No additional provenance or random sampling is needed.

- An `initial` epoch also exposes `atZero`, `forwardStep`, and `backwardStep`.
- An `expanded` epoch exposes `forwardExtension` and `backwardExtension`, each containing:
  - `direct`: the sampled `T → 4T` step, including complete per-source allocations;
  - `firstBridges`: one three-time allocation through `2T` per positive direct flow;
  - `fromTwo`: the `2T → 4T` flows aggregated across `T` sources;
  - `secondBridges`: one three-time allocation through `3T` per positive `fromTwo` flow;
  - `steps`: the three adjacent-time flows, derived by summing these batches
    without additional randomness;
  - `coarsened`: the aggregated `4T` endpoint frame.

Sampled allocations retain zero categories. Frames and derived adjacent-step allocations
are sparse and spatially ordered. An omitted frame entry means zero contribution from
this channel, not zero global population. The finer endpoint frames remain retained after
coarsening, and subsequent epochs reuse the previous coarse frames by reference.

Population addresses identify the origin interval. All transport/bridge addresses also
include the origin. Transport addresses identify the two times and source cell. Bridge
addresses identify the endpoint cells and all three times. Second bridges do not retain
or address their former `T` sources. Category suffixes identify the
allocated cell. Distinct origin channels and conditional batches therefore have distinct
addresses without relying on sparse-array indices or request order.

`getEpoch(n)` builds the missing prefix and retains every completed epoch in an unbounded
instance-owned cache. Returned structures are frozen, including a copy of the caller's
origin cell. There is no eviction or clearing API. A new instance with the same inputs
reproduces the records. Retention is not a claim of small memory use for every parameter
choice or depth.

## Run and verify

```sh
npm run experiment:birds-expansion
npm run experiment:birds-expansion -- 3 2 0.5 'example seed' --origin 32 64
npm run experiment:birds-expansion -- 1 2 0.5 'example seed' --origin -32 -16 --json
npm test -- src/models/birds2a
```

Positional arguments are expansion count after initialization, density, diffusion rate,
and seed. Defaults are `3`, `2`, `0.5`, and `Polis expansion prototype`. `--origin min max`
selects the origin interval; omission selects `[0,1)`. Normal output is one summary per
epoch: the fixed population, occupied endpoint-cell counts, retained step/allocation/bridge
batch counts, and elapsed time. Step/allocation counts include derived marginal records.
`--json` prints full epoch records; shared objects are repeated in JSON, so serialization
size is not retained-memory usage.

Tests cover configurable origins and initial scales, Poisson initialization, conservation
of every allocation, three-time batch-to-leg consistency, endpoint coarsening,
kernel variances/phases, generation order, negative coordinates and backward time,
unique addresses across origins and conditional contexts, deterministic replay,
immutable retention, empty populations, and zero diffusion. A regression checks that
multiple `T` sources contribute to one second batch and that its single sampling
call uses their summed count with no former-source address suffix. Tests cover the construction,
not the statistical correctness of library samplers.

## Classifiers and expansion readers

[`classifiers.ts`](../src/models/birds2a/classifiers.ts) classifies legal cells and
ordinary flows as expansion projections or contraction dependencies. It uses
geometry and the channel origin, not seed, population, or cache contents. The spatial
grid has no fixed coarse ceiling; it supports both sides of the unit initialization.
Ordinary flows retain the epoch, half-duration, quarter-duration, and mixed-width
geometries of the inward hierarchy. The direct duration-3T extension is a retained
expansion record, not an ordinary flow query.

[`expansionFacts.ts`](../src/models/birds2a/expansionFacts.ts) reads classifier-provided
population and flow projections, building the owning expansion epoch when necessary.
Endpoint queries use the finest retained frame, including the fine frame underneath
a coarsened endpoint. Flow projections look up exact entries in `ordinaryFlows`, without
reconstructing margins during a query; negative-time records are exposed as chronological
flows. Sparse missing entries in an available
projection contribute zero for this channel.

The records contain separate `(T,2T,4T)` and `(2T,3T,4T)` tables, not a four-time
joint table. The `2T → 4T` flows are explicit and can be projected onto legal
coarser half-duration flow queries in either time direction, without resampling.
There is no two-stage query interface or explicit `(0,T,2T)` allocation table. Additional
three-time facts are deferred until a contraction dependency demonstrably needs them.

Cell-subdivision batches are classified separately: either retrieve retained child
populations or, when no finer expansion fact exists, identify a binomial owner.
These readers are internal building blocks, not a partial
consumer-facing Birds 2a query API.

[`ownerClassifiers.ts`](../src/models/birds2a/ownerClassifiers.ts) supplies A/C temporal,
G1/G2 incidence, and H spatial-reconciliation ownership. Geometry fields identify
midpoint times, opposite endpoint widths/times, children, and mixed-width margins,
without requiring query code to calculate with stage or epoch labels. Spatial batches
either retrieve their expansion entries or use the usual hypergeometric construction.
Temporal owners use multinomial subdivision only when their ordinary legs are not
expansion facts. If expansion supplies both legs, the temporal-owner classifier throws:
that batch must not be evaluated, and ordinary queries must retrieve the retained legs
directly. This does not assert that leg counts determine a joint three-time allocation.

Tests additionally check classifier domains and returned dependencies, frame and step
projections, mixed-width margins, empty contributions, cold versus already-built epoch
access, and preservation of projected answers after further expansion.
Ordinary-flow tests check all supported width combinations, row/column conservation,
agreement with raw endpoint-pair aggregates, frozen output, and complete table coverage
of expansion-classified geometries, including empty channels.
Owner tests check whole-batch coverage and reject temporal evaluation for retained legs.
A deterministic randomized dependency-shape walk covers fine/coarse scales and positive
and negative times, checking termination at expansion facts without requesting those
forbidden temporal batches. Spatial indices do not affect these classifications, so
the walk uses representative endpoints rather than enumerating motion windows. This
is structural regression coverage, not a proof of finite spatial enumeration or an
end-to-end engine test.

## Single-channel contraction engine

[`birds2aEngine.ts`](../src/models/birds2a/birds2aEngine.ts) combines the retained
expansion with recursive A–H contraction. Its internal `queryCell(cell)` and
`queryFlow(flow)` methods accept exact hierarchy coordinates and return this
origin channel's integer contribution. They do not expose a consumer resolution
wrapper or sum other origins. The production Birds 1 API and GUI are unchanged.

```ts
const engine = new Birds2aEngine('example', 2, 0.5, { min: 0, max: 1 });
const count = engine.queryCell({ min: 0, max: 0.5, time: 0.25 });
```

Expansion-classified queries retrieve retained counts. Otherwise the engine uses:

- A/C addressed multinomial midpoint allocations and B/D temporal leg sums;
- E outgoing-flow sums for introduced cell populations;
- F binomial cell splits, or retained child populations where available;
- G1/G2 multivariate-hypergeometric incidence splits respecting child populations;
- H hypergeometric 2×2 reconciliation respecting both mixed-width margins.

Temporal batches remain private and are reached only from contraction-owned legs.
No expansion two-stage query interface is needed. Queries use classifier-provided
dependency geometry without arithmetic on epoch or stage labels. Motion windows
bound incidence and temporal-parent searches; zero populations and zero parent
flows avoid unnecessary sampling and reconciliation.

Random addresses use a `birds2a.refinement` namespace, the fixed origin interval,
the operation, and full owner coordinates. Category addresses use their cell
coordinates. Query order, cache state, and expansion depth are not random inputs.
The two time directions and incoming/outgoing incidence owners have distinct
addresses. The existing expansion namespace and sampled records are unchanged.

Disposable facts and batches use model-scoped `QuickLRU` caches with named capacity
constants. `clearCache()` clears contraction caches only; authoritative expansion
epochs remain retained and immutable. A new engine is required for a fully cold
expansion run. Neither eviction nor clearing changes query answers.

Engine tests check spatial conservation, incoming/outgoing conservation at all
three equal-width durations, mixed-width margins, whole-channel population across
refined time slices, positive and negative times, and nondefault origins. They also
check retained-output agreement without resampling, replay after cache clearing,
reversed query order and later expansion, empty channels, and invalid geometry.
These are structural correctness checks, not statistical calibration or a complete
complexity/finite-ancestry proof.

## Motion windows for single-channel queries

[`motionSupport.ts`](../src/models/birds2a/motionSupport.ts) constructs a reusable,
seed-independent support object from the diffusion rate. It supplies conservative
flow predicates, source/destination enumeration at every legal opposite width,
midpoint probability tables for contraction-owned temporal batches, and inverse
parent-flow searches for temporal legs. No sampled counts, expansion-cache state,
or arbitrary maximum epoch enter the bounds. A window includes candidates whose
actual population may be zero; it is not an exact reachability test.

The temporal kernels reuse Birds 1's midpoint implementation, including its
zero-diffusion boundary convention, with variance `D * duration / 4`. Expansion
keeps its separately specified kernels. Midpoint queries for expansion-supplied
legs throw through the owner classifier; parent searches for those legs return
no dependencies because their counts are already retained.

### Bound derivation

Let `r` be the named duration/width-squared ratio (currently 1), `v=D*r`, and `K`
the normal cutoff. Bounds below measure center displacements in the indicated
cell width and include at most half a cell of rounding error:

```text
a = K sqrt(3v)   + 1/2   direct expansion over 3T
b = K sqrt(2v/3) + 1/2   first expansion bridge residual
c = K sqrt(v/2)  + 1/2   second expansion bridge residual
```

The expansion endpoint radius at width `L` is at most `(a+1/2)L` about the
original origin center: initialization satisfies it and doubling the width
preserves it under direct transport and endpoint coarsening. Moving to the
containing time-zero cell center gives an entry-flow offset bound `E₀=a+1`.
For a width-`2L` half-duration flow, the origin-to-`2T` bound dominates the
`2T → 4T` bound, giving `H₀=2a/3+b/2+1`.

The fine adjacent expansion displacements are bounded by `a/3+b` for
`T → 2T`, and `a/3+b/2+c` for each of the next two legs. Aggregating both
endpoints to double-width cells changes the normalized offset bound from `d`
to `d/2+1/2`. The quarter-duration expansion seed is therefore:

```text
Q₀ = max(E₀/2 + 1/2, (a/3+b)/2 + 1/2, (a/3+b/2+c)/2 + 1/2)
```

This also covers the extra coarser views of initial and origin-to-horizon flows.
All bounds are absolute, so apply on both time branches and at every spatial
alignment, including negative coordinates.

For refinement define `u=K sqrt(v/4)+1/2` and `w=K sqrt(v/8)+1/2`.
An entry flow with offset bound `E` produces half-duration legs within
`E/2+u`; a half flow bounded by `H` produces quarter legs within `H/2+w`.
Spatial refinement changes a quarter offset `q` to `2q+j-i`, with child indices
`i,j` in `{0,1}`. Thus closure requires `E >= 2Q+1`. A sufficient closed solution is:

```text
E = ceil(max(E₀, 2Q₀+1, H₀+2w+1, 2u+4w+2))
H = max(H₀, E/2+u)
Q = max(Q₀, H/2+w)
```

The implementation retains these real-valued bounds and enumerates integer offsets
up to their floors. Mixed-width flows are tested using their equal-width coarse
parent's quarter bound. This covers every possible spatial child assignment, even
at zero diffusion. No distribution is clipped again to enforce the search window.

For fixed parameters, every incidence window is finite and scale-independent in
cell counts. Parent searches enumerate the appropriate parent window and filter
by the actual positive-probability midpoint categories. Tests check kernel extremes,
refinement closure, source/destination duality, inverse parent searches, negative
times/coordinates, and retained expansion flows across origins and scales. Numeric
index limits produce an error rather than a non-progressing enumeration loop.

This is a local displacement bound for single-channel query evaluation, **not** the
global channel-selection envelope about time zero. The latter must still include
contraction at unrecorded times and account for the origin partition before Birds 2b
can sum a finite set of channels.

Open work includes complete dependency/complexity analysis, a motion-support bound
that permits finite origin-channel searches, and a global model that sums those channels.
There is no consumer-facing Birds 2 API, trajectory matching, GUI integration, or coverage
theorem in this prototype.
