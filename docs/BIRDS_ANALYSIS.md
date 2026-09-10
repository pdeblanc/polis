# Birds analysis record

> **Status: Active investigation record.**
>
> This document records empirical and mathematical analysis of the implemented Birds
> model. [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md) remains the canonical
> specification, while [`BIRDS_IMPLEMENTATION_NOTES.md`](./BIRDS_IMPLEMENTATION_NOTES.md)
> records implementation choices and limitations. Results here characterize the model;
> they do not silently change its requirements or gate version 1 unless explicitly stated.

## Method

Statistical experiments use independent model seeds as trials. Where several cells are
compared, paired experiments query every cell from the same seeded model so that aggregate
and phase differences are not obscured by different random samples.

The Poisson–Brownian reference marginal for a spatial cell `A` is:

```text
N(A) ~ Poisson(populationDensity * width(A))
```

Reported total variation distances are empirical distances from this reference. They
include finite-sample error and should not be interpreted as population-level distances
without an uncertainty analysis. No statistical result in this record is currently a
pass/fail test.

## Population marginals

### Initial scale study

The first experiment sampled one cell at each of several scales across 1,000 independent
seeds with population density `0.5` and diffusion rate `0.5`.

| Case | Reference mean | Empirical mean | Variance / mean | Zero frequency | Poisson zero probability | Empirical TV distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Coarse initial | 8 | 8.000 | 0.000 | 0 | 0.00034 | 0.860 |
| Coarse moved | 8 | 8.019 | 0.302 | 0 | 0.00034 | 0.296 |
| Epoch 1 | 4 | 4.048 | 0.543 | 0.003 | 0.0183 | 0.151 |
| Epoch 2 | 2 | 2.136 | 0.764 | 0.081 | 0.1353 | 0.086 |

The deterministic coarse population is maximally underdispersed. Motion and refinement
progressively increase dispersion and reduce empirical distance from the Poisson
reference. The epoch-2 mean excess was about `3.4` empirical standard errors, motivating
a study of spatial and temporal hierarchy phases rather than an immediate conclusion of
global population bias.

### Density-compensated deep cells

To keep cell counts informative at small scales, a second experiment increased density
with epoch so that every sampled cell retained reference mean `4`. Each case used 200
independent seeds, diffusion rate `0.5`, spatial index `1`, and temporal index `1`.

| Epoch | Density | Cell width | Empirical mean | Variance / mean | Zero frequency | Empirical TV distance |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 4 | 1 | 4.345 | 0.950 | 0.020 | 0.127 |
| 6 | 16 | 0.25 | 4.670 | 1.053 | 0.010 | 0.130 |
| 8 | 64 | 0.0625 | 4.495 | 1.017 | 0.020 | 0.136 |

At these deeper scales, variance and zero frequency are close to their Poisson reference
values, while this particular spatial and temporal phase has a positive mean difference.
Because the model conserves population, the natural hypothesis is compensating negative
bias in other hierarchy phases.

### Paired spatial-phase block

The phase experiment sampled all 256 epoch-8 cells covering `[0, 16)`, exactly one coarse
cell width. Population density was `64`, diffusion rate was `0.5`, and 50 paired seeds
were used at four consecutive fine temporal indices. The reference mean was `4` per fine
cell and `1,024` for the complete block.

| Temporal index | Mean per cell | Aggregate block mean | Aggregate error | Minimum observed cell mean | Maximum observed cell mean |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4.00055 | 1024.14 | +0.14 | 2.84 | 5.04 |
| 2 | 4.00109 | 1024.28 | +0.28 | 2.66 | 5.44 |
| 3 | 4.00078 | 1024.20 | +0.20 | 2.78 | 5.18 |
| 4 | 4.00031 | 1024.08 | +0.08 | 3.02 | 5.16 |

The block averages are extremely close to the reference at every tested time. This is
strong evidence against a global population surplus over the sampled region and supports
looking for hierarchy-phase effects. The reported minimum and maximum are selected from
256 cells with only 50 trials each, so their spread includes substantial multiple-comparison
and sampling noise. This run alone does not establish the expectation of any individual
phase or prove lack of translation invariance.

### Diffusion-rate comparison

The complete epoch-8 phase-block experiment was repeated at diffusion rates `1`, `2`,
and `4`, again with density `64`, 50 paired seeds, and temporal indices 1 through 4. The
table summarizes the envelope across all four temporal rows. The `D = 0.5` row is the
preceding experiment.

| Diffusion rate | Range of block mean per cell | Observed RMS error | Noise-corrected RMS bias | Lowest cell mean | Highest cell mean | Largest absolute block-total error |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 4.00031–4.00109 | 0.429–0.558 | 0.322–0.482 | 2.66 | 5.44 | 0.28 |
| 1 | 3.99945–4.00094 | 0.395–0.478 | 0.276–0.386 | 2.80 | 5.34 | 0.24 |
| 2 | 3.99961–4.00125 | 0.343–0.383 | 0.193–0.258 | 3.10 | 5.02 | 0.32 |
| 4 | 4.00000–4.00203 | 0.282–0.324 | 0.000–0.152 | 3.16 | 4.90 | 0.52 |

All aggregate errors are negligible relative to the reference block population of
`1,024`. The observed cell-mean envelope narrows as diffusion increases: its width falls
from `2.78` at `D = 0.5` to `1.74` at `D = 4`. More importantly, both raw and
noise-corrected RMS errors decrease monotonically over the tested diffusion rates. This
supports the hypothesis that stronger motion reduces spatial hierarchy-phase differences.
Each extrema envelope still selects from 256 noisy cell means, and wider diffusion may
change correlations between estimates, but the RMS comparison does not depend on selecting
only the most extreme cells.

The phase report now includes both the observed RMS cell-mean error and a
noise-corrected RMS bias estimate. For cell `i`, it estimates the sampling contribution
as `sampleVariance_i / sampleCount`, averages that contribution across phases, subtracts
it from the mean squared cell-mean error, clamps the result at zero, and takes the square
root. This removes ordinary within-cell Monte Carlo variance in expectation; it does not
provide a confidence interval or correct selection effects in reported extrema.
At `D = 4`, two temporal phases have corrected estimates near zero. A clamped zero means
that sampling variance explains all observed spatial mean-square variation at this sample
size; it is not evidence that the underlying phase bias is exactly zero.

The higher-diffusion phase runs were materially more expensive because motion-support
width increases with diffusion. Future multi-rate reports should emit each completed
rate progressively or run rates separately.

### Current interpretation and follow-ups

- Fixed coarse totals explain the strong initial underdispersion.
- Fine-cell dispersion becomes approximately Poisson-sized in the tested deep cases.
- The complete epoch-8 spatial block has the correct aggregate mean to high accuracy.
- The observed spread among cell means decreases with diffusion rate while the aggregate
  remains centered, consistent with stronger diffusion smoothing hierarchy-phase effects.
- An isolated phase has repeatedly shown a positive mean difference, but more paired
  trials are needed to separate a persistent phase bias from selection and sampling noise.
- Repeat phase measurements with enough trials to estimate each phase's uncertainty, and
  group cells by structural spatial and temporal residue rather than inspecting extrema.
- Repeat at negative coordinates, shifted coarse blocks, other diffusion rates, and other
  temporal windows.

## Reproduction

Run the ordinary marginal report with an optional trial count:

```sh
npm run characterize:birds-populations -- 1000
```

Deep density-compensated cells are opt-in:

```sh
npm run characterize:birds-populations -- 200 \
  epoch-4-density-compensated \
  epoch-6-density-compensated \
  epoch-8-density-compensated
```

Run the paired complete-spatial-phase report with an epoch and trial count:

```sh
npm run characterize:birds-population-phases -- 8 50
```

Append one or more diffusion rates to compare them over the same phase grid:

```sh
npm run characterize:birds-population-phases -- 8 50 1 2 4
```

## Flow marginals

### Brownian reference

For source interval `A`, destination interval `B`, duration `T`, and diffusion rate `D`,
the reference probability is evaluated analytically as:

```text
(1 / width(A)) integral_A P(x + Normal(0, D T) is in B) dx
```

The implementation integrates the normal CDF over the complete source and destination
intervals. When `D T = 0`, it uses the exact overlap fraction `width(A intersect B) /
width(A)`. Tests cover reflection symmetry, zero-variance overlap, and probability
conservation over a wide destination partition.

### Initial equal-resolution study

The initial flow experiment used epoch 4, density `4`, cell width `1`, duration `0.25`,
source spatial index `1`, source temporal index `1`, and 200 independent seeds. The source
cell therefore had reference mean `4`. Five destination offsets were sampled, while the
complete public outflow list was independently summed on every trial.

| Diffusion rate | Source mean | Reference neighbor mean | Left mean | Right mean | Right-minus-left | Reference center mean | Center mean |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 4.355 | 0.562 | 0.465 | 0.800 | 0.335 | 2.874 | 3.075 |
| 1 | 4.315 | 0.764 | 0.675 | 0.960 | 0.285 | 2.438 | 2.610 |
| 2 | 4.050 | 0.929 | 0.750 | 1.100 | 0.350 | 1.944 | 1.935 |
| 4 | 4.020 | 0.963 | 0.920 | 1.010 | 0.090 | 1.475 | 1.490 |

Every one of the 800 trials had exact equality between the queried source population and
the sum of its complete nonzero outflow list. The first three rates show a substantial
rightward imbalance even though the Brownian reference is reflection symmetric. At
`D = 2`, the source and center means are nearly centered while the neighboring flows
remain asymmetric, separating directional motion bias from aggregate population bias.
At `D = 4`, the measured center and both neighbors are close to their references and the
left/right difference is small relative to the earlier cases.

Most non-tail flow variance-to-mean ratios were near one. Empirical total variation was
generally modest, but was largest for the positively biased right neighbor at low
diffusion (`0.155` at `D = 0.5`). Rare far-tail estimates have high relative uncertainty
at 200 trials and should not be overinterpreted.

These results support the same qualitative conclusion as the population-phase study:
stronger diffusion reduces visible hierarchy-phase artifacts. They also identify a
specifically directional effect that population counts alone cannot reveal. Follow-up
work should repeat paired left/right measurements across source spatial phases, temporal
residues, reflected coordinates, and deeper epochs to determine which structural phase
owns the asymmetry and whether opposite phases compensate globally.

Run the density-compensated flow marginal report with epoch, trial count, and diffusion
rates:

```sh
npm run characterize:birds-flows -- 4 200 0.5 1 2 4
```

### Paired source-phase drift

A follow-up experiment sampled every epoch-4 source cell spanning `[0, 16)` with 50
paired seeds. For each source it queried the complete nonzero outflow list and measured
the population-weighted displacement between source and destination cell centers. Drift
is reported in cell widths per bird; the Brownian reference drift is zero. Temporal
indices 1 through 3 use duration `0.25` (`duration / width² = 0.25`), while index 4 is a
spatial-child cell whose canonical incidence uses duration `1`.

| Diffusion rate | Short-duration aggregate drift range | Short-duration RMS phase drift | Long-duration aggregate drift | Long-duration RMS phase drift | Long-duration reflection-pair residual |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | −0.0059–0.0069 | 0.074–0.111 | −0.0276 | 0.560 | 0.137 |
| 1 | −0.0075–0.0082 | 0.063–0.096 | −0.0228 | 0.540 | 0.157 |
| 2 | −0.0216–0.0147 | 0.053–0.075 | −0.0149 | 0.514 | 0.191 |
| 4 | −0.0205–0.0084 | 0.063–0.074 | −0.0270 | 0.574 | 0.117 |

All 12,800 source/outflow comparisons conserved population exactly. Aggregate block drift
never exceeded `0.028` cell widths per bird in magnitude, even when individual
long-duration source phases ranged roughly from `−0.92` to `+0.78`. The long-duration
reflection-pair residual is much smaller than its phase RMS, consistent with an
approximately antisymmetric pattern of compensating leftward and rightward phases.

The short-duration phase RMS generally decreases through `D = 2`, although this initial
50-seed report does not remove sampling variance from drift estimates. The long-duration
phase RMS remains near `0.5–0.57` at every diffusion rate and is not monotonically
improved by stronger diffusion. This distinguishes two effects: diffusion smooths the
finest temporally introduced flows, while the larger artifact follows the longer
canonical incidence owned by spatial-child cells. The result argues for grouping later
motion analysis by construction case and normalized duration rather than by diffusion
rate alone.

Run the complete source-phase report with epoch, trial count, and diffusion rates:

```sh
npm run characterize:birds-flow-phases -- 4 50 0.5 1 2 4
```

### Displacement second moments

The same complete-outflow samples were extended to measure squared cell-center
displacement. The reference is not the raw continuous Brownian variance: it integrates
the Brownian transition probability into every canonical destination cell and assigns
that probability the destination center's displacement. The symmetric infinite sum is
evaluated until its omitted probability is below `1e-14`. Tests cover convergence,
zero-diffusion behavior, and parabolic scale covariance.

| Diffusion rate | Short-duration reference | Short-duration empirical range | Long-duration reference | Long-duration empirical | Long-duration excess | Relative excess |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 0.2831 | 0.2781–0.2835 | 0.6667 | 1.6365 | +0.9698 | 145% |
| 1 | 0.4159 | 0.4195–0.4292 | 1.1667 | 2.1866 | +1.0199 | 87% |
| 2 | 0.6667 | 0.6714–0.6735 | 2.1667 | 3.2136 | +1.0469 | 48% |
| 4 | 1.1667 | 1.1601–1.1799 | 4.1667 | 5.1859 | +1.0192 | 24% |

The three short-duration temporal residues agree with the binned Brownian second moment
to within about `3.2%`, and usually within roughly `1%`. The long-duration spatial-child
row has an absolute excess close to one squared cell width at every diffusion rate. Its
relative error decreases only because the Brownian component grows with diffusion.

Total empirical variance was decomposed by source phase:

```text
total variance = population-weighted within-phase variance
               + population-weighted variance of phase drifts
```

The between-phase drift contribution to the long-duration variance was `0.309`, `0.288`,
`0.266`, and `0.328` for diffusion rates `0.5`, `1`, `2`, and `4`. Thus compensating phase
drifts explain a substantial minority of the roughly one-unit excess, while most of it
remains as excess motion within individual phases.

The nearly diffusion-independent absolute error suggests an additional scale-normalized
variance contribution in the spatial-child flow construction rather than a simple error
in the diffusion multiplier. The following recurrence analysis locates that contribution.

### Spatial-refinement recurrence

Let a Stage-D parent flow join cells of width `2L`, and let `h` be its center displacement
measured in those parent-cell widths. Stage H produces flows between width-`L` children.
For source and destination child indices `i,j` in `{0,1}`, the child flow's displacement
in child-cell widths is:

```text
Z = 2 h + (j - i)
```

Stage F gives each endpoint a uniform half-cell membership in expectation. G1 and G2
assign those memberships across incidence margins, and H uses a uniform matching
conditional on the margins. Under the resulting exchangeability approximation:

```text
E[(j - i)^2] = 1/2
E[h (j - i)] = 0
```

Therefore, if `M_1/4` is the parent Stage-D cell-center second moment in parent-width
units, the idealized spatial-refinement recurrence predicts:

```text
M_H = 4 M_1/4 + 1/2
```

Using the binned Brownian parent moment gives:

| Diffusion rate | Direct duration-1 Brownian | F/G/H prediction | Empirical H moment | Empirical minus prediction |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 0.6667 | 1.6323 | 1.6365 | +0.0042 |
| 1 | 1.1667 | 2.1638 | 2.1866 | +0.0228 |
| 2 | 2.1667 | 3.1666 | 3.2136 | +0.0469 |
| 4 | 4.1667 | 5.1667 | 5.1859 | +0.0192 |

The child-flow samples were also decomposed directly, without using the Brownian
reference:

```text
E[Z^2] = 4 E[h^2] + E[(j-i)^2] + 4 E[h(j-i)]
```

| Diffusion rate | Parent contribution | Endpoint contribution | Cross contribution | Sum |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 1.1131 | 0.4983 | +0.0251 | 1.6365 |
| 1 | 1.6975 | 0.5016 | −0.0125 | 2.1866 |
| 2 | 2.7360 | 0.5000 | −0.0224 | 3.2136 |
| 4 | 4.6354 | 0.4908 | +0.0597 | 5.1859 |

The endpoint term is approximately `1/2` and the cross term is small at every tested
rate. The recurrence prediction accounts for the empirical moment to within `0.047`.
The remaining differences are consistent with finite-sample variation and the sampled
parent flow differing slightly from its own Brownian reference.

For sufficiently broad rounded kernels, a binned Brownian transition has approximately
`M_q = Dq + 1/6`. The recurrence then gives `4 M_1/4 + 1/2 ≈ D + 7/6`, while a direct
duration-1 transition gives `D + 1/6`: exactly one squared cell width less. Half of that
difference is the explicit independent endpoint-half variance; the other half comes from
amplifying the parent transition's cell-center quantization by spatial rescaling.

This is therefore a consequence of the specified F/G/H exchangeability approximation,
not evidence of sampler failure, address reuse, or broken conservation. The design
already permits additional variance from within-cell mixing. A future model revision
could reduce it only by changing the spatial-refinement coupling—for example, by making
source and destination child memberships conditionally dependent on the parent flow—so
that would be a semantic model change rather than a version-1 bug fix.

## Trajectory characterization

### Cohorts and collision-free screening

Trajectory analysis keeps two populations conceptually separate. An unconditional
candidate stream records empty starts, completions, budget failures, numeric limits, and
other errors without discarding inconvenient outcomes. A conditional cohort retains the
first `N` qualifying paths from that deterministic stream.

A retained path must start in a singleton requested cell, encounter no asymmetric
narrowing attempt, and return a singleton at every requested waypoint. Spatial refinement
is allowed because some hierarchy phases require it solely to reach the requested temporal
step; every detected multi-bird endpoint increments asymmetric narrowing before any
collision-driven source refinement. The report includes the retained candidate indices,
so the same screened population can be reproduced and inspected directly.

This filter conditions the trajectory distribution. Its moments are not unconditional
Birds marginals, and comparison with an ordinary Brownian reference is descriptive only.
The later labeled finite-population Brownian experiment must apply an equivalent
no-co-occupancy filter at the same observation resolution.

### Initial sparse trajectories

The first scan used epoch 2, density `1/16`, eight requested steps, a fixed source phase,
200 deterministic candidates per diffusion rate, and a ceiling of 25 retained paths.

| Diffusion rate | Empty starts | Completed paths | Refinement-budget failures | Numeric failures | Retained paths |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 142 | 52 | 0 | 6 | 25 |
| 1 | 138 | 52 | 1 | 9 | 25 |
| 2 | 148 | 45 | 2 | 5 | 25 |
| 4 | 139 | 55 | 1 | 5 | 25 |

There were no query-budget or unclassified errors. The original 200-candidate run capped
retention at 25 before separately reporting eligible overflow, so the table states only
the retained count, not the total number of qualifying completed paths. The corrected
report now distinguishes collision rejection from retention overflow.

| Diffusion rate | Mean increment | Increment variance | Brownian one-step second moment | Lag-one covariance | Eight-step mean | Eight-step second moment | Brownian eight-step reference |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 0.140 | 0.280 | 0.283 | −0.020 | 1.12 | 2.72 | 2.26 |
| 1 | 0.165 | 0.368 | 0.416 | −0.005 | 1.32 | 4.28 | 3.33 |
| 2 | 0.215 | 0.699 | 0.667 | −0.055 | 1.72 | 7.72 | 5.33 |
| 4 | 0.005 | 1.255 | 1.167 | −0.114 | 0.04 | 11.32 | 9.33 |

Each retained rate contributes 200 one-step increments but only 25 nonoverlapping
eight-step displacements; increments within a path are not independent observations.
The fixed starting phase and collision-free survival filter are serious confounders. The
positive drift at the first three rates may reflect source hierarchy phase, conditioning,
or both. Lag-one covariance is nonpositive, so positive adjacent-increment correlation
does not explain the elevated long-horizon second moments. The `D = 4` cohort has almost
zero mean yet still has an elevated eight-step moment, indicating that drift alone also
does not explain the discrepancy.

### Phase-balanced sparse trajectories

The follow-up experiment assigns the same retention quota to every starting hierarchy
phase. At epoch 2 this is the Cartesian product of four spatial phases and four temporal
phases. Each phase has its own deterministic candidate stream and stops as soon as its
quota is filled. This avoids weighting easy-to-find phases more heavily merely because
their candidates survive the collision-free screen more often.

With a quota of two paths per phase, density `1/16`, and eight requested steps, all 16
phases filled for diffusion rates `0.5`, `1`, and `2`:

| Diffusion rate | Candidates attempted | Retained paths | Phase mean range | RMS phase mean | Pooled mean increment | Increment variance | Brownian one-step second moment | Lag-one covariance | Eight-step mean | Eight-step second moment | Brownian eight-step reference |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 182 | 32 | [−0.250, 0.188] | 0.134 | −0.070 | 0.214 | 0.283 | +0.013 | −0.563 | 2.125 | 2.265 |
| 1 | 191 | 32 | [−0.313, 0.250] | 0.133 | −0.023 | 0.390 | 0.416 | −0.001 | −0.188 | 2.375 | 3.328 |
| 2 | 226 | 32 | [−0.438, 0.313] | 0.231 | −0.051 | 0.665 | 0.667 | +0.020 | −0.406 | 5.719 | 5.333 |

Balancing removes the conspicuous positive pooled drift in the original fixed-phase
cohorts. At `D = 2`, the one-step variance nearly equals the Brownian reference; at the
lower rates it is smaller, plausibly in part because collision-free survival is a
conditioning event. The eight-step estimates contain only 32 displacements each and are
correspondingly noisy. Per-phase means remain substantial and change sign, reinforcing
the earlier finding that hierarchy phases carry compensating directional biases.

The equivalent `D = 4` run was stopped after it spent substantially longer screening a
phase without completing the report. Strict collision-free retention becomes expensive
at high diffusion, so an incomplete phase grid must be reported as incomplete rather
than pooled as though it were balanced. This runtime is also evidence about the selection
mechanism, not a reason to weaken its definition.

### Labeled Brownian quotient-space reference

The reference experiment samples a stationary finite Poisson population on a ring 256
observation cells in circumference. Every bird has a persistent label, an independent
uniform initial position, and independent Gaussian increments with variance `D dt`.
Population totals and increments use the library quantiles directly rather than the
model's bounded-distribution wrappers. Positions are observed through the same cell width
and time step as the epoch-2 Birds cohort. Ring cells determine occupancy, while the
selected label's lifted cell centers determine displacement.

Labels are used only as ground truth. The retained cohort applies the same requested-
resolution condition as the Birds cohort: the selected bird must be alone initially and
at all eight waypoints. This first measurement is a finite-observation comparison; the
following experiment adds the anonymous adaptive tracking procedure.

With 20 retained paths in each of the 16 nominal phase buckets, the reference results
were:

| Diffusion rate | Candidates attempted | Collision-rejected paths | Collision then separation | Join–split–rejoin | Mean increment | Increment variance | Lag-one covariance | Eight-step second moment | Unconditioned Brownian eight-step moment |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 2,298 | 240 | 203 | 123 | +0.0066 | 0.2582 | −0.0679 | 1.0406 | 2.2646 |
| 1 | 2,723 | 339 | 295 | 177 | +0.0141 | 0.3857 | −0.0743 | 1.7750 | 3.3275 |
| 2 | 3,350 | 477 | 416 | 252 | +0.0156 | 0.6646 | −0.0855 | 3.6750 | 5.3333 |
| 4 | 3,960 | 603 | 546 | 328 | +0.0188 | 1.1715 | −0.1179 | 7.6438 | 9.3333 |

The rejected-path denominator excludes empty starts: it is the collision-rejected paths
plus the 320 retained collision-free paths. On that basis, rejection rises from about
`43%` at `D = 0.5` to `65%` at `D = 4`. Among rejected paths, `85–91%` later separate and
about `51–54%` exhibit a join–split–rejoin subsequence at the requested waypoints. Thus
repeated meetings are ordinary in the labeled one-dimensional Brownian reference and are
not, by themselves, evidence of address reuse or a discrete-sampler defect.

Conditioning on no co-occupancy is not innocuous. It introduces substantial negative
adjacent-increment covariance and suppresses long-horizon displacement. Comparing the
32-path balanced Birds cohorts with this larger reference, Birds has much weaker
negative covariance (`+0.013`, `−0.001`, and `+0.020` versus `−0.068`, `−0.074`, and
`−0.086` for `D = 0.5`, `1`, and `2`) and larger eight-step moments (`2.125` versus
`1.041`, `2.375` versus `1.775`, and `5.719` versus `3.675`). The Birds estimates have
only 32 eight-step displacements, so these differences motivate a larger matched cohort;
they do not yet establish a hierarchy-induced trajectory discrepancy.

### Anonymous adaptive reference tracker

The tracking reference exposes dyadic population counts and source-to-destination flow
counts while keeping labels private. Initial selection uses the same addressed rank and
ordered child-count descent as `Sighting`; the hidden label becomes known to the
experiment only after the selected cell is a singleton. Movement follows the same policy
shape as the Birds helper: query a singleton flow, accept a singleton endpoint, otherwise
try one asymmetric destination refinement, and refine the singleton source and shorten
time only as a fallback. Query and spatial-refinement budgets reset for each requested
step just as they do for `Sighting`.

Adaptive temporal queries are consistent by construction. Integer observation-time
positions use independent Brownian increments. A newly requested dyadic midpoint uses a
Brownian bridge conditional on its already fixed endpoints, with an addressed noise
sample owned by that interval. Cached or differently ordered queries therefore reveal
the same labeled paths. The tracker itself never receives labels; after each completed
step the experiment verifies its singleton against hidden ground truth.

The standard run uses the epoch-2 dimensions (`cell width = 4`, `time step = 4`), density
`1/16`, a 256-cell ring, eight steps, and 500 candidates. Exactly 114 candidates have a
nonempty starting cell at every diffusion rate because diffusion does not affect the
stationary initial sample.

| Diffusion rate | Complete, budget 32 | Refinement failures | Numeric failures | Complete, budget 64 | Refinement failures | Numeric failures | Join–split–rejoin paths | Completed recurrent paths at 32 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 91 | 22 | 1 | 91 | 13 | 10 | 21 | 9 |
| 1 | 96 | 18 | 0 | 103 | 8 | 3 | 33 | 22 |
| 2 | 110 | 4 | 0 | 114 | 0 | 0 | 41 | 38 |
| 4 | 109 | 5 | 0 | 114 | 0 | 0 | 43 | 40 |

There were no query-budget or unclassified errors and no completed path ever switched
hidden labels. At budget 32 the hardest `D = 0.5` case reached a time step of about
`3.55e-15`; at budget 64 it reached `1.39e-17`. Increasing the budget converts many
low-diffusion refinement failures into explicit binary64 resolution failures rather than
completions. At `D = 2` and `4`, in contrast, all nonempty candidates complete with the
larger budget. Slow diffusion can keep paths close enough that adaptive source refinement
converges toward a meeting, whereas stronger diffusion more readily separates them.

This reproduces the qualitative Birds failure mechanism in an independent labeled
Brownian population: an omniscient observer knows which path continues, but anonymous
finite-resolution counts and flows may approach the numeric limit without establishing
a singleton correspondence. The occurrence of such failures is therefore not evidence
that the Birds tracker itself is defective. Rates are not an exact model-to-reference
comparison: the existing 200-candidate Birds cohorts use different random populations
and a fixed hierarchy phase. Their nonempty completion rates were about `90%`, `84%`,
`87%`, and `90%` at `D = 0.5`, `1`, `2`, and `4`, compared with `80%`, `84%`, `96%`, and
`96%` for the reference at budget 32. Those differences merit larger matched sampling
only if tracker failure rates become a version-1 quality target.

### Temporal bridges

Temporal bridge counts are internal hierarchy facts, so this measurement queries
`BirdsEngine` rather than the hierarchy-free public API. For equal-width parent flows it
aggregates the owned midpoint multinomials across 100 seeds at epoch 2 and density `16`.
The external reference integrates over a uniform position in the complete source cell,
the first Brownian half-increment, the midpoint cell, the second half-increment, and the
condition that the endpoint lies in the complete destination cell. This differs
deliberately from the configured kernel, which represents both endpoint cells by their
centers.

The table reports total variation distance between each configured midpoint kernel and
the integrated Brownian conditional distribution. Even endpoint offset means the
endpoint-center average lies at a cell center; odd offset means it lies on a cell
boundary.

| Diffusion rate | Duration 1, even | Duration 1, odd | Duration 1/2, even | Duration 1/2, odd |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | — | 0 | — |
| 0.5 | 0.0702 | 0.0086 | 0.0894 | 0.0009 |
| 1 | 0.0395 | 0.0186 | 0.0702 | 0.0086 |
| 2 | 0.0180 | 0.0172 | 0.0395 | 0.0186 |
| 4 | 0.0081 | 0.0100 | 0.0180 | 0.0172 |

The empirical Birds midpoint tables track their configured kernels: empirical-to-
configured distances were at most about `0.029` with roughly 1,100–5,100 parent birds per
case. The main structural discrepancy is the centered, even-offset bridge at low
diffusion, where ignoring within-cell endpoint positions makes the configured midpoint
too concentrated. Boundary-aligned bridges are much closer at the lowest rates. The
difference decreases as Brownian innovation dominates endpoint uncertainty.

### Child crossing and retention

For a parent flow returning to the same cell over normalized duration `1/4`, spatial
refinement produces a `2 x 2` table of source-child to destination-child counts. Diagonal
entries retain the same child; off-diagonal entries cross the parent midpoint. The
external reference integrates each child-to-child Brownian transition and conditions on
the complete parent-to-same-parent flow.

| Diffusion rate | Birds retention | Birds crossing | Brownian retention | Brownian crossing |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0.5086 | 0.4914 | 1.0000 | 0.0000 |
| 0.5 | 0.5066 | 0.4934 | 0.6766 | 0.3234 |
| 1 | 0.5145 | 0.4855 | 0.6050 | 0.3950 |
| 2 | 0.5041 | 0.4959 | 0.5573 | 0.4427 |
| 4 | 0.5032 | 0.4968 | 0.5299 | 0.4701 |

Birds remains near `1/2` retention at every rate, with negligible left/right directional
imbalance. This is the expected signature of Stage H: conditional on its separately
constructed row and column margins, the hypergeometric reconciliation treats source and
destination child membership as exchangeable. Brownian retention approaches `1/2` only
as diffusion becomes large. At `D = 0`, Birds assigns about half of the refined flow to
crossing children even though a stationary Brownian path has perfect retention.

This is not a newly discovered implementation bug: the canonical design explicitly
permits additional within-cell mixing from the F/G/H exchangeability approximation. It
is, however, a large and now quantified model discrepancy. It provides a concrete target
for a future coupling that preserves more source-to-destination child correlation and
helps explain why fine-scale tagged motion can persist even at low diffusion.

Run the deterministic candidate scan with candidate count, retained-path ceiling, and
diffusion rates:

```sh
npm run characterize:birds-trajectories -- 200 25 0.5 1 2 4
```

Run the equal-quota phase experiment with candidate ceiling per phase, quota per phase,
and diffusion rates:

```sh
npm run characterize:birds-balanced-trajectories -- 100 2 0.5 1 2 4
```

Run the corresponding labeled Brownian quotient-space reference:

```sh
npm run characterize:brownian-balanced-trajectories -- 1000 20 0.5 1 2 4
```

Run the anonymous adaptive reference tracker with candidate count and diffusion rates:

```sh
npm run characterize:brownian-reference-tracker -- 500 0.5 1 2 4
npm run characterize:brownian-reference-tracker -- 500 --max-refinements=64 0.5 1 2 4
```

Run the bridge and child-crossing report with trial count and diffusion rates:

```sh
npm run characterize:birds-bridges-crossings -- 100 0 0.5 1 2 4
```

## Deterministic cell-population bounds

Every sampler used by the Birds hierarchy has finite support. Binomial, multinomial,
and multivariate hypergeometric samples partition finite integer populations; their
outputs cannot exceed their supplied totals or margins. The rounded-normal midpoint
kernels are also finite because their tails are clamped at the global normal cutoff.
Consequently, every population and flow query has a deterministic, seed-independent
upper bound for a fully parameterized model and finite epoch.

The simplest bound follows the stage structure. Spatial subdivision and reconciliation
cannot increase the total population available to a child beyond their input margins.
Only the two temporal midpoint constructions in an epoch can aggregate populations
from multiple source cells. Let `F1(D)` be the number of distinct source-cell offsets
whose duration-1 midpoint support can reach a fixed midpoint cell, and let `F1/2(D)` be
the analogous number for a duration-1/2 midpoint. If

```text
N0 = round(populationDensity * BIRDS_COARSE_CELL_LENGTH),
C(D) = F1(D) * F1/2(D),
```

then a cell introduced at epoch `e` obeys

```text
population(cell) <= N0 * C(D)^e.
```

This proof deliberately allows every contributing parent to concentrate its entire
population into the target. It therefore remains valid without independence or typical-
case assumptions, but repeatedly charges the same conserved coarse birds through
different support paths. For the current support construction, the factors are:

| Diffusion rate | Duration-1 fan-in | Duration-1/2 fan-in | Per-epoch factor |
| ---: | ---: | ---: | ---: |
| 0 | 5 | 3 | 15 |
| 0.5 | 19 | 13 | 247 |
| 1 | 24 | 17 | 408 |
| 2 | 33 | 23 | 759 |
| 4 | 44 | 31 | 1,364 |

The large factors make this closed-form bound unsuitable as a practical materialization
threshold. At density 2, for example, its epoch-3 values range from `108,000` at `D = 0`
to `81,206,929,408` at `D = 4`.

A second diagnostic computes a tighter support-capacity bound. It refines the reachable
support of every nonzero deterministic coarse flow, then charges each distinct ancestral
coarse flow at most once for a target cell. This respects conservation across paths,
although it still assumes that the complete capacity of every reachable coarse flow can
arrive simultaneously. At density 2 it gives:

| Diffusion rate | Epoch 0 | Epoch 1 | Epoch 2 | Epoch 3 |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 32 | 34 | 34 | 34 |
| 0.5 | 32 | 199 | 271 | 303 |
| 1 | 32 | 276 | 382 | 436 |
| 2 | 32 | 360 | 515 | 579 |
| 4 | 32 | 496 | 713 | 810 |

This calculation is an exhaustive analysis of hierarchy support, not a runtime model
query. Its intermediate flow sets grow rapidly; epoch 4 was already too expensive for
the intended CLI diagnostic. The shallow results suggest much slower growth than the
closed-form bound, but they do not prove convergence or a uniform bound over all epochs.

The conclusion needed for this project is therefore limited but firm: all finite-epoch
populations are deterministically bounded, and a general explicit bound has been
derived, but no sufficiently tight epoch-only bound has been established to justify a
particular future materialization strategy. Spatial splitting can place an entire finite
population in one child, so deterministic scale decay cannot be assumed. Choosing
between a population cutoff and an epoch cutoff remains work for the next model design,
as intended.

Run the report with maximum epoch, population density, and diffusion rates:

```sh
npm run analyze:birds-population-bounds -- 12 2 0 0.5 1 2 4
```

## Multinomial coupling: gamma processes and Poisson races

**Status:** Initial gamma-process/Dirichlet and Poisson-race multinomial experiments
completed. The race is retained as a research baseline; the model keeps sequential
binomials. Stronger sample-ratio monotonicity remains unresolved.
The current sequential-binomial sampler remains the implementation. The constructions
below describe ideal probability laws; floating-point behavior and sampler costs still
need evaluation.

### Distinguishing the coupling properties

Fix the total `n`, seed, address, and semantic category identities. Let `x` and `y` be
the outputs for probability vectors `p` and `q`. The existing likelihood-ratio criterion
compares the complete multinomial laws `P = Multinomial(n, p)` and
`Q = Multinomial(n, q)`:

```text
Q(y) / P(y) >= Q(x) / P(x).
```

For positive probabilities, cancelling the multinomial coefficients gives

```text
sum_i (y_i - x_i) * log(q_i / p_i) >= 0.
```

At `n = 1`, this is precisely the categorical criterion. Independent categorical
couplings satisfying that criterion also satisfy it after their counts are aggregated.
However, it permits the following behavior: increasing `p_A` and decreasing `p_C` by
the same amount, with `p_B` fixed, can change `(1, 1, 1)` into `(1, 2, 0)`. The sampled
`B/A` ratio increases even though the probability ratio decreases.

A further candidate property is pairwise sample-ratio monotonicity. If parameter `i`
increases and parameter `j` decreases or stays fixed, require

```text
y_i * x_j >= x_i * y_j.
```

This avoids division by zero, but can be uninformative when both old counts are zero.
It must be assessed separately from the complete-outcome likelihood-ratio criterion.
The discussion has not established whether an exact multinomial sampler can satisfy
this property universally. Requiring every unchanged-probability category to keep its
sampled count exactly fixed is a different, stronger restriction that we have not adopted.
For changes in `n`, retain the separate requirement that every category count be
nondecreasing under the same address.

### Continuous starting point: normalized gamma processes

For fixed concentration `kappa > 0`, set `alpha_i = kappa * p_i`. Take independent
unit-scale gamma processes `G_i`, with independent increments satisfying

```text
G_i(t + h) - G_i(t) ~ Gamma(shape = h, scale = 1).
```

Then `X_i = G_i(alpha_i) / sum_j G_j(alpha_j)` has the Dirichlet law with parameters
`alpha`. Holding these paths fixed makes each unnormalized sample nondecreasing in its
own parameter. Because normalization cancels in `X_i / X_j`, increasing `alpha_i` and
decreasing or fixing `alpha_j` gives the proposed pairwise ratio inequality. This does
not assert ratio monotonicity for arbitrary changes where both parameters increase or
both decrease. An unaffected normalized coordinate can move as the denominator changes.

We can construct the paths recursively. A gamma increment covering a parameter interval
of length `a + b`, conditional on total `S`, splits into

```text
B ~ Beta(a, b),
S_left = S * B,
S_right = S * (1 - B).
```

This conditional construction is established gamma-bridge sampling; see
[Avramidis, L'Ecuyer, and Tremblay, Section 3.1](https://informs-sim.org/wsc03papers/039.pdf).
Our proposed adaptation uses canonically addressed dyadic blocks and independent
expansion blocks, so different query orders reveal the same path. Positive increments
provide monotonicity; the scalar gamma and beta implementations need not themselves
couple different shape parameters monotonically. This supplies a concrete alternative
to using a gamma inverse CDF at every requested parameter value.

### Exact multinomial candidate: shared Poisson arrival streams

At integer arguments, `T_i(m) = G_i(m)` is the arrival-time sequence of a unit-rate
Poisson process: consecutive gaps are independent `Gamma(1, 1)` exponential variables.
Scale each arrival to `T_i(m) / p_i` and select the first `n` arrivals across categories.
Their category counts have exactly the multinomial law. A zero-probability category
contributes no arrivals. This construction appears in
[Gölz, Peters, and Procaccia, Section 3.2](https://dominik-peters.de/publications/apportionment-journal.pdf).

With streams fixed, increasing `n` adds one arrival. For `n = 1`, the construction is
the categorical exponential race. It also has the paper's population monotonicity:
when `p_i / p_j` increases, `i` cannot lose counts while `j` gains counts. This is weaker
than sampled-ratio monotonicity: the `(1, 1, 1) -> (1, 2, 0)` example remains possible.

The following direct argument also establishes complete-outcome likelihood-ratio
monotonicity for this candidate. For fixed streams, selecting the earliest arrivals
maximizes, over count vectors `z` summing to `n`,

```text
score_p(z) = sum_i z_i * log(p_i)
             - sum_i sum_{m=1}^{z_i} log(T_i(m)).
```

Adding `score_p(x) >= score_p(y)` and `score_q(y) >= score_q(x)` cancels the random
terms and yields the required inequality. This proof assumes positive probabilities;
support changes and deterministic handling of numerical ties need explicit treatment
in an implementation.

### Avoiding work proportional to the population

The gamma hierarchy could answer `T_i(m)` by revealing only a logarithmic number of
blocks in `m`, without generating all preceding gaps. Canonical block boundaries must
be independent of both `n` and `p`; making a fresh root for each call would destroy the
shared coupling. For example, independent blocks on `[0, 1]`, `[1, 2]`, `[2, 4]`, and
successive doubled intervals can be subdivided with gamma bridges. Addresses identify
the category and block, not the requested probability vector or evaluation order.

Selection across these increasing streams is a sorted-list selection problem. Existing
algorithms use `O(k + sum_i log(x_i + 1))` comparisons for `k` lists contributing `x_i`
selected entries, assuming random access; see
[Kaplan et al., Selection from heaps, row-sorted matrices and X+Y using soft heaps](https://arxiv.org/abs/1802.07041).
Our proposed combination with lazy gamma bridges suggests work polylogarithmic in `n`
for fixed category count. This is an algorithmic direction, not a measured complexity
or throughput result for our implementation. Scalar sampling, tree traversal, hashing,
and selection overhead may still make it slower than sequential binomials.

### Initial gamma-process and Dirichlet experiment

`src/experiments/gammaProcess.ts` implements the proposed addressed dyadic hierarchy
using stdlib gamma and beta generators with a private addressed uniform stream for each
scalar draw. A fresh factory per draw isolates library generator state; its setup cost
is included in timings. The prototype intentionally uses untruncated laws to investigate
the construction. A 4,096-uniform budget per scalar draw throws instead of substituting
a fallback. It lives under `experiments/`, with the library dependencies scoped to
development, and is not connected to model execution.

The deterministic report uses 2,000 trials per case. No pairwise ratio violations above
an absolute cross-product tolerance of `1e-15` occurred in the elementary transfers.
Separate tests check exact replay under reversed query order and cache clearing, joint
gamma increment means/variances/covariance, Dirichlet means/variances/covariance, and
logarithmic scalar work for a large arrival index.

| Dirichlet parameters | Expected means | Observed means | Failed trials | Zero output coordinates |
| --- | --- | --- | ---: | ---: |
| `(2, 3, 5)` | `(0.200, 0.300, 0.500)` | `(0.203, 0.302, 0.495)` | 0 | 0 |
| `(0.125, 0.25, 0.625)` | `(0.125, 0.250, 0.625)` | `(0.121, 0.243, 0.636)` | 0 | 0 |
| `(0.001, 0.002, 0.007)` | `(0.100, 0.200, 0.700)` | `(0.098, 0.195, 0.707)` | 3 | 1,617 |

Means are consistent with sampling noise at this trial count, but the small-shape case
exposes a numerical limitation. All three failures were normalization underflows, and
the displayed moments exclude failed trials. The zero coordinates violate the ideal
positive-parameter Dirichlet support. They are not intentional truncation. Even the
middle case produced some intermediate beta endpoint samples and collapsed splits,
despite no zero coordinates in its final outputs. Thus monotonicity checks passing does
not establish numerical distributional accuracy at arbitrarily small shapes.

Cold single-arrival queries (fresh process/cache per trial) gave the following costs.
These are rough local wall-clock measurements, including factory construction, hashing,
and traversal, rather than isolated scalar-sampler benchmarks:

| Arrival index | Gamma draws | Beta draws | Approximate microseconds/query |
| ---: | ---: | ---: | ---: |
| 17 | 6 | 4 | 164 |
| 1,023 | 11 | 9 | 327 |
| 1,048,575 | 21 | 19 | 642 |
| 1,073,741,823 | 31 | 29 | 968 |
| 1,099,511,627,775 | 41 | 39 | 1,355 |

Across these cases, observed arrival means were within 1.3 theoretical standard errors
of the gamma means. Scalar work grows logarithmically with the index, as intended, but
the absolute cost is substantial. Cache sharing across selection probes and factory
overhead deserve measurement before judging multinomial performance. Integer-index
arrival queries only require root shapes and split shapes of at least one, so the
small-shape Dirichlet failure does not directly block that experiment. Large-index
floating-point ties remain a separate concern.

Run the bounded diagnostic with an optional trial count (default 2,000):

```sh
npm run experiment:gamma-process -- 2000
```

### Poisson-race multinomial experiment

`src/experiments/poissonRace.ts` now provides a direct arrival merge and a lazy rank-based
selector. Both evaluate the same canonically addressed gamma paths. The direct method
advances one winning stream per draw; it serves as a small-population reference. The
lazy method keeps a candidate index range per stream, chooses a midpoint from a largest
range, and uses binary searches to rank that arrival across all streams. It discards
the side that cannot contain the global `n`th arrival and repeats. It returns counts,
not a materialized list of arrivals.

This is a simple selection baseline, not the optimal sorted-list algorithm cited above.
There are `O(k log(n+1))` pivots and `O(k^2 log^2(n+1))` arrival probes for `k` categories.
Each previously unseen arrival may require logarithmic gamma-tree traversal and scalar
draws, so the comparison bound is not a bound on all sampler work. Cache sharing reduces
repeated draws. Probabilities never enter path addresses. Numerical ties are ordered by
semantic category ID, then arrival index; that produces reproducible selection without
claiming exact ideal-law coupling at floating-point limits. Aggregate ranks use bigint
because `k*n` can exceed the safe integer range even when `n` does not.

Tests establish direct/lazy equality with fresh paths and reordered categories, count
conservation, componentwise monotonicity in `n`, categorical behavior at `n = 1`, and
the tested likelihood-ratio and population-monotonicity inequalities. They also check
multinomial means, variances, and covariance over 1,200 seeds at `n = 20`, deterministic
tie behavior, zero-probability categories, and a structural probe bound at `n = 10^9`.
These finite tests supplement the mathematical construction; they do not establish
distributional accuracy throughout the numeric range.

The stronger sample-ratio counterexample is an explicit regression test. With first
unit-rate arrival times `A: (0.1, 1, 2)`, `B: (0.2, 0.4, 2)`, and
`C: (0.35, 0.9, 2)`, changing probabilities from `(1/3, 1/3, 1/3)` to
`(0.4, 1/3, 4/15)` changes the first-three-arrival counts from `(1, 1, 1)` to
`(1, 2, 0)`. Thus a passing likelihood-ratio test must not be read as solving that
stronger requirement.

The report compares fresh-cache races over 20 samples per case with at least 200
sequential-binomial samples, after a warmup call to both implementations. Timings include
path construction, scalar factory creation, addressing, hashing, selection, and allocation.
The Birds cases use actual duration-1, mid-cell kernels. A separate one-seed instrumented
pass reports scalar calls, stored endpoints, encoding, and hashing; those profile timings
are not added to the uninstrumented benchmark times.

| Probabilities | Categories | Population | Lazy race, ms | Sequential binomials, µs |
| --- | ---: | ---: | ---: | ---: |
| Uniform | 3 | 1,024 | 3.32 | 24.1 |
| Uniform | 3 | 1,000,000,000 | 205 | 90.0 |
| `(0.0001, 0.0099, 0.99)` | 3 | 1,024 | 2.82 | 20.0 |
| `(0.0001, 0.0099, 0.99)` | 3 | 1,000,000,000 | 179 | 16.6 |
| Birds `D = 1` | 7 | 1,024 | 4.89 | 14.9 |
| Birds `D = 1` | 7 | 1,000,000,000 | 313 | 58.6 |
| Birds `D = 4` | 13 | 1,024 | 9.62 | 23.6 |
| Birds `D = 4` | 13 | 1,000,000,000 | 639 | 129 |

The direct merge took roughly 20 ms at `n = 1,024`; it was intentionally not run at large
populations. The lazy construction avoids that linear growth but remains much slower
than the production sampler. In the separately profiled `D = 4`, billion-count case,
36 pivots made 14,010 arrival probes and generated 403 gamma draws and 36,336 beta draws,
storing 36,752 endpoints including origin entries. About 97.3% of instrumented time was
inside beta draw calls, 1.2% in gamma draws, and 1.5% elsewhere. Scalar times include
factory setup and RNG work: encoding consumed about 19.8% and hashing about 9.9% of the
total, nested within those scalar times. No collapsed splits occurred in the reported
profile cases; this is not a test of the full safe-integer boundary.

Retain sequential binomials for the current model. This prototype demonstrates the
exact mathematical race construction and useful coupling, but its measured cost rules
out adopting it as-is. Potential follow-up experiments are a better selector that avoids
repeated full-range searches, dyadically aligned probes that share more bridge nodes,
and reducing scalar factory overhead after auditing generator state. These are hypotheses
for optimization, not demonstrated speedups. The stronger sampled-ratio question remains
open independently of performance.

Run the bounded report with an optional number of race samples per case (default 20,
maximum 200; the default takes on the order of tens of seconds locally):

```sh
npm run experiment:poisson-race -- 20
```

### Count-based Poisson hierarchy experiment

The next prototype, `src/experiments/poissonCountProcess.ts`, represents each unit-rate
process as a one-dimensional starfield. Independent roots cover `[0,1)`, `[1,2)`,
`[2,4)`, and successive doubled intervals. Root counts use stdlib's Poisson inverse CDF
without tail clamping or a normal approximation. A parent owns its exact conditional
`Binomial(count, 1/2)` split, also sampled with the stdlib inverse CDF. Nodes with at
most 16 points materialize sorted uniform coordinates. Descendants of a materialized
node use those coordinates directly, so query order cannot change the point process.
This borrows the starfield construction, not its approximate distribution utilities.

Let `N_i(t)` count category `i`'s points in `[0,t)`. The race queries `N_i(p_i*t)` for a
common cutoff `t` and searches for a sum of exactly `n`. It starts at `t = n`, expands
the bracket if needed, and bisects. Probabilities enter only the query coordinates, not
the point-generation addresses. In the ideal process, a suitable interval exists between
the `n`th and `(n+1)`th arrivals almost surely. With finite precision, coincident points
or scaled coordinates may leave no representable cutoff. The prototype throws when
the bracket cannot narrow or a 2,048-cutoff guard is exhausted; it does not silently
return an approximate count. There is no claimed deterministic logarithmic bound on
refinement independent of arrival separation.

The hierarchy also supports selecting an arrival by index, used to compare the cutoff
search against the existing direct merge on the same points. Tests cover exact agreement
with fresh caches and reordered categories, replay of counts and coordinates, conservation,
coupling in `n`, likelihood-ratio and population monotonicity, the full small-`n`
multinomial probability table, independent Poisson increment moments, and a billion-count
query. A synthetic coincident-arrival case checks explicit precision failure. The stronger
sample-ratio counterexample remains reproducible with this representation as well.

The same-run comparison uses 20 fresh-cache count races, 3 fresh-cache gamma races, and
at least 200 sequential-binomial samples per case, with a warmup for each method. The
gamma sample count is small to bound run time; timings are exploratory averages, not
confidence intervals. Different constructions have different addressed realizations,
so count and gamma outputs are not expected to agree seed by seed.

| Probabilities | Categories | Population | Count hierarchy, ms | Gamma hierarchy, ms | Sequential binomials, µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Uniform | 3 | 1,024 | 1.22 | 3.79 | 10.2 |
| Uniform | 3 | 1,000,000,000 | 16.5 | 195 | 83.0 |
| `(0.0001, 0.0099, 0.99)` | 3 | 1,000,000,000 | 6.01 | 181 | 13.1 |
| Birds `D = 1` | 7 | 1,000,000,000 | 12.3 | 312 | 50.1 |
| Birds `D = 4` | 13 | 1,024 | 1.30 | 9.85 | 21.2 |
| Birds `D = 4` | 13 | 1,000,000,000 | 20.3 | 644 | 131 |

The count representation is about 32 times faster than the gamma baseline for the
13-category billion-count case, though still about 155 times slower than sequential
binomials. That case averaged 30.7 cutoff probes. A separate profile of seed 0 recorded
266 Poisson draws, 2,108 binomial draws, 5,008 materialized points, and 4,482 stored nodes.
About 9.6% of profile time was inside Poisson draws, 33.5% inside binomial draws, and
56.8% in other work, including materialization and traversal. Across all those operations,
address encoding consumed 36.4% and hashing 17.1% of total time; those percentages are
nested and must not be added to the scalar/other breakdown. Profiling is performed
separately from the uninstrumented timings.

This establishes the count hierarchy as a more promising implementation of the same
mathematical race. It substantially reduces scalar work and avoids gamma/beta factory
setup, without intentionally approximating the Poisson law. Materialization policy,
bracketing, redundant traversal, and address-generation costs are possible further
optimization targets. The current model still keeps sequential binomials, and numeric
boundary behavior and the stronger ratio condition remain separate limitations.

Run the report (optional count-race samples per case, default 20; gamma samples are capped
at 3 per case):

```sh
npm run experiment:poisson-count-race -- 20
```

### Replaying multinomial parameters from viewport workloads

`src/experiments/birdsSamplerWorkload.ts` captures actual multinomial calls during
cold-cache Birds viewport queries. A scoped synchronous observer records parameters
without changing samples or addresses; it is inactive outside the capture pass and is
restored even when a diagnostic throws. Calls are grouped by the complete `(n, p)` pair,
with invocation frequency and up to eight example semantic addresses per group.
Repeated evaluations caused by model cache eviction count as separate invocations.

The default-density cases use the same 80-by-50 population grid and seeds as the engine
profiler, with `D = 0.5`, density 2, and epochs 1–3. Two additional 20-by-8 grids test
higher diffusion and density at epoch 2. Each case uses one fixed model seed; these are
representative diagnostic workloads rather than a random sample of GUI navigation.

| Workload | Calls | Zero-total calls | Median positive n | 95th percentile positive n | Maximum n |
| --- | ---: | ---: | ---: | ---: | ---: |
| Epoch 1, density 2, D=0.5, 4,000 cells | 81,004 | 82.7% | 4 | 14 | 29 |
| Epoch 2, density 2, D=0.5, 4,000 cells | 87,656 | 85.5% | 2 | 8 | 27 |
| Epoch 3, density 2, D=0.5, 4,000 cells | 90,105 | 88.7% | 2 | 6 | 26 |
| Epoch 2, density 2, D=2, 160 cells | 14,038 | 86.8% | 2 | 8 | 16 |
| Epoch 2, density 32, D=0.5, 160 cells | 5,978 | 76.5% | 18 | 147 | 360 |

Every case used four probability vectors, corresponding to the two duration and two
midpoint-alignment kernels. At `D = 0.5`, their category counts are 4, 4, 5, and 6. The
centered kernels put about 84.3% or 95.4% in the central category, while the boundary
kernels are dominated by a nearly equal pair. All include small tail probabilities.
At `D = 2`, category counts are 7, 7, 9, and 10. The CLI prints the full probability
vectors and their frequencies; `--details` also prints population histograms and every
parameter group's timing. The billion-population, 13-category synthetic case is clearly
not typical of these default model queries.

For replay, each group receives 32 race samples and 512 sequential-binomial samples per
round, using independent addressed seeds and the captured address shapes. Three rounds
alternate sampler order; the median per-call time is weighted by the group's captured
invocation frequency. Every race has fresh process caches. The race bypasses process
construction for `n = 0` or a single active category; the existing sequential sampler is
measured unchanged. Both timed loops include a count-conservation check. Warmup and model
parameter capture are excluded from replay timings. These timings include the cost of
long model addresses, unlike the earlier short synthetic benchmark addresses.

| Workload | Weighted sequential, µs/call | Weighted count race, µs/call | Sampler multiplier | Estimated model multiplier |
| --- | ---: | ---: | ---: | ---: |
| Epoch 1, density 2, D=0.5, 4,000 cells | 1.80 | 11.69 | 6.51× | 1.67× |
| Epoch 2, density 2, D=0.5, 4,000 cells | 1.46 | 7.07 | 4.84× | 1.39× |
| Epoch 3, density 2, D=0.5, 4,000 cells | 1.12 | 5.18 | 4.61× | 1.26× |
| Epoch 2, density 2, D=2, 160 cells | 2.16 | 9.46 | 4.39× | 1.37× |
| Epoch 2, density 32, D=0.5, 160 cells | 2.32 | 56.35 | 24.27× | 4.98× |

The estimated model multiplier is

```text
1 + sum_groups calls * (race_time_per_call - sequential_time_per_call)
    / uninstrumented_model_query_time.
```

The measured baseline model times were approximately 1,189, 1,253, 1,392, 276, and 81 ms,
respectively, after separate JIT warmup and with fresh model caches. The default-density
predictions therefore add roughly 802, 492, and 366 ms to those 4,000-cell batches.
These are fixed-workload estimates, not measured end-to-end replacement runs. Changing
the sampler changes realized counts and can change recursive queries, zero-flow pruning,
cache behavior, and allocation/GC costs. Rendering is excluded. The high-density case
also has a different grid size, so its absolute time is not directly comparable with
the default-density 4,000-cell cases. No confidence interval is claimed.

The observed default workload makes the experimental sampler much less disruptive than
extrapolating the billion-count benchmark suggested: about 26–67% extra model time under
the fixed-workload assumption, rather than a many-fold slowdown. Its cost remains material,
and increases sharply with population density. Retain the production sampler while
considering further count-race optimization or an actual end-to-end replacement experiment.

Run with race samples per parameter group (default 64; the recorded run used 32):

```sh
npm run experiment:birds-sampler-workload -- 32
npm run experiment:birds-sampler-workload -- 32 --details
```

### Fixed race-time hierarchy: which monotonicity survives?

An alternative to scaling fixed unit-rate point coordinates is to keep interval boundaries
fixed in race time and sample each root count with mean `p_i * interval_length`. With
shared inverse-Poisson quantiles, root counts are nondecreasing in `p_i`. Shared exact
inverse-binomial splits preserve this property in both children: increasing a parent
count by one increases its left-child quantile by either zero or one, so the right-child
remainder also increases by either zero or one. Recursion therefore makes every dyadic
interval count nondecreasing in rate, provided materialization does not change the coupling.

This implies a weaker race guarantee: if `q_i >= p_i` and `q_j <= p_j`, category `i`
cannot lose counts while category `j` gains counts. If `i` lost despite its increased
rate, the common cutoff must have moved earlier; that earlier cutoff and `j`'s
nonincreasing rate prevent `j` from gaining. For an elementary probability transfer from
one donor to one recipient with all other probabilities fixed, conservation further
implies that the recipient's count cannot decrease and the donor's count cannot increase.

However, interval-count monotonicity does not imply relative-probability population
monotonicity or the original categorical likelihood-ratio criterion. A concrete
counterexample uses `p = (0.2, 0.2, 0.6)` and `q = (0.4, 0.3, 0.3)`. For the root
`[0,1)`, the following shared quantiles give these counts (verified with stdlib):

| Category | Poisson uniform | Count under p | Count under q |
| --- | ---: | ---: | ---: |
| A | 0.85 | 1 | 1 |
| B | 0.80 | 0 | 1 |
| C | 0.10 | 0 | 0 |

A shared left-child binomial quantile of `0.25` puts A's point in `[0.5,1)`. A quantile
of `0.75` puts B's new point in `[0,0.5)`. Thus, with `n = 1`, the winning category
changes from A to B even though `q_B/p_B = 1.5 < 2 = q_A/p_A`. The failure already
occurs in an exact count-only hierarchy; it is not caused by materialization or numeric
precision. It rules out assuming that this rate-parameterized construction has the same
coupling guarantees as the implemented coordinate-scaled race.

The implemented count-process prototype materializes at a **population threshold**,
not at a fixed hierarchy stage. The initial experiments used 16; the cutoff sweep below
changes the default to 4. A queried root or child at or below the threshold generates
their uniform coordinates; subsequent partial queries use those coordinates without
further subdivision. For its fixed seed and category, the unit-rate hierarchy, counts,
and materialization decisions do not depend on either the multinomial probability or
the requested total `n`. Different queries may reveal different parts of that fixed
process, but never redefine already-determined points. Therefore threshold-based
materialization preserves the current sampler's coupling.

In the proposed fixed-race-time alternative, changing `p_i` could move a node across the
materialization threshold. Switching from parent-generated coordinates to independently
addressed descendant counts/coordinates would invalidate the interval-monotonicity
argument unless those representations were explicitly coupled. A fixed geometric
materialization stage, with prefix-coupled point lists, is one possible approach to that
separate issue, but has not been implemented and would not resolve the counterexample
above. The current sampler remains the coordinate-scaled construction.

### Materialization cutoff sweep

The count-process constructor now accepts a fixed materialization cutoff. We swept
1, 2, 4, 8, 16, 32, and 64, then confirmed 1, 4, and 16 with 32 samples per captured
Birds parameter group. Replay timings use three rounds with rotated/reversed candidate
order and the median for each group, weighted by observed call frequency. These are
sampler timings, not end-to-end model replacement measurements.

| Captured workload | Cutoff 1 (µs/call) | Cutoff 4 | Cutoff 16 |
| --- | ---: | ---: | ---: |
| Epoch 1, D = 0.5, density 2 | 11.389 | 11.058 | 11.252 |
| Epoch 2, D = 0.5, density 2 | 7.807 | 6.706 | 6.831 |
| Epoch 3, D = 0.5, density 2 | 5.185 | 4.816 | 4.777 |
| Epoch 2, D = 2, density 2 | 10.493 | 9.664 | 9.904 |
| Epoch 2, D = 0.5, density 32 | 35.968 | 40.854 | 56.378 |

A separate 13-category D = 4 midpoint-kernel sweep uses eight seeds, repeated for three
rounds, reporting median time per sample:

| Population | Cutoff 1 (ms) | Cutoff 4 | Cutoff 16 |
| --- | ---: | ---: | ---: |
| 1,024 | 0.701 | 0.758 | 1.254 |
| 1,000,000 | 3.522 | 4.160 | 6.212 |
| 1,000,000,000 | 14.214 | 15.159 | 19.390 |

Smaller cutoffs exchange coordinate generation for more binomial splits and nodes.
At population 10⁹, moving from 16 to 4 reduces average materialized points from 5,074
to 1,395, while increasing binomial draws from 2,211 to 2,637 and nodes from 4,695
to 5,547. That tradeoff is favorable here.

**Decision:** use 4 as the experimental default. Compared with 16, it is approximately
unchanged on default-density workloads (small differences should not be overinterpreted),
28% faster on the density-32 replay, and 22–40% faster on these large synthetic cases.
Cutoff 1 is faster still on the dense/large cases, but less favorable on typical sparse
workloads. This is a compromise, not a universal optimum. Production Birds continues
to use sequential binomials.

Changing the cutoff changes seeded realizations: different cells own coordinate
materialization and therefore use different random addresses. Each fixed choice retains
the intended Poisson construction and coupling; it must not be chosen afresh from a
query's `n` or probabilities. Tests cover conservation, moments, cache-clear replay,
monotonicity in `n`, and the likelihood-ratio inequality for every swept cutoff.
Earlier measurements in this document retain their original cutoff of 16.

Reproduce with:

```sh
npm run experiment:birds-sampler-workload -- 32 --cutoffs=1,4,16
npm run experiment:poisson-materialization
```

### Experiment checklist and unresolved decisions

1. The initial gamma hierarchy and normalized Dirichlet checks are complete above.
   Retain small-shape numerical accuracy as an explicit limitation for further study.
2. Completed: build a small direct Poisson-race reference, then evaluate the same streams
   lazily and compare outputs using the same canonical hierarchy.
3. Completed for the tested cases: verify multinomial moments and conservation, categorical behavior at `n = 1`,
   componentwise monotonicity in `n`, population monotonicity, and the complete-outcome
   likelihood-ratio inequality. Retain explicit counterexamples to the stronger ratio
   property so that passing weaker tests cannot be mistaken for satisfying it.
4. Initial benchmark completed: compare increasing population and category counts against sequential binomials,
   including representative Birds parameters. Measure work, memory, hashing, and scalar
   sampler costs separately. Investigate extreme shapes and arrival-time precision.
5. Decision: retain sequential binomials, for the performance reasons above. Both arrival-
   and count-based race prototypes are available for further experiments. The stronger
   multinomial ratio requirement remains open; success with the Poisson race alone does
   not resolve it.

Exact gamma increments and exponential gaps are unbounded. If prototype policy requires
truncating them, document that approximation explicitly: arbitrary clamping need not
preserve the gamma-bridge identities, Dirichlet law, or exact multinomial law. The
implementation decision must account for this alongside numerical limits and performance.
The basic likelihood-ratio coupling investigation now has a tested candidate and an
explicit decision to retain the current sampler. Further optimization and the stronger
sample-ratio question remain possible follow-ups. The high-level analysis synthesis
below is still outstanding.

## Planned analysis

Future sections will record:

- any further multinomial coupling experiments, including the open sampled-ratio question;
- a final high-level synthesis that separates reusable, model-agnostic evaluation
  metrics from version-1-specific anomaly investigations and root-cause findings; and
- any further empirical performance investigations that affect mathematical analysis.

The reusable metrics must remain meaningful for a future model with a different
spacetime construction. They should be stated in terms of public observables, invariants,
reference-process comparisons, scaling behavior, statistical dependence, and resource
costs. Hierarchy phases, F/G/H stages, classifier costs, or a known version-1 failure may
motivate an investigation, but tests aimed specifically at those mechanisms belong in
the model-specific findings rather than the reusable scorecard. This prevents a new
model from appearing superior merely because it lacks the old model's particular
pathologies while introducing different ones.
