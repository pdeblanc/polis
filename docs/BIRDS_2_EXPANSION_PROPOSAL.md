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
innovation variance `D * duration`. Examples of origins are `[0,16)`, `[16,32)`, and
`[32,64)`, with analogous negative intervals. The prototype permits a caller-specified
origin and defaults to `[0,16)`.

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
   insert its contribution at `3T` with mean `(x+2y)/3` and variance `2DT/3`.
3. For each resulting allocation through center `z` at `3T`, insert its contribution
   at `2T` with mean `(x+z)/2` and variance `DT/2`. Keep the original `4T` destination
   attached to this conditional batch.
4. Aggregate the width-`L` endpoint cells at `4T` into aligned width-`2L` cells. These
   endpoint contributions are the next epoch's input.

Perform the mirrored construction backward in time. Generation order on each branch is
`4T`, `3T`, `2T`, followed by endpoint coarsening; the whole epoch is computed eagerly.
Backward records follow the outward computation, opposite to chronological flow.

Retain the direct flows, joint allocations across all four times, derived adjacent-time
flows, intermediate populations, and the fine and coarse endpoint frames. The joint
allocations contain information that adjacent-time marginals alone cannot recover.

The conditional means and variances are Brownian-bridge formulas applied to cell-center
endpoints. With rounding and truncation this is not exact conditioning of the discrete
forward kernel. Statistical fine-tuning, including integration over endpoint intervals,
is deferred. In cell-index units, the kernels can be precomputed:

| Operation | Fractional mean, before integer translation | Variance |
| --- | --- | --- |
| Initial forward allocation | 0 | `D` |
| Direct extension | 0 | `3D` |
| Insert `3T` | 0, 1/3, 2/3 | `2D/3` |
| Insert `2T` | 0, 1/2 | `D/2` |

The prototype uses the existing six-standard-deviation normal clamp and `Math.round`
semantics. All allocations conserve their input counts exactly within safe-integer
arithmetic. Random addresses distinguish origins, operations, endpoint geometry, and
conditional contexts, including the final destination of each early bridge batch.

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

There is a concrete reason to expect compatibility. For the default origin, expansion
to `1024` retains width-16 facts at `0,256,512,768,1024`. Aggregating them to width 32
provides the coarser views of an already-completed contraction epoch:

- A–D temporal allocations can be projected from the retained joint records.
- E–F populations and child populations can be obtained by summation.
- G–H incidence margins and fine-flow reconciliations can be recovered from the retained
  fine flows, rather than sampled again.

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
| `2T` | `R + A/3 + B/2 + C` |
| `3T` | `R + 2A/3 + B` |
| `4T`, after coarsening | `R + A + L/2` |

Add the relevant cell's half-width to cover the whole interval, not only its center.
The same bounds hold backward in time. Intermediate cells can extend beyond the direct
endpoint envelope, but their radii also grow as `sqrt(abs(t))` at recorded times.

For example, with `D=0.5` the actual kernel tables give initial offset bound `4`, direct
extension bound `7`, late-bridge residual bound `11/3`, and early-bridge residual bound
`7/2`, all in current cell-width units. Including rounding and coarsening, a conservative
whole-cell envelope for all retained nonzero-time frames is
`[c₀ - 11.08 sqrt(abs(t)), c₀ + 11.08 sqrt(abs(t))]`. This is worst-case support, not a
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
seeded outputs. Document the chosen equivalence and verify conservation, ownership,
support, and statistical behavior when making such changes.

## Next work

Pause expansion implementation here. The prototype and its tests establish a concrete
single-origin expansion construction. The next implementation project is the classifier
and query integration for contraction within one channel, followed by its support
analysis. Global channel composition and local pooling remain explicitly later steps.
