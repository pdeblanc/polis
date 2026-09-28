# Birds 2: expansion-phase proposal

## Scope and status

This proposal replaces fixed coarse initialization with outward expansion from sampled
time-zero populations. The starting point is a **single channel**: all birds originating
in one specified cell at time zero. Build and understand that model before composing
channels or optimizing away their separate evaluation.

The single-channel expansion is implemented as a standalone
[prototype](./BIRDS_EXPANSION_PROTOTYPE.md). Contraction integration, complete support
derivation, global summation, and local aggregation optimizations are proposed work.
This document records the Birds 2 direction; it does not replace the
[production Birds v1 specification](./BIRDS_DESIGN_PROPOSAL.md) or claim a complete
design for Birds 2.

The [Birds 2 project plan](./BIRDS_2_PROJECT.md) calls the single-origin hierarchy
**Birds 2a**, and the global summed model **Birds 2b**. A separate **Birds 2c** wrapper
around 2b will introduce materialization and its own fine-scale paths without changing
the underlying models' semantics.

The development order is:

1. Expand one origin channel, retaining the generated facts.
2. Add contraction to obtain a complete single-channel query model.
3. Derive that model's support and use it to query a finite sum of contributing channels.
4. Optimize by summing channels earlier in the hierarchy, so some refinement operations
   run on locally combined populations and flows.

The global support problem is not a prerequisite for implementing step 2.

## Target and architectural constraints

The statistical target is a Poisson population in space with Brownian motion. Expansion
removes the fixed integer population at every coarse spacetime cell used by v1.
Poisson initialization alone does not establish the desired marginals at other times:
rounding, cell-center approximations, truncation, and refinement affect the sampled law.

Bounded motion support is an architectural device for finite dependency searches, not
a claim that the target Brownian distribution is bounded. Population initialization
does not need a model-level tail clamp. Numerical primitives still limit representable
geometry and counts; the construction should not introduce an arbitrary maximum epoch.

Keep random ownership explicit and query-order independent. Expansion is an eager batch
per epoch with an unbounded, instance-owned cache. Retain intermediate stochastic facts,
not just the final aggregates. Retention avoids making contraction reconstruct or
resample decisions that expansion has already made. This is not a guarantee that memory
is small for every parameter choice.

## A single origin channel

Choose an aligned dyadic origin interval `I=[a,a+L₀)` at time zero. Its population is
sampled once:

```text
N ~ Poisson(rho L₀)
```

`rho` is population density in world units; `D` is the diffusion rate, with forward
innovation variance `D * duration`. Birds 2 uses base length 1 and duration 1;
examples of origins are `[0,1)`, `[1,2)`, and `[2,4)`, with analogous negative intervals.
Expansion makes it unnecessary to inherit Birds 1's length-16, duration-256 base.
The expansion implementation permits a caller-specified origin and defaults to `[0,1)`.

Set `T₀=L₀²`. The width default and the time/width-squared ratio are named constants,
not query-local magic numbers. Allocate the same `N` independently forward and backward
to width-`L₀` cells at `±T₀`, using multinomials with rounded-normal forward kernels.

All reached populations are **contributions from this origin**, not global populations
of the reached cells. The origin and `N` stay fixed through every expansion. No additional
time-zero populations are introduced inside this channel.

## Expansion epoch

At scale `(L,T)`, where `T=L²`, the channel has endpoint contributions in width-`L`
cells at `±T`. On the forward branch:

1. Extend directly from `T` to `4T`, allocating each contributing cell's population with
   variance `3DT`. This avoids the unnecessarily wide support of three successive
   forward steps of duration `T`.
2. For each positive direct flow from cell center `x` at `T` to center `y` at `4T`,
   insert its contribution at `2T` with mean `(2x+y)/3` and variance `2DT/3`.
3. Sum the resulting `2T → 4T` legs over their `T` sources. For each aggregated
   flow from center `z` to center `y`, insert its contribution at `3T` with mean
   `(z+y)/2` and variance `DT/2`. One batch belongs to each `2T → 4T` endpoint pair.
4. Aggregate the width-`L` endpoint cells at `4T` into aligned width-`2L` cells. These
   endpoint contributions are the next epoch's input.

Perform the mirrored construction backward in time. Generation order on each branch is
`4T`, `2T`, `3T`, followed by endpoint coarsening; the whole epoch is computed eagerly.
Backward records follow the outward computation, opposite to chronological flow.

Retain the direct flows, each three-time subdivision batch, the aggregated `2T → 4T`
flows, adjacent-time flows, intermediate populations, and fine/coarse endpoint frames.
As in Birds 1, aggregate temporal legs before subdividing again. Do not retain additional
provenance linking the `3T` allocations to individual `T` sources. The two
three-time tables do not define a four-time joint table.

The conditional means and variances are Brownian-bridge formulas applied to cell-center
endpoints. With rounding and truncation this is not exact conditioning of the discrete
forward kernel. Statistical fine-tuning, including integration over endpoint intervals,
is deferred. In cell-index units, the kernels can be precomputed:

| Operation | Fractional mean, before integer translation | Variance |
| --- | --- | --- |
| Initial forward allocation | 0 | `D` |
| Direct extension | 0 | `3D` |
| Insert `2T` | 0, 1/3, 2/3 | `2D/3` |
| Insert `3T` | 0, 1/2 | `D/2` |

The prototype uses the existing six-standard-deviation normal clamp and `Math.round`
semantics. All allocations conserve their input counts exactly within safe-integer
arithmetic. Random addresses distinguish origins, operations, endpoint geometry, and
the three times of each bridge. Second bridge addresses contain only their `2T` and
`4T` endpoint cells, not a former `T` source.

## Integrating single-channel contraction

The proposed organizing change is to extend the geometry/owner classifiers. A query
resolves either to an **expansion-generated fact**, with a retained-record projection,
or to a **contraction-generated fact**, with the usual refinement owner and dependencies.
Classifications depend on geometry and channel parameters, not which facts happen to
be cached. Retrieving an expansion fact ensures its owning epoch has been constructed.

This applies to owned batches as well as individual cells and flows. Do not sample a
new subdivision batch and then overwrite some entries with expansion values. Existing
expansion allocations are authoritative, including any margins they provide to otherwise
new contraction operations. Classifiers should supply the necessary dependency geometry;
query implementations should not perform arithmetic on epoch or stage labels.

For origin `[0,1)`, expansion to time `4` retains width-1 populations and adjacent
flows at `0,1,2,3,4`. These supply the overlapping coarser contraction facts:

- Temporal allocations can be projected only where the necessary association is
  present in one retained three-time batch.
- E–F populations and child populations can be obtained by summation.
- G–H incidence margins and fine-flow reconciliations can be recovered from the retained
  fine flows, rather than sampled again.

The generation order supplies the coarser `0 → 4T` temporal structure without a
four-time table. Summing the `(T,2T,4T)` table over `T` gives the `2T → 4T`
counts. Because there is just one origin cell at time zero, these also determine
the coarse `(0,2T,4T)` allocation for A–B. The `T → 2T` leg determines the
left-half `(0,T,2T)` allocation, while the second bridge table directly supplies
the right-half `(2T,3T,4T)` allocation for C–D. This resolves the temporal association
needed here without retaining former sources through another subdivision.

Where expansion has not supplied the finer detail, retain the usual contraction
operations: temporal multinomials, spatial binomials, and hypergeometric allocations
that reconcile flow margins. At interfaces between existing fine records and newly
refined regions, both sides must use the same child population facts.

This is a compatibility argument, not yet a complete classifier construction or proof
of finite ancestry. Geometry/support helpers must recognize expansion-generated flows
rather than reject them using v1's initialization-specific domains. Tests should verify
batch ownership, conservation, overlap agreement, finite ancestry, query-order
independence, and preservation of earlier answers after further expansion.

## What expansion tells us about support

The following bounds concern the records expansion generates, in representable geometry.
They are analytic bounds, not yet executable support helpers or a bound for contraction.
Let `K` be the normal cutoff, `c₀` the original cell center, and `R_e` a radius around
`c₀` containing endpoint-cell centers at epoch `e`.

At width `L_e=L₀ 2^e` and time `T_e=L_e²`, direct extension contributes at most
`K sqrt(3D) L_e`, rounding contributes at most `L_e/2`, and endpoint coarsening shifts
the representative center by `L_e/2`. Therefore:

```text
R₀ <= (K sqrt(D) + 1/2) L₀
R_(e+1) <= R_e + (K sqrt(3D) + 1) L_e
R_e <= (K sqrt(D) + 1/2) L₀ + (K sqrt(3D) + 1) (L_e - L₀)
```

The geometric sum makes the endpoint radius `O((1+K sqrt(D)) sqrt(T_e))`, independent
of population and without an extra factor for the number of epochs.

Bridge excursions require additional room. Starting from a center-radius bound `R` at
time `T`, define:

```text
A = K sqrt(3DT) + L/2
B = K sqrt(2DT/3) + L/2
C = K sqrt(DT/2) + L/2
```

| Recorded time | Center-radius bound about `c₀` |
| --- | --- |
| `2T` | `R + A/3 + B` |
| `3T` | `R + 2A/3 + B/2 + C` |
| `4T`, after coarsening | `R + A + L/2` |

Add the relevant cell's half-width to cover the whole interval, not only its center.
The same bounds hold backward in time. Intermediate cells can extend beyond the direct
endpoint envelope, but their radii also grow as `sqrt(abs(t))` at recorded times.

For example, with `D=0.5` the actual kernel tables give initial offset bound `4`, direct
extension bound `7`, first-bridge residual bound `11/3`, and second-bridge residual bound
`7/2`, all in current cell-width units. Including rounding and coarsening, a conservative
whole-cell envelope for all retained nonzero-time frames is
`[c₀ - 10.40 sqrt(abs(t)), c₀ + 10.40 sqrt(abs(t))]`. This is worst-case support, not a
typical displacement estimate or an empirically fitted boundary.

Expansion does not determine the support at unrecorded times, particularly
`0 < abs(t) < L₀²`. Derive the complete envelope after single-channel contraction is
specified. For global pruning, it must account for the origin interval, observation
resolution, and origin scale; a bound that simply adds a large multiple of `L₀` need
not exclude increasingly distant origins whose widths also increase.

## Global composition, after the single-channel model

Choose origin channels whose time-zero intervals form a disjoint covering of space.
The intended sum is not over all overlapping dyadic intervals, which would count the
same spatial region repeatedly. The precise partition and its enumeration belong to
this later construction.

Give channels distinct random namespaces. Population and flow queries are sums of their
channel contributions. Use the completed single-channel support bound to identify a
finite set of possible contributors to each supported query, without evaluating every
origin. Establish finite enumeration for the chosen origin partition; support of one
fixed-origin expansion alone is not that proof.

This explicit sum provides the baseline construction against which subsequent changes
can be understood and checked.

## Later optimization: sum earlier, refine locally

Once the global sum works, move some summations upward in the dependency hierarchy.
Instead of refining every channel separately and adding only the final answers,
combine compatible population/flow contributions locally and perform some finer
operations on those combined counts. The aim is to avoid repeating similar refinement
work for every contributing origin.

Do not require that optimization in the first single-channel model. Which facts can be
pooled, which conditioning information must remain attached, and where the aggregate
batch is owned are subsequent design questions. Moving a sum across a stochastic
operation is not automatically valid for every sampler or conditional allocation.
Independent multinomials with identical probabilities can be pooled in distribution,
but that alone neither establishes equivalence of the full hierarchy nor preserves
seeded outputs. Birds 2 requires approximation of the same Poisson–Brownian target,
not exact preservation of the reference construction's joint law. Small differences,
such as narrower support from applying a cutoff after summation rather than before it,
are acceptable if documented and evaluated. Verify conservation, ownership, support,
and statistical behavior, and adopt or defer each optimization based on cost-benefit
analysis.

## Implementation status and next work

The single-origin expansion is implemented in `src/models/birds2a/expansion.ts`, with
base length 1 and duration 1. Cell/flow entry classifiers and expansion-projection
readers are implemented, including classification of whole cell-subdivision batches.
They do not yet constitute a complete contraction query engine. The next work is the
remaining temporal/incidence/reconciliation owner classifications, support enumeration,
and recursive queries, followed by complete dependency/support analysis. Global channel
composition and local pooling remain explicitly later steps. The
[implementation notes](./BIRDS_EXPANSION_PROTOTYPE.md) describe the current modules and CLI.
