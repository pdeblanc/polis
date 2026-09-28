# Birds 2a complexity benchmarks

Run the bounded default suite:

```sh
npm run benchmark:birds2a
npm run benchmark:birds2a -- --case viewport
npm run benchmark:birds2a -- --sweep
```

The CLI writes JSONL results to stdout and case progress to stderr. Each case runs
in a separate child process, with a default 15-second timeout and 250,000-request
diagnostic budget per phase. Override these with `--timeout-ms` and
`--max-requests`. `--case` selects case IDs by substring. A stopped case reports
`timeout` or `request-limit` and the runner continues; neither status is a measured
runtime or a successful completion. Unexpected errors give a nonzero exit status.
The timeout includes child startup, diagnostics, and all timing passes.

Implementation: [`birds2aComplexity.ts`](../src/benchmarks/birds2aComplexity.ts) and
[`birds2aComplexityReport.ts`](../src/benchmarks/birds2aComplexityReport.ts).

## Measurement protocol

Every case uses origin `[0,1)` and seed `Polis Birds 2a complexity 1`. Results include
the complete query list, model parameters, sampled population, returned values,
and Node/platform metadata. Queries within a batch run in the listed order and
share a cache.

1. A diagnostic engine evaluates the cold query batch and then repeats it warm.
   Record root requests plus every observed dependency request, including cache
   hits, and distinct requested nodes keyed by role and geometry. Report counts
   by role as well. These are **not cache misses or unique evaluations**.
2. Create a separate engine without an observer and time its constructor.
3. Time eager expansion through exactly the last epoch required by the diagnostic
   cold pass. Expansion therefore starts fresh; contraction caches remain empty.
4. Time the query batch once with expansion retained and contraction cold.
5. Repeat the same batch five times without clearing caches; report mean warm time.

All timed answers must match the diagnostic answers, and the cold contraction pass
must not require further expansion. Timing excludes the answer comparisons. The
diagnostic pass has its own elapsed-time field but is not used as model throughput.
This is model-cache-cold measurement, **not JIT-cold**: the diagnostic pass has already
executed code in the process. The single cold sample and five short warm repetitions
are orientation measurements, not a rigorous timing-distribution study. In particular,
microsecond warm timings are noisy.

`rootRankMax` records the maximum root rank from the
[termination analysis](./BIRDS_2A_DEPENDENCIES.md). It bounds individual dependency
chain depth, not total requests. Warm request counts can exceed the root count if
the workload exceeds cache capacity; a warm pass is not assumed to fit.

## Fully specified cases

The default suite has 17 cases. Unless varied below, density is 32 and diffusion 0.5.

| Family | Geometry | Default values |
| --- | --- | --- |
| Expansion | Equal-width flow `[0,L)` at 0 to `[0,L)` at `L²`, `L=2^s` | `s=0,2,4` |
| Time offset | Width-1 cell `[0,1)` at time `s+1/4` | `s=-16,1,16` |
| Cell refinement | Width `L=2^-s`, cell `[0,L)` at `t₀` | `s=0,2,4` |
| Flow refinement | `[0,L)` at `t₀` to `[L,2L)` at `t₀+L²/4` | `s=0,2,4` |
| Viewport-like | Six columns, four population-snapshot rows, `L=1/2` | `(density,D)=(32,0.5),(32,0),(32,2),(1,0.5),(128,0.5)` |

Here `t₀=floor((3/8)/(L²/4))*(L²/4)`. Viewport columns have indices `-2` through
`3`; row times are `t₀+jL²/4` for `j=0,1,2,3`, queried row-major. This is a small
24-cell batch demonstrating cross-query reuse, not a full-resolution browser viewport.
The physical viewport shrinks with refinement; it is not a fixed-area comparison.

The optional sweep has 116 cases: the three expansion cases; five time offsets
`s=-256,-16,0,16,256`; and cell, flow, and viewport families at all combinations of
`s=0,1,2,4`, density `1,32,128`, and diffusion `0,0.5,2`. Only the default cases
were run for the initial results below. A limit-hit sweep case is censored evidence,
not a reason to increase limits automatically.

## Initial measurements

Measured September 28, 2026, Node v23.6.0, macOS arm64. All 17 default cases completed
within both limits. Density 32 sampled 30 birds; densities 1 and 128 sampled 1 and
124 respectively. Counts below are exact for this workload; timings are rounded.
Setup and expansion are excluded from the cold-contraction column.

| Case | Cold requests | Distinct requested nodes | Cold contraction (ms) |
| --- | ---: | ---: | ---: |
| Expansion, s=0 | 1 | 1 | 0.03 |
| Expansion, s=2 | 1 | 1 | 0.08 |
| Expansion, s=4 | 1 | 1 | 0.05 |
| Time offset, s=-16 | 4,766 | 1,965 | 16.97 |
| Time offset, s=1 | 1,114 | 596 | 6.07 |
| Time offset, s=16 | 8,358 | 3,301 | 32.95 |
| Cell, s=0 | 1,114 | 596 | 5.03 |
| Cell, s=2 | 4,005 | 1,741 | 13.23 |
| Cell, s=4 | 4,009 | 1,745 | 12.57 |
| Flow, s=0 | 191 | 191 | 1.59 |
| Flow, s=2 | 6,209 | 2,450 | 20.36 |
| Flow, s=4 | 13,873 | 5,284 | 55.10 |
| Viewport, density=32, D=0 | 1,400 | 959 | 6.13 |
| Viewport, density=32, D=0.5 | 13,555 | 4,990 | 47.79 |
| Viewport, density=32, D=2 | 45,701 | 11,656 | 140.42 |
| Viewport, density=1, D=0.5 | 12,207 | 4,648 | 41.03 |
| Viewport, density=128, D=0.5 | 13,555 | 4,990 | 47.93 |

Eager expansion through epochs 0, 2, and 4 took approximately 0.48, 4.65, and
8.59 ms respectively for the expansion-family cases. Their flow answers are then
direct retained-record lookups, hence the one-request contraction counts.

Every warm case needed only its root requests: one for a scalar query and 24 for
a viewport batch. The viewport batches averaged about 0.013–0.015 ms warm, versus
6–140 ms cold. Scalar warm times were approximately 0.001–0.021 ms.

The main observations are:

- Diffusion has a substantial effect on the search workload. In the viewport case,
  increasing it from 0.5 to 2 raised requests from 13,555 to 45,701.
- Small population does not eliminate the cost of finding zero contributions.
  The one-bird viewport still needed 12,207 requests. Do not infer complexity
  proportional to occupied populations from sparsity alone.
- Temporal-subdivision requests dominate these request counts: 9,682 of 13,555
  at diffusion 0.5, and 36,945 of 45,701 at diffusion 2. These include cache hits
  and are **not percentages of CPU time**.
- Fine cell counts can become cheap once a coarser population is resolved, but
  fine flows may require considerably more work. The tested `s=4` flow returned
  zero yet still needed 13,873 requests.

These are reproducible workload observations, not an asymptotic complexity proof,
a multi-seed statistical comparison, or a Birds 1 versus Birds 2 comparison. No
model semantics or optimization was changed in response to these measurements.
