import { measureBirdsTrajectories } from './birdsTrajectoryMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const maximumCandidates = Number(commandLine.process?.argv[2] ?? 200);
const retainedPaths = Number(commandLine.process?.argv[3] ?? 25);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0.5] : diffusionArguments.map(Number);
let columns: readonly string[] | undefined;

for (const diffusionRate of diffusionRates) {
  const rows = measureBirdsTrajectories({
    epoch: 2,
    maximumCandidates,
    retainedCollisionFreePaths: retainedPaths,
    steps: 8,
    populationDensity: 1 / 16,
    diffusionRate,
    sourceSpatialIndex: 0,
    sourceTimeIndex: 1,
  });
  columns ??= Object.keys(rows[0]);
  if (diffusionRate === diffusionRates[0]) console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
  }
}
