# Polis Birds Design Q&A and Decision Log

This document records questions, feedback, and decisions from the review of
[`BIRDS_MODEL_DESIGN.md`](./BIRDS_MODEL_DESIGN.md). The design remains preliminary while
these questions are open. Accepted conclusions should be recorded here and incorporated
into the design when they change the model specification.

## Status key

- **Open** — needs discussion.
- **Proposed** — a concrete answer or direction has been suggested but not accepted.
- **Decided** — a conclusion has been accepted.
- **Deferred** — intentionally postponed, with a stated reason or trigger for revisiting it.
- **Validated** — a previously uncertain conclusion has been supported by analysis,
  experiment, or implementation.

## Decision principles

When resolving these questions, prefer:

- exact integer conservation;
- one canonical owner and address for every stochastic fact;
- dependency bounds closed under every legal refinement and aggregation;
- a structurally acyclic recursive query graph;
- explicit numeric and parameter domains;
- bounded public output and bounded dependency enumeration;
- a precise statement of approximation error rather than an implicit Brownian claim; and
- model-specific APIs rather than a generic stochastic hierarchy framework.

---

## Discussion batch 1: Model domain and initialization

### Q1. What are the supported parameter ranges?

**Status:** Decided

The design exposes `populationDensity` and `diffusionRate`, but does not define their
legal numeric ranges. A single temporal subdivision enumerates approximately
`O(K sqrt(D))` midpoint cells, so an unrestricted finite `D` can request enormous work.
That work is not polynomial in the encoded bit length of `D`.

The specification should still decide:

- whether zero diffusion is legal;
- whether a positive minimum diffusion is required for the approximation;
- the legal density range; and
- the validation rules for finite JavaScript-number parameters.

**Conclusion:** Model parameters are fixed when evaluating asymptotic query
complexity. There is therefore no requirement that work be polynomial in the encoded
size or precision of `populationDensity` or `diffusionRate`, and the API should not impose
an artificial performance-derived maximum on either parameter. Semantically valid
parameters should be accepted and their practical limits discovered experimentally.

Parameters are expressed in world units and use JavaScript numbers in the prototype.
`populationDensity` and `diffusionRate` accept every finite nonnegative number, including
zero. Reject negative values, infinities, and `NaN`. There is no artificial maximum or
positive minimum. A density whose coarse-cell population rounds to zero produces an
empty initial model. Zero diffusion uses the midpoint semantics decided in Q6 and Q8.

### Q2. How is the deterministic coarse-flow kernel defined?

**Status:** Decided

The recursive model requires a complete definition of:

```text
F(A, B) = g(distance(A, B); density, diffusionRate).
```

The kernel must return nonnegative integers, have finite support, be translation
invariant, give every coarse cell equal incoming and outgoing totals, and obey the same
support relation used by recursive queries.

An arbitrary real density cannot generally give exactly `density × 16` birds in every
coarse cell because the population must be an integer. Possible resolutions include:

- use an integer coarse-cell population as the primitive parameter;
- restrict density to multiples of `1/16`; or
- define deterministic rounding and distinguish requested from effective density.

The allocation of that population among destination offsets also needs an exact,
canonical integer rule.

**Conclusion:** `populationDensity` remains the public parameter and is measured
in birds per unit of world-space length. Its semantics must not depend on the chosen
coarse cell size. For the initial deterministic coarse-flow model, the requested density
is converted to an integer coarse-cell population using `Math.round` semantics when an
integer is required.

The fixed deterministic coarse flows are understood as a temporary initialization model,
not a permanent interpretation of population density. A later stochastic initialization
may naturally have a non-integer expected population per coarse cell.

Use `roundedNormal` to define the target coarse-flow probability mass over destination
offsets. Approximate a source-uniform starting position by a normal with matching
variance, then add Brownian displacement, giving normalized variance:

```text
variance / L_0^2 = 1 / 12 + D T_0 / L_0^2
```

With the current `T_0 = L_0^2`, this is `1 / 12 + D`. Apply the same bounded-normal
clamping semantics used by the midpoint kernels.

Convert this target probability mass into deterministic integer coarse-flow counts by
minimizing total variation distance subject to exact reflection symmetry. If `p_d` is the
target probability of destination offset `d`, choose nonnegative integer counts `n_d`
such that:

```text
sum_d n_d = N
n_d = n_-d
```

while minimizing:

```text
(1 / 2) sum_d |n_d / N - p_d|
```

Equivalently, minimize `sum_d |n_d - N p_d|`. This is a finite deterministic
optimization, not a stochastic sample. Reflection symmetry prevents systematic drift;
translation independence then gives every coarse cell the same total incoming and
outgoing population.

If several count vectors attain the same minimum, represent each reflection-symmetric
candidate by `(n_0, n_1, n_2, ...)`, where `n_d = n_-d` for positive `d`, and choose the
lexicographically smallest vector. Thus the tie-break examines displacement zero first
and then proceeds outward by increasing absolute displacement. This rule is deterministic
and translation independent; it does not claim additional physical significance.

### Q3. What is the exact spatial and temporal root domain?

**Status:** Decided

The design says outward and unbounded-time expansion are deferred, but also appears to
initialize coarse flows for every aligned spatial cell and every start time divisible by
256. That already defines an unbounded spatial and temporal domain at fixed coarse
resolution.

We should clarify whether:

- coarse roots exist across the entire infinite space-time lattice; or
- the first model has a finite spatial or temporal root window with explicit boundaries.

If roots exist everywhere, the deferred feature is coarser-scale expansion rather than
unbounded temporal extent.

**Conclusion:** Coarse roots exist for every length-16 aligned spatial cell and every
aligned coarse time interval `[256k, 256(k + 1)]`, throughout the domain representable by
the numeric primitives. The model construction imposes no additional spatial or temporal
window. The deferred feature is expansion to coarser scales, not extension beyond a
finite root window.

The initial hierarchy includes all such roots even when a particular diffusion parameter
would make some flows identically zero. A diffusion-dependent hierarchy that omits those
flows is deferred until it addresses a concrete implementation problem.

### Q4. What exact type represents population counts?

**Status:** Decided

Birds requires exact conservation across sums, binomial splits, multivariate
hypergeometric batches, and contingency-table reconciliation. JavaScript `number` stops
representing every integer exactly above `Number.MAX_SAFE_INTEGER`.

The model needs one of:

- a supported parameter and query domain proven to keep every count safe;
- explicit overflow detection and rejection; or
- a `bigint` count representation with compatible samplers.

This decision affects every distribution API and should precede their implementation.

**Conclusion:** Population counts use JavaScript `number` in the prototype. Model claims
of exact integer conservation apply within the range where JavaScript represents the
relevant integers exactly; `bigint` support is out of scope for now. More generally,
references to an unbounded model mean that its construction imposes no bounds beyond the
limitations of its numeric primitives.

This numeric choice does not introduce semantic limits on otherwise valid model
parameters. Experiments should expose parameter regimes where precision or performance
becomes unsuitable, at which point the representation or implementation can be revisited.

---

## Discussion batch 2: Brownian support and approximation

### Q5. What ordinary-flow support rule is closed under the hierarchy?

**Status:** Decided

The design suggests using the direct bounded-increment envelope

```text
|X(t + T) - X(t)| <= K sqrt(DT)
```

for every ordinary flow. This envelope is not closed under the proposed bridge
subdivision. If a parent displacement is bounded by `S sqrt(DT)`, a half-flow can reach

```text
((S + K) / 2) sqrt(DT).
```

Relative to its own duration `T/2`, its normalized coefficient is `(S + K) / sqrt(2)`.
A pointwise envelope would therefore require at least

```text
S >= (1 + sqrt(2)) K
```

before accounting for cell-width uncertainty.

The earlier proposal also mixed independently uniform latent endpoint positions into the
temporal midpoint distribution. That made it unclear whether cell uncertainty had to be
charged against every temporal envelope. Q6 and Q8 now separate the concerns: temporal
support contains only bridge innovation around cell-center averages, while spatial
subdivision owns within-cell mixing.

**Proposed direction:** Derive one hierarchy-closed cell-flow support relation from the
actual temporal and spatial subdivision operations. Prove that:

- every generated child flow lies inside it;
- forward midpoint enumeration is finite;
- inverse temporal aggregation includes every possible owner flow;
- source and destination batches enumerate every possible coarse flow; and
- the support width remains scale-independent when `T = L^2`.

The direct `K sqrt(DT)` rule should not be normative until this closure proof exists.

The implementation should expose support helpers for the specific searches performed by
the recursive queries, rather than one helper accepting arbitrary combinations of cell
width and duration. A suggested set is:

```ts
possibleMidpointCells(flow, diffusionRate): readonly Cell[]

possibleParentFlows(halfFlow, diffusionRate): readonly Flow[]

possibleFlowDestinations(sourceCell, duration, diffusionRate): readonly Cell[]

possibleFlowSources(destinationCell, duration, diffusionRate): readonly Cell[]

isPossibleFlow(flow, diffusionRate): boolean
```

These are pure model-support helpers, so every result that depends on diffusion receives
the model's `diffusionRate` explicitly. Internal model methods may wrap them and supply
the configured rate, but the underlying functions must not read implicit global model
state. Other support-policy constants, such as the bounded-normal cutoff, may similarly
be explicit arguments or named global constants according to their actual configuration
scope.

Their domains and consumers are:

- `possibleMidpointCells` accepts only an equal-resolution flow that structurally owns a
  temporal subdivision: an epoch flow of width `L_n` and duration `T_n`, or the legal
  half-duration flow of width `L_n` and duration `T_n / 2`. It returns all same-width
  midpoint cells that may receive population. Stages A and C consume it.
- `possibleParentFlows` accepts only an equal-resolution half- or quarter-duration flow
  whose count is defined by temporal aggregation. Its time alignment determines whether
  it is the first or second leg and therefore which endpoint is missing. It returns every
  enclosing parent flow whose time subdivision may contribute. Stages B and D consume
  it. The implementation may split this into first-leg and second-leg inverse helpers if
  that makes the domain clearer.
- `possibleFlowDestinations` accepts a source cell and only a structurally legal duration
  at which that cell's complete outgoing incidence set is required. This includes coarse
  initialization and the pre-spatial quarter-duration flows used by Stages E and G1. It
  returns every same-resolution destination that may have a nonzero flow.
- `possibleFlowSources` is the inverse used for complete incoming incidence sets,
  especially Stage G2. It must agree exactly or conservatively with
  `possibleFlowDestinations`.
- `isPossibleFlow` applies the corresponding structural support rule to one legal flow.
  Queries may use it to return zero without recursive evaluation. It must not reject any
  flow returned by the enumeration helpers.

Invalid scale, duration, or alignment combinations should be rejected rather than given
a speculative support window. The helpers may share lower-level interval arithmetic, but
that arithmetic should not become an unrestricted model API.

Accounting for the required order of operations resolves one earlier concern. Spatial
flow refinement is never repeated in isolation: two temporal refinements reduce the
duration by four before cell width is halved.

Measure flow displacement between cell centers. Let `E_1 L`, `E_1/2 L`, and `E_1/4 L`
be conservative symmetric ordinary-flow envelopes at durations `T`, `T / 2`, and
`T / 4`, respectively, where `T = L^2`. Let `R_1 L` and `R_1/2 L` be conservative
radii containing the actual midpoint-cell centers in the two finite kernels. Temporal
closure requires:

```text
E_1/2 >= E_1 / 2 + R_1
E_1/4 >= E_1/2 / 2 + R_1/2
```

Spatially refining both endpoints can increase center displacement by at most `L / 2`.
The refined cells have width `L / 2`, so epoch-to-epoch closure requires:

```text
E_1 >= 2 E_1/4 + 1
```

Taking the intermediate envelopes at their smallest permitted values gives:

```text
E_1 >= 2 + 2 R_1 + 4 R_1/2
```

Before midpoint positions are assigned to cells, the midpoint kernels contain only
Brownian-bridge innovation. With bounded-normal cutoff `K` and diffusion rate `D`, their
continuous radii `rho` have the exact proportionality:

```text
rho_1   = K sqrt(D) / 2
rho_1/2 = rho_1 / sqrt(2)
```

Assigning the continuous result to a midpoint cell can move its representative center by
up to another `L / 2`. Thus `R_1` and `R_1/2` must be read from the two finite bin tables;
conservatively:

```text
R_1   <= rho_1 + 1 / 2
R_1/2 <= rho_1/2 + 1 / 2
```

Substituting these conservative bounds gives the sufficient continuous inequality:

```text
E_1 >= 5 + (1 + sqrt(2)) K sqrt(D)
```

The exact discrete envelope can be tighter and may be asymmetric at clamped boundary
bins. It must be computed from the actual mid-cell and cell-boundary offset sets using
Q9's integer transformation. For any fixed candidate envelope, the largest compatible
noise scale is the greatest `K sqrt(D)` whose two finite kernel tables satisfy that
closure. The expression above is a conservative closed-form check, not the normative
discrete answer.

The coarse forward kernel must independently fit the same epoch envelope. Under its
current source-uniform approximation, a conservative continuous constraint before exact
integer-bin treatment is:

```text
E_1 >= K sqrt(1 / 12 + D) + 1 / 2
```

For a user-supplied `D`, the model should choose the smallest canonical integer epoch
offset envelope satisfying both the recursive-closure constraint and the coarse-kernel
constraint. Equivalently, while designing or benchmarking a fixed envelope, these same
relations determine the maximum compatible normalized noise scale. Q9's finite bin
tables, rather than independently rounded continuous intervals, remain the normative
source for exact offset sets and boundaries.

**Conclusion:** Define the exact support as a minimal finite fixed point. Let `M_q(d)` be
the midpoint-cell offsets returned by the appropriate parity kernel for a flow offset
`d` and normalized duration `q`. For each epoch offset `d`, each Stage A midpoint
`k in M_1(d)` produces the complete set of quarter-duration offsets:

```text
M_1/2(k)
k - M_1/2(k)
M_1/2(d - k)
(d - k) - M_1/2(d - k)
```

These are respectively the first and second quarters of the first half and the first and
second quarters of the second half. If `h` is any such quarter offset, spatially refining
both endpoints produces next-epoch offsets:

```text
2 h + delta, where delta is -1, 0, or 1
```

Start with the reflection-symmetrized nonzero offset support of the coarse forward
kernel. Repeatedly add every next-epoch offset generated by the transformation above
until the set stops changing. The result is the canonical epoch support. Derive the
half- and quarter-duration support sets during the same enumeration, and use their unions
across all legal temporal alignments and directions.

Termination follows from contraction. If the magnitude of a parent offset is at most
`E`, every transformed offset has magnitude at most:

```text
E / 2 + rho_1 + 2 rho_1/2 + 5 / 2
```

where `rho_1` and `rho_1/2` are the continuous innovation radii above. Thus all iterates
lie inside a finite integer interval once:

```text
E >= 5 + (1 + sqrt(2)) K sqrt(D)
```

or inside the larger finite interval needed to contain the coarse support. Since the
iteration only adds integer offsets, it must stabilize and yields the smallest closed set
containing the coarse kernel.

An executable construction experiment confirmed closure and termination for diffusion
rates `0`, `0.01`, `0.1`, `1`, `4`, `16`, and `100`. The resulting supports were symmetric
contiguous intervals and stabilized in two to seven iterations. Representative radii
were `3` at `D = 0`, `17` at `D = 1`, `31` at `D = 4`, and `147` at `D = 100`. Symmetry
and contiguity are empirical simplifications, not assumptions of the construction; the
implementation should retain the explicit-set definition unless they are separately
proved.

### Q6. What does `diffusionRate` mean in the approximate model?

**Status:** Decided

The design states `Var(X(t + delta) - X(t)) = D delta`, but independently uniform
within-cell endpoints introduce additional mixing not controlled by `D`. At `D = 0`,
source- and destination-side spatial subdivisions can still produce flows between
different child cells.

Also, because `T_n = L_n^2`, displacement relative to cell width is `sqrt(D)` at every
epoch. Refinement does not make the within-cell approximation converge to exact Brownian
motion; its relative error is scale-stationary.

We should decide whether `D` is:

- required to equal the empirical variance rate of the resulting hierarchy;
- only a scale parameter for a Brownian-like kernel; or
- calibrated so a chosen observable has variance rate `D`.

The legal and intended behavior near `D = 0` needs an explicit answer.

**Conclusion:** `diffusionRate = D` controls the Brownian innovation variance, not the
empirical variance of every observable produced by the discretized hierarchy. A forward
increment of duration `T` has innovation variance `D T`. A Brownian-bridge midpoint
conditioned on endpoints has innovation variance `D T / 4`; for the next subdivision of
a duration-`T / 2` flow it has variance `D T / 8`.

Within-cell uncertainty is a separate approximation owned by spatial discretization and
subdivision. It is not repeatedly added to the temporal midpoint innovation. Consequently
the model may have additional displacement variance or mixing not controlled by `D`, and
`D` is not claimed to equal the hierarchy's empirical long-run variance rate.

At `D = 0`, Brownian innovation vanishes, but spatial subdivision and the special
cell-boundary midpoint rule may still distribute population. This is valid intended
behavior for the approximate model rather than a claim of exact zero-diffusion Brownian
motion.

### Q7. What approximation-quality criterion is sufficient?

**Status:** Decided

The design correctly rejects a claim of exact Brownian trajectories, but “better for
larger diffusion” needs a measurable interpretation.

Candidate observables include:

- one-step and multi-step displacement variance;
- displacement distributions across several epoch depths;
- adjacent-interval correlations;
- child-cell crossing and retention probabilities; and
- error relative to an exact or Monte Carlo Brownian reference.

Tests should distinguish errors that persist at every scale from finite-resolution errors
that shrink under refinement.

**Conclusion:** Treat the intended process as a Poisson population undergoing Brownian
motion and compare version 1 against that external reference without tuning version 1 to
improve the measurements retroactively.

For a spatial cell `A` at any time, the reference marginal is:

```text
N(A) ~ Poisson(populationDensity * width(A))
```

For a flow from `A` to `B` over duration `T`, the reference marginal is Poisson with
mean:

```text
populationDensity * width(A)
  * P(X_T in B | X_0 is uniform on A)
```

Calculate that Brownian transition probability by integrating over the complete source
and destination intervals in the continuous reference model, even when the implementation
uses a different cell-center or hierarchical approximation. Measure marginal means,
variances, probability masses, and relevant correlations over several scales.

These are characterization tests, not exact version-1 invariants. Deterministic rounded
coarse populations and flows prevent exact Poisson marginals at the coarse scale, and
conditional binomial or multinomial refinement of a fixed total does not restore exact
Poisson marginals. Record the discrepancy so it can guide a later stochastic
initialization or model version.

Also build a higher-level **tagged-bird tracker** for trajectory measurements and the
GUI. It is a helper, not part of the `Birds` model API. Its only random choice selects one
starting bird uniformly from a populated starting cell. This can be represented by a
single random population rank. Canonical cumulative child counts then map that rank
deterministically through spatial refinements until its cell population is one.

Once a cell has population one, conservation guarantees that exactly one outgoing flow
is populated. The tracker follows that flow without another random choice. Temporal and
spatial flow subdivisions conserve its unit count, so exactly one descendant remains
populated at each refinement. At the destination, the helper may refine further than the
requested output precision until the bird is again isolated from other birds, then
continues through its unique outgoing flow. It may omit these internal disambiguation
steps from the returned trajectory.

The tracker should accept a starting-selection seed, starting cell and time, requested
spatial precision, requested temporal step, and duration or step count. Because the
amount of disambiguating refinement is not known in advance, it should also accept a
work or refinement budget and report an unresolved step rather than pretending that a
non-unique continuation is a sampled model fact.

Trajectory characterization should measure increment mean and variance, Gaussian
increment error, independence of disjoint increments, conditional midpoint or bridge
behavior, multi-step displacement, and how these errors vary with scale and diffusion
rate. The results inform version 2; they do not authorize changing the already specified
version-1 hierarchy merely to improve a score.

---

## Discussion batch 3: Midpoint probabilities and finite distributions

### Q8. How are midpoint-cell probabilities calculated?

**Status:** Decided

The support interval for a Brownian-bridge midpoint is derived, but Stage A and Stage C
also need the actual categorical probabilities.

The temporal midpoint distribution uses the average of the source and destination cell
centers plus a clamped-normal Brownian-bridge innovation. It does not marginalize over
independently uniform latent endpoint positions. Within-cell uncertainty is a separate
source of approximation handled by the spatial stages and should not be injected again
at each temporal subdivision.

The implementation must preserve the decided semantics for:

- normal-CDF integration over the integer rounding bins;
- the treatment of clamped-normal tail mass;
- probability normalization;
- zero-probability category detection;
- numerical tolerances; and
- a reference implementation for tests.

**Conclusion:** For a duration-`T` parent flow, use:

```text
mean     = (center(A) + center(C)) / 2
variance = D T / 4
```

Apply the existing bounded-normal clamping semantics to this bridge innovation once.
There are two canonical kernels according to the alignment of the endpoint-center
average:

- the **mid-cell kernel**, whose mean lies at a cell center; and
- the **cell-boundary kernel**, whose mean lies exactly between two cells.

Both kernels are translation independent and scale independent after normalization by
cell width. The alignment is determined by the parity of the endpoint cell indices.

Add a distribution utility conceptually named `roundedNormal` under
`utils/distributions`. It does not sample. It returns the finite probability-mass table
obtained by clamping a normal variate at the configured tail bounds and assigning the
result to integer bins. At minimum, it accepts integer and half-integer means so the same
utility handles both midpoint alignments. The utility owns and documents:

- clamping rather than conditional truncation, including the tail atoms at the clamp
  points;
- `Math.round` integer-bin boundaries and tie convention;
- normalization of the returned mass table; and
- exclusion or inclusion of zero-mass boundary bins.

For positive variance, `roundedNormal` has the same rounding semantics as JavaScript
`Math.round`: values at `n + 1/2` round to `n + 1`, toward positive infinity. An
unclamped continuous normal assigns zero mass to an exact tie. If a clamped tail atom
lands exactly on a bin boundary, it follows the same positive/right tie rule and may make
the extreme support asymmetric. The cell-boundary kernel's two central bins nevertheless
have equal probability by symmetry whenever variance is positive.

At `D = 0`, define the cell-boundary kernel by its `D -> 0+` limit: it assigns probability
`1 / 2` to each adjacent cell. Do not collapse its atom into the positive/right cell using
the ordinary `Math.round` tie rule. This exception preserves reflection symmetry and
continuity in `D`. The zero-variance mid-cell kernel assigns probability one to its
central cell.

The midpoint-kernel code uses `roundedNormal` or an alignment-specific wrapper with
normalized standard deviation:

```text
sigma / L = sqrt(D (T / L^2) / 4)
```

The resulting kernels depend only on center-versus-boundary alignment, diffusion rate, the
legal normalized duration `T / L^2`, and the global normal cutoff. They are independent
of absolute position and spatial scale.

### Q9. What are the exact half-open support and enumeration rules?

**Status:** Decided

The design uses half-open spatial cells but alternates between closed support intervals
and strict intersection inequalities. A conservative superset is safe, but forward and
inverse helpers must agree on exact aligned index ranges.

We need canonical formulas for:

- the first and final midpoint indices;
- extrema created by the clamped normal;
- cells that touch support only at one boundary;
- inverse endpoint ranges; and
- zero-probability categories retained for conservative enumeration.

An off-by-one exclusion is a conservation bug because it can remove a contributing flow.

**Conclusion:** The finite probability-mass tables produced by `roundedNormal` are the
canonical definition of midpoint support. `possibleMidpointCells` translates exactly the
nonzero integer bins of the appropriate parity-and-duration kernel to the requested
flow. It does not independently reconstruct support from a continuous interval.

`possibleParentFlows` algebraically inverts those same finite bin sets. Forward and
inverse enumeration must therefore agree by construction and should be tested
exhaustively over representative integer indices, both parities, both legal normalized
durations, and boundary bins containing clamped tail mass. Half-open ownership and
boundary touching use the already chosen `Math.round` semantics for positive variance.
The zero-diffusion cell-boundary kernel is the explicit symmetric exception decided in
Q8.

Ordinary-flow support is derived in integer cell indices from closure under one complete
epoch, not from a separately rounded continuous envelope. For a parent flow from cell
index `i` to `j`, let Stage A choose midpoint index `k`, let Stage C choose quarter-point
index `q`, and let spatial subdivision choose child indices:

```text
i' = 2 i + s
q' = 2 q + r
```

where `s, r` are each zero or one. The resulting refined flow offset is:

```text
q' - i' = 2 (q - i) + (r - s)
```

Apply this transformation to the legal parent offsets and the nonzero bins of the two
midpoint kernels to obtain a finite offset set closed under a complete epoch. The
implementation should initially preserve an integer interval or explicit offset set
rather than assume symmetry, because `Math.round` and half-open boundary ownership may
produce asymmetric extrema. The earlier continuous envelope remains useful as a
finiteness argument and conservative cross-check, but it is not the canonical source of
enumerated cells.

### Q10. Which finite-support sampler algorithms are acceptable?

**Status:** Decided

Birds requires arbitrary-probability binomial, multinomial, hypergeometric, and
multivariate hypergeometric samplers. They must be addressed, deterministic, bounded-work,
and valid over the chosen count representation.

The implementation should establish for each sampler:

- exact versus approximate distributional semantics;
- hard feasible output bounds;
- behavior for large counts and extreme probabilities;
- pointwise monotonicity requirements, where meaningful;
- maximum work; and
- throughput at expected model parameters.

Large-count hypergeometric sampling is the most uncertain dependency and should be
prototyped before recursive model work depends on it.

#### Existing implementation survey

`@stdlib` provides both `@stdlib/random-base-hypergeometric` and
`@stdlib/stats-base-dists-hypergeometric-quantile`, but no multivariate-hypergeometric
package was found. The random sampler:

- accepts a custom uniform PRNG;
- uses symmetry reductions followed by the HIN inverse-transformation algorithm;
- consumes one uniform variate;
- walks the scalar support by a probability recurrence; and
- initializes that recurrence with ordinary factorial values.

This makes it easy to adapt to one addressed uniform and potentially useful as an exact
small-parameter baseline. However, factorial overflow and linear support traversal make
it suspect for the large counts expected in Birds. The `@stdlib` quantile implementation
also scans upward from the lower support bound and repeatedly evaluates the CDF, so it is
not an obvious large-count replacement. Both should be tested rather than assumed safe or
fast across the model's parameter range.

No maintained npm package providing a direct multivariate-hypergeometric sampler appeared
in the registry survey. The non-`@stdlib` results were predominantly general statistics
packages or unrelated hypergeometric special functions.

SciPy implements multivariate hypergeometric sampling as a canonical sequence of scalar
hypergeometric draws. For capacities `m[0..k-1]` and remaining sample size `n`, it samples
each of the first `k - 1` categories against the combined remaining capacity, subtracts
the result from `n`, and assigns the final remainder to category `k - 1`. This is exact
provided the scalar sampler is exact and costs `k - 1` scalar draws.

NumPy exposes two multivariate algorithms:

- `marginals`, the same sequential scalar-hypergeometric construction and the default;
  and
- `count`, an explicit without-replacement population sample using temporary storage
  proportional to total population.

The count method can be faster for small capacities but is unsuitable as the general
Birds implementation because its work and memory scale with population. NumPy's scalar
fast path uses an HRUA ratio-of-uniforms rejection algorithm, with a direct method for
small cases. NumPy documents a parameter limit below `10^9` for that floating-point
implementation.

**Provisional implementation direction:**

1. Implement the multivariate distribution as canonical sequential scalar draws, as in
   SciPy and NumPy's `marginals` method.
2. Benchmark the `@stdlib` HIN sampler as the simplest exact baseline on small and
   moderate inputs.
3. Prototype or port an HRUA-style scalar sampler for the large-count path, giving every
   variable rejection draw a deterministic child address under the caller's prefix.
4. Test exact conservation, scalar distributional accuracy, sequential multivariate
   accuracy, extreme margins, and throughput before selecting thresholds.
5. Treat monotonic coupling behavior as a separately measured property. The one-uniform
   inverse sampler may provide useful ordered-parameter couplings; an HRUA rejection path
   should not be assumed to preserve them.

The initial benchmark confirmed the expected split:

- balanced scalar populations 32, 64, and 128 achieved approximately 666,000 to 690,000
  complete addressed samples per second on the development machine;
- an eight-category sequential multivariate sample with total population 128 achieved
  approximately 79,000 samples per second; and
- a direct balanced scalar probe with total population 171 did not terminate after the
  factorial initialization crossed the finite binary64 factorial range.

Therefore `@stdlib/random-base-hypergeometric` is a useful small-count reference and
benchmark baseline but is not viable as the sole Birds sampler. Do not call it outside a
proven-safe small-parameter dispatch region. The next sampler experiment should target
large populations with HRUA or another bounded/rejection method that avoids factorial
initialization.

An addressed H2PE prototype adapted from `rand_distr` now provides that second baseline.
It uses deterministic child addresses for each rejection attempt, avoids ordinary
factorials, and caps rejection at 1,024 attempts. Its exact recurrence or published
squeezing bounds decide acceptance; a direct exact urn sampler handles narrow-support
cases. On the development machine, balanced scalar populations 1,000, 1,000,000, and
1,000,000,000 all achieved approximately 200,000 to 207,000 samples per second. An
eight-category sequential multivariate sample with total population 1,000,000,000
achieved approximately 25,000 samples per second. The essentially flat scaling is the
important result: unlike the `@stdlib` HIN baseline, its routine large-count work does not
grow with the population.

This prototype is H2PE rather than NumPy's HRUA. Use it as the exact large-count sampler
for the initial Birds implementation, after testing more extreme and asymmetric margins
and the narrow-support fallback. The hard attempt cap throws rather than introducing a
biased fallback; successful samples retain the exact distributional semantics.

We do not expect to obtain a dramatically faster exact sampler easily. Leave room for a
future approximate fast path if end-to-end profiling shows that hypergeometric sampling
is materially limiting the simulation or UI. Choose that approximation only after the
initial model and visualization reveal the actual parameter regimes, call frequencies,
and required throughput. At that point its error, feasible-output bounds, deterministic
addressing, bounded work, and dispatch threshold must be stated and tested explicitly.
The initial implementation does not need to anticipate a particular approximation.

For arbitrary-probability binomial sampling, use
`@stdlib/stats-base-dists-binomial-quantile` with one addressed uniform quantile in the
initial implementation. Sequential conditional binomial draws then implement the
multinomial distribution in canonical category order, with the final category receiving
the conserved remainder.

An inverse-CDF benchmark over probabilities `0.001`, `0.01`, `0.1`, `0.5`, `0.9`,
`0.99`, and `0.999` found:

- at `n = 1,000`, approximately 816,000 samples per second in the balanced case and up
  to 1.9 million in the most skewed cases;
- at `n = 1,000,000`, approximately 254,000 balanced samples per second and 644,000 to
  674,000 at the most extreme probabilities; and
- at `n = 1,000,000,000`, approximately 26,000 balanced samples per second, 73,000 to
  78,000 at probabilities `0.1` and `0.9`, and 184,000 to 189,000 at probabilities
  `0.001` and `0.999`.

This is adequate as the exact initial algorithm, particularly because most model counts
may be far below one billion. The balanced large-count case is a plausible future
performance bottleneck. As with hypergeometric sampling, defer an approximate binomial
fast path until end-to-end model profiling establishes actual count and probability
regimes. Preserve the inverse-CDF implementation as a reference and as a useful
monotone coupling for parameter changes where inverse-quantile ordering applies.

The canonical sequential-binomial multinomial construction is not claimed to satisfy
global likelihood-ratio monotonicity when its probability vector changes. After the main
Birds model and initial UI are complete, the project must investigate alternative
multinomial couplings with that property. This is a required research milestone but not
a blocker for version-1 model implementation.

The investigation should begin with exact constructions such as shared Gumbel-max or
exponential-race coupling over categorical trials, then look for more efficient batched
or count-space algorithms. For each candidate, establish whether the global
likelihood-ratio condition actually follows; monotonicity of local conditional binomial
draws is insufficient. Measure work and memory as functions of population and category
count, benchmark representative Birds parameters, and document the interaction with
addressed determinism and conservation. The milestone is complete only when the project
either adopts a practical sampler or explicitly records why the investigated constructions
are unsuitable and retains the sequential sampler.

Monotonicity for multivariate samplers means an addressed coupling across related calls,
not merely monotonicity of their expectations. Require or investigate it only for
parameter changes that define a coherent partial order:

- For a multinomial with a fixed probability vector and canonical category order,
  increasing the total count should make every category count nondecreasing under the
  same address. Conservation then implies that increasing the total by one increments
  exactly one category.
- For a multivariate hypergeometric sample with fixed category capacities, increasing the
  sample size should make every selected category count nondecreasing under the same
  address. This corresponds conceptually to taking longer prefixes of one coupled random
  ordering of the finite population.
- Increasing one hypergeometric category capacity while holding sample size fixed should
  not be required to make every output coordinate nondecreasing; conservation makes that
  impossible. It is reasonable to seek monotonicity of the enlarged category's selected
  count, with no componentwise promise for competing categories.
- For the scalar Stage-H hypergeometric draw, seek the standard stochastic directions:
  the selected intersection count is nondecreasing when either relevant margin increases,
  and nonincreasing when only the ambient population increases while both margins stay
  fixed. Derived contingency-table entries cannot all be monotone simultaneously.

Probability-vector changes likewise cannot generally produce componentwise-monotone
multinomial outputs because probabilities must still sum to one. If needed later, a more
specific mass-transfer or cumulative-order coupling can be defined for a particular
consumer.

A more general criterion for a parameter or probability change is **likelihood-ratio
monotonicity**. Let `P` be the old distribution, `Q` the new distribution, and let the
same address produce `x` under `P` and `y` under `Q`. Require:

```text
Q(y) / P(y) >= Q(x) / P(x)
```

with the usual extended-value handling when an outcome enters or leaves support.
Equivalently, the new sample must not move downward when outcomes are ordered by the
likelihood ratio `Q(z) / P(z)`. This formalizes the idea that changing the distribution
should move the coupled result toward an outcome whose relative probability increased at
least as much.

For a finite categorical distribution this is achievable with a shared exponential-race
or Gumbel-max coupling. If `x` maximizes `log P(i) + G_i` and `y` maximizes
`log Q(i) + G_i` using the same addressed `G_i`, the two maximizing inequalities imply
the likelihood-ratio condition above. The construction costs work proportional to the
number of categories.

The same criterion applies mathematically to any two distributions on a common finite
outcome space, including multinomial count vectors and fixed-sample-size multivariate
hypergeometric vectors. A Gumbel-max construction over complete vectors proves existence
but is generally too expensive. Independent coupled categorical trials also give the
criterion for a multinomial probability change, but cost `O(total count * categories)`
in a direct implementation. We should investigate whether faster sequential binomial or
hypergeometric decompositions preserve the global likelihood-ratio condition; local
monotonicity of each conditional draw does not automatically prove that they do.

When a parameter change alters the outcome space, such as changing hypergeometric sample
size, the likelihood ratio is not directly defined without choosing a common embedding.
The earlier prefix/componentwise coupling remains the clearer criterion for that case.

These are desirable coupling properties, not unconditional requirements. Candidate
algorithms should document which properties they provide and benchmark their cost.
Avoid an `O(population)` latent-item implementation solely to obtain an elegant coupling
when a bounded-work exact or approximate sampler is substantially faster. If performance
and monotonicity conflict, bring the affected property back as a model tradeoff rather
than silently claiming it.

**Conclusion:** Use canonical sequential scalar draws for multivariate hypergeometric
sampling and the addressed H2PE implementation for the initial exact scalar sampler.
Keep the `@stdlib` HIN implementation only as a small-count reference or optional safe
fast path. Use the `@stdlib` inverse CDF for initial exact arbitrary-probability binomial
sampling and canonical sequential binomial draws for multinomial sampling. Monotonic
coupling is not mandatory for the initial implementation, but the required post-UI
multinomial investigation must evaluate global likelihood-ratio monotonicity. Defer
approximate sampling until end-to-end performance measurements demonstrate a need and
provide the parameter regimes against which to evaluate it.

### Q11. What canonical ordering and addressing does each batch use?

**Status:** Decided

Sequential multinomial and multivariate hypergeometric algorithms depend on category
order. Ownership identifies the complete stochastic fact but does not by itself identify
the order of its conditional draws.

Each batch must specify:

- category order, probably increasing canonical spatial index;
- whether zero-capacity or zero-probability categories occupy an index;
- which final category is assigned the remainder;
- addresses for conditional child draws; and
- how inverse or transposed queries retrieve the same owned vector.

Enumeration order, cache order, or caller order must never change a subdivision.

**Current conclusion:** Exact random-address layouts are implementation details owned by
the queries. The design does not prescribe their component sequence or naming scheme.
Addresses must remain collision-free across distinct stochastic facts, and the same fact
must receive the same address regardless of query path. Canonical category ordering and
conditional-draw addressing within sequential batch samplers are resolved below.

**Conclusion:** Use increasing canonical spatial index for every batch:

- increasing midpoint-cell index for temporal multinomials;
- increasing destination-cell index for Stage-G1 outflow batches; and
- increasing source-cell index for Stage-G2 inflow batches.

Exclude zero-probability or zero-capacity categories from conditional random draws. A
semantic batch result may still contain explicit zero entries when its consumer expects
the complete support set. The last active category receives the exact conserved
remainder.

Each conditional scalar draw derives a collision-free address from the batch owner and
the semantic identity of its category, not from a temporary array position. A
variable-work sampler derives private child addresses beneath that conditional draw.
Exact component layouts remain implementation details.

Inverse, transposed, and individual-entry queries retrieve the result owned by the
canonical batch. They never reconstruct or resample the batch in caller, enumeration,
cache, or reverse spatial order.

---

## Discussion batch 4: Entity representation and recursive correctness

### Q12. How are dyadic space and time represented exactly?

**Status:** Decided

The hierarchy permits infinite inward subdivision, but binary64 coordinates and times
have finite exponent and exact-index ranges. Eventually durations underflow or aligned
indices cease to be safe integers.

Options include:

- an exact dyadic type containing an integer numerator and power-of-two exponent; or
- explicit maximum epoch, coordinate, and time ranges for JavaScript numbers.

Because legality and parent selection depend on divisibility, exact dyadic representation
may be more valuable for Birds than for the existing static models.

**Conclusion:** Birds uses raw JavaScript-number world coordinates, lengths, times, and
durations. This is easier to inspect than an integer-coefficient/exponent representation
and is consistent with the prototype's existing spatial models. Hierarchy construction
uses dyadic arithmetic, but the model imposes no explicit maximum epoch or refinement
level beyond the behavior of the numeric primitives.

The implementation should not add overflow, underflow, or distinguishability checks to
every hierarchy calculation. Numeric limits should first be observed experimentally. If
they become a practical problem, restrict the consumer-facing API or a higher layer at
the demonstrated boundary rather than complicating every internal operation in advance.

All fixed hierarchy dimensions, including the coarse spatial length and coarse temporal
duration, must be declared as named global constants rather than repeated as numeric
literals.

### Q13. What are the executable legal-entity predicates?

**Status:** Decided

Section 33 describes legal cells and flows but does not yet provide complete predicates.
The implementation needs pure structural rules for:

- deriving spatial epoch from cell length;
- classifying `T_n`, `T_n/2`, and `T_n/4` durations;
- selecting the unique enclosing temporal interval, including at negative times;
- identifying mixed-resolution flows;
- distinguishing an epoch output from its use as the next epoch's entry flow; and
- finding every canonical parent entity.

Invalid combinations should fail before recursive evaluation.

**Proposed direction:** Implement pure, shared structural utilities over raw-coordinate
entities. They compute facts such as scale, legal duration class, temporal alignment,
construction case, and canonical parent. Return `undefined` when the supplied entity does
not exist in the hierarchy. Query implementations should consume these utilities rather
than duplicate modular arithmetic or stage-classification rules.

These utilities should derive their rules from the named hierarchy constants and the
epoch transformations. Their purpose is structural correctness, not policing eventual
binary64 precision limits.

Derive the classifiers constructively in four steps:

1. Write the algebraic sets of cells, ordinary flows, two-stage flows, and
   mixed-resolution flows introduced at each stage of epoch 0. Refer to named coarse
   spatial and temporal constants, never their current numeric values.
2. Repeat the expansion for epoch 1. Use this to expose alignment aliases and objects
   that are outputs of one epoch but inputs to the next.
3. Generalize the sets using:

   ```text
   L_n = L_0 / 2^n
   T_n = T_0 / 4^n
   ```

4. Invert those formulas into one classifier per entity type. A valid classifier returns
   the unique epoch and construction stage that first defines the entity, together with
   every derived fact needed by its query case. It returns `undefined` for an entity that
   is not in any legal set.

Epoch and stage identifiers are explanatory labels, not an arithmetic API. Query
implementations must not increment, decrement, compare arithmetically, or otherwise
derive geometry from those identifiers. If a query needs a parent entity, enclosing
interval, subdivision owner, alignment class, related duration, or another stage-specific
fact, the classifier should calculate and return that fact directly. During initial
implementation these result interfaces may intentionally contain more derived metadata
than ultimately proves necessary; simplify them only after all query cases work.

The revised design's success criteria must include a follow-up audit of Starfield and
Terrain after this pattern has been validated in Birds. During implementation, each
existing model must either adopt the applicable structural-classifier changes or gain an
explicitly documented decision not to do so, including the reason. This follow-up is not
complete merely because the Birds implementation works.

#### Construction notation

Use named code constants such as:

```ts
BIRDS_COARSE_CELL_LENGTH
BIRDS_COARSE_FLOW_DURATION
```

and denote them mathematically by `L_0` and `T_0`. Define:

```text
L_n = L_0 / 2^n
T_n = T_0 / 4^n
```

For integer indices, write:

```text
C_n(i, r) = cell [i L_n, (i + 1) L_n) at time r T_n

F_n(i, j, r; delta) = ordinary flow from spatial cell i to j,
                       beginning at r delta and lasting delta

G_n(i, k, j, t; delta) = two-stage flow from i through midpoint k to j,
                          beginning at t and lasting total duration delta
```

These symbols describe geometry only. Each set below is additionally restricted to the
offsets returned by the canonical discrete support helpers. Indices outside those sets do
not become stochastic categories merely because they satisfy the alignment formulas.

#### Epoch 0 expansion

At entry, the initialized objects are:

```text
cells: C_0(i, m)                         for i, m in Z
flows: F_0(i, j, m; T_0)                beginning at m T_0
```

where the coarse-flow kernel restricts `j - i` to its finite support.

The epoch stages create:

```text
Stage A:
  G_0(i, k, j, m T_0; T_0)
  midpoint time = (m + 1/2) T_0

Stage B:
  F_0(i, j, r; T_0 / 2)
  start time = r T_0 / 2

Stage C:
  G_0(i, k, j, r T_0 / 2; T_0 / 2)
  midpoint time = (2r + 1) T_0 / 4

Stage D:
  F_0(i, j, s; T_0 / 4)
  start time = s T_0 / 4

Stage E:
  length-L_0 cells at time s T_0 / 4 for s not congruent to 0 modulo 4
  (the congruence-0 cells were initialized at epoch entry)

Stage F:
  length-L_1 cells at every time s T_0 / 4 = s T_1

Stage G1:
  mixed flows L_1 -> L_0 of duration T_1, starting at s T_1

Stage G2:
  mixed flows L_0 -> L_1 of duration T_1, starting at s T_1

Stage H:
  equal-resolution flows L_1 -> L_1 of duration T_1,
  starting at s T_1
```

Stage H flows and Stage F cells are the entry objects for epoch 1. The mixed flows are
intermediate construction objects, not epoch-1 entry flows.

#### Epoch 1 expansion

Epoch 1 has entry cells of length `L_1` at times `m T_1` and entry flows of width `L_1`,
duration `T_1`, and start time `m T_1`. It creates:

```text
Stage A:
  two-stage L_1 flows of duration T_1, starting at m T_1

Stage B:
  ordinary L_1 flows of duration T_1 / 2, starting at r T_1 / 2

Stage C:
  two-stage L_1 flows of duration T_1 / 2, starting at r T_1 / 2

Stage D:
  ordinary L_1 flows of duration T_1 / 4 = T_2, starting at s T_2

Stage E:
  length-L_1 cells at time s T_2 for s not congruent to 0 modulo 4

Stage F:
  length-L_2 cells at every time s T_2

Stage G1:
  mixed flows L_2 -> L_1 of duration T_2, starting at s T_2

Stage G2:
  mixed flows L_1 -> L_2 of duration T_2, starting at s T_2

Stage H:
  equal-resolution flows L_2 -> L_2 of duration T_2,
  starting at s T_2
```

This confirms that an epoch output may be the next epoch's entry object without being
introduced twice: Stage F owns the finer cells at the coarser alignment, and Stage H owns
the finer flows. Epoch 1 merely consumes them.

#### General epoch sets

For every `n >= 0`, epoch `n` consumes length-`L_n` cells at `T_n`-aligned times and
length-`L_n` ordinary flows of duration `T_n`. Its stages create:

```text
A_n: two-stage (L_n, L_n, L_n) flows
     total duration T_n, start in T_n Z

B_n: ordinary L_n -> L_n flows
     duration T_n / 2, start in (T_n / 2) Z

C_n: two-stage (L_n, L_n, L_n) flows
     total duration T_n / 2, start in (T_n / 2) Z

D_n: ordinary L_n -> L_n flows
     duration T_n / 4 = T_(n+1), start in T_(n+1) Z

E_n: length-L_n cells
     time in T_(n+1) Z but not in T_n Z

F_n: length-L_(n+1) cells
     time in T_(n+1) Z

G1_n: mixed L_(n+1) -> L_n flows
      duration T_(n+1), start in T_(n+1) Z

G2_n: mixed L_n -> L_(n+1) flows
      duration T_(n+1), start in T_(n+1) Z

H_n: ordinary L_(n+1) -> L_(n+1) flows
     duration T_(n+1), start in T_(n+1) Z
```

The `E_n` exclusion identifies only newly introduced cells. Cells of length `L_n` at
times in `T_n Z` already exist: for `n = 0` they are coarse initialized cells, and for
`n > 0` they were introduced by `F_(n-1)`.

The classifiers should invert these sets into discriminated construction cases. Each
case should carry its already-constructed parent or owner entities, alignment role,
support-query inputs, and any other data the recursive query requires. The generalized
formulas belong inside the classifiers; callers should never reconstruct them from `n`
or a stage label.

#### Proposed classifier interfaces

The following interfaces are intentionally expansive. Names may change during
implementation, but query code should receive equivalent derived facts.

`classifyCell` first derives the unique `n` for which the cell has length `L_n`. A legal
length-`L_n` cell exists only at a time in `T_(n+1) Z`. Its construction case is:

```ts
type CellConstruction =
  | {
      readonly kind: 'coarse-initialized';
      readonly epoch: 0;
      readonly stage: 'initialization';
      readonly outgoingDuration: number; // T_0
    }
  | {
      readonly kind: 'spatial-child';
      readonly epoch: number;
      readonly stage: 'F';
      readonly parentCell: Cell;
      readonly childIndex: 0 | 1;
      readonly subdivisionOwner: Cell;
    }
  | {
      readonly kind: 'temporally-introduced';
      readonly epoch: number;
      readonly stage: 'E';
      readonly outgoingDuration: number; // T_(n+1)
      readonly outflowSearch: FlowIncidenceSearch;
    };

classifyCell(cell): CellConstruction | undefined;
```

The branches are selected as follows:

- `n = 0` and `time in T_0 Z`: coarse initialized;
- `n > 0` and `time in T_n Z`: introduced by Stage `F_(n-1)`, with the returned parent
  cell of length `L_(n-1)` at the same time; or
- `time in T_(n+1) Z` but not `T_n Z`: introduced by Stage `E_n` and computed from
  outgoing Stage-D flows.

The classifier returns `undefined` for all other lengths, spatial alignments, or times.
The `epoch` in the spatial-child result is the introducing epoch `n - 1`; callers do not
calculate that subtraction.

`classifyFlow` validates endpoint alignment, positive duration, time alignment, and one
of the legal spatial-size combinations. Its proposed result is:

```ts
type FlowConstruction =
  | {
      readonly kind: 'coarse-initialized';
      readonly epoch: 0;
      readonly stage: 'initialization';
      readonly coarseKernelOffset: number;
    }
  | {
      readonly kind: 'temporal-aggregation';
      readonly epoch: number;
      readonly stage: 'B' | 'D';
      readonly leg: 'first' | 'second';
      readonly enclosingStartTime: number;
      readonly enclosingEndTime: number;
      readonly parentDuration: number;
      readonly parentFlowSearch: ParentFlowSearch;
    }
  | {
      readonly kind: 'source-spatial-child';
      readonly epoch: number;
      readonly stage: 'G1';
      readonly sourceParentCell: Cell;
      readonly sourceChildIndex: 0 | 1;
      readonly subdivisionOwner: Cell;
    }
  | {
      readonly kind: 'destination-spatial-child';
      readonly epoch: number;
      readonly stage: 'G2';
      readonly destinationParentCell: Cell;
      readonly destinationChildIndex: 0 | 1;
      readonly subdivisionOwner: Cell;
    }
  | {
      readonly kind: 'fully-spatially-refined';
      readonly epoch: number;
      readonly stage: 'H';
      readonly containingFlow: Flow;
      readonly sourceChildIndex: 0 | 1;
      readonly destinationChildIndex: 0 | 1;
      readonly subdivisionOwner: Flow;
    };

classifyFlow(flow): FlowConstruction | undefined;
```

For equal-resolution endpoints of length `L_n`, the cases are:

- `n = 0`, duration `T_0`, and start in `T_0 Z`: coarse initialized;
- `n > 0`, duration `T_n`, and start in `T_n Z`: Stage `H_(n-1)`, with the containing
  length-`L_(n-1)` flow returned directly;
- duration `T_n / 2` and start in `(T_n / 2) Z`: Stage `B_n`; or
- duration `T_n / 4` and start in `(T_n / 4) Z`: Stage `D_n`.

Both temporal-aggregation cases return the enclosing flow interval of duration twice the
queried duration. Alignment determines whether the queried flow is its first or second
leg. The result also contains all parameters needed by `possibleParentFlows`; callers do
not derive the enclosing interval or missing endpoint themselves.

For mixed-resolution endpoints, only these cases are legal:

```text
L_(n+1) -> L_n, duration T_(n+1), start in T_(n+1) Z: G1_n
L_n -> L_(n+1), duration T_(n+1), start in T_(n+1) Z: G2_n
```

The classifier returns the appropriate coarse parent cell and child index. A fully fine
flow of width `L_(n+1)` and duration `T_(n+1)` is classified as `H_n` and returns its
containing `L_n -> L_n` flow and both child indices.

`classifyTwoStageFlow` has two cases:

```ts
type TwoStageFlowConstruction =
  | {
      readonly kind: 'epoch-time-subdivision';
      readonly epoch: number;
      readonly stage: 'A';
      readonly parentFlow: Flow;
      readonly midpointCell: Cell;
      readonly normalizedDuration: 1;
    }
  | {
      readonly kind: 'half-flow-time-subdivision';
      readonly epoch: number;
      readonly stage: 'C';
      readonly parentFlow: Flow;
      readonly midpointCell: Cell;
      readonly normalizedDuration: 0.5;
    };

classifyTwoStageFlow(flow): TwoStageFlowConstruction | undefined;
```

All three cells must have length `L_n`, the middle time must be the exact arithmetic
midpoint, and the start time must have the parent flow's alignment. Total duration `T_n`
selects Stage A; total duration `T_n / 2` selects Stage C. The returned parent flow is the
owner passed directly to `queryFlowTimeSubdivision`.

Structural classification and stochastic support are related but distinct. These
classifiers establish that an entity has a legal construction shape. The support helpers
then determine whether a legal-shaped flow or midpoint category can have a nonzero count
for the configured diffusion rate. Query code may return zero immediately for a
support-excluded entity, while invalid geometry or alignment produces `undefined` and is
rejected. Enumeration functions return only support-included categories.

Auxiliary subdivision-query classifiers should be thin projections of these results:

- a flow owns a time subdivision only when its classification and duration identify an
  epoch entry flow or a Stage-B half-flow;
- a cell owns a spatial, outflow, or inflow subdivision only at the Stage-F/G alignment;
  and
- a flow owns a full spatial subdivision only when it is the containing Stage-D flow
  returned for a Stage-H child flow.

If those projections need additional geometry, add it to the primary classifier result
instead of deriving it from `epoch` or `stage` in the query method.

**Conclusion:** Adopt the constructive sets and classifier interfaces above. Entities
store raw geometry rather than epoch or stage labels. `classifyCell`, `classifyFlow`, and
`classifyTwoStageFlow` invert that geometry into one unique construction case and return
every parent, owner, alignment, search input, and related entity required by recursive
queries. Queries must not reconstruct those facts by calculating with epoch or stage
numbers.

Return `undefined` for structurally invalid geometry or alignment. A structurally legal
entity excluded by the configured stochastic support remains valid and has count zero;
do not conflate it with a nonexistent hierarchy entity. Negative-time classification
uses Euclidean residues. Numeric precision limits remain outside these predicates unless
experiments identify a practical boundary.

Construction and subdivision-owner capability are independent classifications. Every
legal length-`L_n` cell occurs at a `T_(n+1)`-aligned time and owns its epoch-`n` Stage-F
cell subdivision and Stage-G1/G2 incidence subdivisions, whether the cell itself was
constructed by coarse initialization, Stage `E_n`, or Stage `F_(n-1)`. Owner projections
must return these capabilities directly.

Likewise, an equal-resolution flow may own a temporal subdivision because of its geometry
even when its own construction case is coarse initialization or the preceding epoch's
Stage H. The owner-projection classifiers must not infer capability merely by matching
the entity's construction-stage label.

### Q14. What rank proves that recursive queries are acyclic?

**Status:** Decided

The stage narrative suggests a DAG, but production code is expected to infer stages from
geometry. Testing representative epochs cannot prove that every inverse aggregation edge
points backward.

**Proposed direction:** Define a pure conceptual rank such as

```text
(epoch, stage, entity subtype, temporal alignment class)
```

without storing it in model entities. For every query case, document and test that all
recursive dependencies have strictly earlier rank. This rank can also drive exhaustive
small-epoch dependency-graph tests.

Add a seeded generative ancestry test. Sample legal cells across many refinement scales,
spatial indices, positive and negative times, and temporal alignment classes. Starting
from each cell, traverse the dependencies returned by its classified query case and
assert that:

- every dependency is structurally legal;
- every edge decreases the conceptual dependency rank;
- the traversal is finite;
- every leaf is a coarse initialized cell or coarse initialized flow; and
- changing query/evaluation order does not change the reached stochastic owners.

This must traverse the actual heterogeneous query graph. A Stage-E cell depends on an
aggregation of flows rather than on one direct parent cell, so merely following
`parentCell` links would not test the relevant recursion. Use a fixed test seed and print
the sampled entity on failure so failures reproduce exactly. Random coverage complements,
but does not replace, exhaustive enumeration over a small set of early epochs and
alignment residues.

**Conclusion:** Use the conceptual lexicographic rank:

```text
(introducing epoch, construction order, query role)
```

Construction order within an epoch is:

```text
entry objects < A < B < C < D < E < F < G1/G2 < H
```

The entry objects for epoch `n > 0` are Stage-F and Stage-H outputs from epoch `n - 1`,
so their introducing epoch remains `n - 1`. Coarse deterministic flows are leaves;
coarse initialized cells rank after them because they aggregate those flows.

`G1` and `G2` may share one construction rank because neither depends on the other. Both
depend on Stage-D flows and Stage-F cell populations. Stage H depends on the independently
owned G1 and G2 margins.

The query-role component handles projections within one construction stage. An owned
batch or subdivision is earlier than a query that retrieves one entry from it. Thus:

- a two-stage-flow query depends on its Stage-A or Stage-C time-subdivision batch;
- a spatial-child cell query depends on its Stage-F cell-subdivision batch;
- a mixed-flow query depends on its Stage-G1 or Stage-G2 incidence batch; and
- a fully refined flow query depends on its Stage-H space-subdivision batch.

The batch itself depends only on objects from earlier construction order. Cache lookup is
not a dependency rank and correctness must not rely on a value already having been
evaluated.

This rank is specification and test metadata only. Production queries receive their
dependencies from classifier results and do not compare or perform arithmetic on rank,
epoch, stage, or query-role values. Exhaustive early-epoch graph tests and the seeded
ancestry test must verify that every actual recursive edge decreases this conceptual
rank. Passing those tests will validate, rather than define, the acyclicity claim.

### Q15. Is every stochastic owner unique at alignment boundaries?

**Status:** Decided

Flows at `T_n/4` become entry flows for epoch `n + 1`, and cells at coarse time alignments
also belong to every finer compatible time lattice. The design intends one construction
for each mathematical entity, but the structural rules must ensure that an entity cannot
select two owners depending on which epoch description reaches it.

We should enumerate alignment-boundary examples, including negative times, and verify one
canonical construction for each cell, flow, and subdivision.

**Conclusion:** Determine spatial epoch from cell length before interpreting temporal
alignment. Once `L_n` is fixed, durations belonging to other spatial epochs cannot create
an ownership ambiguity even when their numeric values coincide with `T_n`, `T_n / 2`, or
`T_n / 4`.

Use Euclidean integer residues for time classification. For a length-`L_n` cell, write:

```text
time = q T_(n+1)
r = ((q % 4) + 4) % 4
```

Then ownership is:

- `r = 0`, `n = 0`: coarse initialized cell;
- `r = 0`, `n > 0`: Stage `F_(n-1)` spatial child; and
- `r = 1, 2, or 3`: Stage `E_n` temporally introduced cell.

This handles negative times without relying on JavaScript's signed remainder as though it
were a nonnegative modulo. For example, `q = -1` has Euclidean residue `3`, while `q =
-4` has residue `0`.

For equal-resolution flows of width `L_n`, duration uniquely selects the construction:

- duration `T_n`: coarse initialization when `n = 0`, otherwise Stage `H_(n-1)`;
- duration `T_n / 2`: Stage `B_n`; and
- duration `T_n / 4`: Stage `D_n`.

For a Stage-B or Stage-D temporal aggregation, let `delta` be the queried flow duration
and write its start time as `q delta`. If `q` is even, it is the first leg of the unique
enclosing interval of duration `2 delta`. If `q` is odd, it is the second leg and the
enclosing interval starts at `(q - 1) delta`. This parity rule works unchanged for
negative `q`.

Mixed spatial sizes are unambiguous because orientation is part of the entity:

- `L_(n+1) -> L_n` is owned by the source-cell batch at Stage `G1_n`;
- `L_n -> L_(n+1)` is owned by the destination-cell batch at Stage `G2_n`; and
- `L_(n+1) -> L_(n+1)` with duration `T_(n+1)` is owned by the containing
  `L_n -> L_n` flow's Stage-H subdivision.

Two-stage-flow ownership is similarly unique after width is fixed:

- total duration `T_n` is an entry of its parent flow's Stage-A subdivision; and
- total duration `T_n / 2` is an entry of its parent flow's Stage-C subdivision.

The exact arithmetic midpoint time and the midpoint cell identify the entry. For positive
variance, midpoint-cell boundaries use the `Math.round` semantics decided in Q8. At zero
diffusion, the cell-boundary kernel instead has two distinct categories with probability
`1 / 2` each. Each category is still a different midpoint cell owned by the same unique
parent subdivision; the exception does not duplicate a stochastic fact or owner.

Entity ownership and subdivision ownership must remain distinct in classifier metadata.
For example, a Stage-B flow is constructed by temporal aggregation but then owns a
Stage-C time subdivision. Classifier projections should return these unique capabilities
directly:

```ts
classifyFlowTimeSubdivisionOwner(flow)
classifyCellSubdivisionOwner(cell)
classifyCellOutflowSubdivisionOwner(cell)
classifyCellInflowSubdivisionOwner(cell)
classifyFlowSpaceSubdivisionOwner(flow)
```

Each returns complete owner metadata or `undefined`; query code must not infer ownership
by performing arithmetic on construction-stage labels.

At temporal boundaries, a flow ending at `t` and another flow starting at `t` are
different entities. A cell at `t` has the one owner selected by the residue rule above.
At stochastic support boundaries, only the integer bin selected by the canonical
`roundedNormal` mass table exists as a category. Consequently no alignment or support
boundary assigns the same stochastic fact to two owners.

---

## Discussion batch 5: Public API, tests, and documentation

### Q16. What is the consumer-facing `Birds` API?

**Status:** Decided

The design lists internal stochastic queries but does not define the public model wrapper.
The public API should be motivated by the first visualization and should not expose epochs,
stages, owner subdivisions, or hierarchy addresses.

Possible consumer operations include:

- population tiles over a spatial interval at one time and requested resolution;
- flow aggregates between selected times; or
- bounded spacetime tiles for a heatmap.

The output contract needs a hard size limit analogous to the starfield tile limit.

The tagged-bird tracker decided in Q7 is intentionally not a `Birds` model method. It is
a higher-level helper that may perform an unpredictable amount of refinement and owns
the one random choice used to select its starting bird. The public model API only needs
to expose bounded aggregate queries sufficient for that helper and for visualizations.

**Conclusion:** The initial public API exposes bounded instantaneous population and flow
queries:

```ts
queryPopulation(...)
queryFlow(...)
queryOutflows(...)
queryInflows(...)
```

`queryPopulation` returns an ordered population profile at one explicit sampled time. A
spacetime visualization builds a two-dimensional display from a sequence of such
timestamped profiles. Do not expose a rectangular population query whose entries could
be misread as occupancy throughout a time interval.

`queryFlow` returns the count between one canonical source and destination.
`queryOutflows` and `queryInflows` discover the complete motion envelope internally and
return all nonzero incident flows in canonical spatial order. Consumers never enumerate
the envelope themselves. Every plural query has a hard result limit and reports that the
complete result is too large rather than returning a partial list that appears to violate
conservation.

Supported space/time combinations are model semantics and are exposed through resolution
capabilities rather than a separate utility:

```ts
resolvePopulationResolution({ targetCellWidth, targetTimeStep })
resolveFlowResolution({ targetSourceWidth, targetDestinationWidth, targetDuration })
getNearbyResolutions(request)
```

The resolvers select the coarsest supported resolution at least as fine as every supplied
bound and return the exact world-unit widths, duration, and temporal lattice. A flow
resolver returns `undefined` when no structural flow type satisfies incompatible bounds.
It understands equal-resolution and adjacent mixed-resolution flows without exposing the
corresponding epochs or stages. `getNearbyResolutions` may return a finite set around a
requested scale for UI controls; it does not enumerate the unbounded hierarchy.

Population and flow queries accept only capabilities produced by the same model instance.
The capability values expose world-space facts such as cell widths, time steps, and flow
duration, but no hierarchy addresses, owners, stages, or epoch identifiers. Queries
report actual snapped times and resolutions in their results.

The higher-level tagged-bird helper uses these public methods and requests progressively
finer capabilities when it must disambiguate a conserved unit. It does not call internal
hierarchy queries or reproduce resolution formulas. Exact TypeScript names and result
union shapes may evolve during implementation while preserving these semantics.

### Q17. Which tests can be written only after earlier decisions?

**Status:** Decided

The conservation identities are already well specified. Other planned tests depend on
unresolved model choices:

- support tests require a hierarchy-closed support relation;
- statistical tests require the coarse kernel and midpoint probability definition;
- complexity tests require parameter limits and canonical enumeration;
- overflow tests require a count representation; and
- general acyclicity tests require legal-entity predicates and a dependency rank.

This dependency order should shape the implementation sequence so tests do not silently
codify provisional behavior as model semantics.

**Conclusion:** The prerequisite decisions are now complete. Divide validation into
normative tests that version 1 must pass and non-gating characterization measurements.

Normative tests cover:

- parameter validation;
- entity classification and invalid-geometry rejection;
- unique ownership at positive and negative time alignments;
- finite fixed-point support and agreement of forward and inverse enumeration;
- mid-cell, cell-boundary, and zero-diffusion kernel semantics;
- exact conservation through every subdivision and aggregation stage;
- sampler feasibility bounds and exact batch remainders;
- determinism across query order and cache state;
- decreasing dependency rank and finite heterogeneous ancestry;
- public resolution selection, snapping disclosure, and result-size limits;
- unique tagged-bird continuation after isolation; and
- measured query complexity over epoch depth, density, diffusion, and separation.

After the main model and initial UI, complete the multinomial coupling investigation
specified in Q10. This is part of the Birds project success criteria even though it does
not gate the first working implementation. It must end with either a tested practical
likelihood-ratio-monotone sampler or an explicit documented decision to retain the
sequential sampler after evaluating the alternatives.

Characterization measurements cover cell and flow error relative to the Poisson reference,
Brownian increment and bridge error, correlations between disjoint increments, tagged
trajectories across scales, and sensitivity to density and diffusion rate. These results
inform version 2 and do not gate the version-1 hierarchy.

Per Q12, do not invent speculative overflow tests or numeric limits. Record observed
failure boundaries and add focused regression tests or API restrictions only when an
experiment demonstrates a real boundary. The Starfield and Terrain classifier audit
remains an explicit implementation success criterion.

### Q18. How should the mathematical notation be repaired?

**Status:** Decided

Many formulas currently contain malformed Markdown or LaTeX-like notation, including
`L*n`, `T*{n+1}`, underline-style `====` sequences, and broken matrix row separators.
This makes some scale and recurrence formulas ambiguous.

**Conclusion:** Do not repair the pre-Q&A design document in place. Write a new revised
design proposal from the accepted Q&A conclusions and submit that coherent document for
review. Use whichever Markdown and mathematical notation renders most clearly, keeping
literal forms such as `L_n` and `T_{n+1}` in code spans when mathematical rendering is
unreliable. The old design remains historical input rather than a normative specification.

---

## Completed review summary

All review questions have accepted conclusions. The resulting plan combines deterministic
coarse initialization, bridge-only temporal kernels, a finite fixed-point motion support,
exact spatial conservation, geometry-derived entity classification, unique stochastic
ownership, an acyclic query graph, and bounded resolution-aware public APIs.

The standalone revised proposal is [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md).
This Q&A remains the decision history and contains experiments and alternatives that are
too detailed for the normative proposal.

The required post-implementation work remains part of project completion: characterize
the model against the Poisson–Brownian reference, investigate likelihood-ratio-monotone
multinomial coupling, measure end-to-end performance before adding approximate fast
paths, and audit Starfield and Terrain for applicable structural classifiers.
