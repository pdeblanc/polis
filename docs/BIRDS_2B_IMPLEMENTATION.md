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
