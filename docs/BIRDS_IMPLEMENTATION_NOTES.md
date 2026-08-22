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

A late-project analysis task will seek a deterministic maximum cell population as a
function of scale, population density, diffusion rate, and the samplers' truncation
constants. The derivation must account for the model's actual support, conservation, and
possible concentration mechanisms rather than substituting a marginal tail estimate.
If the resulting bound becomes practically small beyond a parameter-dependent epoch, it
may support materializing every bird at sufficiently fine scales instead of checking a
population threshold at each cell. This task records the bound and its limitations only;
the materialization-policy decision belongs to planning the next major Birds revision.

Tracker termination now distinguishes computational resolution from mathematical
ambiguity. Before refining a cell or querying an incident flow, the helper checks whether
the resulting spatial midpoint or temporal endpoint remains separated from its neighbor
by a conservative binary64 error margin at that coordinate magnitude. If not, it throws
a structured `SightingResolutionLimitError` without asserting that the apparent meeting
is intrinsically unresolvable. The Birds page labels this separately from query or
refinement budget exhaustion, and tracker benchmarks record it as `numeric-resolution`.

GUI experiments indicate that these ambiguous collision paths are common whenever two
birds appear likely to meet. The version-1 tracker is therefore considered an adequate
consumer of the current one-dimensional anonymous model; tracker-specific search tuning
is not the primary performance project. Further relief is deferred to a later model
revision, where explicit bird materialization could preserve an easier correspondence or
a higher-dimensional spatial process could make exact collisions rare. The latter is
only practical if the Birds engine becomes substantially faster overall. Near-term
performance work should consequently profile representative population and flow queries
across the model, independent of tracking, and optimize the dominant engine costs.

An opt-in Birds engine profiler now separates outermost distribution wall time from the
rest of a query and attributes address encoding and RapidHash time to every enclosing
distribution. It also reports an uninstrumented baseline because fine-grained timers add
overhead. In representative cold flow queries, distributions occupied about `16.5%` at
epoch 2 with `D = 0.5`, `8.7%` at epoch 3 with `D = 0.5`, and `9.8%` at epoch 2 with
`D = 2`; the remaining `83.5–91.3%` was model machinery. Exact percentages for tiny cell
and warm-cache queries are dominated by timer and JIT noise and should not guide work.

Within the sampled distributions, raw RapidHash took roughly `18–35%` of inclusive
sampler time. Address encoding was usually comparable to or larger than hashing itself.
Binomial calls dominated total sampler work because the multinomial implementation is a
sequence of binomials; hypergeometric work was smaller in these cases. Inclusive parent
rows intentionally include their child samplers, while exclusive rows remove them.

A V8 CPU sample over the same workload attributed about `24%` of all samples to structural
classifiers, `23%` to `lru-cache`, `17%` to motion-support enumeration and deduplication,
`5%` to scale arithmetic, and `8%` to garbage collection. These shares include profiler
startup and are approximate, but they clearly identify repeated classification, support
construction, cache/key activity, and allocation as the major non-distribution costs.
The next optimization investigation should begin with reuse or memoization of structural
facts and motion-support sets, followed by cache-key/allocation costs, rather than replacing
the discrete samplers first.

Within the `372` CPU samples attributed specifically to construction and owner
classification, the exclusive self-sample breakdown was: `classifyCell` `147` (`39.5%`),
`classifyFlow` `88` (`23.7%`), `classifyCellGeometry` `64` (`17.2%`),
`classifyEqualResolutionFlow` `22` (`5.9%`),
`classifyFlowTimeSubdivisionOwner` `18` (`4.8%`), `classifyTwoStageFlow` `14`
(`3.8%`), and `childIndex` `10` (`2.7%`). All remaining classifier and owner helpers
together accounted for `9` samples (`2.4%`). Relative to all `1,435` CPU samples, the
three leading functions occupied about `10.2%`, `6.1%`, and `4.5%`, respectively.

These are self samples, so time in `classifyCellGeometry` is not also charged to its
`classifyCell` caller. The call graph shows substantial repeated validation:
`classifyFlow` classifies both endpoint geometries and then calls `classifyCell` for both
endpoints, while `classifyTwoStageFlow` repeats geometry and cell classification for three
endpoints and then classifies its parent flow. Owner classifiers subsequently reclassify
the same entities. Passing already-derived structural facts through an engine query, or
memoizing facts by canonical entity key, is therefore a concrete optimization candidate.
Functions with zero or very few CPU samples are below this profile's sampling resolution,
not proven to be free.

The first classifier optimization inlined cell length, epoch inversion, scale construction,
and spatial alignment inside `classifyCellGeometry`. A positive finite `max - min` makes
separate endpoint-finiteness checks redundant; the implementation still checks finite
time, exact canonical dyadic width, non-underflowed flow duration, and integer spatial
alignment. Focused regressions cover non-finite endpoints and spatial scales whose time
dimension has underflowed.

On the same calibrated cold-flow cases, uninstrumented time fell from about `34.1` to
`27.7 ms` at epoch 2 with `D = 0.5`, `83.0` to `69.1 ms` at epoch 3 with `D = 0.5`, and
`146.0` to `117.2 ms` at epoch 2 with `D = 2`: improvements of roughly `17–20%` in this
run. A follow-up CPU profile reduced classifier/owner self samples from `372` to `269`
and scale-helper samples from `75` to `44`; total samples fell from `1,435` to `1,271`.
Although sampling and wall-clock variation require treating exact percentages cautiously,
both measurements support continuing with direct classifier simplification before adding
a structural-fact cache.

The remaining construction and owner classifiers were then flattened around the same
principle. `classifyFlow` validates each endpoint geometry and temporal lattice once and
passes those scales to `classifyFlowFromValidCells`; `classifyTwoStageFlow` reuses those
facts for its parent flow. Parent cells, child indices, equal-resolution stages, and
temporal-aggregation facts are calculated directly without helper rediscovery. Flow owner
classifiers now derive their epoch and normalized stage from the already-validated flow
construction. Cell owners derive the actual cell epoch from `CellConstruction` and
compute their next duration directly, rather than calling epoch inversion and scale
construction again.

Against the preceding geometry-only version, calibrated cold-flow baselines fell from
about `27.7` to `21.9 ms` at epoch 2 with `D = 0.5`, `69.1` to `46.0 ms` at epoch 3 with
`D = 0.5`, and `117.2` to `90.1 ms` at epoch 2 with `D = 2`. Relative to the original
pre-inlining profile, those cases are about `36%`, `45%`, and `38%` faster. Classifier and
owner CPU self samples fell again from `269` to `102`, scale-helper samples from `44` to
`14`, and total samples from `1,271` to `1,034`. The remaining classifier samples were
concentrated in `classifyFlowFromValidCells` (`30`), `classifyFlow` (`27`),
`classifyCellGeometry` (`16`), `classifyTwoStageFlow` (`13`), and
`classifyFlowTimeSubdivisionOwner` (`10`). This leaves LRU activity and motion-support
construction as larger targets than classification in this workload.

Cache profiling now separates string-key construction, LRU lookup, and insertion for the
cell, flow, temporal-batch, cell-subdivision, outflow-subdivision,
inflow-subdivision, and flow-space-subdivision caches. It records hit and miss counts by
family and is enabled only for profiled engines. On the calibrated cold-flow workloads,
the complete cache system occupied about `11.4%` at epoch 2 with `D = 0.5`, `12.8%` at
epoch 3 with `D = 0.5`, and `12.1%` at epoch 2 with `D = 2`. Instrumented query time was
within roughly `0–6%` of the separate baseline for these substantial queries.

The temporal-batch cache accounted for about `63–73%` of measured cache time. Its hit
rate was high (`80.5–88.3%`), but it was consulted far more often than any other cache:
`4,067`, `10,040`, and `20,632` lookups in the three cases. Within this family, LRU
lookup took about `59–61%` of cache time, key construction about `32–33%`, and insertion
about `6–10%`. Avoiding repeated requests for an already-known temporal batch may
therefore be more valuable than changing its eviction policy.

The flow cache was the second-largest family at roughly `22‒7%` of cache time. Its hit
rate was low (`9.6–13.5%`) in cold recursive queries, and misses require both a lookup and
later insertion. Other cache families were individually small; incidence and
flow-reconciliation caches had good hit rates, while cell and cell-subdivision caches had
few hits in these particular single-query workloads. Across all families, string-key
construction is material but ordinary LRU operations remain the larger component. Once
a complete query is warm, the root flow-cache hit reduces it to one key construction and
one lookup, with no recursive or distribution work.

The cache-library comparison exercised `lru-cache`, `quick-lru`, `tiny-lru`, Mnemonist,
and a bounded `Map` FIFO using complete Birds flow queries. With caches below capacity,
results were close and workload-dependent; `quick-lru` was generally about `0–8%` faster.
Under constrained capacities, ordinary `quick-lru` was about `15%` faster at epoch 3 with
`D = 0.5` and `10%` faster at epoch 2 with `D = 2`, despite recording fewer cache hits.
The other strict-capacity candidates ranged from about `2%` faster to `3%` slower. A
half-sized `quick-lru` configuration that forced its two generations under the old hard
bound was `6–21%` slower and was rejected.

The Birds engine therefore uses `quick-lru` as its default cache. Its `maxSize` is a target:
the two-generation algorithm can retain up to twice that number of entries. Cache usage
reports this honest worst-case capacity, and tests accept the same bound. This is an
intentional memory-for-throughput tradeoff following the decision that exact LRU policy
is not required. The temporary comparison harness and rejected candidate dependencies
were removed after recording these results. String-key construction remains the next
cache optimization target.
