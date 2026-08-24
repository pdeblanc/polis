import { measureBirdsBridgeAndCrossing } from './birdsBridgeCrossingMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const trials = Number(commandLine.process?.argv[2] ?? 100);
const diffusionArguments = commandLine.process?.argv.slice(3) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0, 0.5, 1, 2, 4] : diffusionArguments.map(Number);
const results = diffusionRates.map((diffusionRate) => ({
  diffusionRate,
  measurement: measureBirdsBridgeAndCrossing({
    diffusionRate,
    epoch: 2,
    populationDensity: 16,
    trials,
  }),
}));

console.log('bridges');
printTable(results.flatMap(({ diffusionRate, measurement }) =>
  measurement.bridges.map((row) => ({ diffusionRate, ...row }))));
console.log('child crossings');
printTable(results.flatMap(({ diffusionRate, measurement }) =>
  measurement.crossings.map((row) => ({ diffusionRate, ...row }))));

function printTable<Row extends object>(rows: readonly Row[]): void {
  const columns = Object.keys(rows[0]) as Array<keyof Row>;
  console.log(columns.join('\t'));
  for (const row of rows) console.log(columns.map((column) => String(row[column])).join('\t'));
}
