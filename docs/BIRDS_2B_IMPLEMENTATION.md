# Birds 2b: channel sum and composite refinement

Birds 2b merges boundary facts from independently namespaced Birds 2a channels,
then refines their aggregate in a separate composite layer. The explicit channel
sum remains available internally as a reference and boundary provider. Birds 1
and the single-origin Birds 2a model remain available.

## Origins and randomness

The canonical time-zero partition is
`…, [-4,-2), [-2,-1), [-1,0), [0,1), [1,2), [2,4), …`.
The base width uses `EXPANSION_DEFAULT_CELL_WIDTH`. Endpoints use half-open ownership.
Each origin receives a Poisson population with mean density times width.

Every channel receives the global model seed. Birds 2a already includes origin
endpoints in both its expansion and refinement addresses; there is no additional
seed transformation. Thus a channel agrees exactly with a standalone Birds 2a
instance with that seed, density, diffusion, and origin.

## Finite channel selection

For a reference-sum query cell at time `t` and width `w`, invert the existing local flow support
toward zero. Let `n = |t| / (w²/4)` (with the named time-scale constant included)
and `R = floor(quarterRadius)`.

1. Expand the possible interval of cells by `(n mod 4) R w` on either side.
2. Replace `n` by `floor(n/4)`.
3. If `n` is nonzero, double `w`, round the interval outward to that grid, and repeat.

Positive population requires positive incident flow toward zero. Local flow bounds
enclose each step, and spatial aggregation encloses each possible source cell in its
parent. Induction therefore gives a finite interval at zero intersecting **every**
contributing origin. The time index decreases geometrically. The origin partition
can be enumerated directly within this interval, with no arbitrary maximum epoch
and no stopping at the first nonintersecting channel.

Filter this finite candidate list with each channel's tighter time-only population
support. An unavailable numeric support bound never counts as an exclusion.
For flow queries, select candidates at the source and filter against the destination
support as well. Endpoint support is necessary, not sufficient; extra candidates
are harmless. No new channel-specific flow envelope is assumed.

Selection uses geometry and diffusion, not seed, density, sampled counts, or cache
contents. Numeric geometry failures are errors, not silent truncation of the sum.

## Queries and caches

`Birds2bEngine` lazily constructs participating channels and sums their integer cell
and flow answers. Summation throws if the total is not a safe integer. No sampling
occurs at the summation layer. Conservation and query-order independence follow
from the per-channel invariants and complete candidate enumeration.

The `Birds2b` public API wraps `CompositeEngine`, whose boundary provider is
`Birds2bEngine`. It uses the same capabilities and viewer-facing methods as
Birds 1 and Birds 2a. Shared Birds 2 query geometry is in `birds2a/queryBackend.ts`.
The representative origin used there determines legal geometry only, not global
population or stochastic ownership.

Both layers have bounded QuickLRU caches. Public cached-only reads return a
complete cached composite population or `undefined`; they do not evaluate either
layer. Clearing the composite alone leaves its provider untouched. Public
`clearCache()` clears both layers and channel contraction caches, but preserves
authoritative expansion records.

Channel instances and their expansion prefixes remain retained without eviction.
The cache widget reports bounded disposable caches, not all retained memory.
`getChannelUsage()` reports instantiated channels and retained expansion epochs.
Retention across very large explorations is a memory/performance follow-up.

## Composite ownership

The composite has its own classifiers, A–H refinement queries and cache namespace.
Its only lower-layer capabilities are reading a population or flow. It has no
expansion stages and never modifies a channel's stochastic facts.

The merge geometry follows a unit-origin expansion schedule across the whole
spatial line. On the positive branch the finest imported flows cover:

- [0,1], [1,2], [2,3], [3,4] at width 1;
- [4,8], [8,12], [12,16] at width 2;
- generally [T,2T], [2T,3T], [3T,4T] at width L, with T=L².

The negative branch is reflected in time. Constants come from the named base
width and time-scale constants. Populations at these endpoints are imported at
the finest adjacent boundary width and all legal coarser widths. Thus t=4 has
both width-1 and width-2 channel-merged populations. Legal coarsenings of retained
flows, including 0→4, 2→4 and mixed-width margins, are also imported; classifiers
define their exact ownership. These additional facts keep spatial and temporal
aggregation consistent at band boundaries.

Below this boundary, the composite owns F binomial splits, A/C midpoint
multinomials, G incidence allocations and H reconciliations. It uses the same
samplers and local motion-support closure as 2a, with a separate
`birds2b.composite` random namespace. Imported splits and margins are read, not
independently resampled. A temporal joint whose two public legs are imported is
not queried; attempting to evaluate it throws.

Fine composite answers need not equal the explicit sum of fine channel answers.
They supersede facts that the composite never reads. Boundary agreement and
conservation are required; equality of the full joint probability law is not.
The Brownian target is unchanged, but changed conditional behavior and any
effective support differences need statistical evaluation. Channel-specific
population envelopes prune only reference-sum queries, not composite refinements.

### Flow-dependent stage F follow-up

Current F uses a fixed probability of one half. A future split conditioned on
known inflows/outflows requires reconsidering the boundary design: imported fine
populations could reflect channel flows that the composite supersedes.

This is not solely a composition issue. In a single channel, expansion already
creates width-1 populations at t=4 before aggregating them to width 2 and sampling
the t=4→8 flows. Given the coarse population, those new flow counts do not consult
the previously generated fine split. Changing only the F sampler cannot make
that existing split condition on the new flows.

During calibration, revisit expansion order, retained conditioning information
and composite merge ownership together if flow-dependent F is pursued. Implement
a consistent change or explicitly document its deferral; do not silently reuse
shadowed channel flows as conditioning facts.

## Viewer and verification

`/birds2b` reuses the full shared Birds viewer, including navigation, editable model
parameters, flows, click-to-track, cached scale fades, and prefetching. Its default
seed is `Polis 5`, density 2, and diffusion 0.5. There is no origin selector or global
support outline: the model covers the whole spatial line.

Tests cover partition boundaries, finite geometric selection, comparison with a
wider direct channel sum, population/flow conservation, spatial subdivision,
query-order and cache independence, empty populations, and shared-viewer routing.
Composite tests check boundary classification across scales, read-only
boundary access, mixed-width conservation, and decreasing ranks on actual
recursive edges. The rank diagnostic is shared with unit-origin 2a because the
dependency geometry agrees; production ownership uses the composite classifiers.

Run `npm run benchmark:birds2b` for two fixed 600-cell batches: 24 spatial columns
and 25 time rows, centered near the origin, at widths 1 and 1/4. Time steps are
`w²/4`; seed, density, and diffusion match the demo. Each case runs in a separate
process with a 20-second deadline, for both reference and composite modes.
Output separates cold queries and warm replay, and includes channel counts.
Candidate counts and selection timings describe the reference query geometry;
the composite actually selects channels at its merge boundaries.
These are model-query timings, not browser frame timings.

Initial local checks measured roughly 3.7–4.6 seconds cold and below 1 ms warm.
Candidate selection took 7–12 ms, averaging about 5–8 candidates per query.
Cold views can therefore visibly block the synchronous viewer.

A local paired run (Node 22.22.3, macOS arm64) measured:

| Width | Explicit sum, cold | Composite, cold |
| --- | ---: | ---: |
| 1 | 3.66 s | 1.21 s |
| 1/4 | 4.03 s | 0.85 s |

Warm replays were below 1 ms in all four cases. These single-run comparisons
suggest roughly 3–5× faster cold queries for these workloads, not a general
performance guarantee. Seeded checksums differ as expected because aggregate
refinement replaces per-channel fine sampling.

## Remaining work

The composite implements an earlier summation placement. Statistical comparison
with the explicit reference and broader workload evaluation remain open before
closing Phase 2. Statistical calibration and Birds 2c materialization remain later
phases; none of them are implicit in this implementation.

## Initial composite profile

Run `npm run profile:birds2b` for four isolated 600-cell workloads. Each uses
24 spatial columns and 25 time rows, spatially centered on zero, with time step
`w²/4`. The cases below specify width and central time; seed is `Polis 5`,
density 2, diffusion 0.5. Each subprocess has a 30-second deadline including a
disposable JIT warm-up, fresh-model baseline, and fresh-model profile.

The profiler samples V8 stacks every 500 microseconds during queries only.
Constructors, imports and rendering are outside the measured query interval.
Inspector start/stop samples are excluded and reported separately. Categories
are disjoint, assigned to the deepest recognized stack frame; e.g. classifier
work called from support enumeration counts as classifiers, not support.
Native/inlined work can be attributed to its calling frame, so small percentages
are estimates, not precise per-operation timings. The separate boundary timer
includes all work inside the reference-sum provider and overlaps these categories.

Local Node 22.22.3/macOS arm64 results:

| Width; central time | Cold baseline | Profiled | Boundary share of profiled wall time |
| --- | ---: | ---: | ---: |
| 1; 0 | 1.24 s | 1.36 s | 77% |
| 1/4; 0 | 0.82 s | 0.82 s | 19% |
| 4; 0 | 1.98 s | 2.08 s | 88% |
| 1/4; 6 | 0.90 s | 0.92 s | 23% |

| Sample category | Width 1 | Width 1/4 | Width 4 | Width 1/4, t=6 |
| --- | ---: | ---: | ---: | ---: |
| Classifiers | 35.9% | 46.2% | 42.4% | 47.0% |
| Support/geometry, excluding classifiers | 33.6% | 25.4% | 31.6% | 23.4% |
| Cache operations | 12.3% | 6.9% | 7.4% | 8.4% |
| Cache key construction | 0.2% | 7.4% | 0.2% | 6.3% |
| Garbage collection | 9.6% | 7.2% | 10.3% | 7.2% |
| Distributions, excluding RNG/encoding | 0.6% | 1.1% | 0.6% | 0.8% |
| Address encoding | 0.9% | 0.6% | 0.7% | 0.6% |
| Hashing/RNG | 0.2% | 0.2% | 0.4% | 0.5% |
| Other | 6.6% | 5.1% | 6.3% | 5.8% |

These are single-run diagnostics, not stable timing thresholds. An earlier pass
showed the same dominant costs. Warm replays took 0.2–0.5 ms. All profiled results
matched their unprofiled baseline and warm replay exactly.

Low-risk optimization candidates:

1. Move full construction classification behind successful scalar-cache lookups.
   Implemented in the channel, composite and reference-sum engines, including
   cached-only population reads. Misses retain validation, and dependency observers
   still see cache-hit edges. Valid zero answers from empty channels are cached too.
2. Replace full midpoint-table construction during parent-support membership
   tests with a direct test against the precomputed parity kernel. Current searches
   repeatedly translate, filter and allocate whole tables just to call `some`.
   Preserve positive-probability membership, including the zero-diffusion cases.
3. Avoid repeated scale validation and owner reconstruction within one support
   operation. `birds2aScale` alone accounts for roughly 8–16% of self samples;
   both composite and channel classifiers use it. Keep public validation intact.
4. Enumerate only the endpoint width requested by the recursive caller, rather
   than enumerating/sorting all legal widths and then filtering most of them out.

Apply improvements to the channel and composite paths where relevant: optimizing
only the composite cannot address the dominant cost of the coarse workload.
Sampler replacement and another cache-library change are not the first priorities
for these default-density population-query workloads. High-density and overlay/
tracking workloads may have different bottlenecks and are not covered by this run.

### Cache-first comparison

A fresh before/after run of the same profiler produced these unprofiled cold-query
timings (milliseconds):

| Width; central time | Before | Cache first |
| --- | ---: | ---: |
| 1; 0 | 1167 | 1188 |
| 1/4; 0 | 806 | 808 |
| 4; 0 | 1989 | 2032 |
| 1/4; 6 | 908 | 920 |

There is no demonstrated cold-query speedup: differences of 0–2% in these
single-run measurements are too small to distinguish from runtime variation.
Warm replay remained sub-millisecond. Classifier samples remain prominent
(37–47% after the change), consistent with the substantial repeated classification
inside support searches, which scalar-cache lookup ordering does not remove.
Direct midpoint-support membership tests remain the next optimization candidate.

Regression tests explicitly verify that zero-valued hits skip classifiers,
misses still reject illegal/nonfinite geometry without populating caches, and
clearing caches restores miss-time classification. Existing conservation,
deterministic replay, and decreasing-dependency-rank tests cover the recursive paths.

### Geometry and ownership predicates

Flow legality is now checked separately from construction ownership, using shared
`classifyBirds2FlowGeometry`. Support enumeration uses this geometry check rather
than constructing full flow-owner results. Already-classified flows use a
radius-only support predicate; the checked support entry points still reject
invalid geometry. Temporal/spatial owner queries use direct expansion/merge
predicates instead of constructing unrelated refinement owners.

The change applies to both channel and composite paths. Predicates are checked
against full classification across origins, scales, both time directions, mixed
widths and invalid geometry; existing tests still check conservation and ancestry.
It does not change kernels, random addresses or intended stochastic semantics.

Using the same four profile workloads, unprofiled cold-query timings were:

| Width; central time | Cache-first version | Separated predicates |
| --- | ---: | ---: |
| 1; 0 | 1188 ms | 940 ms |
| 1/4; 0 | 808 ms | 627 ms |
| 4; 0 | 2032 ms | 1544 ms |
| 1/4; 6 | 920 ms | 692 ms |

This is about 21–25% less wall time in a single-run comparison, not a stable
performance guarantee. Classifier samples fell from about 37–47% to 23–36%;
boundary read counts and retained channel/epoch counts were unchanged.
Repeated legality checks and midpoint-table allocation remain optimization
opportunities; this change does not implement the remaining candidates above.
