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

## Planned analysis

Future sections will record:

- increment, displacement, bridge, and crossing statistics;
- tagged trajectories and the finite-population quotient-space reference comparison;
- deterministic cell-population bound analysis;
- likelihood-ratio-monotone multinomial coupling investigation; and
- any further empirical performance investigations that affect mathematical analysis.
