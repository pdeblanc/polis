import { measureBirdsPopulationPhases } from './birdsPopulationPhases';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const epoch = Number(commandLine.process?.argv[2] ?? 8);
const sampleCount = Number(commandLine.process?.argv[3] ?? 50);
const cellWidth = 16 / 2 ** epoch;
const rows = measureBirdsPopulationPhases({
  epoch,
  sampleCount,
  populationDensity: 4 / cellWidth,
  diffusionRate: 0.5,
  timeIndices: [1, 2, 3, 4],
});
const columns = Object.keys(rows[0]);
console.log(columns.join('\t'));
for (const row of rows) {
  console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
}
