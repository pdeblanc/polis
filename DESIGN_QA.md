# Polis Design Q&A and Decision Log

This document records questions, feedback, and decisions that arise while reviewing
[`DESIGN.md`](./DESIGN.md). It is a working companion to the design rather than a
replacement for it.

We will discuss a small number of issues at a time. Once an issue is resolved, its
conclusion should be recorded here and the relevant part of `DESIGN.md` should
eventually be updated. Decisions that remain experimental should say so explicitly.

## Status key

- **Open** — needs discussion.
- **Proposed** — a concrete answer has been suggested but not accepted.
- **Decided** — a conclusion has been accepted.
- **Deferred** — intentionally postponed, with a stated reason or trigger for revisiting it.
- **Validated** — a previously uncertain conclusion has been supported by an experiment or implementation.

## Decision principles

When resolving these questions, prefer:

- a precise mathematical model before an implementation-specific API;
- deterministic and query-order-independent behavior;
- explicit approximation or truncation rather than implicit deviation from the model;
- output-sensitive complexity claims;
- small, model-specific interfaces until genuine shared abstractions emerge;
- experiments where the relevant complexity or behavior is not yet understood.

---

## Discussion batch 1: Starfield foundations

### Q1. What hierarchy supports an unbounded Poisson starfield?

**Status:** Open

`DESIGN.md` describes a coarse box whose population is subdivided among its children,
while also describing an extremely large or unbounded plane. An unbounded plane cannot
have a single finite root box with a finite Poisson population.

Questions to resolve:

- Is the plane tiled by independent, fixed-size root cells with integer coordinates?
- If so, what is the root-cell size in world units?
- Are boxes coarser than a root cell supported directly, or only by aggregating roots?
- Is statistical translation invariance sufficient even though the hierarchy is anchored
  to an integer grid?

**Proposed direction:** Tile the plane with independently populated integer-addressed
base cells, then refine downward within each cell. Arbitrary larger regions aggregate
the required base cells rather than depending on a global root.

**Conclusion:** _Pending discussion._

### Q2. What constitutes the stable identity of a star?

**Status:** Open

Count consistency does not by itself specify which individual stars are observed when
the same area is reached through different refinement or query strategies.

Questions to resolve:

- Does each star have an identity such as `(baseCell, starIndex)`?
- Are exact positions assigned immediately from that identity, with counts derived by
  classifying positions?
- Or are identities deterministically partitioned during hierarchical multinomial splits?
- What stability is promised when density or another model parameter changes?

**Conclusion:** _Pending discussion._

### Q3. What does `points(box, resolution)` return?

**Status:** Open

The term `resolution` could mean positional precision, hierarchy depth, world-space
tolerance, or projected screen-space tolerance. An exact query may also have an
arbitrarily large output.

Questions to resolve:

- Does the result contain exact points, aggregate cells, or both?
- Is resolution expressed in world units or supplied as a hierarchy level?
- What refinement/nesting property must hold between coarse and fine queries?
- How are result-size or work budgets represented?
- What does it mean to avoid generating points outside the requested region?

**Conclusion:** _Pending discussion._

---

## Discussion batch 2: Terrain model definition

### Q4. What is the exact random-access diamond-square dependency graph?

**Status:** Open

The conceptual recurrence in `DESIGN.md` does not yet define a complete algorithm.

Questions to resolve:

- What are the coarsest vertices or boundary conditions?
- How are square and diamond phases represented?
- At which unique level is each vertex introduced?
- What are the exact parent coordinates for every vertex type?
- How are negative coordinates canonicalized?
- Why is the dependency graph acyclic?
- How do independently requested neighboring regions share boundary values?

**Required design artifact:** A worked coordinate example across at least two refinement
levels, including negative coordinates and a boundary shared by neighboring query tiles.

**Conclusion:** _Pending discussion._

### Q5. Is literal diamond-square the right terrain requirement?

**Status:** Open

An unbounded literal diamond-square construction may require awkward coarse boundary
conditions or an infinite regress toward coarser levels. A different multiscale random
field might preserve the intended Polis properties more cleanly.

Questions to resolve:

- Is studying random-access diamond-square itself a project goal?
- Or is the actual goal any correlated, continuous, hierarchical random field?
- Would comparing two constructions be more informative than committing to one?

**Conclusion:** _Pending discussion._

### Q6. What is the public terrain query API?

**Status:** Open

The design mentions terrain vertices, arbitrary visible regions, and raster rendering,
but does not define the model operation used by the renderer.

Questions to resolve:

- Can callers query only canonical vertices, or arbitrary world coordinates too?
- Does the model provide interpolation?
- Is the main rendering query a regular grid or a hierarchy-aligned tile?
- Does one batch query share a per-query dependency cache?

**Conclusion:** _Pending discussion._

---

## Discussion batch 3: Addressed randomness and distributions

### Q7. What is the canonical random-address encoding?

**Status:** Open

Reproducibility requires more than a conceptual tuple. The encoded identity of each
random variable must be unambiguous and versioned.

Questions to resolve:

- Which typed address components are supported?
- How are signed integers, lengths, strings, and domain tags encoded?
- How are seed strings converted to keys?
- Which hash or pseudorandom-function primitive is used?
- Is an RNG/model version included in the domain?

**Conclusion:** _Pending discussion._

### Q8. What reproducibility guarantee does the project make?

**Status:** Open

Possible guarantees range from deterministic behavior within one build to permanent
cross-browser compatibility for all generated values.

Questions to resolve:

- Must raw RNG vectors remain stable forever?
- Must integer distribution outputs remain stable across algorithm upgrades?
- Must floating-point terrain values be bit-identical across browser engines?
- How are intentional compatibility-breaking changes versioned?

**Conclusion:** _Pending discussion._

### Q9. How should distribution parameters affect coupling and identity?

**Status:** Open

The design proposes that parameters generally reinterpret the same addressed quantile.
This is useful in some cases but may be surprising or underspecified in others.

Questions to resolve:

- Which parameter changes are intentionally coupled?
- Is the latent addressed randomness separate from its distribution transform?
- How do samplers with rejection or a variable number of random draws derive attempts?
- Does changing distribution implementation preserve compatibility?

**Conclusion:** _Pending discussion._

### Q10. Where is truncation allowed?

**Status:** Open

A truncated Poisson distribution does not produce the exact Poisson point process
claimed by the starfield model. Bounded terrain displacement, on the other hand, can be
part of the terrain's explicit definition.

Questions to resolve:

- Must starfield counts use an exact Poisson distribution?
- Which model distributions are deliberately bounded?
- Is there any genuine need for a global truncation policy?
- How are model truncation, numerical approximation, and operational safety factors
  documented separately?

**Conclusion:** _Pending discussion._

---

## Discussion batch 4: Coordinates and scale

### Q11. What coordinate range does the starter project support?

**Status:** Open

JavaScript `number` viewport centers eventually lose local precision far from the
origin, even if model addresses use exact integers.

Questions to resolve:

- Is a documented safe numeric range acceptable for the starter project?
- Should the viewport instead store an exact cell origin plus a floating local offset?
- When, if ever, are `bigint` coordinates exposed through the UI?

**Conclusion:** _Pending discussion._

### Q12. What are the coordinate and hierarchy conventions?

**Status:** Open

The following terms need one consistent definition:

- world unit and base-cell size;
- hierarchy-level numbering and refinement direction;
- half-open or closed region boundaries;
- treatment of points exactly on boundaries;
- zoom units, such as pixels per world unit;
- relationship between viewport zoom and model resolution.

**Conclusion:** _Pending discussion._

---

## Discussion batch 5: Complexity and execution

### Q13. How should complexity goals account for output size?

**Status:** Open

No query returning a million terrain samples or stars can take time polynomial only in
the logarithm of resolution. The complexity goal should separate random-access overhead
from the amount of requested output.

Questions to resolve:

- Is the goal polylogarithmic navigation/dependency overhead plus output-sensitive work?
- Which variables are included in each benchmark?
- Should large-coordinate bit complexity be measured or merely documented?

**Conclusion:** _Pending discussion._

### Q14. What is the unit of instrumentation?

**Status:** Open

“Current render” is not a reliable model-query boundary because React may restart,
batch, or cancel rendering work.

Questions to resolve:

- Does each explicit model call create a query context and return its own statistics?
- How are batch queries distinguished from individual sample queries?
- Are cold-cache and warm-cache measurements both exposed?

**Conclusion:** _Pending discussion._

### Q15. How does the browser avoid obsolete or blocking work?

**Status:** Open

Panning and zooming can invalidate expensive work before it finishes.

Questions to resolve:

- Are model queries synchronous initially, or designed to support cancellation?
- Is work bounded per frame or query?
- When should a Web Worker be introduced?
- How does the UI reject a stale result after the viewport changes?

**Conclusion:** _Pending discussion._

---

## Discussion batch 6: Scope, testing, and ambition

### Q16. Which implementation choices are requirements versus defaults?

**Status:** Open

React, Vite, Canvas, React Router, the proposed directory tree, and a shared viewport are
reasonable defaults. Not all need to be architectural commitments.

Questions to resolve:

- Which choices are intentionally fixed for this project?
- Which may change during implementation without revising the design?
- Should the shared viewport emerge from the first demo instead of preceding it?
- Which distribution utilities are actually required for the first two models?

**Conclusion:** _Pending discussion._

### Q17. What belongs in the initial testing contract?

**Status:** Open

Questions to resolve:

- Which small set of RNG compatibility vectors is permanent?
- Which behavior is tested through invariants or property-based tests instead?
- How are negative coordinates and region boundaries covered?
- How are deterministic statistical tests isolated from correctness tests?

**Conclusion:** _Pending discussion._

### Q18. Should reproducible and inspectable views be more ambitious?

**Status:** Open

Potential additions that closely support the project's purpose include:

- seed, location, and zoom encoded in the URL;
- hierarchy and terrain-dependency overlays in the first milestone;
- a “clear caches and rerun” comparison control;
- canonical query-result hashes;
- a headless benchmark entry point;
- comparison between alternative terrain constructions.

Questions to resolve:

- Which of these belong in the starter milestone?
- Which should remain explicit future work?

**Conclusion:** _Pending discussion._

---

## Accepted decisions summary

No decisions recorded yet.

## Deferred questions summary

No questions deferred yet.
