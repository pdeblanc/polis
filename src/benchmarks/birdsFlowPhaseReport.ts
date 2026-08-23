import { measureBirdsFlowPhases } from './birdsFlowPhases';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const epoch = Number(commandLine.process?.argv[2] ?? 4);
const sampleCount = Number(commandLine.process?.argv[3] ?? 50);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);
const cellWidth = 16 / 2 ** epoch;
let columns: readonly string[] | undefined;

for (const diffusionRate of diffusionRates) {
  const { summaries } = measureBirdsFlowPhases({
    epoch,
    sampleCount,
    populationDensity: 4 / cellWidth,
    diffusionRate,
    timeIndices: [1, 2, 3, 4],
  });
  columns ??= Object.keys(summaries[0]);
  if (diffusionRate === diffusionRates[0]) console.log(columns.join('\t'));
  for (const summary of summaries) {
    console.log(columns.map((column) => String(summary[column as keyof typeof summary])).join('\t'));
  }
}
