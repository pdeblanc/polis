# Birds single-origin expansion prototype

This standalone experiment expands the time horizon of one fixed population originating
in one cell at time zero. It is not part of the production Birds model or GUI. Its purpose
is to expose concrete intermediate facts for review before specifying contraction or
combining multiple origin channels into a global model.

Implementation: [`birdsExpansion.ts`](../src/experiments/birdsExpansion.ts).
Tests: [`birdsExpansion.test.ts`](../src/experiments/birdsExpansion.test.ts).

## Origin and initialization

The caller specifies an aligned dyadic cell `[a,a+L₀)` at time zero: `L₀` is a positive
power of two and `a` is an integer multiple of `L₀`. Examples include `[0,16)`, `[16,32)`,
`[32,64)`, and negative or fractional-scale cells. The default is `[0,16)`.

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
2. **Insert `3T`.** For each positive direct flow from center `x` at `T` to center `y`
   at `4T`, allocate its count among intermediate cells using a rounded-normal kernel
   with mean `(x+2y)/3` and variance `2DT/3`.
3. **Insert `2T`.** For each allocation through center `z` at `3T`, allocate its count
   among cells at `2T`, with mean `(x+z)/2` and variance `DT/2`. Keep its `4T` destination
   attached to this allocation; do not pool flows with different final destinations.
4. **Aggregate endpoint cells at `4T`.** Sum adjacent width-`L` cells into globally
   aligned width-`2L` cells. These aggregates are the next epoch's forward input.

Apply the same construction to the backward branch: `-T → -4T`, then insert `-3T`,
then `-2T`. Backward records follow the outward computation; physical chronological
flow is in the opposite direction. Each epoch is one eager batch containing both branches.

After epoch `e`, endpoint width is `L₀ 2^e` and time horizon is `T₀ 4^e`. Initial
allocation is epoch zero. With the default origin, epoch zero reaches `±256`; epoch one
generates `±1024`, `±768`, `±512` and ends with width-32 endpoint contributions.

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
| Insert `3T` | 0, 1/3, or 2/3, plus integer translation | `2D/3` |
| Insert `2T` | 0 or 1/2, plus integer translation | `D/2` |

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
const experiment = new BirdsExpansion('example', 2, 0.5, { min: 32, max: 64 });
const initial = experiment.getEpoch(0);
const expanded = experiment.getEpoch(1);
```

Every epoch exposes `origin`, `population`, `cellWidth`, `timeStep`, `forward`, and
`backward`. The last two are the endpoint contribution frames used by the next epoch.

- An `initial` epoch also exposes `atZero`, `forwardStep`, and `backwardStep`.
- An `expanded` epoch exposes `forwardExtension` and `backwardExtension`, each containing:
  - `direct`: the sampled `T → 4T` step, including complete per-source allocations;
  - `bridges`: one retained late bridge per positive direct flow, with its early
    bridges nested beneath it; these encode joint counts across all four times;
  - `steps`: the three adjacent-time flow marginals, derived by summing those joint
    counts without additional randomness;
  - `coarsened`: the aggregated `4T` endpoint frame.

Sampled allocations retain zero categories. Frames and derived adjacent-step allocations
are sparse and spatially ordered. An omitted frame entry means zero contribution from
this channel, not zero global population. The finer endpoint frames remain retained after
coarsening, and subsequent epochs reuse the previous coarse frames by reference.

Population addresses identify the origin interval. All transport/bridge addresses also
include the origin. Transport addresses identify the two times and source cell. Bridge
addresses identify the endpoint cells and all three times; early bridges additionally
identify the enclosing direct flow's `4T` destination. Category suffixes identify the
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
npm test -- src/experiments/birdsExpansion.test.ts
```

Positional arguments are expansion count after initialization, density, diffusion rate,
and seed. Defaults are `3`, `2`, `0.5`, and `Polis expansion prototype`. `--origin min max`
selects the origin interval; omission selects `[0,16)`. Normal output is one summary per
epoch: the fixed population, occupied endpoint-cell counts, retained step/allocation/bridge
batch counts, and elapsed time. Step/allocation counts include derived marginal records.
`--json` prints full epoch records; shared objects are repeated in JSON, so serialization
size is not retained-memory usage.

Tests cover configurable origins and initial scales, Poisson initialization, conservation
of every allocation, four-time joint-to-marginal consistency, endpoint coarsening,
kernel variances/phases, generation order, negative coordinates and backward time,
unique addresses across origins and conditional contexts, deterministic replay,
immutable retention, empty populations, and zero diffusion. They test the construction,
not the statistical correctness of library samplers.

Open work includes contraction consistent with retained batches, a motion-support bound
that permits finite origin-channel searches, and a global model that sums those channels.
There is no inward query implementation, trajectory matching, GUI integration, or coverage
theorem in this prototype.
