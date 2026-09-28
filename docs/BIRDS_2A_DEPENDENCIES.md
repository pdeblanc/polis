# Birds 2a dependency termination

This document gives a termination argument for the single-origin expansion and
contraction engine. It concerns the implemented dependency geometry, not a claim
that every query is fast or succeeds at floating-point limits. The argument uses
exact dyadic geometry; execution requires its intermediate coordinates, indices,
durations, and counts to remain representable. Numeric errors, sampler failures,
and the JavaScript call-stack limit are separate limitations.

Implementation: [`dependencyRanks.ts`](../src/models/birds2a/dependencyRanks.ts).
The engine does not use ranks to choose dependencies or impose a maximum epoch.
Its optional diagnostic observer lets tests check ranks on actual recursive calls.

## A finite coarse window for each query

Let the origin width be `L₀`, and let `r` be the named duration/width-squared
constant (currently 1). For a legal root cell or ordinary flow, choose a dyadic
width `W` satisfying:

- `W >= 2L₀`;
- `W` is at least every root endpoint width;
- `B = rW²` is at least the absolute value of every root endpoint time.

The diagnostic helper chooses the smallest such dyadic `W`. The proof window is
the closed temporal interval `[-B,B]`. Its size depends on the query; it is not a
model boundary. There is no restriction on spatial location in this argument.

At width `W`, every legal cell in this window has a time in
`{-B,-3B/4,-B/2,-B/4,0,B/4,B/2,3B/4,B}`. Expansion supplies all these populations.
It also supplies every legal equal-width flow of width `W` inside the window:
durations `B`, `B/2`, and `B/4`. The mixed-width flows between widths `W/2` and `W`
have duration `B/4`, and are also retained. The requirement `W/2 >= L₀` ensures
that their time-zero endpoint does not request detail finer than the origin.
Expansion supplies absent spatial entries as zero, so these statements are
independent of spatial indices, sampled populations, and support pruning.

## Dependencies stay inside the window

Spatial parent and child operations keep their endpoint times. A temporal-parent
operation takes the aligned interval of twice the duration containing the queried
leg. All durations divide `B`, so nesting an interval inside `[-B,B]` cannot cross
either boundary while its parent duration is at most `B`.

Incidence owners use the same oriented interval as the requesting mixed-width
flow. Their other endpoint varies in space, not time. Spatial reconciliation and
its incidence dependencies therefore remain inside the parent's interval.

An E cell query introduces an outgoing quarter-duration interval. At the right
boundary `B`, E is not selected: `B` is divisible by the full duration of every
width at most `W`, so the cell is either expansion-owned or a spatial child.
At other grid times the next quarter step cannot skip past `B`. Spatial-child
dependencies keep the same time. The analogous lower-boundary cases do not
introduce a step before `-B`.

Dependency widths only stay fixed or move towards a coarser owner. Reaching
width `W` ordinary facts terminates in expansion. The F/G/H batches that could
otherwise carry queries through this boundary are not requested: their relevant
child entries are already expansion facts. In particular, width-`W/2` entry flows
throughout the window, and their cells at interval endpoints, are retained.

Temporal batches whose legs are already retained must not be evaluated. The
owner classifier throws if asked to do so. For a legal A/C temporal split,
coverage of its legs is uniform in spatial indices and shared by both legs:
at a given width, expansion supplies either the whole relevant half/quarter
temporal grid in its central window, or neither leg. Thus a contraction-owned
leg cannot request a forbidden retained-leg temporal batch. This property is
also checked across scales and positive/negative times in owner tests.

## A decreasing natural-number rank

Expansion cell/flow facts, and F batches that read retained child counts directly,
have rank zero. Other nodes have an owner width `w` and an order from this table:

| Node | Owner width | Order |
| --- | --- | ---: |
| A temporal batch | endpoint width | 2 |
| B half-duration flow | endpoint width | 4 |
| C temporal batch | endpoint width | 5 |
| D quarter-duration flow | endpoint width | 7 |
| E cell population | cell width | 8 |
| F cell-subdivision batch | parent cell width | 9 |
| F spatial-child population | twice child width | 10 |
| G1/G2 incidence batch | parent cell width | 11 |
| G1/G2 mixed-width flow entry | larger endpoint width | 12 |
| H reconciliation batch | parent endpoint width | 13 |
| H refined entry flow | twice endpoint width | 14 |

Define:

```text
level = log₂(W/w)
rank = 15 * level + order + 1
```

Every dependency strictly decreases this rank:

- B → A and D → C reduce order at the same owner width.
- C → its B parent flow reduces order. A → its entry parent flow moves to the
  preceding, coarser owner width (or terminates in expansion).
- E → D, F batch → E, and F child → F batch reduce order. When the F parent's
  population is itself a spatial child, its owner is a further factor of two coarser.
- G entries → G batches → F batches, parent cells, or D flows reduce rank.
- H entries → H batches → D parent flows or G mixed-width margins reduce order.
- Direct expansion dependencies have rank zero. Zero-count and out-of-support
  shortcuts simply terminate earlier.

A factor-of-two increase in owner width reduces `level` by one, which dominates
any change of order within the table. Every reached owner width is at most `W`,
so `level` is a nonnegative integer. A chain starting at rank `R` consequently
has at most `R` contraction dependency edges before termination. Cached returns
can shorten the chain; neither clearing nor eviction is needed for this argument.

For an incidence or H batch marked expansion-owned, its direct entry reads also
terminate at zero. These branches do not reconstruct a temporal joint table.

## Finite branching and expansion work

The [local motion windows](./BIRDS_EXPANSION_PROTOTYPE.md#motion-windows-for-single-channel-queries)
bound every incidence and temporal-parent enumeration for fixed diffusion rate.
F and H have fixed-size subdivisions, and midpoint kernels have finite support.
Each dependency node therefore has finitely many children. Combined with the
rank bound, this gives a finite evaluation tree, even without memoization.

Expansion itself is not recursive through contraction. It constructs a prefix
of eager epochs in increasing order. Every expansion fact in the proof window
needs at most epoch `log₂(W/L₀)`. A finite initial population, finite kernel tables,
and a finite number of transport/bridge operations per epoch give a finite
prefix. Expansion cannot introduce a dependency back into the contraction tree.

This proves structural termination in representable geometry. It does **not**
prove polynomial total work: the rank bounds depth, not the number of distinct
nodes or repeated evaluations after eviction. CLI complexity measurements are
the next step. Nor does it establish the origin-relative envelope needed to
select finitely many channels in Birds 2b.

## Executable checks

Tests check that the coarse boundary facts are expansion terminals for multiple
origin scales and offsets. An optional engine observer reports each requested
dependency edge, including cache hits; tests assert strict rank decrease and
containment in the root's proof window. Cases include all seven engine node roles,
both time directions, zero and nonzero diffusion, cleared and warm caches, fine
widths down to `2⁻²⁴`, and times out to `±1024`. Observer exceptions restore the
previous diagnostic ancestry and do not alter subsequent sampled answers.

These tests check the implementation against the argument; they are not a formal
verification of the source code. With no observer, the engine builds no diagnostic
nodes and performs no rank calculations.
