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

Print tab-separated terrain and starfield complexity measurements:

```sh
npm run benchmark:complexity
```

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
