# Birds 2 single-channel expansion and refinement experiment manifest

The executable specification is
[`birds2ExpansionManifest.ts`](../src/experiments/birds2ExpansionManifest.ts).
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

The original 109 expansion groups are followed by 108 refinement groups, for
16,199 scalar queries per world. Existing command and manifest names are retained
for compatibility; each output header specifies exactly which targets were run.

The manifest contains no ground-truth values or reference-distribution
calculations. Those belong to separate evaluation code. It does not run
simulations on import.

## Running measurements

Start with a small seed count:

```sh
npm run measure:birds2-expansion -- --seed-count 32 --output expansion-pilot.jsonl
```

List stages or measure one exact stage ID:

```sh
npm run measure:birds2-expansion -- --list-stages
npm run measure:birds2-expansion -- --seed-count 100 --stage epoch-1.forward.first-split --output first-split.jsonl
npm run measure:birds2-expansion -- --seed-count 100 --stage refinement.origin.level-0.forward.A --output refinement-A.jsonl
```

Without overrides the runner uses the manifest's seed count and all stages,
writing `birds2-expansion.jsonl`. The output path must not already exist and its
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
