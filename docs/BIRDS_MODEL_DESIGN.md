# Polis Birds Model — Preliminary 1+1D Technical Design

> **Status: Historical preliminary design.** The canonical Birds design currently being
> implemented is [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md).

## 1. Purpose

This document specifies a preliminary one-dimensional moving-population model for Polis.

The model represents a large population of indistinguishable birds moving along a one-dimensional spatial line. Their large-scale motion is intended to resemble Brownian motion, but the implementation is deliberately hierarchical and approximate rather than an exact lazy representation of independent continuous Brownian trajectories.

The immediate goal is to define a **subdivision-only spacetime hierarchy**. Unbounded-time expansion and other top-level growth mechanisms are intentionally deferred.

The model should establish:

- hierarchical moving populations rather than static fields;
- exact conservation of integer population counts;
- deterministic addressed stochastic subdivisions;
- finite dependency neighborhoods derived from bounded Brownian motion;
- recursive queries whose results are independent of evaluation order and cache state;
- a concrete test bed for studying approximation quality and query complexity.

The current Polis project already provides addressed randomness, bounded deterministic samplers, synchronous model APIs, model-scoped caches, instrumentation, and browser visualization infrastructure.

The Birds model should remain model-specific rather than introducing a universal stochastic hierarchy abstraction. This follows the existing project architecture, where the starfield and terrain share infrastructure but retain separate recursive models.

---

## 2. Scope

This version has:

- one spatial dimension;
- one time dimension;
- indistinguishable birds;
- integer population counts only;
- no materialized individual birds;
- no stable bird identities;
- no births or deaths;
- no interaction between birds;
- spatially homogeneous model parameters;
- fixed coarse spatial and temporal scales;
- infinite inward subdivision but no outward expansion yet.

The two principal model parameters are:

```ts
populationDensity;
diffusionRate;
```

`populationDensity` controls the expected number of birds per unit length.

`diffusionRate` controls the variance of Brownian displacement:

[
\operatorname{Var}(X\_{t+\Delta}-X_t)
====================================

D\Delta,
]

where (D) is the model's `diffusionRate`.

The project-wide normal truncation constant is also part of the model definition because it determines hard spatial dependency bounds.

---

## 3. Fundamental approximation

The model tracks counts associated with spatial cells and flows between them.

Within any cell, bird position is approximated as uniform.

For a flow from source cell (A) to destination cell (C), the start and end positions are approximated as independently uniform inside their respective cells:

[
X_0\sim U(A),
\qquad
X_1\sim U(C).
]

This is not the exact conditional distribution obtained from a continuous Brownian population conditioned on starting in (A) and ending in (C).

The approximation deliberately discards within-cell information at each hierarchy scale.

A time refinement uses the Brownian-bridge midpoint law conditioned on these approximate endpoint distributions.

Therefore this model should be described as a **hierarchical Brownian-like population model**, not as an exact random-access representation of independent Brownian trajectories.

The approximation becomes better when Brownian displacement is large relative to cell width because flows then spread over many cells and within-cell conditioning becomes weaker.

Increasing diffusion rate therefore creates an important tradeoff:

- larger diffusion rate should improve the uniform-within-cell approximation;
- larger diffusion rate also increases the number of spatial cells that may participate in a subdivision or aggregation.

This tradeoff should be measured experimentally.

---

# 4. Basic hierarchy entities

## 4.1 Cell

A `Cell` is a spatial interval observed at one time.

Conceptually:

```ts
type Cell = {
  left: number;
  right: number;
  time: number;
};
```

Its spatial length is

[
L=\text{right}-\text{left}.
]

Requirements:

- (L) is a power of two;
- `left` is divisible by (L);
- `time` is dyadic;
- the cell must belong to one of the legal hierarchy scales defined below.

A cell query returns an integer bird population.

---

## 4.2 Flow

A `Flow` represents birds moving from one cell to another.

```ts
type Flow = {
  start: Cell;
  end: Cell;
};
```

The source and destination cells need not always have the same spatial size.

Its duration is

[
T=t_1-t_0.
]

Requirements include:

- (T>0);
- (T) is dyadic;
- (T) divides the start time;
- its spatial cell-size combination must be one of the legal hierarchy combinations described below.

A flow query returns an integer bird count.

---

## 4.3 Two-stage flow

A `TwoStageFlow` represents one coarse flow refined through an explicitly exposed halftime cell.

```ts
type TwoStageFlow = {
  start: Cell;
  half: Cell;
  end: Cell;
};
```

Requirements:

- all three cells have the same spatial length;
- if total duration is (T),

[
t_{\text{half}}=t_0+T/2;
]

- (T) divides the start time;
- the entity must occur at one of the legal temporal-refinement stages.

A two-stage-flow query returns the count assigned to that particular midpoint cell.

A `TwoStageFlow` is not independently sampled. It is an entry in a complete subdivision owned by its containing `Flow`.

---

# 5. Coarse scales and epoch scales

The initial fixed coarse scales are:

[
L_0=16
]

and

[
T_0=256.
]

One complete hierarchy epoch halves spatial scale and quarters temporal scale.

Define:

[
\boxed{L_n=16\cdot2^{-n}}
]

and

[
\boxed{T_n=256\cdot4^{-n}}.
]

Therefore:

[
T_n=L_n^2.
]

The first few epochs are:

| Epoch (n) | Spatial scale (L_n) | Time scale (T_n) |
| --------- | ------------------: | ---------------: |
| 0         |                  16 |              256 |
| 1         |                   8 |               64 |
| 2         |                   4 |               16 |
| 3         |                   2 |                4 |
| 4         |                   1 |                1 |
| 5         |                 1/2 |              1/4 |

This relation is intentional.

For Brownian motion,

[
\sqrt{DT_n}
===========

L_n\sqrt D.
]

Thus Brownian displacement measured in units of hierarchy cells is scale-independent.

This should keep the number of spatially relevant neighboring cells approximately constant across hierarchy depth for fixed (D).

---

# 6. Epochs and stages

Epochs and stages are **specification and testing concepts**.

They should not normally appear as explicit fields in hierarchy entities or drive recursive query code through a `generation` or `stage` enum.

Production query code should infer the applicable case from:

- spatial lengths;
- times;
- durations;
- divisibility/alignment;
- parent/child relationships.

Tests may classify legal entities into epochs and stages to exhaustively verify the hierarchy.

---

# 7. Initialization

## 7.1 Stage 0 — coarse flows

At epoch 0, define flows with:

- source length (16);
- destination length (16);
- duration (256);
- start time divisible by (256).

Thus:

[
F(A,B;t,t+256)
]

exists when (A) and (B) are aligned length-16 cells and

[
256\mid t.
]

For the preliminary model, these counts are deterministic.

Define:

[
F(A,B)=g(\operatorname{distance}(A,B);\rho,D),
]

where:

- (\rho) is population density;
- the count decreases with source/destination separation;
- the count is exactly zero outside a bounded spatial range.

The precise initial function remains to be chosen.

It should be constructed so that all coarse cells obtain the same total population under the spatially homogeneous default model:

[
\sum_B F(A,B)
]

is independent of (A).

However, query code must not rely on this equality. It is merely a property of the initial homogeneous coarse-flow function.

The coarse-flow construction is deterministic specifically to avoid having to solve top-level stochastic consistency in this preliminary version.

---

## 7.2 Stage 1 — coarse cells

A coarse cell has:

- length (16);
- time divisible by (256).

Its population is obtained by aggregation:

[
C(A,t)
======

\sum_B F(A,B;t,t+256).
]

Only destination cells inside the known coarse-flow support need to be queried.

Equivalently, the population could be computed by summing inflows:

[
C(B,t)
======

\sum_A F(A,B;t-256,t).
]

The implementation should choose one canonical direction, probably outgoing flows.

Equality between incoming and outgoing totals should be tested as a conservation invariant where both are legal.

---

# 8. Repeating epoch refinement

Suppose epoch (n) begins with legal:

- cells of spatial length (L_n) at times divisible by (T_n);
- equal-resolution flows (L_n\to L_n) of duration (T_n).

One epoch produces the corresponding objects at scale

[
(L*{n+1},T*{n+1})
=================

(L_n/2,T_n/4).
]

The repeating stages are defined below.

---

# 9. Stage A — first temporal subdivision

For every equal-resolution epoch-(n) flow

[
F(A,C;t,t+T_n),
]

introduce two-stage flows

[
G(A,B,C;t,t+T_n/2,t+T_n)
]

for every legal midpoint cell (B) of length (L_n) with nonzero possible probability.

These counts form one subdivision owned by the parent flow.

If

[
F(A,C)=N,
]

then:

[
(N_B)_B
\sim
\operatorname{Multinomial}
\left(
N;(p_B)_B
\right).
]

The probabilities (p_B) are derived from the bounded Brownian-bridge midpoint distribution under the uniform endpoint approximation.

They satisfy:

[
\sum_B N_B=N.
]

The subdivision is queried through something conceptually like:

```ts
queryFlowTimeSubdivision(flow);
```

which returns all midpoint allocations.

Then:

```ts
queryTwoStageFlow(twoStageFlow);
```

simply queries the containing parent subdivision and retrieves its own entry.

---

# 10. Stage B — half-duration flows

Introduce equal-resolution flows of spatial length (L_n) and duration

[
T_n/2.
]

These are aggregations of Stage A objects.

For the first half:

[
F(A,B;t,t+T_n/2)
================

\sum_C G(A,B,C).
]

For the second half:

[
F(B,C;t+T_n/2,t+T_n)
====================

\sum_A G(A,B,C).
]

The legal enclosing coarse interval is determined by time alignment.

No stochastic subdivision is owned by these shorter flows at this stage.

Their counts are derived by aggregating the relevant two-stage flows.

---

# 11. Stage C — second temporal subdivision

Each Stage B flow now undergoes the same midpoint refinement.

For a flow

[
F(A,C;t,t+T_n/2),
]

introduce midpoint allocations through cells (B) of length (L_n) at:

[
t+T_n/4.
]

This is again owned by the parent flow and sampled as a bounded-support multinomial subdivision.

---

# 12. Stage D — quarter-duration flows

Aggregate Stage C two-stage flows into ordinary flows of duration:

[
T_n/4=T_{n+1}.
]

Their spatial start and end cells still have length (L_n).

These flows form the finest temporal flow resolution available before spatial subdivision.

---

# 13. Stage E — newly available coarse-space cells

At this point, length-(L*n) flows exist for duration (T*{n+1}).

Therefore cell populations can be defined at every time:

[
t\equiv0\pmod{T_{n+1}}.
]

For a length-(L_n) cell:

[
C(A,t)
======

\sum*B F(A,B;t,t+T*{n+1}).
]

Some of these cells may already have existed at a coarser stage.

Only newly introduced time alignments require new computation.

For epoch 0:

- (L_0=16);
- (T_1=64).

Thus Stage E includes length-16 cells at times divisible by 64 that were not already coarse cells at multiples of 256.

---

# 14. Stage F — spatial cell subdivision

Every Stage E or previously existing length-(L*n) cell at a (T*{n+1})-aligned time can now subdivide into two children of length:

[
L_{n+1}=L_n/2.
]

Let:

[
A=A_0\cup A_1.
]

Under the uniform-within-cell approximation:

[
C(A_0)\mid C(A)=N
\sim
\operatorname{Binomial}(N,1/2),
]

and:

[
C(A_1)=N-C(A_0).
]

This is one stochastic subdivision owned by the parent cell.

Conceptually:

```ts
queryCellSubdivision(cell);
```

returns both child counts.

A child-cell `queryCell` call retrieves its entry from this subdivision.

---

# 15. Stage G1 — source-side flow subdivision

We now know finer source-cell populations but still have flows to coarse destination cells.

Suppose coarse source cell (A) has children:

[
A_0,A_1.
]

For each accessible coarse destination (B_j), we already know:

[
F(A,B_j).
]

These satisfy:

[
\sum_jF(A,B_j)=C(A).
]

We also know:

[
C(A_0)+C(A_1)=C(A).
]

We must partition all coarse outgoing flows jointly so that the fine source populations are respected exactly.

Conditional on the coarse counts and the uniform approximation:

[
\left(
F(A_0,B_1),
\ldots,
F(A_0,B_k)
\right)
]

follows a multivariate hypergeometric distribution with:

- category sizes

[
F(A,B_1),\ldots,F(A,B_k);
]

- sample size

[
C(A_0).
]

Then:

[
F(A_1,B_j)
==========

F(A,B_j)-F(A_0,B_j).
]

This operation must be sampled **as one batch over all outgoing flows from (A)**.

Sampling individual flows independently would fail to guarantee:

[
\sum_jF(A_0,B_j)=C(A_0).
]

This subdivision is therefore owned by the source cell.

Conceptually:

```ts
queryCellOutflowSubdivision(cell);
```

returns the relevant mixed-resolution flows.

---

# 16. Stage G2 — destination-side flow subdivision

The destination side is the transpose of Stage G1.

Suppose destination cell (B) has children:

[
B_0,B_1.
]

For all accessible source cells (A_i), the incoming coarse counts are:

[
F(A_i,B).
]

These must be jointly split so that:

[
\sum_iF(A_i,B_0)=C(B_0)
]

and:

[
\sum_iF(A_i,B_1)=C(B_1).
]

Again this is a multivariate hypergeometric subdivision owned by the destination cell.

Conceptually:

```ts
queryCellInflowSubdivision(cell);
```

returns the mixed-resolution incoming flows.

---

# 17. Stage H — full spatial flow subdivision

Now consider one original coarse-space flow:

[
F(A,B)=N.
]

Its source subdivision has determined row sums:

[
r_0=F(A_0,B),
\qquad
r_1=F(A_1,B).
]

Its destination subdivision has determined column sums:

[
c_0=F(A,B_0),
\qquad
c_1=F(A,B_1).
]

We need a (2\times2) fine flow table:

[
\begin{pmatrix}
F(A_0,B_0) & F(A_0,B_1)\
F(A_1,B_0) & F(A_1,B_1)
\end{pmatrix}.
]

Given fixed margins, only one entry remains stochastic.

For example:

[
X=F(A_0,B_0)
]

is sampled as:

[
X
\sim
\operatorname{Hypergeometric}
(N,c_0,r_0).
]

Then:

[
F(A_0,B_1)=r_0-X,
]

[
F(A_1,B_0)=c_0-X,
]

[
F(A_1,B_1)=N-r_0-c_0+X.
]

This subdivision is naturally owned by the coarse flow.

Conceptually:

```ts
queryFlowSpaceSubdivision(flow);
```

returns the four fine flows.

These fine flows have:

- spatial length (L\_{n+1});
- duration (T\_{n+1}).

They are therefore exactly the ordinary flow objects required to begin epoch (n+1).

---

# 18. Epoch summary

One complete epoch transforms:

[
(L_n,T_n)
]

into:

[
(L_n/2,T_n/4).
]

Its logical structure is:

```text
equal-scale flow, duration T
        |
        | time subdivision
        v
two-stage flows
        |
        | aggregate
        v
equal-scale flows, duration T/2
        |
        | time subdivision
        v
two-stage flows
        |
        | aggregate
        v
equal-scale flows, duration T/4
        |
        | aggregate outgoing flows
        v
coarse-space cells at finer time lattice
        |
        | spatial binomial split
        v
fine-space cells
        |
        | joint source-side / destination-side hypergeometric splits
        v
mixed-resolution flows
        |
        | 2x2 hypergeometric reconciliation
        v
fine-space flows, duration T/4
```

Those final flows and fine cells provide the input conditions for the next epoch.

---

# 19. Brownian midpoint distribution

Let a parent flow have:

- source cell

[
A=[a,a+L);
]

- destination cell

[
C=[c,c+L);
]

- total duration (T).

Approximate:

[
X_0\sim U(A),
\qquad
X_T\sim U(C)
]

independently.

Conditional on exact endpoints, Brownian bridge gives:

[
X\_{T/2}
=======

\frac{X_0+X_T}{2}

- \frac{\sqrt{DT}}{2}Z,
  ]

where (Z) is a standard normal innovation.

Polis uses the existing bounded normal construction with:

[
|Z|\le K,
]

where currently:

[
K=6.
]

The existing project already clamps normal tails at six standard deviations.

Therefore:

[
\left|
X\_{T/2}

---

\frac{X_0+X_T}{2}
\right|
\le
\frac{K\sqrt{DT}}2.
]

Define:

[
R(T)=\frac{K\sqrt{DT}}2.
]

Because:

[
\frac{X_0+X_T}{2}
\in
\left[
\frac{a+c}{2},
\frac{a+c}{2}+L
\right),
]

every possible midpoint lies in:

[
\boxed{
M(A,C,T)
========

\left[
\frac{a+c}{2}-R(T),
\frac{a+c}{2}+L+R(T)
\right].
}
]

Only midpoint cells intersecting this interval can receive nonzero two-stage-flow count.

This is a **hard dependency bound**, not merely a probability cutoff.

---

# 20. Scale-independent midpoint width

At epoch (n):

[
T_n=L_n^2.
]

Therefore:

[
R(T_n)
======

\frac{K\sqrt D}{2}L_n.
]

Measured in units of spatial cells:

[
\frac{R(T_n)}{L_n}
==================

\frac{K\sqrt D}{2}.
]

Thus the number of midpoint cells with nonzero probability is bounded independently of epoch depth for fixed diffusion rate.

This is one of the central structural reasons for choosing:

[
T_n=L_n^2.
]

The model's local branching factor grows with approximately:

[
O(K\sqrt D)
]

rather than with refinement depth.

---

# 21. Forward dependency bound for time subdivision

For a parent flow (A\to C), `queryFlowTimeSubdivision` needs to enumerate all midpoint cells with nonzero possible population.

If midpoint cells have width (L), then the midpoint-cell indices need only cover the cells intersecting:

[
M(A,C,T).
]

This provides a finite range directly from:

- source cell;
- destination cell;
- duration;
- diffusion rate;
- normal truncation constant.

The implementation must calculate this range conservatively, accounting for half-open cell-boundary conventions.

---

# 22. Inverse dependency bounds for aggregation

Aggregation is only tractable if a shorter flow can determine a finite set of enclosing two-stage flows that might contribute to it.

Consider a first-leg flow:

[
A\to B
]

over duration (T/2).

We need all possible end cells (C) such that:

[
B\cap M(A,C,T)\ne\varnothing.
]

Let:

[
A=[a,a+L),
\quad
B=[b,b+L),
\quad
C=[c,c+L).
]

The midpoint support is:

[
\left[
\frac{a+c}{2}-R,
\frac{a+c}{2}+L+R
\right].
]

For it to intersect (B), we require:

[
\frac{a+c}{2}-R < b+L
]

and:

[
\frac{a+c}{2}+L+R > b.
]

Solving for (c):

[
c < 2(b+L+R)-a
]

and:

[
c > 2(b-L-R)-a.
]

Thus candidate coarse end cells lie inside the bounded interval:

[
\boxed{
2(b-L-R)-a
<
c
<
2(b+L+R)-a.
}
]

Only aligned length-(L) cells with left endpoints in this range can contribute.

The corresponding inverse bound for a second-leg flow is symmetric.

This bound is required whenever `queryFlow` aggregates Stage A or Stage C two-stage flows.

---

# 23. Bounds required for spatial subdivision

Source-side and destination-side hypergeometric batches must also enumerate only a bounded number of flows.

At a fixed duration (T\_{n+1}), the model should maintain a hard maximum source/destination separation derived from the Brownian transition support used by the hierarchy.

Therefore:

```ts
queryCellOutflowSubdivision(cell);
```

enumerates only coarse destination cells within the maximum flow-support radius.

Likewise:

```ts
queryCellInflowSubdivision(cell);
```

enumerates only coarse source cells within the corresponding inverse radius.

The model specification must define one canonical support rule for ordinary flows so that all such enumeration bounds are derivable from it.

The exact coarse-flow initialization function must obey the same or a stricter support bound.

---

# 24. Ordinary-flow support

For every legal equal-resolution flow with duration (T), define a finite spatial support condition.

At minimum, a flow should be impossible if no pair of points from its start and end cells can be connected within the bounded Brownian displacement envelope associated with (T).

A conservative rule can be derived from:

[
|X_T-X_0|
\le
K\sqrt{DT}
]

for the bounded increment approximation.

Because source and destination positions vary over cells of width (L), cell-to-cell support should include that width uncertainty.

The implementation should centralize this calculation in a helper such as:

```ts
possibleFlowDestinations(cell, duration, diffusionRate);
```

and use the same helper or mathematically equivalent inverse helper in:

- flow aggregation;
- inflow aggregation;
- outflow subdivision;
- inflow subdivision;
- validation of legal nonzero flows;
- tests.

No recursive query should enumerate spatial cells beyond a proved possible-support range.

---

# 25. Probability distributions required

## 25.1 Bounded normal

Already implemented by Polis.

Used indirectly to define Brownian support and midpoint probabilities.

The six-standard-deviation bound is part of the Birds model's hard dependency geometry.

---

## 25.2 Arbitrary-probability binomial

Needed as a building block for finite categorical subdivisions.

The existing starfield currently implements only the equal-probability binomial case.

Birds will require a general:

```ts
binomial(seed, address, n, p);
```

or an equivalent bounded deterministic sampler.

The sampler should preserve pointwise monotonicity in (p) where practical and specified.

---

## 25.3 Multinomial

Needed for:

```ts
queryFlowTimeSubdivision(flow);
```

because one parent-flow count is partitioned among multiple midpoint cells.

A practical implementation may use a sequence of conditional binomial samples, but the stochastic fact is one multinomial allocation owned by the parent flow.

The subdivision must always conserve:

[
\sum_iN_i=N.
]

---

## 25.4 Hypergeometric

Needed for Stage H's (2\times2) reconciliation.

Conceptually:

```ts
hypergeometric(seed, address, population, successes, draws);
```

The result must always remain in its exact feasible range.

Unlike normal or Poisson sampling, hypergeometric output already has finite mathematical support.

---

## 25.5 Multivariate hypergeometric

Needed for source-side and destination-side mixed-resolution flow subdivision.

A practical implementation may use sequential hypergeometric draws.

Again, the whole vector is one addressed stochastic subdivision.

All outputs must exactly satisfy:

- category capacities;
- requested sample total;
- parent flow conservation.

---

# 26. Ownership of stochastic facts

The hierarchy should obey one central rule:

> Every stochastic subdivision is owned by the unique hierarchy entity whose complete subdivision it defines.

Examples:

- midpoint allocations are owned by a `Flow`;
- left/right cell populations are owned by the parent `Cell`;
- source-side outgoing-flow splits are owned by the source `Cell`;
- destination-side incoming-flow splits are owned by the destination `Cell`;
- (2\times2) fine-flow tables are owned by the coarse `Flow`.

Individual entries do not own independent randomness.

For example:

```ts
queryTwoStageFlow(twoStageFlow);
```

does not sample anything.

It queries:

```ts
queryFlowTimeSubdivision(parentFlow);
```

and returns the appropriate entry.

Likewise a fine child flow does not independently sample its count. It queries the spatial subdivision owned by its coarse parent flow.

---

# 27. Aggregations

Aggregations are deterministic sums of already defined stochastic facts.

They do not require separate subdivision-query APIs.

For example, `queryCell(cell)` may detect that the cell belongs to a stage where its population is defined from outgoing flows and compute:

[
C(A,t)=\sum_BF(A,B).
]

Similarly, `queryFlow(flow)` may detect that its duration makes it a temporal half-flow and aggregate the relevant two-stage flows.

The generation/stage classification explains _why_ the aggregation is valid, but runtime code should infer the case structurally.

---

# 28. Recursive query API

The likely internal stochastic/query API is:

```ts
queryCell(cell): PopulationCount

queryFlow(flow): PopulationCount

queryTwoStageFlow(flow): PopulationCount

queryFlowTimeSubdivision(
  flow
): FlowTimeSubdivisionResult

queryCellSubdivision(
  cell
): CellSubdivisionResult

queryCellOutflowSubdivision(
  cell
): CellOutflowSubdivisionResult

queryCellInflowSubdivision(
  cell
): CellInflowSubdivisionResult

queryFlowSpaceSubdivision(
  flow
): FlowSpaceSubdivisionResult
```

The exact class/interface arrangement can evolve during implementation.

No explicit epoch or stage argument should be passed.

---

# 29. `queryCell`

`queryCell(cell)` determines the legal construction from scale and alignment.

Cases include:

### Coarse initialized cell

If:

- length (=16);
- time divisible by (256);

aggregate generation-0 outgoing coarse flows.

### Coarse-space cell at finer legal time

If the cell's spatial length remains (L*n) but its time belongs to the finer (T*{n+1}) lattice introduced after temporal refinement:

aggregate outgoing equal-resolution flows of duration (T\_{n+1}).

### Spatial child

If the cell has length (L*{n+1}) at a legal (T*{n+1})-aligned time:

find its length-(L_n) parent cell and retrieve the corresponding result from:

```ts
queryCellSubdivision(parent);
```

All legal cells should fall into one recursively derivable case.

Invalid scale/time combinations throw.

---

# 30. `queryTwoStageFlow`

A legal `TwoStageFlow` always belongs to exactly one parent equal-resolution flow.

The method:

1. validates common spatial sizes and midpoint timing;
2. identifies the containing parent `Flow`;
3. calls:

```ts
queryFlowTimeSubdivision(parentFlow);
```

4. returns the entry associated with the requested halftime cell.

It performs no random sampling itself.

---

# 31. `queryFlow`

`queryFlow(flow)` determines its construction structurally.

Possible cases include:

### Coarse generation-0 flow

Length-16 to length-16, duration 256, start time divisible by 256.

Return the deterministic coarse-flow function.

### Temporally aggregated equal-resolution flow

If the flow represents one half of a legal coarser temporal subdivision:

enumerate, using the inverse dependency bound, all enclosing parent two-stage flows that could contain it and sum their counts.

### Mixed source resolution

For a legal (L\_{n+1}\to L_n) flow:

query the source parent cell's:

```ts
queryCellOutflowSubdivision(parentCell);
```

and retrieve the corresponding entry.

### Mixed destination resolution

For a legal (L*n\to L*{n+1}) flow:

query:

```ts
queryCellInflowSubdivision(parentCell);
```

and retrieve the entry.

### Fully refined equal-resolution flow

For a legal (L*{n+1}\to L*{n+1}) flow:

identify its containing coarse (L_n\to L_n) flow and call:

```ts
queryFlowSpaceSubdivision(parentFlow);
```

then retrieve the correct child-flow entry.

Invalid scale/duration/alignment combinations throw.

---

# 32. Worked epoch-0 example

Let:

[
L_0=16,\qquad T_0=256.
]

Take source cell:

[
A=[0,16)
]

at:

[
t=0.
]

Take destination cell:

[
C=[16,32)
]

at:

[
t=256.
]

Assume the deterministic coarse-flow function gives:

[
F(A,C)=100.
]

## Stage A

The parent flow is refined through halftime:

[
t=128.
]

Suppose Brownian support permits midpoint cells:

[
B\_{-1}=[-16,0),
]

[
B_0=[0,16),
]

[
B_1=[16,32),
]

[
B_2=[32,48).
]

The subdivision probability vector might be:

[
(0.05,0.35,0.45,0.15).
]

An addressed multinomial sample may produce:

[
(4,37,44,15).
]

These sum to:

[
100.
]

Therefore:

[
G(A,B_0,C)=37
]

is obtained by asking for the `B0` entry of the parent flow's time subdivision.

---

## Stage B

To query:

[
F(A,B_0;0,128),
]

we must aggregate over every legal final cell (C') whose parent flow (A\to C') could pass through (B_0).

The inverse midpoint-support bound gives a finite range of candidate (C').

Then:

[
F(A,B_0;0,128)
==============

\sum\_{C'}G(A,B_0,C').
]

---

## Stage C

That 128-duration flow is subdivided again at:

[
t=64.
]

Its count is apportioned among length-16 midpoint cells using another addressed multinomial subdivision.

---

## Stage D

Aggregating these second-level two-stage flows produces ordinary length-16 flows from:

[
t=0
]

to:

[
t=64.
]

Analogous flows exist on every 64-aligned interval.

---

## Stage E

The population of:

[
A=[0,16)
]

at:

[
t=64
]

is:

[
C(A,64)
=======

\sum_BF(A,B;64,128),
]

where only bounded-support destinations (B) are queried.

---

## Stage F

Suppose:

[
C(A,64)=180.
]

Split:

[
A_0=[0,8),
\qquad
A_1=[8,16).
]

An addressed equal-probability binomial sample might produce:

[
C(A_0,64)=87,
]

[
C(A_1,64)=93.
]

---

## Stage G1

Suppose the outgoing coarse flows from (A) at this 64-duration scale are:

[
(20,50,70,40)
]

to four accessible destination cells.

They sum to:

[
180.
]

We must choose which 87 outgoing birds belong to (A_0).

A multivariate hypergeometric sample could yield:

[
(8,26,34,19),
]

which also sums to:

[
87.
]

Then (A_1)'s mixed-resolution flows are the remainders:

[
(12,24,36,21).
]

---

## Stage G2

Suppose one destination cell (B) has child populations:

[
C(B_0)=90,
\qquad
C(B_1)=110.
]

Its incoming coarse flows are jointly split by a separate multivariate hypergeometric subdivision so their fine-destination sums exactly equal 90 and 110.

---

## Stage H

Take one coarse flow with:

[
N=70.
]

Suppose source subdivision gives:

[
r_0=34,
\qquad
r_1=36.
]

Suppose destination subdivision gives:

[
c_0=31,
\qquad
c_1=39.
]

Sample:

[
X=F(A_0,B_0)
\sim
\operatorname{Hypergeometric}(70,31,34).
]

Suppose:

[
X=16.
]

Then:

[
F(A_0,B_0)=16,
]

[
F(A_0,B_1)=34-16=18,
]

[
F(A_1,B_0)=31-16=15,
]

[
F(A_1,B_1)=70-34-31+16=21.
]

The table is:

[
\begin{pmatrix}
16&18\
15&21
\end{pmatrix}.
]

Row sums:

[
34,36.
]

Column sums:

[
31,39.
]

Total:

[
70.
]

These are now ordinary length-8 flows of duration 64.

They form epoch-1 input.

---

# 33. Legal hierarchy entities

The implementation should expose validation helpers that recognize legal hierarchy positions from geometry rather than from stored generation labels.

The exact predicates should be derived from the epoch formulas.

For epoch (n):

[
L_n=16/2^n
]

and:

[
T_n=256/4^n.
]

Legal ordinary equal-resolution flows occur at several temporal subscales inside each epoch:

[
T_n,\quad T_n/2,\quad T_n/4.
]

Legal mixed-resolution flows occur only during the spatial-refinement boundary:

[
L_{n+1}\to L_n
]

or:

[
L_n\to L_{n+1},
]

with duration:

[
T_{n+1}.
]

Legal fully refined epoch-(n+1) flows are:

[
L_{n+1}\to L_{n+1}
]

with duration:

[
T_{n+1}.
]

Legal two-stage flows have:

- equal-sized start, half, and end cells;
- total duration equal to either

[
T_n
]

or:

[
T_n/2;
]

- aligned start time;
- halftime exactly at the midpoint.

Cells exist at spatial scale (L_n) on all time lattices that have been exposed before that scale is spatially refined.

These predicates should be expressed in terms of dyadic arithmetic and divisibility.

---

# 34. Tests organized by epoch/stage

Although epoch and stage should not normally appear in production model objects, they are useful for test generation.

Tests should construct representative objects from every stage of several epochs and verify that the recursive query reaches only earlier-defined dependencies.

For example:

- Stage A depends on epoch-entry flow;
- Stage B depends on Stage A;
- Stage C depends on Stage B;
- Stage D depends on Stage C;
- Stage E depends on Stage D;
- Stage F depends on Stage E or an already existing cell;
- Stage G depends on Stage D flows and Stage F cells;
- Stage H depends on Stage G and the coarse flow.

Tests should verify that no dependency edge points forward in this conceptual generation order.

---

# 35. Conservation invariants

The model should test several exact integer identities.

### Time subdivision

For every parent flow:

[
F(A,C)=\sum_B G(A,B,C).
]

### Temporal aggregation

For a first-leg flow:

[
F(A,B)=\sum_CG(A,B,C).
]

### Cell population

[
C(A,t)=\sum_BF(A,B;t,t+T).
]

Where both sides are legal:

[
C(A,t)=\sum_BF(B,A;t-T,t).
]

### Spatial cell subdivision

[
C(A)=C(A_0)+C(A_1).
]

### Source mixed-flow subdivision

[
F(A,B)=F(A_0,B)+F(A_1,B).
]

and:

[
\sum_BF(A_i,B)=C(A_i).
]

### Destination mixed-flow subdivision

[
F(A,B)=F(A,B_0)+F(A,B_1).
]

and:

[
\sum_AF(A,B_i)=C(B_i).
]

### Full spatial subdivision

[
F(A,B)
======

\sum\_{i,j}F(A_i,B_j).
]

All row and column sums must agree with the corresponding Stage G results.

---

# 36. Query-order and cache invariants

As with existing Polis models:

- query order must not affect results;
- clearing caches must not affect results;
- LRU eviction must not affect results;
- querying a child before its owner subdivision must produce the same value as querying the owner first.

The existing project treats these as core cross-model invariants.

Birds should extend the same principles to population conservation across spacetime.

---

# 37. Dependency-bound tests

Because this is the first Polis model whose tractability strongly depends on hard spatial bounds, bound tests are first-class correctness tests.

For every temporal subdivision:

- every returned midpoint cell must intersect the derived midpoint-support interval;
- cells immediately outside the enumerated range must have mathematically zero support.

For every temporal aggregation:

- the inverse bound must include every possible enclosing coarse endpoint;
- a brute-force finite reference search at small scales should confirm that no legal contributor lies outside the computed range.

For ordinary flow support:

- every nonzero generated or refined flow must lie inside the declared support;
- aggregation and spatial-subdivision enumeration must use exactly or conservatively the same support relation.

A bound failure is a semantic error because it can cause birds to disappear from an aggregation.

---

# 38. Complexity instrumentation

The model should record per-query statistics including:

```ts
cellsEvaluated;
flowsEvaluated;
twoStageFlowsEvaluated;
timeSubdivisions;
cellSubdivisions;
sourceFlowSubdivisions;
destinationFlowSubdivisions;
spaceFlowSubdivisions;
multinomialCategories;
hypergeometricSamples;
cacheHits;
maximumDependencyDepth;
```

Benchmarks should vary:

- epoch depth;
- population density;
- diffusion rate;
- spatial separation;
- query type.

Of particular interest is whether work at fixed query type remains polynomial in epoch depth and how the constant factor grows with:

[
\sqrt D.
]

---

# 39. Development experiments

The preliminary implementation should explicitly investigate:

### Diffusion versus approximation

Compare different values of (D).

For larger (D):

- more midpoint cells become accessible;
- recursive aggregation becomes more expensive;
- the uniform endpoint approximation should improve.

### Density versus cost

Higher population density should increase integer count magnitudes without necessarily increasing the number of hierarchy nodes queried.

However, sampler cost may depend on count magnitude.

### Empirical within-cell error

A separate numerical experiment can compare the model's assumed uniform conditional endpoint or midpoint distribution against an exact or Monte Carlo Brownian reference.

This does not need to block implementation, but it should quantify how crude the approximation is at practical parameter choices.

---

# 40. Demo requirements

The eventual Birds demo should visualize one spatial dimension horizontally and time vertically or through an animation/time control.

The initial browser UI should expose:

- seed;
- population density;
- diffusion rate;
- space/time coordinates;
- hierarchy/debug overlay;
- query statistics.

The exact primary visualization can be decided during implementation.

Useful possibilities include:

- population density over space at a selected time;
- flow intensity between two selected times;
- a spacetime heatmap of cell populations;
- hierarchy boxes and flow dependencies near the cursor.

Birds should join Starfield and Terrain as one of the project's principal models.

Smaller supporting demos may be implemented before Birds if they help validate:

- 1D hierarchical populations;
- bounded Brownian bridge subdivision;
- general binomial/multinomial/hypergeometric samplers.

---

# 41. Deferred topics

This design intentionally does not solve:

- hierarchy scales coarser than L=16, T=256;
- stable individual bird identity;
- explicit individual trajectories;
- smooth velocity dynamics;
- latent bird state;
- terrain-dependent movement;
- higher spatial dimensions;
- exact continuous Brownian consistency;
- arbitrary user-defined spacetime queries.

These can be revisited after the finite-coarseness subdivision hierarchy is implemented and measured.

---

# 42. Implementation sequence

A reasonable implementation order is:

1. Add general finite-support distribution infrastructure needed by Birds.
2. Implement and test arbitrary-(p) binomial sampling.
3. Implement addressed multinomial sampling.
4. Implement addressed hypergeometric and multivariate hypergeometric sampling.
5. Implement exact hierarchy entity types and legality predicates.
6. Implement epoch/stage test helpers, without exposing epochs in production query objects.
7. Implement deterministic generation-0 coarse flows.
8. Implement coarse cells.
9. Implement bounded Brownian midpoint-support calculations.
10. Implement forward and inverse dependency-bound helpers.
11. Implement `queryFlowTimeSubdivision`.
12. Implement temporal flow aggregation.
13. Repeat temporal subdivision to reach (T/4).
14. Implement finer-time cell aggregation.
15. Implement `queryCellSubdivision`.
16. Implement source- and destination-side flow subdivisions.
17. Implement full spatial flow reconciliation.
18. Verify that epoch (n+1) objects recurse correctly through epoch (n).
19. Add conservation, query-order, cache, and bounds tests.
20. Add complexity benchmarks.
21. Add a minimal Birds visualization.
22. Experiment with density and diffusion-rate tradeoffs.

The key acceptance criterion before extending the model outward is that several complete inward subdivision epochs work deterministically, conserve population exactly, and require only dependency ranges justified by explicit hard bounds.
