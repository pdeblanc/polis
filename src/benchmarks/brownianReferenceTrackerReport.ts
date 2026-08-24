import { measureBrownianReferenceTracker } from './brownianReferenceTracker';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const arguments_ = commandLine.process?.argv.slice(2) ?? [];
const candidateCount = Number(arguments_[0] ?? 500);
const refinementArgument = arguments_.find((value) => value.startsWith('--max-refinements='));
const maxRefinements = Number(refinementArgument?.split('=')[1] ?? 32);
const diffusionArguments = arguments_.slice(1).filter((value) => !value.startsWith('--'));
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);

const summaries = diffusionRates.map((diffusionRate) =>
  measureBrownianReferenceTracker({
    candidateCount,
    cellWidth: 4,
    timeStep: 4,
    populationDensity: 1 / 16,
    diffusionRate,
    ringCellCount: 256,
    sourceCellIndex: 0,
    steps: 8,
    maxQueries: 10_000,
    maxRefinements,
  }).summary,
);

const columns = Object.keys(summaries[0]) as Array<keyof (typeof summaries)[number]>;
console.log(columns.join('\t'));
for (const summary of summaries) {
  console.log(columns.map((column) => String(summary[column])).join('\t'));
}
