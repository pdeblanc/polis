import { measureBirdsPopulationPhases } from './birdsPopulationPhases';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const epoch = Number(commandLine.process?.argv[2] ?? 8);
const sampleCount = Number(commandLine.process?.argv[3] ?? 50);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);
if (diffusionRates.some((rate) => !Number.isFinite(rate) || rate < 0)) {
  throw new RangeError('Diffusion rates must be finite nonnegative numbers');
}
const cellWidth = 16 / 2 ** epoch;
let columns: readonly string[] | undefined;
for (const diffusionRate of diffusionRates) {
  const rows = measureBirdsPopulationPhases({
    epoch,
    sampleCount,
    populationDensity: 4 / cellWidth,
    diffusionRate,
    timeIndices: [1, 2, 3, 4],
  });
  columns ??= Object.keys(rows[0]);
  if (diffusionRate === diffusionRates[0]) console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
  }
}
