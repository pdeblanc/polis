# Polis documentation

This directory contains the project's technical reference material and design records.

For a presentation of Birds, start with [`BIRDS_OVERVIEW.md`](./BIRDS_OVERVIEW.md), then
use the analysis summary for findings and the canonical proposal for mathematical detail.

- [`PROJECT.md`](./PROJECT.md) describes the current application as an implemented
  artifact: its architecture, mathematical models, user interface, invariants, and
  verification strategy.
- [`DESIGN.md`](./DESIGN.md) is the original technical design for the starter project.
  It records the intended scope and implementation constraints that guided the first
  starfield and terrain models.
- [`DESIGN_QA.md`](./DESIGN_QA.md) is the decision log created while reviewing and refining
  the starter design.
- [`DESIGN_CHANGES.md`](./DESIGN_CHANGES.md) compares the starter design with the resulting
  implementation, including justified departures and issues retained for review.
- [`BIRDS_OVERVIEW.md`](./BIRDS_OVERVIEW.md) introduces the implemented model, its recursive
  construction, API and viewer, tracking, findings, and changes relative to the proposal.
- [`BIRDS_EXPANSION_PROTOTYPE.md`](./BIRDS_EXPANSION_PROTOTYPE.md) describes the standalone
  outward-expansion experiment for a possible next revision, its retained contribution
  records, and CLI. It does not replace the production v1 specification.
- [`BIRDS_DESIGN_PROPOSAL.md`](./BIRDS_DESIGN_PROPOSAL.md) is the **canonical v1
  specification** for the implemented birds model.
- [`BIRDS_ACCEPTANCE_AUDIT.md`](./BIRDS_ACCEPTANCE_AUDIT.md) maps acceptance requirements
  to evidence and agreed deferrals, and records closure of the v1 milestone.
- [`BIRDS_IMPLEMENTATION_NOTES.md`](./BIRDS_IMPLEMENTATION_NOTES.md) is the active record
  of Birds implementation discoveries, provisional limitations, and concrete internal
  choices that do not override the canonical design.
- [`BIRDS_ANALYSIS.md`](./BIRDS_ANALYSIS.md) is the active record of empirical and
  mathematical investigations of the implemented Birds model, including population
  bounds and the proposed gamma-process/Poisson-race sampler experiments.
- [`BIRDS_ANALYSIS_SUMMARY.md`](./BIRDS_ANALYSIS_SUMMARY.md) synthesizes the v1 findings,
  their limitations, and explicitly deferred decisions.
- [`BIRDS_EVALUATION.md`](./BIRDS_EVALUATION.md) defines a reusable, model-independent
  evaluation scorecard and concrete measurement protocol (parameters, observations,
  trials, budgets, and reporting), distinguishing existing evidence from missing coverage.
- [`BIRDS_EVALUATION_RUNBOOK.md`](./BIRDS_EVALUATION_RUNBOOK.md) records the Birds baseline,
  resumable standard-A commands, checkpoint behavior, and remaining runner coverage.
- [`BIRDS_MODEL_DESIGN.md`](./BIRDS_MODEL_DESIGN.md) is the preliminary birds design and is
  retained as historical review input.
- [`BIRDS_DESIGN_QA.md`](./BIRDS_DESIGN_QA.md) is the completed decision log that produced
  the canonical birds design.
- [`BIRDS_MODEL_PROPOSAL_FEEDBACK.md`](./BIRDS_MODEL_PROPOSAL_FEEDBACK.md) records the review
  feedback incorporated after the revised proposal was drafted.

For an introduction to the existing code, start with `PROJECT.md`. For birds implementation
work, use `BIRDS_DESIGN_PROPOSAL.md` as the normative specification. The other birds
documents are implementation context or review history and do not override it.
