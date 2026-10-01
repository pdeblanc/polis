# Polis

See the [documentation index](./docs/README.md) for technical references and design records.

## Requirements

- Node.js 22 or later
- npm 11 or later

## Install dependencies

```sh
npm install
```

## Run the development server

```sh
npm run dev
```

Vite prints the local URL when the server starts.

## Run checks

```sh
npm test
npm run typecheck
npm run lint
```

Run tests continuously while editing with:

```sh
npm run test:watch
```

## Run benchmarks

Inspect the standalone single-origin Birds expansion prototype (no GUI or production-model integration):

```sh
npm run experiment:birds-expansion
npm run experiment:birds-expansion -- --origin 32 64
```

Save Birds 2 single-channel expansion and refinement measurements with a progress bar:

```sh
npm run measure:birds2-calibration -- --seed-count 32 --output calibration-pilot.jsonl
npm run measure:birds2-calibration -- --list-stages
npm run measure:birds2-calibration -- --seed-count 100 --stage epoch-1.forward.first-split --output first-split.jsonl
npm run measure:birds2-calibration -- --seed-count 100 --stage refinement.origin.level-0.forward.A --output refinement-A.jsonl
```

Output files must not already exist. See the
[manifest and output format](docs/BIRDS_2_CALIBRATION_MANIFEST.md) for details.

Convert a completed measurement file into query-oriented JSONL:

```sh
npm run table:birds2-calibration -- --input measurements.jsonl --output measurements.queries.jsonl
```

Each row contains one query/parameter combination, a seed-ordered data array,
and sample statistics. Input files are preserved; output files must not exist.

See the [prototype notes](docs/BIRDS_EXPANSION_PROTOTYPE.md) for parameters and full-record output.

For resumable Birds standard-A evaluation collection, use `npm run evaluate:birds`.
See the [evaluation runbook](docs/BIRDS_EVALUATION_RUNBOOK.md) for dry runs, limits,
resumption, and the preserved model baseline. This does not yet implement all batches.
Analyze saved checkpoints with `npm run analyze:birds-evaluation -- DIRECTORY`;
add `--plan` to inspect the schedule without running the statistical analysis.

Run the four-case evaluation smoke protocol (32 trials per case, including order/cache
replays; no bootstrap or reference Monte Carlo):

```sh
npm run evaluate:birds-smoke
```

It prints progress and saves a manifest, trial JSONL, and per-case summary JSON in a new
ignored `artifacts/evaluation-smoke-*` directory. An optional argument selects a new
output directory; existing directories are never overwritten. Each model query has a
supervised two-second timeout. This is not the full evaluation suite or a performance run.

Print tab-separated terrain and starfield complexity measurements:

```sh
npm run benchmark:complexity
```

Run bounded Birds 2a complexity benchmarks (JSONL output):

```sh
npm run benchmark:birds2a
npm run benchmark:birds2a -- --case viewport
```

Run the Birds 2b cold/warm viewport benchmarks (20-second limit per case):

```sh
npm run benchmark:birds2b
```

Profile cold Birds 2b viewport queries at several scales:

```sh
npm run profile:birds2b
```

Each profile case has a 30-second subprocess deadline. Output includes sampled
CPU categories, channel-boundary time, and unprofiled baseline timing.

Compare numeric cache-key construction alternatives (bounded microbenchmark):

```sh
npm run benchmark:birds2-keys
```

Case definitions, limits, and results are in [the benchmark notes](docs/BIRDS_2A_BENCHMARKS.md).

Run the distribution throughput benchmarks:

```sh
npm run benchmark:distributions
```

Print tracker diagnostics for the ordinary, dense, and known-collision cases:

```sh
npm run benchmark:birds-tracker
```

Pass one or more case names to run a subset, such as:

```sh
npm run benchmark:birds-tracker -- known-polis-3-meeting
```

Sample Birds cell populations across independent seeds and compare their empirical
marginals with the Poisson reference (the optional argument is the trial count):

```sh
npm run characterize:birds-populations
npm run characterize:birds-populations -- 5000
```

Pass case names after the trial count to select a subset, which is useful for more
expensive deep-epoch cases. These cases are opt-in rather than part of the default run:

```sh
npm run characterize:birds-populations -- 200 epoch-8-density-compensated
```

Sample every spatial phase across one coarse-cell-width block at a deep epoch. Arguments
select the epoch, number of paired seeds, and optional diffusion rates; the reference mean
remains four birds per fine cell:

```sh
npm run characterize:birds-population-phases -- 8 50
npm run characterize:birds-population-phases -- 8 50 1 2 4
```

Calculate the structural deterministic cell-population bound. Arguments select maximum
epoch, population density, and diffusion rates. The report also computes the tighter,
more expensive reachability bound through epoch 3:

```sh
npm run analyze:birds-population-bounds -- 12 2 0 0.5 1 2 4
```

Run the gamma-process/Dirichlet research diagnostic (optional number of trials per case):

```sh
npm run experiment:gamma-process -- 2000
```

Compare the direct/lazy Poisson-race multinomial experiments with sequential binomials
(optional race samples per case; default run takes tens of seconds):

```sh
npm run experiment:poisson-race -- 20
```

Compare the one-dimensional count hierarchy against the gamma-bridge race and sequential
binomials (optional count-race samples per case; gamma samples capped at 3):

```sh
npm run experiment:poisson-count-race -- 20
```

Capture viewport multinomial parameters and replay both samplers, weighted by observed
call frequencies (race samples per parameter group; add `--details` for per-group data):

```sh
npm run experiment:birds-sampler-workload -- 32
```

Add `--profile` for a separate weighted race-sampler profile of scalar distributions,
encoding, hashing, residual overhead, and operation counts:

```sh
npm run experiment:birds-sampler-workload -- 32 --profile
```

Add `--compare-tags` to compare the optional operation-prefix cache with the default:

```sh
npm run experiment:birds-sampler-workload -- 32 --profile --compare-tags
```

Compare materialization cutoffs on captured Birds workloads or larger synthetic races:

```sh
npm run experiment:birds-sampler-workload -- 32 --cutoffs=1,4,16
npm run experiment:poisson-materialization
```

Compare count-guided cutoff search with bisection on identical Poisson processes:

```sh
npm run experiment:poisson-search
```

Compare full address encoding with prefix reuse, including separate encoding/hash profiles:

```sh
npm run experiment:poisson-prefix
```

Measure splitter count frequencies and compare small-count binomial table limits:

```sh
npm run experiment:poisson-binomial
```

Compare cumulative-root caching with root scanning:

```sh
npm run experiment:poisson-traversal
```

Sample density-compensated Birds flow marginals. Arguments select epoch, trial count,
and optional diffusion rates:

```sh
npm run characterize:birds-flows -- 4 200 0.5 1 2 4
```

Measure complete-outflow drift across every source phase in one coarse-cell-width block:

```sh
npm run characterize:birds-flow-phases -- 4 50 0.5 1 2 4
```

Measure temporal bridge kernels and child-cell crossing/retention against the integrated
Brownian reference. Arguments select trial count and diffusion rates:

```sh
npm run characterize:birds-bridges-crossings -- 100 0 0.5 1 2 4
```

Screen deterministic candidate seeds and characterize retained collision-free trajectories.
Structural resolution refinement is allowed; candidates are rejected when the tracker
detects a multi-bird endpoint or a requested waypoint is not a singleton.
Arguments select the candidate count, retained-path ceiling, and diffusion rates:

```sh
npm run characterize:birds-trajectories -- 200 25 0.5 1 2 4
```

Build an equal-quota collision-free cohort over every spatial and temporal starting
phase. Arguments select the candidate ceiling per phase, path quota per phase, and
diffusion rates:

```sh
npm run characterize:birds-balanced-trajectories -- 100 2 0.5 1 2 4
```

Run the corresponding labeled finite-population Brownian reference on a quotient space:

```sh
npm run characterize:brownian-balanced-trajectories -- 100 2 0.5 1 2 4
```

Run the anonymous, adaptively refined tracker against labeled Brownian ground truth.
Arguments select the candidate count and diffusion rates. An optional
`--max-refinements=N` changes the per-step refinement budget:

```sh
npm run characterize:brownian-reference-tracker -- 500 0.5 1 2 4
```

Profile Birds engine time inside distributions, hashing, address encoding, and other
model work:

```sh
npm run profile:birds-engine
```

## Build and preview

Create a production build:

```sh
npm run build
```

Serve the production build locally:

```sh
npm run preview
```
