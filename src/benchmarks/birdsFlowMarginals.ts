import { measureBirdsFlowMarginals } from './birdsFlowMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const epoch = Number(commandLine.process?.argv[2] ?? 4);
const sampleCount = Number(commandLine.process?.argv[3] ?? 200);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);
const cellWidth = 16 / 2 ** epoch;
let columns: readonly string[] | undefined;

for (const diffusionRate of diffusionRates) {
  const rows = measureBirdsFlowMarginals({
    epoch,
    sampleCount,
    populationDensity: 4 / cellWidth,
    diffusionRate,
    sourceSpatialIndex: 1,
    sourceTimeIndex: 1,
    destinationOffsets: [-2, -1, 0, 1, 2],
  });
  columns ??= Object.keys(rows[0]);
  if (diffusionRate === diffusionRates[0]) console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
  }
}
