# Birds v1 acceptance audit

Audit of implementation revision `4dceca7f91da37a4439e6fee58c8365e505155f6` against
[proposal §§16–18](./BIRDS_DESIGN_PROPOSAL.md#16-verification). This is an evidence
review, not a new model specification or a statistical certification.
Verification also covers the tracker regression and rescaling fix described below.

## Conclusion

The **initial model milestone is supported by the implementation and tests**: the full
inward recurrence, bounded public API, spacetime visualization, incident-flow and tracked-path
overlays exist. The broader investigation deliverables are also present. The review items
are closed: R1 by a regression and fix, R2 by an explicitly approved deferral, and R3
by explicitly deferring dependency visualization.
The v1 prototype and investigation milestone is complete within these documented limits;
the broader reusable evaluation backlog remains separate.

Brownian fidelity is not a v1 acceptance threshold. The measured biases and incomplete
tracks remain documented outcomes, not failed conservation tests. Completing this
investigation is distinct from implementing and running the entire reusable evaluation
suite. No large campaign or fresh browser interaction session was run for this audit.

## Acceptance evidence

“Covered” means implemented with the cited finite evidence, not a proof over every
representable coordinate, parameter, or seed.

| Requirement | Assessment and evidence |
| --- | --- |
| A–H recurrence through several inward epochs | Covered. [Engine tests](../src/models/birds/birdsEngine.test.ts) exercise temporal aggregation, spatial subdivision, G1/G2 margins, H reconciliation, and multi-epoch queries through epoch 3. |
| Exact integer conservation and one stochastic owner per batch | Covered in the safe-integer domain. Engine tests check batch sums, both H margins, complete incidence, and owned-batch caching. [Owner classifiers](../src/models/birds/ownerClassifiers.test.ts) cover construction-independent capabilities and negative alignments. This is not an exhaustive address-collision proof. |
| Finite canonical support and coarse termination | Covered by [support closure/inversion tests](../src/models/birds/motionSupport.test.ts), [classifiers](../src/models/birds/classifiers.test.ts), and [decreasing dependency ranks](../src/models/birds/dependencyRanks.test.ts). Traces cover all eight query roles through epoch 3; sampled spatial ancestry covers deeper coarse-aligned cells. No uniform bound on all query work is claimed. |
| Samplers, coarse initialization, parameter semantics | Covered by [rounded-normal](../src/utils/distributions/roundedNormal.test.ts), [binomial](../src/utils/distributions/binomial.test.ts), [multinomial](../src/utils/distributions/multinomial.test.ts), [hypergeometric](../src/utils/distributions/hypergeometric.test.ts), [midpoint-kernel](../src/models/birds/midpointKernels.test.ts), and [coarse-initialization](../src/models/birds/coarseInitialization.test.ts) tests. These check clamp/rounding behavior, feasible counts, remainders, symmetry, and invalid parameters. Extreme finite parameters can still exceed numeric or practical resource limits. |
| Query-order and cache independence | Covered by engine order/clear/eviction tests and support-cache tests. Production uses bounded approximate-LRU caches; strict LRU was explicitly dropped during optimization. |
| Bounded, hierarchy-free synchronous API | Covered by [API tests](../src/models/birds/birds.test.ts): instance-scoped capabilities, exact flow endpoints, disclosed population snapping, refinement/coarsening, incidence consistency, cached-only reads, and explicit size limits. Output bounds are not wall-clock guarantees. |
| Spacetime viewer and debug controls | Implemented in [BirdsCanvas](../src/components/BirdsCanvas.tsx) and [BirdsPage](../src/pages/BirdsPage.tsx): future-up snapshots, parameters, coordinates, resolution, cache controls, FPS/query counters, incident flows, and tracked paths. There is no dependency overlay; see R3. No new browser acceptance run is claimed. |
| Budgeted singleton-tube tracker | Implemented in [Sighting](../src/helpers/birdsSighting.ts), with [tests](../src/helpers/birdsSighting.test.ts) for selection/rescaling, immutability, budgets, numeric limits, asymmetric narrowing, and forward/backward motion. The [multi-step trace regression](../src/helpers/birdsSightingTrace.test.ts) closes R1 below. |
| Poisson–Brownian characterization | Completed as an investigation, not exhaustive coverage. [Analysis](./BIRDS_ANALYSIS.md) records population and flow marginals, deep density-compensated cells, diffusion sensitivity, drift/displacement moments, trajectories, bridges, crossing/retention, and selection effects. Small and incomplete cohorts are disclosed. |
| Finite-population quotient-space reference tracker | Completed with limitations. [Reference comparison](./BIRDS_ANALYSIS.md#anonymous-adaptive-reference-tracker) and [tests](../src/benchmarks/brownianReferenceTracker.test.ts) record recurrence, budget/numeric failures, and hidden-label checks. It reproduces the anonymous tracking strategy; it is not literally the Birds helper behind one shared adapter, and cohorts do not establish equal failure rates. |
| End-to-end performance and complexity | Measurements exist: [complexity guardrails](../src/benchmarks/complexityMeasurements.test.ts), [engine/viewport profiles](../src/benchmarks/birdsEngineProfile.ts), and [tracker diagnostics](../src/benchmarks/birdsTracker.ts). The full breadth requested in §16.3 is not uniformly covered; see R2. |
| Deterministic population bounds | Completed. [Derivation](./BIRDS_ANALYSIS.md#deterministic-cell-population-bounds) and [tests](../src/benchmarks/birdsPopulationBounds.test.ts) give a finite-epoch bound and tighter shallow support-capacity estimates. Neither proves a useful scale-only materialization cutoff; finding one was not required. |
| Likelihood-ratio-monotone multinomial investigation | Completed for this cycle. [Experiment record](./BIRDS_ANALYSIS.md#multinomial-coupling-gamma-processes-and-poisson-races) distinguishes complete-outcome likelihood ratios from stronger sampled ratios and records numerical limitations and workload cost. Production adoption was explicitly deferred. |
| Starfield/Terrain classifier follow-up | Closed by explicit [no-refactor decisions](./BIRDS_IMPLEMENTATION_NOTES.md#starfieldterrain-structural-classifier-audit), with implementation/test evidence for each model. |
| High-level synthesis and reusable metrics | Published [summary](./BIRDS_ANALYSIS_SUMMARY.md) and [fully specified protocol](./BIRDS_EVALUATION.md). Standard-A collection and saved-data inference exist and have validation tests; the full campaign and batches B–F are not complete. Publication satisfies the synthesis/specification deliverable, not unmeasured statistical coverage. |

## Closed acceptance review items

### R1 — Tracker trace-level regression coverage

The implementation returns to its current singleton source when narrowing fails and
does not maintain a history to rewind across committed steps. It checks destination
population before committing a new internal singleton and coarsens only through
single-population parents. Public sighting cells can contain multiple birds: the
singleton guarantee belongs to the internal tube, not the requested display resolution.

**Closed by implementation and tests.** The multi-step trace regression runs the actual
Sighting helper against a controlled finite two-bird fixture in both time directions.
Labels are used to construct anonymous counts/flows and score the result, never exposed
to the helper. Four steps include two co-occupancies, unsuccessful asymmetric narrowing,
source/time refinement, successful endpoint isolation, and recovery to coarser/longer
steps. It checks singleton continuation sources, monotone committed-time progress,
unchanged earlier sightings, and identity after display coarsening and re-refinement.
This tests helper control flow, not Brownian fidelity or all Birds hierarchy cases.

The regression exposed an actual rescaling bug: requesting multiple finer levels from
a coarse singleton could repeatedly revisit its first cached child without extending
the tube or consuming a query budget. Rescaling now extends the deepest singleton.
The fixture bounds geometry reads so recurrence of this synchronous loop fails the test
rather than hanging its worker. No model stochastic semantics changed.

### R2 — Breadth of complexity/performance verification

The Birds automated complexity guardrail varies entry-flow epoch and diffusion, bounds
maximum recursion depth, and compares support cost. Other reports cover density, cache
state, viewport workloads, and tracker budgets, but there is no unified tested matrix
covering every query family, separation, output ceiling, and parameter axis named in
§16.3. Linear depth is not a bound on total recursive calls. Existing Node timings also
do not constitute standardized browser percentile or peak-memory measurements.

**Closed by explicit user-approved deferral.** Existing profiling and guardrails are
accepted for the v1 prototype. The broader resource matrix remains in the reusable
[evaluation protocol](./BIRDS_EVALUATION.md), especially batch F, rather than gating
this milestone. No additional performance guarantee or unmeasured result is inferred.

### R3 — Dependency visualization

The Birds viewer provides incident-flow and tracked-path overlays, but no dependency
overlay. The internal dependency observer supports tests, not a graphical inspector.

**Closed by explicit deferral.** The hierarchy is substantially more complex than the
Starfield/Terrain graphs. Its useful visual inspection scope is not yet defined, so
dependency visualization is deferred rather than required for the current milestone.
The proposal's visualization/acceptance criteria reflect this scope. Possible
query inspectors or work summaries remain design ideas, not new implementation tasks.

## Other agreed decisions and limits

- Keep the designed v1 math; do not tune it merely to improve these measurements.
- Keep sequential-binomial multinomials in production. Race-sampler adoption, stronger
  ratio coupling, and additional optimization remain optional future work.
- Defer materialization policy, stochastic coarse initialization, higher-dimensional
  motion, and other model-revision choices. The bound investigation does not pick a policy.
- Keep Starfield and Terrain's present structural organization for the documented reasons.
- Budget and numeric-resolution failures are valid tracker outcomes, not claims that
  a particular apparent collision is mathematically unresolvable.
- Defer the large evaluation run as requested. Preserve the runnable baseline and use
  the [runbook](./BIRDS_EVALUATION_RUNBOOK.md); no complete A–F scorecard is claimed.

The internal engine's diagnostic cache-capacity options are justified by eviction tests
and profiling. Public API names evolved into consumer-driven resolution and incidence
methods as permitted by §13. Sighting became an immutable helper with nested population
evidence rather than persistent bird identity. These are documented implementation
choices, not new model mathematics.

## Verification performed for this audit

Read the proposal, implementation/analysis records, production ownership/support/API and
tracker paths, viewer controls, and the cited tests and measurement entry points.
Ran the targeted command below after closing R1: **28 test files, 190 tests passed**.
Typecheck and lint also passed. The tests include small
reference and synthetic statistical checks, not the large evaluation campaign.

```sh
npm test -- src/models/birds src/helpers/birdsSighting.test.ts src/helpers/birdsSightingTrace.test.ts src/utils/distributions src/benchmarks/complexityMeasurements.test.ts src/benchmarks/brownianReferenceTracker.test.ts src/benchmarks/birdsPopulationBounds.test.ts src/benchmarks/evaluationInference.test.ts src/benchmarks/evaluationSmoke.test.ts src/benchmarks/evaluationCampaign.test.ts
```

Historical empirical results above were reviewed, not recollected. Local ignored
artifacts are not a bundled reproducibility dataset. R1–R3 are closed as documented
above; the full evaluation suite remains unfinished and unrun.
