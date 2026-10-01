# Birds 2 single-channel calibration manifest

The executable specification is
[`birds2CalibrationManifest.ts`](../src/experiments/birds2CalibrationManifest.ts).
It is a serializable TypeScript object, not an experiment runner.

- `modelParameters` contains independent arrays of origins, population densities
  and diffusion rates. A runner takes their Cartesian product.
- `seeds` gives a prefix, first integer ID and count. Append each ID in ordinary
  decimal notation without padding or extra separators.
- `stages` groups explicit queries by generation stage, with IDs, titles and
  descriptions. Expansion groups specify an epoch and retained-record path.
  Refinement groups specify their A–H stage, level, parent width, chronological
  time window, branch and internal query method.

The full experiment key is the stage ID plus the query ID. Query kinds are
`population`, `flow` and `temporal-split`. Each query contains fixed world
intervals and times; the same queries apply to every model parameter combination.
Flow and split endpoints are in outward generation order, including on the
negative-time branch. Retained-record paths are relative to the specified epoch.

Run every target, including targets outside the sampled support. Missing sparse
entries mean zero. Different stage/query keys can expose the same scalar fact;
those aliases are not independent samples. Reuse one model instance and its
retained expansion records and refinement caches for all queries with the same
initialization. These are single-channel Birds 2a measurements, not composite
Birds 2b measurements.

## Refinement targets

[`birds2RefinementManifest.ts`](../src/experiments/birds2RefinementManifest.ts)
adds A, B, C, D, E, F, G1, G2 and H groups, in that order, for each of:

- Windows starting at time 0 with base width 1, and time 4 with base width 2.
- Levels 0, 1 and 2: parent width is the base width divided by `2 ** level`,
  and parent duration is its square.
- Positive windows and their reflections across time zero.

Within each window, coarse spatial indices are -1, 0 and 1; destination offsets
are -2 through 2. A/C measure midpoint indices at offsets -1, 0 and 1 from
`sourceIndex + floor(destinationOffset / 2)`. B/D include both/all four time
legs. E/F include the three interior frames and both spatial children. G1/G2
include both child margins, and H includes all four child pairs for every
quarter-time leg. These fixed probes are not exhaustive support enumerations;
their sum need not equal the parent count.

Stages and source/destination subdivision labels use chronological time, even
on the negative branch. The runner converts outward-oriented query endpoints
back to chronological order. A/C use the engine's actual cached three-time
allocations through an internal `queryTemporalSplit` method, not a reconstruction
from flow margins. This does not extend the consumer-facing Birds API. Expansion
joint facts remain read from retained records; unavailable joints still throw.

The 109 expansion groups are followed by 108 refinement groups, for
16,199 scalar queries per world. Each output header specifies exactly which
targets were run. The seed prefix retains its expansion-era spelling so that
existing measurements and new runs sample the same worlds.

The manifest contains no ground-truth values or reference-distribution
calculations. Those belong to separate evaluation code. It does not run
simulations on import.

## Running measurements

### Reference means

`Birds2aMeans(populationDensity, diffusionRate, origin?)` in
[`birds2aMeans.ts`](../src/models/birds2a/birds2aMeans.ts) shares the Birds 2a
consumer query API, but its `count` fields are real-valued ideal Poisson means.
It takes no seed. `queryInflows` and `queryOutflows` throw unsupported-operation
errors because the ideal Brownian process has no finite motion envelope.
`populationSupport` reports infinite bounds at nonzero times with positive
diffusion; this is not the simulation's bounded support.

The scalar `Birds2aMeanQueries` interface also accepts arbitrary observation
intervals and times, including expansion bridges and three-time joint counts.
`measureCalibrationMeans(parameters, stages)` returns these reference means in
the same `[stage][query]` layout as the sampled measurements. Compute references
once per parameter combination, not per seed. The CLI still saves raw samples
only; it does not automatically compute reference means.

For constraints E, the mean is `density × integral_origin P(E | X(0)=x) dx`.
The reference integrates Gaussian transition densities over whole intervals;
it does not approximate later positions as cell centers or uniform populations.
Past and future are independent conditional on the initial position. Displacement
variance is `diffusionRate × elapsedTime`, and zero diffusion uses exact interval
intersections. All these unconditional scalar count targets are Poisson, though
different queries can be correlated.

Means are numerical approximations: adaptive Simpson quadrature uses Gaussian
boundary-layer splits, a nominal absolute mass tolerance of `1e-10` times the
integration's spatial scale, and a ±12-standard-deviation integration window
(omitted Gaussian tail below `4e-33` per transition). These are numerical controls,
not the simulation's truncation semantics, and they do not promise relative
accuracy for very small tail means. Failure to converge raises an error. Reference
caches are disposable and model-scoped.

### Sample runner

Start with a small seed count:

```sh
npm run measure:birds2-calibration -- --seed-count 32 --output calibration-pilot.jsonl
```

List stages or measure one exact stage ID:

```sh
npm run measure:birds2-calibration -- --list-stages
npm run measure:birds2-calibration -- --seed-count 100 --stage epoch-1.forward.first-split --output first-split.jsonl
npm run measure:birds2-calibration -- --seed-count 100 --stage refinement.origin.level-0.forward.A --output refinement-A.jsonl
```

Without overrides the runner uses the manifest's seed count and all stages,
writing `birds2-calibration.jsonl`. The output path must not already exist and its
parent directory must exist. The progress bar is written to stderr and advances
after all model parameter combinations for a seed finish. Redirected stderr
contains one progress line per completed seed instead of terminal cursor updates.

Output is newline-delimited JSON:

- A `manifest` record includes the selected stages and exact query coordinates,
  effective seed range, enumerated model parameters, runtime and Git revision/dirty
  status when available.
- Each `sample` record contains `seedId`, `parameterIndex`, and
  `counts[stageIndex][queryIndex]`. Indices refer to the file header, not an
  external version of the manifest. These are raw scalar observations, not
  ground-truth values or summary statistics.
- A final `complete` record gives completed seed/world counts and elapsed time.

Only one world and its measurement arrays need to be in memory at a time.
Each sample is written after all selected queries for that initialization finish.
No cache is cleared between queries; filtering a stage avoids building unnecessary
later epochs. Generating a requested epoch still generates its normal dependencies.

On a model/query failure, the runner retains preceding sample records, attempts
to append an `error` record, and exits unsuccessfully. Abrupt interruption may
leave a partial last line. A file without a final `complete` record is incomplete;
do not interpret absent samples as zero. Automatic resume is not implemented.
The default full campaign has 16,000 world initializations and about 259 million
scalar observations, so use a pilot to assess runtime and output size first.

## Query-oriented inspection tables

```sh
npm run table:birds2-calibration -- --input measurements.jsonl --output measurements.queries.jsonl
```

This post-processing command creates JSONL with one row per parameter combination
and experiment query, ordered by parameter, stage and query. It uses the input's
embedded manifest, not the current source-code manifest, so older complete
version-1 files are supported. It does not rerun the model or calculate reference
means. The original JSONL remains unchanged, and existing output files are never
overwritten.

Each row has `type: "query-summary"`, `formatVersion: 1`, `manifestId`,
`parameterIndex`, and native JSON objects for `parameters`, `stage`, `query`,
`seeds`, `statistics` and `source`, plus a numeric `data` array. Stage metadata
includes its ID/title/description but not the other queries in the stage.
`data[i]` belongs to seed `seeds.prefix + (seeds.firstId + i)`, in ascending seed order even
if the source records were unordered. Source path, Git information, runtime and
start timestamp are retained for provenance when present in the input.

Fields within `statistics` are `n`, `mean`, `variance`, `standardError`, `min` and `max`.
Variance is the unbiased sample estimator with denominator `n - 1`; standard
error is `sqrt(variance / n)`. For one seed, variance and standard error are `null`
(undefined), not zero. Statistics use an online centered-moment calculation to
avoid subtracting large nearly equal sums of squares. Repeated or correlated
queries remain separate rows; samples are only combined across world seeds.

The converter rejects incomplete/error runs, duplicate worlds, invalid counts,
dimension mismatches and inconsistent completion records before opening the
output. Missing observations are never treated as zeros. Counts are temporarily
spooled to binary storage (8 bytes per observation), then transposed in blocks
of at most 256 queries across all seeds. Temporary storage is cleaned up on
normal completion or caught errors. Allow sufficient temporary disk space as
well as output space. If writing fails or the process is interrupted, a partial
JSONL may remain; only treat the output as complete after a successful command.

### Reference distribution rows

```sh
npm run table:birds2-calibration -- --means --input measurements.jsonl --output measurements.means.jsonl
```

This writes the same parameter/stage/query ordering and metadata as the inspection
table, but each row has `type: "query-reference"` and
`distribution: { kind: "poisson", mean: number }` instead of seed metadata,
sample data or sample statistics. Join the two files by `parameterIndex`,
`stage.id` and `query.id` when they use the same source manifest. The reference
means use `Birds2aMeans`' numerical integration semantics described above.

Only the original measurement file's manifest header is read: reference values
do not depend on seeds or on the sampling run having completed. This command
does not validate that run's samples. It computes unit-density integrals once
per origin/diffusion configuration and reuses them across densities. Progress is
reported after each parameter combination. Output must not exist; a failed or
interrupted calculation can leave a partial file, which must not be treated as
a complete reference table.
