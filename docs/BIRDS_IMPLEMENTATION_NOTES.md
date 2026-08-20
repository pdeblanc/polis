# Birds implementation notes

> **Status: Active implementation record.**
>
> [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md) remains the canonical model
> specification. This document records implementation discoveries, concrete internal
> choices, provisional limitations, and points that should be revisited. It does not
> override the canonical design.

## Current implementation boundary

The internal `BirdsEngine` implements the complete inward recurrence from deterministic
coarse cells and flows through Stages A–H. Queries compose through multiple epochs. The
consumer-facing `Birds` API, resolution capabilities, result ceilings, visualization,
tagged-bird helper, statistical characterization, and final complexity suite have not yet
been implemented.

## Structural geometry

Hierarchy entities store raw world geometry. Pure construction classifiers recover the
introducing case, concrete parents, child indices, temporal leg, enclosing interval, and
parent-search direction. Thin owner projections independently derive subdivision
capabilities.

This separation matters for cells introduced in different ways. A coarse-initialized
cell, a newly timed Stage-E cell, and a cell produced by an earlier Stage-F split all own
the same F/G subdivision capabilities when their raw scale and alignment agree.

Construction classifiers establish whether an entity exists in the hierarchy. Motion
support is a separate question: structurally legal flows outside finite stochastic
support have count zero.

## Motion-support helpers

The former fixed-point support experiment now delegates to the production motion-support
implementation. It remains useful as a report and validation harness, but it is no longer
an independent version of the closure algorithm.

`possibleFlowDestinations` and `possibleFlowSources` return the union of all structurally
legal endpoint resolutions for the supplied cell and duration. At some duration/scale
combinations this includes both equal-resolution and adjacent-resolution cells. A
stage-specific consumer uses the endpoint width returned by its classifier or owner
projection to select the relevant subset. This keeps support algebra centralized rather
than reproducing it inside query cases.

The immutable support tables are cached by diffusion rate in a small module-level LRU.
This differs from stochastic query caches, which are model-scoped. The support cache only
memoizes a pure parameter-derived calculation, has an explicit capacity and clear
operation, and cannot affect results.

## Coarse initialization

The deterministic reflection-symmetric integer allocation is implemented without work
proportional to population. It treats the allocation objective as a separable convex
problem, allocates positive-offset pairs by marginal cost, and performs a convex search
over the parity-compatible center count. Equal optima use the specified lexicographic
tie-break. An independent exhaustive oracle checks the optimizer over small asymmetric
tables.

The current integer samplers and allocation utilities require population counts to be
safe integers. Consequently, a finite density whose rounded coarse-cell population is
outside the safe-integer range currently fails during engine construction. This is an
implementation/numeric boundary, not a newly intended semantic maximum for
`populationDensity`. Before the public API is finalized, measure the practical boundary
and either support it, reject it explicitly at the API layer with a documented numeric
reason, or document why the prototype cannot represent it.

## Stage-E population semantics

Only coarse-root cell populations are fixed to the deterministic rounded population.
Newly timed Stage-E populations generally fluctuate as birds move. For a Stage-E cell,
the conservation invariant is:

```text
cell population = total incoming Stage-D flow = total outgoing Stage-D flow
```

It is not required to equal the population of one coarse root. This distinction was made
explicit after an early test incorrectly expected every Stage-E cell to retain the fixed
coarse count.

## Stochastic ownership and caching

The engine caches complete owner batches rather than independently sampling entries:

- an entry or Stage-B flow owns its A/C midpoint multinomial;
- a cell owns its F binary population split;
- a source cell owns its complete G1 outflow split;
- a destination cell owns its complete G2 inflow split; and
- a Stage-D flow owns its complete H reconciliation.

Individual two-stage, mixed-resolution, and fully refined queries retrieve entries from
those batches. Addresses contain semantic cell geometry rather than temporary array
positions. Cache clearing and query-order tests cover the implemented recurrence.

## Verification completed so far

The implementation tests currently cover:

- scale inversion and construction classification through the first two epochs;
- sampled finite spatial ancestry at coarse-aligned times;
- owner capability independent of construction case;
- fixed-point closure and forward/inverse support agreement;
- exact conservation through A/C, F, G1, G2, and H owner batches;
- incoming/outgoing conservation for Stage-E and fine entry cells;
- H row and column margin reconciliation;
- deterministic results across query order and cache clearing; and
- recursive evaluation through epoch 2.

Full heterogeneous-ancestry, dependency-rank, complexity, public-API, and statistical
characterization tests remain future implementation milestones.
