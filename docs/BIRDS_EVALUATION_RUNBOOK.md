# Running and preserving the Birds evaluation

## Baseline

The runnable Birds evaluation baseline is commit
`abf95a5c4b95ab1c8d2edbd8cacb7c4e46f944f8`. It includes the current Birds model
and the resumable standard-A runner described below. No model changes accompanied
the runner. Preserve this revision when evaluating later model versions.

For a future run, check out the recorded runner revision in a separate worktree,
use `npm ci`, and retain the generated manifest and artifacts. The manifest records
the commit, working-tree status/diff, source fingerprint, Node version, CPU, and
limits. Prefer a clean checkout for published measurements. Untracked source content
is fingerprinted but not archived; a dirty manifest alone cannot reconstruct it.

## Implemented scope

`npm run evaluate:birds` collects protocol-v1 **standard A**: 120 cases,
16 strata, and 512 seeds per case (61,440 trials). Reverse-order and cache-clear
replays run for the first 32 seeds only. It also supports the four-case smoke tier.
Summaries include point estimates, raw TV, covariance, flow moments, and consistency
checks. A separate saved-data command adds bootstrap intervals and reference Monte
Carlo calibration (below). Batches B–F and confirmation-tier scheduling remain
unimplemented. This is not yet a runner for
the entire evaluation scorecard. The full campaign has not been run for this change.

## Commands

Inspect the schedule without executing queries or creating artifacts:

```sh
npm run evaluate:birds -- --plan
```

Start standard-A collection (up to two hours per invocation):

```sh
npm run evaluate:birds -- --output artifacts/birds-v1-standard-a
```

Resume the same campaign:

```sh
npm run evaluate:birds -- --resume artifacts/birds-v1-standard-a
```

For a small validation run:

```sh
npm run evaluate:birds -- --tier smoke --cases 0 --max-trials 1 --output artifacts/birds-runner-check
npm run evaluate:birds -- --resume artifacts/birds-runner-check --max-trials 1
```

`--cases` selects zero-based case indices from `--plan`. `--max-trials` caps new
attempts for this invocation; it does not lower the protocol's expected sample size.
`--session-minutes` can shorten the default 120-minute session. Resume takes the
saved case selection and refuses source/dependency/protocol or Node-version changes.

## Analyze saved data

From a revision containing the inference command, analyze a collection directory:

```sh
npm run analyze:birds-evaluation -- artifacts/birds-v1-standard-a --plan
npm run analyze:birds-evaluation -- artifacts/birds-v1-standard-a --cases 0
```

Omit `--cases` to process all cases selected in the collection manifest. This reads
the resumable runner's JSON checkpoints, never instantiates or queries Birds, and
leaves collection results unchanged. The earlier smoke-only JSONL format is not
accepted. The pinned collection baseline above predates this analysis command; use
the newer analysis code on its artifacts, without recollecting the model data.

Each case receives 2,000 whole-seed bootstrap replicates and 2,000 reference-only
Poisson TV replicates per count observable. Outputs include nearest-rank 95% intervals
for count statistics, flow displacement moments, covariances, and aggregate RMS bias
estimates, plus the median and 95th percentile of reference TV. Calibration uses
stdlib's exact Poisson inverse CDF, not Birds' bounded/approximate sampler. It uses the
available sample count for each marginal. All strata share each bootstrap's seed
selection, preserving their dependence. Reflected populations use their actual
L-normalized spatial offset in the calibration address; reflected flow checks share
the same displacement-law calibration. The aggregate flow-tail observable uses the
string `"tail"` in place of a numeric displacement offset.

Outputs retain denominators and the number of undefined replicates; if any replicate
is undefined, that metric's interval is unavailable. Missing/failed observations are
never imputed as zero. Inference uses completed trials and available observations,
so completion-dependent selection can still bias it. Missing strata make the full-grid
RMS unavailable rather than silently reducing the grid. Partial collections remain
partial; intervals are marginal, not a multiple-comparison correction.

Analysis saves each case atomically under `analysis-v1/` in the collection directory.
Re-running skips finished cases only when their data and analysis identity match.
Changed source, Node version, collection manifest, or trial data requires a new
`--output DIRECTORY`; interrupted cases restart, while completed cases are preserved.
Run one analysis writer per output directory. Analysis is offline CPU work without
the model collection budgets; full-size calibration may itself be expensive. Use
`--cases` to schedule manageable batches. Only synthetic validation, not the full
campaign analysis, was run when adding this command.

## Checkpoints and limits

Each attempted trial gets an atomically renamed `trial-CASE-TRIAL.json`, including
failures; failures are never replaced by zero-valued samples or silently retried.
`case-CASE.json` summaries report attempted and completed counts, failures, and whether
collection is paused, budget-exhausted, or all trials were attempted. Raw observations
remain in the trial files. A failed or partial campaign is not a complete scorecard.

Workers run serially. The supervisor enforces a two-second query timeout, ten-minute
cumulative collection budget per case, and session deadline. RSS checks occur at query
boundaries with a 1536 MiB V8 heap cap, not continuous 2 GiB RSS enforcement. Summary
computation is outside collection timing. Case budgets persist across resume; a case
that exhausts its budget is not restarted by another invocation.

Ctrl-C requests a stop after the current supervised trial is checkpointed. A hard
interruption leaves an active-trial journal: resume retries that uncommitted trial
but conservatively charges elapsed wall time (including downtime, capped at the case
budget). Completed checkpoints are untouched. Same-host stale process locks can be
recovered automatically; cross-host locks require manual inspection. Do not edit
checkpoints or run two writers against one directory.
