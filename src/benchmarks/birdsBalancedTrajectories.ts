import { measureBirdsBalancedTrajectories } from './birdsBalancedTrajectoryMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const candidatesPerPhase = Number(commandLine.process?.argv[2] ?? 100);
const pathsPerPhase = Number(commandLine.process?.argv[3] ?? 2);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);

for (const diffusionRate of diffusionRates) {
  const result = measureBirdsBalancedTrajectories({
    epoch: 2,
    candidatesPerPhase,
    pathsPerPhase,
    steps: 8,
    populationDensity: 1 / 16,
    diffusionRate,
  });
  console.log(`summary D=${diffusionRate}`);
  printTable(result.summaries);
  console.log(`phases D=${diffusionRate}`);
  printTable(result.phases);
}

function printTable<Row extends object>(rows: readonly Row[]): void {
  const columns = Object.keys(rows[0]) as Array<keyof Row>;
  console.log(columns.join('\t'));
  for (const row of rows) console.log(columns.map((column) => String(row[column])).join('\t'));
}
