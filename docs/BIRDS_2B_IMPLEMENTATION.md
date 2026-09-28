# Birds 2b: explicit channel sum

Birds 2b is the reference global construction: sum independently namespaced Birds
2a channels without moving stochastic refinement across summation. Birds 1 and
the single-origin Birds 2a model remain available.

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

For a query cell at time `t` and width `w`, invert the existing local flow support
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

The `Birds2b` public API uses the same capabilities and viewer-facing methods as
Birds 1 and Birds 2a. Shared Birds 2 query geometry is in `birds2a/queryBackend.ts`.
The representative origin used there determines legal geometry only, not global
population or stochastic ownership.

Global cell/flow answers have separate bounded QuickLRU caches. Cached-only reads
return a complete cached global population or `undefined`; they do not evaluate
missing channel contributions. Clearing caches clears global answers and all
channel contraction caches, but preserves authoritative expansion records.

Channel instances and their expansion prefixes remain retained without eviction.
The cache widget reports bounded disposable caches, not all retained memory.
`getChannelUsage()` reports instantiated channels and retained expansion epochs.
Retention across very large explorations is a memory/performance follow-up.

## Viewer and verification

`/birds2b` reuses the full shared Birds viewer, including navigation, editable model
parameters, flows, click-to-track, cached scale fades, and prefetching. Its default
seed is `Polis 5`, density 2, and diffusion 0.5. There is no origin selector or global
support outline: the model covers the whole spatial line.

Tests cover partition boundaries, finite geometric selection, comparison with a
wider direct channel sum, population/flow conservation, spatial subdivision,
query-order and cache independence, empty populations, and shared-viewer routing.

Run `npm run benchmark:birds2b` for two fixed 600-cell batches: 24 spatial columns
and 25 time rows, centered near the origin, at widths 1 and 1/4. Time steps are
`w²/4`; seed, density, and diffusion match the demo. Each case runs in a separate
process with a 20-second deadline. Output separates candidate-selection timing,
cold global queries, and warm replay, and includes candidate/channel counts.
These are model-query timings, not browser frame timings.

Initial local checks measured roughly 3.7–4.6 seconds cold and below 1 ms warm.
Candidate selection took 7–12 ms, averaging about 5–8 candidates per query.
Cold views can therefore visibly block the synchronous viewer.

## Remaining work

This implements the explicit reference sum, not the optimized Phase 2 construction.
Profiling and evaluation of earlier summation placements remain open. Such changes
may alter the seeded world or probability law and require explicit semantics and
conservation tests. Statistical calibration and Birds 2c materialization remain
later phases; none of them are implicit in this implementation.
