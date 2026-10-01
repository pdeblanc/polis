/// <reference types="node" />
import { writeCalibrationTable } from './birds2CalibrationTable';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: npm run table:birds2-calibration -- --input measurements.jsonl --output measurements.queries.jsonl');
    return;
  }
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!['--input', '--output'].includes(name) || options.has(name) || !value || value.startsWith('--')) throw new Error('Expected --input PATH --output PATH');
    options.set(name, value);
  }
  if (options.size !== 2) throw new Error('Both --input and --output are required');
  const rows = await writeCalibrationTable(options.get('--input')!, options.get('--output')!);
  console.log(`Saved ${rows} query/parameter rows to ${options.get('--output')}`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
