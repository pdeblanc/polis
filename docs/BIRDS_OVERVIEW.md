# Birds: random-access population dynamics

Birds is a working Polis model of an anonymous population moving through one spatial
dimension. It answers questions about populations and movement at chosen places, times,
and resolutions without simulating the intervening history. The browser demo presents
these answers as an explorable spacetime field.

Its central achievement is **consistent random access**, not an exact reproduction of
Brownian motion. It conserves integer populations, gives each random subdivision one
canonical definition, and reproduces answers regardless of query order or cache contents.
The completed v1 investigation measures where that construction differs from the intended
Poisson–Brownian reference.

## What the demo shows

Space runs horizontally and future time runs upward. Each displayed cell represents a
population in a half-open spatial interval at one exact time. Brightness represents
population density. Adjacent temporal bands touch for readability; a band does not assert
that its population stayed constant between sampled times.

You can pan, zoom, edit coordinates, change the seed, population density, or diffusion
rate, and share the resulting view through its URL. Zoom is parabolic: changing the
spatial span by a factor of two changes the time span by four. This keeps the view aligned
with the model's space/time scaling. Cached previous-resolution samples briefly fade over
the new view at scale transitions; prefetching spreads some transition work across frames.

The diagnostic overlays expose different aspects of the model:

- incident arrows show the nonzero inflows and outflows of the hovered cell;
- dependency edges show the recursive facts needed to answer a query; and
- clicking a populated cell selects a bird for a budgeted tracked-path overlay.

The controls report exact sampling resolution, hovered interval/time/population, cache
usage, queries per frame, and a draw-time-derived FPS estimate. These are inspection
tools, not a claim that a completed standardized performance suite exists.

## Populations and flows, not stored individuals

A **cell** is a spatial interval `[x, x + L)` at time `t`. Its population is a
nonnegative integer. A **flow** joins a source cell to a destination cell at a later time;
its count tells how many birds make that transition. A two-stage flow additionally fixes
an intermediate cell.

These facts obey two kinds of conservation:

```text
population(parent cell) = population(left child) + population(right child)

population(cell) = sum(outgoing flow counts) = sum(incoming flow counts)
```

The model stores no persistent bird identifier or incoming-to-outgoing matching through
a multi-bird cell. Counts are the model facts. A consumer can nevertheless identify a
single exchangeable unit when sufficiently narrow cells contain exactly one bird.

## The recursive construction

### Fixed coarse data

The coarse spatial width is `L₀ = 16` and coarse duration is `T₀ = 256`. Coarse cells
and flows exist at every integer translate in space and time, not inside a finite root
window. Finer entry resolutions have

```text
Lₙ = L₀ / 2ⁿ
Tₙ = T₀ / 4ⁿ = Lₙ²
```

For requested density `ρ`, every coarse cell contains `Math.round(ρ L₀)` birds. This
deterministic initialization makes equal coarse totals easy to conserve, but is not a
Poisson population. Very low requested densities can round to an empty model.

Coarse destination offsets have a rounded-normal target with normalized variance
`1/12 + D`, where `D` is the diffusion rate. The `1/12` term represents the variance of
a uniform starting position within a unit-width cell. A deterministic integer allocation
minimizes deviation from those probabilities subject to reflection symmetry and the
fixed total. Translating that allocation gives every coarse cell equal inflow and outflow.

### Refine time, then space

An epoch turns width-`L`, duration-`T` entry data into width-`L/2`, duration-`T/4` entry
data. Its stages can be understood as this dependency sequence:

```text
width L, duration T
  → split through midpoint cells; aggregate half-duration flows       A–B
  → split again; aggregate quarter-duration flows                    C–D
  → derive populations at the newly available times                   E
  → split each population into left/right children                    F
  → allocate outgoing and incoming flows to those children          G1/G2
  → reconcile both endpoint allocations into fine-to-fine flows        H
width L/2, duration T/4 → next epoch
```

This is a definition of dependencies, not an instruction to generate a whole epoch.
A query evaluates only the finite ancestor facts it needs, eventually reaching coarse
data. Repeated dependencies can be reused from caches.

Temporal splitting uses a multinomial over possible midpoint cells. Its normal midpoint
innovation has variance `DT/4`, the Brownian-bridge value for fixed endpoints. Endpoint
cells are represented by their centers; no extra latent endpoint variance is added here.
There are four reusable midpoint tables: two endpoint-center alignments, each at normalized
duration `T/L²` equal to `1` or `1/2`.

Normal tails are clamped at six standard deviations, and the resulting mass is assigned
to integer bins using `Math.round` semantics. At zero diffusion, a centered midpoint is
deterministic; a midpoint exactly between cells splits its probability equally between
the neighboring cells. Thus zero diffusion does not make all refined movement disappear.

Spatial splitting first draws a binomial left-child population. It then must allocate
the parent's flows consistently with that population. Independently splitting each flow
would generally give the wrong child total. Instead, multivariate hypergeometric batches
allocate the source-child and destination-child totals across their incident flows.

For each original flow, the final reconciliation is a `2 × 2` table:

| | Destination left | Destination right | Row total |
| --- | --- | --- | --- |
| Source left | `x` | `r₀ − x` | `r₀` |
| Source right | `c₀ − x` | `N − r₀ − c₀ + x` | `r₁` |
| Column total | `c₀` | `c₁` | `N` |

A hypergeometric draw selects feasible `x`; all other entries follow by subtraction.
Both endpoint margins are preserved exactly. The draw treats the two endpoint child
memberships as exchangeable given those margins. That approximation is important to the
model's statistical behavior: it adds within-cell mixing rather than maintaining hidden
continuous paths.

### Finite support and canonical ownership

A simple Brownian displacement cutoff is not enough: splitting endpoints and time can
produce offsets outside that initial envelope. Birds computes an offset set closed under
the full refinement construction. The closure is finite for fixed diffusion within the
numeric/resource domain, and shared forward/inverse helpers enumerate the same possible
dependencies. A structurally legal flow outside this support has count zero.

Each stochastic batch has one owner: a temporal parent flow, a spatial parent cell, an
incidence cell, or a containing reconciliation flow. Asking for an entry retrieves that
owner's result; it does not redraw a split for the caller. Typed addresses and a string
seed feed the shared addressed RNG, so navigation and evaluation order cannot advance
or perturb a global random stream.

## Architecture and public interface

`BirdsEngine` owns the stochastic recursion, batch caches, and diagnostics. Geometry
classifiers derive construction cases and dependencies from raw world coordinates.
The engine consumes those facts rather than calculating parents by manipulating stage
or epoch labels. Its optional dependency observer supports rank checks and visualization.

The public `Birds` wrapper exposes synchronous world-coordinate operations:

- resolution selection reports exact supported widths, durations, and time lattices;
- `queryPopulation` returns a spatial profile at a disclosed sampled time;
- `queryFlow`, `queryOutflows`, and `queryInflows` expose canonical flows without making
  consumers enumerate the motion envelope;
- cell refinement/coarsening and incident-flow capabilities support exact continuation;
- `queryCachedPopulation` reads available cached populations without generating missing
  ones; and
- cache controls and statistics support inspection and benchmarking.

Resolution capabilities belong to their model instance. Exact flow endpoints are not
independently snapped. Plural population and flow queries have 65,536-record ceilings
and return explicit size-limit results rather than misleading partial totals. Those
limits bound output, not execution time.

Distribution utilities provide exact-quantile arbitrary-probability binomials, sequential
multinomials, and addressed hypergeometric sampling with bounded rejection attempts.
The Poisson-race multinomial experiments have not replaced the production sampler.
Birds caches use `quick-lru`; eviction changes work, not answers. React/Canvas rendering,
prefetch coordination, and tracking stay outside the stochastic engine.

## Following a bird

The `Sighting` helper is immutable. Its public cell and resolution describe the requested
view, while a private stack of nested cells and populations locates a singleton inside
that cell. Selection makes one random rank choice; subsequent movement follows existing
counts, with no new choice among outflows from a singleton.

`next()`, `prev()`, and `rescale()` return new sightings. If a proposed destination holds
multiple birds, the helper first tries narrowing only that endpoint, preserving the
longer time interval. If that fails, it refines the source and tries shorter segments.
Once possible, it coarsens through singleton parents again. Internal committed movement
uses singleton cells even when the displayed cell contains several birds.

A query/refinement budget or loss of distinguishable numeric coordinates can stop the
search explicitly. The viewer retains a partial path. Such failure does not prove a
collision is mathematically unresolvable. Anonymous finite-resolution observations can
fail to isolate a continuing identity even in the labeled Brownian reference experiment.

## What verification and analysis establish

Tests check conservation through all stages, ownership, finite support, structural
classification, decreasing dependency ranks, query-order/cache invariance, public
capabilities and limits, and tracker behavior. Multi-step tracker regressions exercise
collision retries and identity-preserving refinement/coarsening in both time directions.
These are finite checks within JavaScript's useful numeric domain, not proofs for every
parameter or coordinate. There is no arbitrary maximum epoch, but binary64 precision,
safe integer counts, and practical resource limits still matter.

The statistical reference is a spatial Poisson population with independent Brownian
motion: a width-`L` cell has target mean `ρL`, and a flow's target mean integrates Brownian
transition probability across both endpoint intervals. Measurements found:

- fixed coarse totals and location-dependent fine-cell biases, with reduced measured
  local bias at higher diffusion in the tested cases;
- excess displacement associated with spatial exchangeability, including mixing at
  zero diffusion;
- differences between endpoint-center midpoint kernels and interval-conditioned
  Brownian bridges;
- substantial effects of trajectory selection and collision-free screening; and
- repeated meetings and tracking failures in the Brownian reference as well as Birds.

Profiling found substantial cost outside distributions, motivating improvements to
classifiers, cache operations, keys, and viewport scheduling. A deterministic finite-epoch
population bound was derived, but it is too loose to settle a materialization policy.
The experimental shared Poisson race supplies a tested complete-outcome likelihood-ratio
coupling, but remains slower than the production sequential multinomial on captured Birds
workloads. Stronger sampled-ratio monotonicity is a separate unresolved question.

The v1 prototype and investigation milestone is complete. Statistical fidelity has not
been certified, and the full reusable evaluation campaign has not run. Standard-A
collection and saved-data bootstrap/TV calibration are implemented; the broader batches
and performance matrix remain outstanding. Detailed findings and their sample limitations
are in the [analysis summary](./BIRDS_ANALYSIS_SUMMARY.md).

## Changes and clarifications relative to the design proposal

The [canonical proposal](./BIRDS_DESIGN_PROPOSAL.md) has itself been updated to reflect
some decisions. This comparison describes substantive implementation choices and explicit
scope decisions, not every historical edit. The core mathematics—fixed coarse data,
four midpoint kernels, support closure, and A–H conservation—was retained. Statistical
anomalies did not trigger an undocumented replacement model.

- **Cache policy:** strict LRU was dropped after profiling in favor of bounded
  approximate-LRU caches. Internal capacity overrides support eviction tests and profiling;
  stochastic semantics remain independent of both policy and contents.
- **Public API:** the provisional capability/query names evolved into concrete population,
  refinement/coarsening, and incident-flow methods driven by the viewer and tracker.
  Cached-only population reads support fades. These extend the API without exposing
  stages or transferring motion-envelope calculations to consumers.
- **Tracker representation:** the helper keeps nested population evidence rather than a
  persistent rank or identity. The one random rank is used only for starting selection.
  Explicit budget/numeric failures qualify the proposal's “search until singleton” wording;
  completion is not guaranteed. A regression also fixed rescaling that could revisit a
  cached child indefinitely; this was an implementation bug, not a mathematical change.
- **Reference comparison:** the quotient-space experiment implements the same anonymous
  tracking strategy over reference counts, rather than passing one shared tracker class
  through a common adapter. Hidden labels score results only. Its cohorts support a
  qualitative comparison of failure mechanisms, not matched failure-rate estimates.
- **Verification scope:** existing profiling and complexity guardrails were accepted for
  v1, with the complete cross-query resource matrix explicitly deferred. Population-bound
  and monotonicity investigations were completed without requiring a materialization
  policy or sampler adoption. Starfield/Terrain classifier follow-ups closed with explicit
  no-refactor decisions. None of these decisions claims measurements that were not taken.

The [acceptance audit](./BIRDS_ACCEPTANCE_AUDIT.md) maps these conclusions to implementation
and test evidence, including the approved deferrals.

## Reading further

For the exact recurrence and normative invariants, use the
[design proposal](./BIRDS_DESIGN_PROPOSAL.md). For internal choices and optimization history,
use the [implementation notes](./BIRDS_IMPLEMENTATION_NOTES.md). For experimental methods,
results, and reproduction commands, use the [analysis record](./BIRDS_ANALYSIS.md).
The [evaluation protocol](./BIRDS_EVALUATION.md) specifies model-independent measurements;
the [runbook](./BIRDS_EVALUATION_RUNBOOK.md) explains the executable subset and preserved
baseline. [PROJECT.md](./PROJECT.md) places Birds alongside the other Polis models.
