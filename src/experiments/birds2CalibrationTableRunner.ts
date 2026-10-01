/// <reference types="node" />
import { writeCalibrationTable } from './birds2CalibrationTable';
import { writeCalibrationReference } from './birds2CalibrationReference';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run table:birds2-calibration -- --input measurements.jsonl --output measurements.queries.jsonl');
    console.log('Add --means to write Poisson reference distributions instead of sampled summaries.');
    return;
  }
  const options = new Map<string, string>();
  let means = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--means' && !means) { means = true; continue; }
    const value = args[++i];
    if (!['--input', '--output'].includes(name) || options.has(name) || !value || value.startsWith('--')) throw new Error('Expected --input PATH --output PATH');
    options.set(name, value);
  }
  if (options.size !== 2) throw new Error('Both --input and --output are required');
  const input = options.get('--input')!, output = options.get('--output')!;
  const rows = means ? await writeCalibrationReference(input, output, (completed, total) => {
    process.stderr.write(`Reference means: ${completed}/${total} parameter combinations\n`);
  }) : await writeCalibrationTable(input, output);
  console.log(`Saved ${rows} query/parameter rows to ${options.get('--output')}`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
