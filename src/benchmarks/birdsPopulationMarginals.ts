import {
  BIRDS_POPULATION_CASES,
  measureBirdsPopulationMarginal,
} from './birdsPopulationMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const sampleArgument = commandLine.process?.argv[2];
const sampleCount = sampleArgument === undefined ? 1_000 : Number(sampleArgument);
if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) {
  throw new RangeError('Sample count must be a safe integer of at least two');
}
const requestedNames = new Set(commandLine.process?.argv.slice(3) ?? []);
const cases =
  requestedNames.size === 0
    ? BIRDS_POPULATION_CASES.filter(({ name }) => !name.endsWith('-density-compensated'))
    : BIRDS_POPULATION_CASES.filter(({ name }) => requestedNames.has(name));
if (cases.length === 0) throw new RangeError('No population characterization case matched');

const rows = cases.map((testCase) =>
  measureBirdsPopulationMarginal(testCase, sampleCount),
);
const columns = Object.keys(rows[0]);
console.log(columns.join('\t'));
for (const row of rows) {
  console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
}
