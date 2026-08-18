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

**Status:** Open

The design exposes `populationDensity` and `diffusionRate`, but does not define their
legal numeric ranges. A single temporal subdivision enumerates approximately
`O(K sqrt(D))` midpoint cells, so an unrestricted finite `D` can request enormous work.
That work is not polynomial in the encoded bit length of `D`.

The specification should decide:

- whether zero diffusion is legal;
- whether a positive minimum diffusion is required for the approximation;
- a maximum diffusion rate or per-query category limit;
- the legal density range; and
- whether parameters are arbitrary numbers or a smaller canonical configuration type.

**Conclusion:** Pending.

### Q2. How is the deterministic coarse-flow kernel defined?

**Status:** Open

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

**Conclusion:** Pending.

### Q3. What is the exact spatial and temporal root domain?

**Status:** Open

The design says outward and unbounded-time expansion are deferred, but also appears to
initialize coarse flows for every aligned spatial cell and every start time divisible by
256. That already defines an unbounded spatial and temporal domain at fixed coarse
resolution.

We should clarify whether:

- coarse roots exist across the entire infinite space-time lattice; or
- the first model has a finite spatial or temporal root window with explicit boundaries.

If roots exist everywhere, the deferred feature is coarser-scale expansion rather than
unbounded temporal extent.

**Conclusion:** Pending.

### Q4. What exact type represents population counts?

**Status:** Open

Birds requires exact conservation across sums, binomial splits, multivariate
hypergeometric batches, and contingency-table reconciliation. JavaScript `number` stops
representing every integer exactly above `Number.MAX_SAFE_INTEGER`.

The model needs one of:

- a supported parameter and query domain proven to keep every count safe;
- explicit overflow detection and rejection; or
- a `bigint` count representation with compatible samplers.

This decision affects every distribution API and should precede their implementation.

**Conclusion:** Pending.

---

## Discussion batch 2: Brownian support and approximation

### Q5. What ordinary-flow support rule is closed under the hierarchy?

**Status:** Proposed

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

There is a stronger modeling issue: a nonzero cell flow treats endpoints as independently
uniform over the complete source and destination cells, including endpoint pairs that may
not satisfy a direct pointwise increment envelope.

**Proposed direction:** Derive one hierarchy-closed cell-flow support relation from the
actual temporal and spatial subdivision operations. Prove that:

- every generated child flow lies inside it;
- forward midpoint enumeration is finite;
- inverse temporal aggregation includes every possible owner flow;
- source and destination batches enumerate every possible coarse flow; and
- the support width remains scale-independent when `T = L^2`.

The direct `K sqrt(DT)` rule should not be normative until this closure proof exists.

**Conclusion:** Pending.

### Q6. What does `diffusionRate` mean in the approximate model?

**Status:** Open

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

**Conclusion:** Pending.

### Q7. What approximation-quality criterion is sufficient?

**Status:** Open

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

**Conclusion:** Pending.

---

## Discussion batch 3: Midpoint probabilities and finite distributions

### Q8. How are midpoint-cell probabilities calculated?

**Status:** Open

The support interval for a Brownian-bridge midpoint is derived, but Stage A and Stage C
also need the actual categorical probabilities.

Under the stated approximation, the midpoint distribution combines:

- the average of two independent cell-uniform endpoints, which has a triangular density;
  and
- a clamped-normal bridge innovation.

The specification should define:

- exact integration, numerical quadrature, or another approximation;
- the treatment of clamped-normal tail mass;
- probability normalization;
- zero-probability category detection;
- numerical tolerances; and
- a reference implementation for tests.

**Conclusion:** Pending.

### Q9. What are the exact half-open support and enumeration rules?

**Status:** Open

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

**Conclusion:** Pending.

### Q10. Which finite-support sampler algorithms are acceptable?

**Status:** Open

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

**Conclusion:** Pending.

### Q11. What canonical ordering and addressing does each batch use?

**Status:** Open

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

**Conclusion:** Pending.

---

## Discussion batch 4: Entity representation and recursive correctness

### Q12. How are dyadic space and time represented exactly?

**Status:** Open

The hierarchy permits infinite inward subdivision, but binary64 coordinates and times
have finite exponent and exact-index ranges. Eventually durations underflow or aligned
indices cease to be safe integers.

Options include:

- an exact dyadic type containing an integer numerator and power-of-two exponent; or
- explicit maximum epoch, coordinate, and time ranges for JavaScript numbers.

Because legality and parent selection depend on divisibility, exact dyadic representation
may be more valuable for Birds than for the existing static models.

**Conclusion:** Pending.

### Q13. What are the executable legal-entity predicates?

**Status:** Open

Section 33 describes legal cells and flows but does not yet provide complete predicates.
The implementation needs pure structural rules for:

- deriving spatial epoch from cell length;
- classifying `T_n`, `T_n/2`, and `T_n/4` durations;
- selecting the unique enclosing temporal interval, including at negative times;
- identifying mixed-resolution flows;
- distinguishing an epoch output from its use as the next epoch's entry flow; and
- finding every canonical parent entity.

Invalid combinations should fail before recursive evaluation.

**Conclusion:** Pending.

### Q14. What rank proves that recursive queries are acyclic?

**Status:** Proposed

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

**Conclusion:** Pending.

### Q15. Is every stochastic owner unique at alignment boundaries?

**Status:** Open

Flows at `T_n/4` become entry flows for epoch `n + 1`, and cells at coarse time alignments
also belong to every finer compatible time lattice. The design intends one construction
for each mathematical entity, but the structural rules must ensure that an entity cannot
select two owners depending on which epoch description reaches it.

We should enumerate alignment-boundary examples, including negative times, and verify one
canonical construction for each cell, flow, and subdivision.

**Conclusion:** Pending.

---

## Discussion batch 5: Public API, tests, and documentation

### Q16. What is the consumer-facing `Birds` API?

**Status:** Open

The design lists internal stochastic queries but does not define the public model wrapper.
The public API should be motivated by the first visualization and should not expose epochs,
stages, owner subdivisions, or hierarchy addresses.

Possible consumer operations include:

- population tiles over a spatial interval at one time and requested resolution;
- flow aggregates between selected times; or
- bounded spacetime tiles for a heatmap.

The output contract needs a hard size limit analogous to the starfield tile limit.

**Conclusion:** Pending.

### Q17. Which tests can be written only after earlier decisions?

**Status:** Open

The conservation identities are already well specified. Other planned tests depend on
unresolved model choices:

- support tests require a hierarchy-closed support relation;
- statistical tests require the coarse kernel and midpoint probability definition;
- complexity tests require parameter limits and canonical enumeration;
- overflow tests require a count representation; and
- general acyclicity tests require legal-entity predicates and a dependency rank.

This dependency order should shape the implementation sequence so tests do not silently
codify provisional behavior as model semantics.

**Conclusion:** Pending.

### Q18. How should the mathematical notation be repaired?

**Status:** Proposed

Many formulas currently contain malformed Markdown or LaTeX-like notation, including
`L*n`, `T*{n+1}`, underline-style `====` sequences, and broken matrix row separators.
This makes some scale and recurrence formulas ambiguous.

**Proposed direction:** Normalize the document to one supported math notation before it
becomes normative. At minimum, preserve literal subscripts such as `L_n` and `T_{n+1}` in
plain code spans where the renderer cannot reliably display mathematical markup.

**Conclusion:** Pending.

---

## Initial review summary

The exact conservation construction in the spatial stages is the strongest part of the
proposal. In particular, joint source and destination hypergeometric batches followed by
per-flow contingency-table reconciliation provide compatible row sums, column sums, and
parent totals.

The largest correctness risk is the ordinary-flow support rule: the direct bounded
Brownian increment envelope is not evidently preserved by the model's own temporal and
spatial refinement operations. The largest implementation blockers are the unspecified
coarse kernel, count and dyadic representations, midpoint probability calculation, and
finite-support sampler algorithms.

Suggested discussion order:

1. parameter and numeric domains;
2. coarse initialization;
3. hierarchy-closed support;
4. midpoint probabilities and boundary enumeration;
5. canonical batch ordering and samplers;
6. legal-entity predicates and acyclicity;
7. public API and experiments.
