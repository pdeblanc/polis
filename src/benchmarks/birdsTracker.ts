import { measureTracker, TRACKER_BENCHMARK_CASES } from './trackerMeasurements';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const requestedNames = new Set(commandLine.process?.argv.slice(2) ?? []);
const cases =
  requestedNames.size === 0
    ? TRACKER_BENCHMARK_CASES
    : TRACKER_BENCHMARK_CASES.filter(({ name }) => requestedNames.has(name));
if (cases.length === 0) throw new RangeError('No tracker benchmark case matched');
const rows = cases.map(measureTracker);
const columns = Object.keys(rows[0]);
console.log(columns.join('\t'));
for (const row of rows) {
  console.log(columns.map((column) => String(row[column as keyof typeof row])).join('\t'));
}
