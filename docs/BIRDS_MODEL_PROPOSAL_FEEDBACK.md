> **Status: Incorporated review record.** Its revisions are reflected in the canonical
> Birds design currently being implemented:
> [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md).

I reviewed the revised Birds design and Q&A. I think the design is now in good shape to implement. The Q&A resolved most of the issues that were underspecified in the earlier version, especially support closure, construction vs. subdivision capability, stochastic ownership, legality/classification, and the interpretation of the diffusion parameter.

A few comments and revisions:

**1. Fixed-point support looks like the right solution.**
I like defining ordinary-flow support as the minimal finite set closed under the actual epoch refinement operations, rather than trying to impose a simple analytic Brownian envelope that refinement can violate. The contraction/termination argument plus a computed exact closure should be the normative definition. More generally, dependency bounds should be closed under the actual refinement operators, not merely derived from the continuous process we're approximating.

**2. Keep construction and subdivision capability separate.**
A hierarchy object should have one canonical explanation for how its count was constructed, but that should not determine what subdivisions it can subsequently own. In particular, a flow produced by spatial refinement may later own a temporal subdivision. I like the proposed classifier/owner-projection approach. Epochs/stages/ranks should remain specification and test concepts rather than concepts explicitly represented in the recursive query implementation.

**3. The revised interpretation of `diffusionRate` is good.**
It should parameterize the Brownian innovation variance used during temporal subdivision, not promise that the final discretized hierarchy has empirical variance rate exactly (D). Spatial subdivision itself introduces displacement, including at (D=0). Statistical comparison with a Poisson–Brownian reference should therefore be characterization rather than a correctness test.

**4. Make the probabilistic assumption in the final spatial reconciliation explicit.**
In Stage H, after G1 establishes source-child margins and G2 establishes destination-child margins, we sample the (2\times2) table with a hypergeometric distribution. This corresponds to an exchangeability assumption: conditional on those margins, the source-child and destination-child memberships of the birds in the coarse flow are coupled as a uniformly random matching. I think that's the intended approximation, but it is important enough to state explicitly.

**5. Keep the public resolution/capability API semantically specified but syntactically provisional.**
The important contract is that a consumer can request approximately the resolution it wants, learn the exact legal resolution it received, and continue from that exact lattice without independently re-snapping subsequent queries. I'm less concerned that we commit immediately to the exact capability-object API proposed in the document. We can let actual visualization/tracker usage inform that.

**6. Be precise about what “bounded queries” means.**
Dependency sets and result sets are finite for fixed model parameters, but their sizes can grow with `diffusionRate` (roughly with (\sqrt D)). The public result ceiling can reject impractically large requests. We shouldn't accidentally imply a parameter-independent constant bound.

**7. I want to revise the tagged-bird tracker design somewhat.**
I don't think tracking necessarily becomes a simple deterministic walk after choosing the initial exchangeable unit. It looks more like an adaptive search over already-determined hierarchy facts.

The tracker should maintain a strong invariant: **every committed waypoint is a cell containing exactly one bird**. Suppose the tagged bird is isolated in source cell (A), and at the desired next resolution its unique populated outgoing flow reaches destination cell (B). If `population(B) === 1`, we can commit (B) and continue. If `population(B) >= 2`, we cannot safely continue identity through (B), because the model doesn't retain an incoming-to-outgoing correspondence among multiple exchangeable birds.

In that case the candidate segment is a dead path and the tracker should backtrack to its last committed singleton source. It can then refine the segment. Two obvious possibilities are:

- request an asymmetric flow with a smaller destination cell and follow the unique child flow containing the tagged unit;
- subdivide the singleton source cell and continue from the unique source child containing the unit, then request a compatible finer flow.

The search continues until the destination is itself singleton, at which point that destination becomes the next committed waypoint.

I suspect we **never need to backtrack across two committed waypoints**. A failed continuation only means that the most recently proposed segment was too coarse. The previous committed waypoint still uniquely identifies the tagged bird, so we only need to reconsider the segment leaving that waypoint. This should be proved/tested against the legal asymmetric-flow/refinement cases rather than simply assumed.

Conversely, the tracker should **coarsen aggressively when the bird is isolated**. Subject to the consumer's requested spatial/temporal resolution, it should use the coarsest cell/longest legal segment that continues to isolate the bird. If the parent of a singleton cell also has population one, then it represents the same unique bird and the extra spatial refinement is unnecessary. Thus the tracker naturally becomes fine around encounters with other birds and coarse in sparse regions.

One useful way to describe the tracker is therefore: it searches for a **singleton spacetime tube** around an initially selected exchangeable unit, refining around collisions/ambiguities and coarsening where possible. Identity is not an additional fact stored by the Birds model; it is something the consumer can recover wherever the population hierarchy provides enough resolution to distinguish the selected unit.

The initial tag can still be the only new random choice made by the tracker. Backtracking/refinement should query already-defined Birds facts rather than introduce new traversal-dependent randomness.

**8. The sampler plan looks ready for implementation.**
The H2PE hypergeometric prototype results make me comfortable proceeding with exact samplers initially. Approximate large-(N) samplers can wait for profiling. Likewise, the stronger monotonicity questions are worth investigating after the main model works rather than blocking it.

Overall, I don't think we need another broad design-Q&A round before implementation. I'd incorporate the Stage-H clarification and revised tracker concept, leave the exact public capability API somewhat flexible, and proceed with the proposed implementation sequence. The tracker in particular should probably be implemented only after the underlying population/flow capability API is exercised enough that we understand what adaptive refinement operations it actually needs.
