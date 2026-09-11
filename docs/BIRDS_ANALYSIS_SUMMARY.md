# Birds v1: analysis summary

This summarizes the completed investigation cycle, not a new model specification or a
claim that every quality metric has been measured. The [analysis record](./BIRDS_ANALYSIS.md)
contains methods, sample sizes, results, and reproduction commands. The
[evaluation scorecard](./BIRDS_EVALUATION.md) defines what should carry forward to models
with different spacetime constructions.

## Main conclusions

**Consistency and Brownian fidelity are different questions.** The tested model conserves
integer populations, respects stochastic ownership, and reproduces results across query
order and cache changes. Those properties coexist with substantial discrepancies from
Poisson–Brownian motion. We found no reason to silently change v1's specified mathematics
to improve its statistical scores.

1. **Population totals look better than individual local marginals.** Deterministic
   coarse populations are strongly underdispersed. Fine-cell dispersion approaches the
   Poisson scale in the tested cases, but local mean differences remain. A paired
   epoch-8 block had mean about 4 per cell while individual cell means varied. Higher
   diffusion reduced the noise-corrected RMS variation: approximately 0.322–0.482 at
   D = 0.5 versus 0–0.152 at D = 4. These limited samples support compensating local
   effects, not a global surplus; a corrected estimate of zero does not prove zero bias.
   See [population marginals](./BIRDS_ANALYSIS.md#population-marginals).
2. **Spatial mixing is a material source of excess motion.** Short-duration flow moments
   were close to the binned Brownian reference. The longer incidence associated with
   spatial refinement had about one extra squared cell width of displacement, with
   relative excess ranging from 145% at D = 0.5 to 24% at D = 4. The spatial-refinement
   decomposition accounts for this through endpoint mixing and amplified quantization.
   At D = 0, refined same-parent flows still crossed between children about half the
   time, versus zero for stationary Brownian paths. This is a consequence of the specified
   exchangeability approximation, not evidence of a faulty discrete sampler.
   See [flow moments](./BIRDS_ANALYSIS.md#displacement-second-moments) and
   [crossing](./BIRDS_ANALYSIS.md#child-crossing-and-retention).
3. **Endpoint-center bridges lose information.** The configured midpoint kernels follow
   their intended probabilities, but differ from a Brownian bridge integrated over full
   endpoint cells. The largest tabulated configured-to-reference TV discrepancy was
   about 0.089 for a low-diffusion, centered case. This is a model approximation, distinct
   from sampling error. See [bridges](./BIRDS_ANALYSIS.md#temporal-bridges).
4. **Repeated meetings do not diagnose a tracking bug.** The labeled Brownian ring
   reference also exhibits join–split–rejoin behavior. Its anonymous adaptive tracker
   can exhaust refinement budgets or binary64 precision; increasing budgets sometimes
   changes the failure label rather than completing a path. No completed reference
   track switched hidden labels. This reproduces a qualitative failure mechanism, not
   a proof that Birds and the reference have equal failure rates. The cohorts differ.
   See [reference tracking](./BIRDS_ANALYSIS.md#anonymous-adaptive-reference-tracker).
5. **Trajectory selection substantially changes the measured law.** Balancing starting
   phases removed the conspicuous pooled drift of the initial Birds cohort. Screening
   for no co-occupancy induces negative increment correlation and suppresses long-horizon
   motion even in Brownian reference paths. Birds/reference differences remain suggestive,
   but the Birds cohorts were small; the high-diffusion balanced run was incomplete.
   Successful or collision-free tracks must not stand in for unconditional trajectories.
   See [trajectory characterization](./BIRDS_ANALYSIS.md#trajectory-characterization).
6. **Finite population bounds exist, but do not settle materialization.** The derived
   bound `N0 * C(D)^e` is valid at finite epochs under the stated construction, but is
   very loose. Counting distinct ancestral coarse-flow capacity gives tighter shallow
   results, at substantial analysis cost. Neither establishes a practically small
   population ceiling beyond some refinement scale. Choosing a materialization strategy
   belongs to the next model revision. See [bounds](./BIRDS_ANALYSIS.md#deterministic-cell-population-bounds).
7. **A likelihood-ratio-monotone sampler is available as an experiment, not a deployment
   decision.** The shared unit-rate Poisson race supplies the complete-outcome
   likelihood-ratio coupling and monotonic counts as total population increases. These
   are distinct from the stronger sampled-ratio property, which remains unresolved.
   After optimization, captured-workload sampling remained about 3–4× slower than
   sequential binomials at default density and about 6× at higher density. Estimated
   whole-model impacts use a frozen query workload, not an actual replacement run.
   Adoption is deferred; production Birds is unchanged. Numerical limits and the
   prototype's untruncated scalar distributions also matter to a future adoption review.
   See [coupling](./BIRDS_ANALYSIS.md#multinomial-coupling-gamma-processes-and-poisson-races).

## What should carry forward

Keep exact consistency checks, reference-based distribution measurements, sensitivity
to observation location and scale, trajectory completion accounting, and matched-workload
resource measurements. These describe observable behavior independently of implementation.

Keep the F/G/H recurrence, phase-residue breakdowns, parity-specific bridge tables,
classifier profiles, and sampler microbenchmarks as **investigative explanations**. They
are useful evidence about v1, but a successor must not receive a better score simply
because it has no F/G/H stages or different pathological alignments. The scorecard fixes
external sampling rules and retains discovery samples for unfamiliar failures.

## Status and decisions

- The statistical, reference-tracker, population-bound, and sampler investigations have
  produced documented results. Remaining research ideas are not implicit prerequisites
  to publishing this synthesis.
- The [Starfield/Terrain classifier audit](./BIRDS_IMPLEMENTATION_NOTES.md#starfieldterrain-structural-classifier-audit)
  is closed with explicit no-refactor decisions.
- Sampler adoption, stronger sampled-ratio coupling, materialization, higher-dimensional
  motion, and changes to spatial-refinement coupling remain deferred decisions or research.
- The accompanying scorecard is a reusable **evaluation specification**, with existing
  evidence and unmeasured items labeled. Its measurement protocol specifies parameter
  grids, scales, trials, observation sets, budgets, and smoke/standard/confirmation tiers.
  Standard-A collection and saved-data bootstrap/TV calibration are implemented;
  the full campaign has not been run. A complete automated cross-model runner has not
  been built. No combined quality score or new statistical acceptance thresholds are imposed.
- The [acceptance audit](./BIRDS_ACCEPTANCE_AUDIT.md) closes the v1 prototype and
  investigation milestone: the tracker regression is implemented and the broader
  performance matrix explicitly deferred. This does not certify unmeasured evaluation cases.
  The proposed dependency overlay is not implemented and is explicitly deferred
  pending a useful visualization design.
