# Poisson–Brownian model evaluation scorecard

This is a model-independent evaluation specification, not a benchmark-results claim.
It applies to models exposing spatial populations and endpoint flows, with optional
trajectory access or a tracking helper. It assumes no dyadic hierarchy, epoch, stage,
particular cache, or materialization strategy. The [v1 summary](./BIRDS_ANALYSIS_SUMMARY.md)
and [detailed record](./BIRDS_ANALYSIS.md) supply current evidence.

The [measurement protocol](#measurement-protocol-v1) fixes parameter grids, physical
observations, sample sizes, seed streams, estimators, reference calculations, and execution
limits. The surrounding sections explain why those measurements are separated.

## Comparison protocol

1. Specify density `rho`, diffusion `D`, observation cells of width `L`, observation
   intervals `T`, world-coordinate locations, horizons, seed/trial counts, budgets, and
   numeric precision before comparing models. Report the dimensionless quantities
   `rho L` and `D T / L²`; include zero diffusion, sparse/dense populations, and several
   resolutions. Parameter sweeps and fixed-model resolution sweeps are different studies.
2. Use an externally specified set of translated/reflected windows and time origins,
   including negative coordinates. Draw extra offsets from a deterministic external
   random stream, independent of model internals. Preserve a held-out window/seed set
   for confirmation after an anomaly is found. Do not select only known v1 bad phases.
3. Request the same physical observations from each model. Record actual returned
   resolution, snapping, support, and missing/unsupported queries. Aggregate to a common
   supported observation grid when semantics allow; otherwise report non-comparability.
   Do not invent detail by interpolation or silently exclude hard cases.
4. For each model, use independent model realizations as trials. Measurements from the
   same realization remain paired; shared seed strings across different constructions
   do not imply identical random populations. Estimate uncertainty by resampling whole
   realizations, or whole independent trajectories where justified, not individual
   correlated cells or increments. Report sample counts and missingness with every metric.
5. Freeze the observation protocol and reference law across versions. Publish all metric
   families separately rather than fitting a composite score to v1's known weaknesses.
   New anomalies can add exploratory measurements, with confirmation on held-out data.

## Reference and observation semantics

The target is a homogeneous Poisson population of intensity `rho`, with independent
Brownian motion satisfying `Var(X(t+T)-X(t)) = D T` in one spatial dimension. For cells
`A,B`, define `K_T(x,B) = P(x + Normal(0,D T) in B)`. Then:

```text
E[N_t(A)] = rho |A|
E[F_(t,t+T)(A,B)] = rho integral_A K_T(x,B) dx
Cov(N_t(A), N_(t+T)(B)) = rho integral_A K_T(x,B) dx
```

Cell counts and individual endpoint-flow counts have Poisson marginals under this
unconditional reference. At `D T = 0`, use interval overlap instead of a Gaussian limit.
For other dimensions replace interval length by volume and state the diffusion covariance.

Integrate over complete observation cells, not their centers. If measurements use cell
centers for displacement, bin reference positions identically before computing moments.
Quantization and conditioning can correlate observed increments even when underlying
continuous Brownian increments are independent. Compare with that observed reference,
not automatically with zero correlation or raw variance `D T`.

A population observation is a snapshot. An endpoint flow does not count visits, all
crossings, or residence time between endpoints. A temporal display band is not an
occupancy measurement throughout the band. Finite ring references must state ring size,
wrap handling, and whether displacement is lifted; conditioning on a fixed total changes
the Poisson reference and must be disclosed.

## Metric families

| Family | Observable measurement | Birds-v1 evidence / current gap |
| --- | --- | --- |
| Consistency | Integer/nonnegative counts; spatial additivity; complete outflow/inflow sums equal endpoint populations; query-order, repeated-query and cache-clear equality | Implemented tests and empirical conservation checks. Not exhaustive across numeric extremes. |
| Population marginals | Mean error relative to `rho |A|`, variance/mean, empty-cell frequency, empirical count-law TV with uncertainty | Measured at coarse and deep scales; limited trials and locations. |
| Flow marginals | Mean/dispersion/zero frequency and count-law discrepancy against the integrated endpoint reference; include tail mass | Measured for selected flows and complete-outflow moments. Rare tails poorly resolved. |
| Homogeneity and symmetries | Variation of marginal and motion statistics under externally chosen translations, time shifts, reflection and matched rescaling | Phase studies are evidence, not a completed hierarchy-independent sampling protocol. |
| Joint population law | Same-time count covariance across disjoint cells; lagged covariance versus the formula above, across separation and time lag | Not systematically measured. Essential because matching marginals alone does not establish Poisson–Brownian motion. |
| Motion over multiple horizons | Drift, second moment, variance, displacement quantiles and tails; increment covariance at several lags | Flow moments and small trajectory cohorts exist; broader horizons and uncertainty remain incomplete. |
| Conditional motion | Midpoint distribution conditioned on endpoint observations; retention/transition probabilities between externally chosen subregions | Internal bridge and child-flow investigations exist. General public-observable adapters are not yet implemented. |
| Tracking | Completion fraction among nonempty starts, empty-start rate, failure causes, correctness against hidden labels where available, precision reached | Birds diagnostics and an independent anonymous Brownian tracker exist; cohorts are not a fully matched rate comparison. |
| Resources and scaling | Cold/warm latency distributions, throughput, peak memory/cache usage, output size, failure rates versus work/budget/precision | CLI complexity, engine profiles and sampler replays exist; a unified browser/CLI percentile suite is not complete. |

Consistency identities apply only to compatible observations of the same conserved
population. Do not sum consecutive endpoint flows as though they partition unique birds,
or infer an individual correspondence by multiplying aggregate flow matrices. Symmetry
is a distributional property, not a requirement that reflected coordinates return the
same sample for one seed.

For heterogeneous-cell mean errors, report both the individual errors and an RMS summary
over the externally fixed window set. A noise-corrected squared RMS estimate is
`mean_i[(sampleMean_i - targetMean_i)² - sampleVariance_i / trials]`; report the raw
estimate as well as `sqrt(max(0, estimate))` and uncertainty. Clamping at zero does not
establish zero bias. Near-zero reference means need absolute errors as well as relative
ones. Empirical TV has a finite-sample noise floor; report support/tail treatment and
reference sampling uncertainty rather than treating plug-in TV as the true distance.

## Trajectory and cost accounting

Maintain an unconditional candidate ledger: attempts, empty starts, completions, partial
paths, budget failures, numeric failures, and other errors. Define starting-bird selection
(for example population-weighted selection in a fixed region) before sampling. In
addition, a screened no-co-occupancy cohort can be useful, but apply the same observable
screen, waypoint resolution, horizon and selection rule to the reference. Report screening
rejections, overflow beyond quotas, and unfilled strata. Never pool incomplete strata as
though balanced, or use survivor moments as unconditional model statistics.

Use a labeled reference to check anonymous tracking correctness without exposing labels
to the tracker. Distinguish incorrect identity, insufficient information at finite
precision, and exhausted computational budget. Include budget-versus-completion curves;
a timeout is data, not an observation to drop. Reference failures explain a possible
mechanism but do not establish equal model quality or failure probability.

Resource comparisons must hold physical query scope, result size, hardware/runtime,
parameters, and cache policy constant. Separate first-use setup from amortized work,
model queries from rendering, and instrumented attribution from uninstrumented latency.
Report medians and tails with enough repetitions, alongside memory and incomplete runs.
Recursive-call and classifier counts are useful implementation diagnostics, not a common
unit of cost across unrelated constructions. Scaling with argument size is evaluated
for a fixed parameterized model; changing density or diffusion is a separate workload axis.

## Measurement protocol v1

The following choices define the runs, rather than leaving them to the implementer.
They are a new protocol; earlier results are not retroactively labeled as these runs.
The standard suite consists of batches A–F below. Confirmation is a separate tier, not
permission to keep sampling until a preferred result appears. Run one case at a time,
checkpoint completed trials, and obey the limits below. This document specifies the
measurements; it does not launch them or claim that the required adapters exist already.

### Parameters, coordinates, and random streams

Use binary64 geometry and counts within each model's documented exact domain. All lengths
and times below are in the shared world units; no conversion to an implementation's epoch
is part of the protocol. `mu` denotes the **requested** mean population per observation
cell: set `rho = mu/L`. Do not replace it by a rounded internal mean in the reference.
Record both requested and effective parameters if initialization rounds them.

| Batch | Widths L | Means mu or densities rho | Diffusion D | Times |
| --- | --- | --- | --- | --- |
| A: marginals, joint counts, symmetry | 16, 4, 1, 1/16 | mu = 1/4, 4, 64 | 0, 1/2, 1, 2, 4 | T = q L²; q = 1/4, 1 |
| B: density-compensated deep observations | 1/256, 1/4096 | mu = 4 | 0, 1/2, 2, 4 | Same q values |
| C: fixed-model scale sweep | 16, 4, 1, 1/16, 1/256 | rho = 1/4, 4, held fixed across L | 0, 1/2, 2, 4 | Same q values |
| D: conditional motion | 4, 1 | mu = 4 | 0, 1/2, 1, 2, 4 | T = q L²; q = 1/4, 1 |
| E: trajectories/tracking | 4, 1 | mu = 1/4, 4 | 0, 1/2, 1, 2, 4 | Step T = L²/4; 16 steps |
| F: runtime/memory | 16, 4, 1, 1/16, 1/256 | rho = 1/4, 4 | 0, 1/2, 2, 4 | Population snapshots spaced by T = L²/4 |

Every row means the full Cartesian product. A has 120 cases, B 16, C 80, D 20, E 20,
and F 40 before the cache/budget variants below. A–C overlap intentionally: an identical
parameter/seed/observation record may be reused rather than queried twice, but must retain
its membership in each report. A and B change the model density with resolution; only C
measures resolution scaling of a fixed parameterized model.

For A–E use 16 observation strata. The first eight integer pairs `(a,b)` are
`(0,0), (1,1), (-1,-1), (3,-2), (-4,3), (17,11), (-18,-12), (31,-5)`.
Generate eight more, for j = 0..7, using Polis's existing addressed RNG and `uniformUnit`:
seed `Polis evaluation protocol 1 locations`; addresses `['space', j]` and `['time', j]`;
`a = floor(2048*uSpace)-1024`, `b = floor(64*uTime)-32`. Keep duplicates if any and record
the resulting coordinates in the run manifest, so the fixture survives future RNG changes.
Stratum `(a,b)` observes `A = [aL,(a+1)L)` at `t = bT`.

For a parameter group, trial r uses model seed `Polis evaluation protocol 1 trial r`,
where r is the decimal integer with no padding. Use the **same realization** for all
16 strata, paired reflections, q values and C resolutions at that parameter setting.
Reconstructing that seed to reset a cache is allowed. Different model implementations
need not produce corresponding birds. All selection/reference/bootstrap randomness is
separate from model randomness, with seeds and addresses specified below.

### A–C: exact requested observations and sample counts

Use **512 independent realizations per parameter case**, r = 0..511. For every stratum:

- Query populations of `A_j = [(a+j)L,(a+j+1)L)` for j = -8..8 at times `t+hT`,
  h = 0,1,2,4. These are the individual cell-marginal observations.
- Query the population of the full 17-cell union at each time, and the two width-L/2
  halves of `A` at t. Check spatial additivity wherever those queries are supported.
- Query complete outflows from `(A,t)` over T and complete inflows to `(A,t+T)` over T.
  Sum them and compare with the respective endpoint populations. From the outflow list,
  record flow counts into each `A_j`, j = -8..8, and the sum outside that window as a
  separate tail bin. Missing entries are zero only when the API certifies completeness.
- Repeat central populations and outflows for the reflected interval `[-(a+1)L,-aL)`
  at the same t. Reflection maps destination j to -j in the reflected local partition.
  Compare distributions and paired per-seed statistics; do not require sample equality.
- For r = 0..31, replay this exact query set in reverse order in a fresh same-seed model,
  then clear its cache and replay forward. Require identical results, including metadata
  about completeness. Different output ordering is normalized by geometric key.

Per stratum and time report population mean, unbiased sample variance, variance/mean,
zero frequency, and empirical Poisson TV. Report these flow statistics for all 17
destinations and the outside-tail count. Compute population covariance between `A` at t
and `A_j` at `t+hT`, j = 0,1,2,4,8 and h = 0,1,2,4. At h = 0 use overlap for the
reference; do not mislabel the j = 0 variance as independence. Pooling across locations
is additional to, never a substitute for, the per-stratum report and RMS mean-error summary.

From complete outflows compute bird-weighted displacement mean, second moment and variance
in units L, using destination centers. Sum count-weighted numerators across trials before
dividing by summed source counts. Empty sources contribute zero numerator and denominator.
If the total denominator is zero, report unavailable, not zero motion. Include the full
destination support in moments, not just the 17 displayed bins. Use the identically binned
Brownian reference. A missing exact duration or resolution is `unsupported`; do not replace
T with a canonical duration and retain the requested-case label.

### D: conditional motion, without a survivor-selected proxy

Use **512 realizations**, r = 0..511, and all 16 strata. Request the joint counts for
`A at t -> C_j at t+T/2 -> B_k at t+T`, with `B_k = A_k`, k = -1,0,1,
and midpoint cells `C_j = A_j`, j = -8..8 plus the complete outside-tail category.
For each k, pool counts across realizations and divide by the pooled A-to-B_k count.
Report conditional midpoint PMFs, TV to the integrated Brownian conditional reference,
and total conditioning population. A zero denominator has no conditional distribution.

Also query the four flows from each half of A at t to each half of A at t+T. Condition
their pooled 2×2 count table on the full A-to-A count. Report retention (diagonal sum),
crossing (off-diagonal sum), and the four probabilities. Check their sum against A-to-A.
Compare with integrated Brownian probabilities, including D = 0's zero crossing.

An adapter may expose existing internal joint facts, but the requested observations are
defined entirely by these physical intervals/times. Do not manufacture joint counts by
multiplying flow margins or by selecting only trackable singletons. If the model cannot
answer a triple or half-cell flow exactly, report `unsupported` for that measurement;
this is an explicit coverage gap, not a fidelity score of zero.

### E: unconditional candidate ledger and screened trajectories

Use **64 candidates per stratum**, for 1,024 candidates per parameter case. Candidate c
in stratum s uses trial seed r = 64*s+c, c = 0..63, independent of other candidates.
Select uniformly among birds in the starting cell when nonempty, using selection seed
`Polis evaluation protocol 1 selection`, address `[s,c]`, and rank `floor(u*N)` in the
helper's fixed selection order. No randomness is used to choose an outflow after selection.

Run the same candidates at per-step query budgets **10,000 and 50,000**, each with
spatial-refinement budgets **32 and 64** (four combinations). Charge each helper-to-model
query once; internal recursive calls remain diagnostics. Reset both counters each step.
Use the same selected starting bird and 16 requested steps in every budget variant.
Record per-step timings, calls, refinement counts, finest space/time resolution, partial
waypoints and terminal status. Enforce the wall-clock limits below as an independent
outcome, not by pretending a recursive-call budget is comparable between implementations.

For each budget variant report outcomes for every candidate, completion among nonempty
starts, and screened retention. A screened path must start alone and be alone at all 16
waypoints; log internally detected co-occupancy separately. Keep **all** qualifying paths
from this fixed candidate set; do not keep searching to fill a quota. Compute moments
separately for completed paths and screened paths, each explicitly conditional on success.
Do not pool incomplete paths into long-horizon moments.

Report increment mean/variance, lag covariances at lags 1,2,4, and displacements over
H = 1,2,4,8,16 steps (using the starting observation at t as the origin for each H). Report each
stratum and pooled results, quantiles 0.05/0.5/0.95, and probabilities of absolute
displacement exceeding 1L, 2L and 4L. Increments within a path are clustered observations.

Run the same protocol against a labeled Brownian reference on a ring of circumference
**256L** with Poisson total of mean `256*mu`, uniform initial positions, and independent
Gaussian innovations of variance D times elapsed time. Use the existing consistent
dyadic Brownian-bridge reference construction for adaptive times, with seed prefix
`Polis evaluation protocol 1 reference` and trial index r. Initialize the stationary
reference at local time zero corresponding to the stratum's starting t; later times are
relative offsets from t. Save its implementation commit
and addressed stream layout in the manifest. Use ring occupancy but lifted displacements;
labels are visible only to the correctness checker. Report unconditioned selected-label
moments as well as moments under the identical waypoint co-occupancy screen and anonymous
tracker completion screen. This separates physical motion, selection and inference limits.

### F: resource workload and repetition counts

For each table-F case query a 32-column × 32-time population grid with columns j = -16..15
and times hT, h = 0..31. Query one complete population profile per time row when available,
otherwise individual cells; record the number of public calls and returned cells. Include
resolution discovery, exclude constructor time (record that separately), and exclude UI
drawing. A fixed-output batch must contain 1,024 snapshots; missing results invalidate
that complete-batch timing and receive a failure status.

After **five untimed batches**, measure **100 batches** in each of three modes:
fresh instance each batch; repeated same window on one instance; and one instance with
the window shifted right by one L per batch. The warmup and measured streaming windows
are consecutive. Use seeds `Polis evaluation protocol 1 performance r` for cold batches
and seed index 0 for the persistent-instance modes. Report p50/p90/p95/max wall time,
snapshots/second, actual cache capacity/entries, process peak RSS, and final heap use;
collect memory in a separate run if instrumentation perturbs timing. Report numeric
quantiles as sorted observation at index `ceil(p*N)-1`, with no interpolation.
Preserve each model's normal cache policy and disclose differences rather than claiming
that equal entry counts imply equal memory budgets. Run on the same machine, runtime
version and power mode, with no competing benchmark processes.

### Numerical integration, statistics, limits, and artifacts

- Use analytic Brownian interval integrals where implemented. Otherwise use deterministic
  adaptive quadrature with absolute probability error target **1e-10**, tightened to
  **1e-12** for the reference convergence check. Include all Gaussian mass outside displayed
  spatial bins in an explicit tail category. Require reported probabilities/moments to
  change by less than **1e-8** on tightening; otherwise mark the reference unconverged.
  For conditional ratios, check the final ratio, not just the unnormalized integral.
  Stop an infinite spatial moment sum only when remaining probability, absolute first
  moment and second moment bounds are each below 1e-10 in L-normalized units.
- For count-law TV use bins 0..K and one overflow bin, where K is the smallest integer
  with reference Poisson upper tail ≤ 1e-10. Use the same bins for every model in that
  case. Report `0.5*sum(abs(empirical-reference))`, including overflow. For zero mean,
  K = 0. No renormalization after dropping tails is allowed.
- Report **95% percentile intervals from 2,000 bootstrap replicates**. Resample whole
  realizations for A–D; resample whole candidates within each stratum for E, then recompute
  ratios and conditional summaries. Use seed `Polis evaluation protocol 1 bootstrap`
  with addresses `[batch, caseIndex, replicate, stratumOrMinusOne, drawIndex]` and index
  `floor(u*sampleCount)`. Use case order from the parameter table (leftmost axis outermost).
  Percentile endpoints use the same nearest-rank rule as F. Undefined bootstrap ratios
  are counted and the interval is unavailable if any replicate is undefined; retain the
  point estimate and denominator. Do not select significant individual strata without
  a multiple-comparison correction or held-out confirmation.
- Use a separate **2,000-replicate reference-only Monte Carlo TV calibration**, with the
  same trial count and histogram bins, sampled from the reference Poisson law using seed
  `Polis evaluation protocol 1 TV reference`. Report its median and 95th percentile next
  to empirical TV, rather than declaring all nonzero empirical TV to be model error.
  Draw each reference count using stdlib's Poisson inverse CDF and `uniformUnit`, with
  addresses `[batch, caseIndex, stratum, observableId, replicate, trialIndex]` under that
  seed. The observable ID is the JSON array of its type (`population` or `flow`), spatial
  offset, and temporal offset (all offsets in units L and T). This calibration addresses
  marginal histogram noise, not simultaneous phase selection.
- Cap each public non-tracker query at **2 seconds**, each complete trajectory at
  **10 seconds**, and each F batch at **30 seconds**, enforced by a supervising process
  since the model API is synchronous. Cap a case at **10 minutes and 2 GiB process RSS**;
  checkpoint after each trial. Run sessions last at most **2 hours** before pausing.
  Resume unfinished cases in deterministic order; never silently reduce trial counts.
  A case hitting its own cap is reported incomplete until explicitly authorized for a
  larger budget. Reference computation has the same case cap and must also disclose failure.
- Set public result ceilings to **65,536 records** for these measurements. A ceiling hit,
  unsupported exact geometry, numeric failure, timeout or other error is recorded with
  its input and not converted to zero or omitted. Unsupported/failed submeasurements do
  not prevent reporting supported populations from the same case. No statistical ranking
  is assigned to unmatched or incomplete cases.
- The **confirmation tier** repeats A–D with **4,096 realizations**, r = 512..4607,
  and E with **512 candidates per stratum**, r = 1024+512*s+c. F uses 500 batches and
  then includes p99. All other choices stay fixed. Run only explicitly selected cases,
  list the selection rationale before execution, and use a separate held-out location
  seed `Polis evaluation protocol 1 confirmation locations` for the eight random strata.
  Fixed strata remain fixed. No confirmation jobs start automatically.
- Save a manifest (protocol/model/reference commits, exact seeds and resolved locations,
  parameters, runtime/hardware, cache/result/budget settings), trial-level JSONL records,
  and summary CSV/JSON. Include exact requested/returned geometries, completeness/status,
  counts or waypoints needed to recompute statistics, timing/cost counters, per-stratum
  denominators and uncertainty. Existing CLI reports need adapters to emit this schema;
  they must not be described as implementing protocol v1 until they do.

For initial runner validation only, use a **smoke tier**: A with L = 4,1; mu = 4;
D = 1/2,2; q = 1/4; r = 0..31; and the first four fixed strata. That is four cases,
not a substitute for the standard scorecard. Label output `smoke` and omit bootstrap
and TV calibration. The full standard suite is a checkpointed campaign, not a quick
single-session benchmark; report progress as completed cases/trials out of the counts
above. Only confirmation jobs may increase the predeclared per-case statistical sample.

### Smoke runner implementation

`npm run evaluate:birds-smoke` implements the four-case smoke observation set, including
the first four strata, 32 independent seeds per case, reflected observations, complete
incidence queries, half-cell and union additivity, reverse-order replay and cache clearing.
It emits raw requested/returned observations and per-case marginal, flow, covariance and
mean-error summaries. Bootstrap and reference Monte Carlo are intentionally omitted.
The union query uses the public population-profile API and sums its cells; its additivity
check tests agreement with separately requested cells, not an independent aggregate owner.

Each trial runs in an isolated child process. The parent enforces the two-second query
timeout and case/session deadlines and appends completed or failed trial records. Failed
trials do not contribute fabricated zero observations. RSS is checked at query boundaries,
with a separate 1536 MiB V8 heap limit; this is **not** continuous enforcement of the
protocol's 2 GiB RSS ceiling during a blocked query. The manifest discloses that limitation.
Raw checkpoints survive interruption; this legacy command does not resume them.
The separate `npm run evaluate:birds` command supports resumable smoke and standard-A
collection; see the [runbook](BIRDS_EVALUATION_RUNBOOK.md). Standard-A inferential analysis,
batches B–F, and confirmation scheduling remain unimplemented. Do not treat this initial smoke
runner as a complete implementation of all protocol safeguards or the full scorecard.

## What is not a reusable score

V1's phase residues, F/G/H endpoint decomposition, even/odd bridge alignment, exact
support fan-in, classifier costs, cache-key costs, and chosen sampler internals explain
particular observations. Retain them as targeted regressions or investigations. They
must not define the entire successor test set. Likewise, fewer apparent meetings is
not inherently better Brownian motion; compare the observable joint law and tracking
behavior with the appropriate reference.

Sampler coupling is an optional separate contract, not evidence of marginal physical
fidelity. Where required, specify the complete-outcome likelihood-ratio inequality,
monotonicity in total count, and any stronger sampled-ratio condition separately. Do
not require cross-version seeded equality when the model's coupling changes.

This specification adds no statistical pass/fail thresholds to v1 and does not claim
that unmeasured rows pass. Existing CLI reports provide partial coverage; implementing
the missing cross-model adapters and measurements is a future evaluation task, explicitly
distinct from publication of this scorecard.
