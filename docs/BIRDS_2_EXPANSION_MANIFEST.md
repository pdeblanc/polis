# Birds 2 expansion experiment manifest

The executable specification is
[`birds2ExpansionManifest.ts`](../src/experiments/birds2ExpansionManifest.ts).
It is a serializable TypeScript object, not an experiment runner.

- `modelParameters` contains independent arrays of origins, population densities
  and diffusion rates. A runner takes their Cartesian product.
- `seeds` gives a prefix, first integer ID and count. Append each ID in ordinary
  decimal notation without padding or extra separators.
- `stages` lists the measurements in generation order. Each stage has an ID,
  title, description, epoch, branch where applicable, retained-record path and
  explicit queries.

The full experiment key is the stage ID plus the query ID. Query kinds are
`population`, `flow` and `temporal-split`. Each query contains fixed world
intervals and times; the same queries apply to every model parameter combination.
Flow and split endpoints are in outward generation order, including on the
negative-time branch. Retained-record paths are relative to the specified epoch.

Run every target, including targets outside the sampled support. Missing sparse
entries mean zero. Different stage/query keys can expose the same scalar fact;
those aliases are not independent samples. Reuse one model instance and its
retained expansion records for all queries with the same initialization.

The manifest contains no ground-truth values or reference-distribution
calculations. Those belong to separate evaluation code. It does not run
simulations on import.
