# Birds implementation notes

> **Status: Active implementation record.**
>
> [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md) remains the canonical model
> specification. This document records implementation discoveries, concrete internal
> choices, provisional limitations, and points that should be revisited. It does not
> override the canonical design.

## Current implementation boundary

The internal `BirdsEngine` implements the complete inward recurrence from deterministic
coarse cells and flows through Stages A–H. Queries compose through multiple epochs. The
consumer-facing `Birds` API now provides model-scoped resolution capabilities,
population profiles, singular flows, complete nonzero inflow/outflow lists, explicit
result ceilings, cache controls, and query statistics. An initial spacetime visualization
renders discrete population profiles with space horizontal and future time upward. A
toggleable cursor-following overlay draws every nonzero outflow from the selected cell to
the next sampled row, with count-weighted opacity and width. The dependency overlay,
tagged-bird helper, statistical characterization, and final complexity suite have not yet
been implemented. Initial cold-cache flow measurements cover epoch depth and
diffusion-dependent support width.

The visualization presents each population sample as a filled temporal band centered on
its exact sampled time, with adjacent bands touching. This is a display convention for a
dense readable grid, not a claim that the population remained fixed throughout the band.
It reports the selected `Δx` and `Δt`, limits each frame to a fixed sample budget, and
coarsens through public resolution capabilities when necessary.

The demo exposes seed, population density, and diffusion rate as committed controls.
Density and diffusion accept finite nonnegative numbers, apply on blur or Enter, rebuild
the model, and participate in shareable URL state; default numeric values are omitted
from the URL.

Birds uses parabolic viewport zoom: if the visible spatial span changes by a factor `s`,
the visible time span changes by `s²`. The URL's `area` parameter remains the literal
visible spacetime area, so an area factor `q` corresponds to spatial factor `q^(1/3)` and
time factor `q^(2/3)`. Its world-unit calibration uses `time span = space span² / (64 ×
screen aspect ratio)`, which makes the initial view approximately 128 space units by 128
time units and keeps the rendered spatial/time grid spacing comparable. Other Polis views
retain isotropic zoom.

## Public API boundary

Resolution objects expose exact world-unit widths, durations, and temporal lattice data,
while their epoch metadata remains in model-owned weak maps. A capability cannot be
forged or reused with another model instance. Resolvers choose the coarsest equal- or
adjacent-resolution construction satisfying all requested upper bounds; refinement
methods preserve the exact supported relationship without consumer scale arithmetic.

Population queries cover an arbitrary spatial interval with an ordered cell profile.
They snap the requested time to the nearest supported sample and disclose the exact time
and resolution. Exact flow queries do not snap: their endpoints must lie on the selected
spatial and temporal lattices. Plural incidence queries enumerate support internally,
retain the support helper's canonical spatial order, omit zero flows, and either return
the complete result or an explicit size-limit result.

## Structural geometry

Hierarchy entities store raw world geometry. Pure construction classifiers recover the
introducing case, concrete parents, child indices, temporal leg, enclosing interval, and
parent-search direction. Thin owner projections independently derive subdivision
capabilities.

This separation matters for cells introduced in different ways. A coarse-initialized
cell, a newly timed Stage-E cell, and a cell produced by an earlier Stage-F split all own
the same F/G subdivision capabilities when their raw scale and alignment agree.

Construction classifiers establish whether an entity exists in the hierarchy. Motion
support is a separate question: structurally legal flows outside finite stochastic
support have count zero.

## Motion-support helpers

The former fixed-point support experiment now delegates to the production motion-support
implementation. It remains useful as a report and validation harness, but it is no longer
an independent version of the closure algorithm.

`possibleFlowDestinations` and `possibleFlowSources` return the union of all structurally
legal endpoint resolutions for the supplied cell and duration. At some duration/scale
combinations this includes both equal-resolution and adjacent-resolution cells. A
stage-specific consumer uses the endpoint width returned by its classifier or owner
projection to select the relevant subset. This keeps support algebra centralized rather
than reproducing it inside query cases.

The immutable support tables are cached by diffusion rate in a small module-level LRU.
This differs from stochastic query caches, which are model-scoped. The support cache only
memoizes a pure parameter-derived calculation, has an explicit capacity and clear
operation, and cannot affect results.

## Coarse initialization

The deterministic reflection-symmetric integer allocation is implemented without work
proportional to population. It treats the allocation objective as a separable convex
problem, allocates positive-offset pairs by marginal cost, and performs a convex search
over the parity-compatible center count. Equal optima use the specified lexicographic
tie-break. An independent exhaustive oracle checks the optimizer over small asymmetric
tables.

The current integer samplers and allocation utilities require population counts to be
safe integers. Consequently, a finite density whose rounded coarse-cell population is
outside the safe-integer range currently fails during engine construction. This is an
implementation/numeric boundary, not a newly intended semantic maximum for
`populationDensity`. Before the public API is finalized, measure the practical boundary
and either support it, reject it explicitly at the API layer with a documented numeric
reason, or document why the prototype cannot represent it.

## Stage-E population semantics

Only coarse-root cell populations are fixed to the deterministic rounded population.
Newly timed Stage-E populations generally fluctuate as birds move. For a Stage-E cell,
the conservation invariant is:

```text
cell population = total incoming Stage-D flow = total outgoing Stage-D flow
```

It is not required to equal the population of one coarse root. This distinction was made
explicit after an early test incorrectly expected every Stage-E cell to retain the fixed
coarse count.

## Stochastic ownership and caching

The engine caches complete owner batches rather than independently sampling entries:

- an entry or Stage-B flow owns its A/C midpoint multinomial;
- a cell owns its F binary population split;
- a source cell owns its complete G1 outflow split;
- a destination cell owns its complete G2 inflow split; and
- a Stage-D flow owns its complete H reconciliation.

Individual two-stage, mixed-resolution, and fully refined queries retrieve entries from
those batches. Addresses contain semantic cell geometry rather than temporary array
positions. Cache clearing and query-order tests cover the implemented recurrence.

## Verification completed so far

The implementation tests currently cover:

- scale inversion and construction classification through the first two epochs;
- sampled finite spatial ancestry at coarse-aligned times;
- owner capability independent of construction case;
- fixed-point closure and forward/inverse support agreement;
- exact conservation through A/C, F, G1, G2, and H owner batches;
- incoming/outgoing conservation for Stage-E and fine entry cells;
- H row and column margin reconciliation;
- deterministic results across query order, cache clearing, and continuous LRU eviction;
- recursive evaluation through epoch 3; and
- diagnostic tracing of the actual recursive call graph through all eight query roles,
  with sampled positive and negative spacetime positions through epoch 3 checked against
  the conceptual rank order.

Conceptual ranks are implemented in a separate diagnostic module. The engine's optional
dependency observer reports caller/dependency nodes using the recursion depth already
carried for statistics; production construction and dependency selection do not consult
ranks.

The CLI complexity report includes cold-cache flow ancestry by epoch and diffusion rate.
It reports recursive calls, owned/entity evaluations, cache hits, sampler calls, maximum
depth, and elapsed time. The current guardrail checks linear maximum depth; broader query
families, parameter sweeps, and throughput characterization remain future work alongside
the public API and statistical characterization.

The initial flow measurements show maximum dependency depth growing by roughly nine per
epoch. Total work is much more sensitive to support width: for the benchmark's centered
epoch-3 entry flow, diffusion rates `0`, `0.5`, and `2` produced approximately 920,
24,500, and 118,000 recursive calls respectively. These figures are observations rather
than complexity guarantees, but they identify diffusion/support width as an important
parameter for the public query budgets and later performance work.

## Immutable sightings

The helper-level `Sighting` represents one exchangeable bird with an immutable stack of
nested population cells and counts ending in a singleton. Its public cell and resolution
select one presentation level from that private tube. Initial selection is the helper's
only independent random choice: a temporary population rank chooses children until the
singleton is found, then the rank is discarded. Rescaling within the retained tube needs
no new model queries or randomness, and navigation reuses the singleton leaf instead of
locating the bird again from its public aggregate cell.

Movement uses hierarchy-free continuation operations on the public model:
`queryPopulationCell`, `refinePopulationCell`, `coarsenPopulationCell`, and
`queryIncidentFlows`. These operations own exact geometry, capability relationships,
stage-dependent duration selection, and complete subdivision or incidence results. The
helper therefore contains no parent-coordinate construction, nearby-capability search,
or flow-to-population resolution conversion.

A singleton has one incident unit flow. If its endpoint is not a singleton, the
uncommitted segment is retried at finer resolution. `next`, `prev`, and `rescale` return
new sightings, and all variable searches have explicit model-query and refinement
budgets. Dense collision cases can still require deep, expensive refinement; measuring
and improving that behavior remains part of the planned tracker benchmarks.

Investigation of the `Polis 3` sighting beginning at `[5.3125, 5.375)` and
`t = 6.9921875` found a stronger limitation. Its third forward step repeatedly approaches
`t ≈ 6.994203669932815`; candidate destination cells continue to contain two birds as
space and time are refined. With larger budgets the search reached 37 new refinement
levels, a cell width near `1.49e-8`, and a binary64-scale duration before numeric flow
enumeration failed. This is Zeno-like behavior at an identity-ambiguous meeting, not an
ordinary slow singleton search. The version-1 model records no incoming-to-outgoing
correspondence through a multi-bird cell, so the current helper cannot continue that bird
past the meeting. The design assumption that endpoint refinement always recovers a
singleton is therefore false for at least this constructed path and must be revised
before trajectory tracking can be considered complete.

A follow-up address audit found no omitted owner geometry or cross-stage address reuse in
the cell, temporal-flow, incidence, or flow-reconciliation samplers. Refining the first
two-bird destination from the path above while holding its time fixed produced child
counts `[2, 0]`, then `[0, 2]`, `[0, 2]`, and finally `[1, 1]`. Thus the spatial sampler
does separate the pair, with distinct decisions at successive addresses. The persistent
join/split/rejoin pattern occurs across changing times near the meeting. This is
qualitatively consistent with the recurrent zero set of the difference of two
one-dimensional Brownian motions, although the anonymous count construction does not by
itself establish that the empirical recurrence frequency matches independent Brownian
trajectories. That frequency remains a statistical-characterization question rather than
an identified address or discrete-sampler defect.

The end-of-project statistical work will include a controlled tracker comparison against
a finite population of labeled Brownian motions on a quotient space. Applying comparable
finite-resolution and work-budget constraints to the reference paths will test whether
the same join/split/rejoin behavior and tracking failure arise even without the hierarchy.
This is characterization work: recurrent meetings in the reference process would explain
the observed limitation rather than count as a defect to eliminate.

The tracker now tries the supported one-level asymmetric incidence before refining its
singleton source. This narrows only the collided endpoint while retaining the longest
available time interval, avoiding an unnecessary opportunity for intervening meetings.
Source refinement, and the shorter temporal scale it may entail, is the fallback only
when the asymmetric destination or source cell still contains multiple birds. A focused
unit test requires this path to succeed with a zero source-refinement budget. The known
`Polis 3` meeting still reaches binary64-scale durations after this change, so asymmetric
narrowing improves the search order but does not by itself resolve that identity-ambiguous
path.

The tracker benchmark now reports public model-query and spatial-refinement counts,
asymmetric attempts, minimum cell width and flow duration, elapsed time, cache growth,
and cumulative recursive engine counters. Its initial cases cover sparse zero-diffusion
motion, a denser moving population, and the known `Polis 3` meeting. On the current Node
runtime, the sparse eight-step case completes with 23 model queries and 731 recursive
calls. The dense case and known meeting both reach binary64-scale durations: respectively
about 1.76 million and 1.19 million recursive calls before numeric failure in these
seeded runs. This confirms a qualitatively separate collision-path cost from ordinary
tracking and gives performance work a reproducible baseline.
