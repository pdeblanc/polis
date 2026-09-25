# Birds outward-expansion prototype

This standalone experiment implements the nested-root expansion construction. It is not
part of the production Birds model, its refinement hierarchy, or the GUI. It imposes no
spacetime completeness criterion. Its purpose is to expose concrete intermediate facts
for review before deciding how refinement will consume them.

Implementation: [`birdsExpansion.ts`](../src/experiments/birdsExpansion.ts).
Tests: [`birdsExpansion.test.ts`](../src/experiments/birdsExpansion.test.ts).

## One iteration

At scale `(L,T)`, the two roots are `[-L,0)` and `[0,L)` at time zero. Each has a
population and complete endpoint contributions to width-`L` cells at `+T` and `-T`.
Initially `L=16`, `T=256`.

Expansion performs these operations, in order:

1. Introduce `[-2L,-L)` and `[L,2L)` at time zero. Sample each population and its
   forward/backward allocations to `±T`.
2. Retain the old roots and their existing `±T` endpoint contributions unchanged.
   There are now four width-`L` source cohorts, in increasing spatial order.
3. For each cohort separately, extend its contributions from `±T` to `±2T`, `±3T`,
   and `±4T`. Each populated contributing cell owns one multinomial allocation at each
   step. Sum arrivals to obtain the next contribution frame.
4. Pair the time-zero sources and pair adjacent endpoint cells. Sum the final frames
   to obtain two width-`2L` roots and their width-`2L` endpoint contributions at `±4T`.

These aggregates, not new samples, become the next iteration's root data. In particular,
an inherited first-step distribution is not replaced by the forward kernel at its new
scale. Its intermediate construction remains retained.

For backward propagation, a step from `-T` to `-2T` records where that root's birds came
from. The physical chronological flow runs from `-2T` to `-T`; the step record follows
the outward computation, not chronological arrow direction.

## Sampling and support

Each newly introduced time-zero cell has population sampled from a Poisson law with
mean `populationDensity * cellWidth`, using stdlib's inverse CDF and an addressed uniform.
There is no explicit population-tail truncation or large-mean normal approximation.
Finite random-bit precision and safe-integer storage remain numerical limitations;
unrepresentable counts are errors rather than clipped values.

Forward and backward initial allocations share that population total but have distinct
random addresses. Every later contribution is allocated multinomially; propagation never
creates additional birds. The implementation reuses the shared sequential-binomial
multinomial utility.

The forward kernel is precomputed once as `roundedNormal(0, sqrt(D*T/L²))`. Because
`T/L²=1` throughout expansion, one table suffices at every scale. The backward table
reflects its offsets and probabilities, including any asymmetric clamp atoms. Kernel
categories and returned contributions use increasing spatial order.

This uses forward variance `D*T`. It is twice the midpoint variance for a parent bridge
of total duration `2T`, or four times the midpoint variance for a parent bridge of total
duration `T`. The source is approximated by its cell center. Integrating over a uniform
source cell and other kernel fine-tuning are intentionally deferred.

Motion support uses the existing six-deviation normal clamp. This is an architectural
finite-search constraint, not a bounded target population law. Multinomial conservation
and finite motion support are separate from any deterministic population ceiling.
At zero diffusion the motion kernel is a point mass at zero.

## Inspectable records and ownership

```ts
const experiment = new BirdsExpansion('example', 2, 0.5);
const initial = experiment.getEpoch(0);
const expanded = experiment.getEpoch(1);
```

An epoch exposes:

- `roots`: the two output roots and their endpoint contributions;
- `introduced`: the two newly sampled roots, time-zero frames, and first-step batches;
- `extensions`: four cohorts with three forward and three backward propagation steps;
- `aggregations`: the pairs of extended cohorts and their resulting coarse roots.

Epoch zero has only initialization records, with no extensions or aggregations.
Every propagation step exposes its originating time-zero cell, input frame, complete
per-cell allocations, and output frame. Allocation batches retain zero categories;
frames are sparse and omit zero contributions. An omitted entry means zero contribution
from that cohort, not zero total population at the spacetime location.

The source cohort remains distinct while propagating, even when several cohorts reach
the same cell. They are combined only by explicit root aggregation. The next iteration
propagates the resulting aggregate cohort, while its finer provenance remains accessible
through the retained earlier records. This does not yet specify conditional refinement
of later steps back into those finer cohorts.

Population addresses identify the newly introduced interval. Transport addresses identify
the cohort's interval, the two times, and the contributing cell; category suffixes identify
destination intervals. They do not depend on cache state, request order, or the position
of an entry in a sparse array.

`getEpoch(n)` builds the missing prefix and retains every completed epoch in an unbounded
instance-owned cache. Earlier records are reused by reference and all returned structures
are frozen. There is no eviction or clearing API. Replay in a new instance with identical
parameters reproduces the same records. This is not a claim that retained memory is
small for every density, diffusion rate, or requested expansion depth.

## Run and verify

```sh
npm run experiment:birds-expansion
npm run experiment:birds-expansion -- 3 2 0.5 'example seed'
npm run experiment:birds-expansion -- 1 2 0.5 'example seed' --json
npm test -- src/experiments/birdsExpansion.test.ts
```

Positional arguments are expansion count after initialization, density, diffusion rate,
and seed. Defaults are `3`, `2`, `0.5`, and `Polis expansion prototype`. Normal output is
one summary per epoch, including root populations, occupied endpoint counts, retained
step/allocation counts, and elapsed time. `--json` prints full epoch records instead;
shared records are repeated in JSON, so serialization size is not retained-memory usage.

Tests check initialization, both directions of every allocation, contribution aggregation,
negative-coordinate coarsening, population conservation over multiple expansions,
preservation of inherited facts, unique transport addresses, deterministic replay,
immutable retention, empty populations, and zero diffusion. They test the new
construction, not the statistical correctness of library distribution implementations.

Open architectural questions include what complete population/flow queries these retained
contributions determine, how refinement retrieves and conditions on them, and the behavior
of the overall sampled law across expansion scales. No inward query implementation,
trajectory matching, GUI integration, or coverage theorem is implied by this prototype.
