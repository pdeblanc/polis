# Running and preserving the Birds evaluation

## Baseline

The current Birds model baseline is commit
`0c7659b240bbcc4ff00e1787f0e8705f91fdc30f`. No model changes accompany the
resumable runner. This hash preserves the model and earlier smoke runner, **not**
the new runner described below. After committing these runner changes, record that
commit's `git rev-parse HEAD` as the runnable baseline; its hash cannot be known
before the commit exists. Preserve that revision when evaluating later model versions.

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
checks. Bootstrap intervals, reference Monte Carlo calibration, batches B–F, and
confirmation-tier scheduling remain unimplemented. This is not yet a runner for
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
