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
a coarsened endpoint. Flow projections read retained adjacent-time steps and aggregated `2T → 4T` flows; negative-time
records are exposed as chronological flows. Sparse missing entries in an available
projection contribute zero for this channel.

The records contain separate `(T,2T,4T)` and `(2T,3T,4T)` tables, not a four-time
joint table. The `2T → 4T` flows are explicit and can be projected onto legal
coarser half-duration flow queries in either time direction, without resampling.

Cell-subdivision batches are classified separately: either retrieve retained child
populations or, when no finer expansion fact exists, identify a binomial owner. The
recursive samplers are not implemented yet. Temporal and incidence batch ownership,
the contraction query engine, motion-support enumeration, and finite-ancestry proof
remain to be completed. These readers are internal building blocks, not a partial
consumer-facing Birds 2a query API.

Tests additionally check classifier domains and returned dependencies, frame and step
projections, mixed-width margins, empty contributions, cold versus already-built epoch
access, and preservation of projected answers after further expansion.

Open work includes contraction consistent with retained batches, a motion-support bound
that permits finite origin-channel searches, and a global model that sums those channels.
There is no inward query implementation, trajectory matching, GUI integration, or coverage
theorem in this prototype.
