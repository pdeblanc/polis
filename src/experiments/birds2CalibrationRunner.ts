/// <reference types="node" />
import { openSync, writeSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { birds2CalibrationManifest as manifest } from './birds2CalibrationManifest';
import { calibrationParameterCombinations, measureCalibrationWorld } from './birds2CalibrationMeasurements';

const usage = `Usage: npm run measure:birds2-calibration -- [options]
  --output PATH       JSONL output (default: birds2-calibration.jsonl; must not exist)
  --seed-count N      Positive number of seeds (default: ${manifest.seeds.count})
  --stage ID          Measure only this exact stage ID
  --list-stages       Print available IDs and titles, then exit
  --help              Show this help
`;

function main(): void {
  const args = process.argv.slice(2);
  let output = 'birds2-calibration.jsonl', seedCount: number = manifest.seeds.count, stageId: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help') { console.log(usage); return; }
    if (option === '--list-stages') {
      for (const stage of manifest.stages) console.log(`${stage.id}\t${stage.title}`);
      return;
    }
    if (!['--output', '--seed-count', '--stage'].includes(option)) throw new Error(`Unknown option: ${option}`);
    if (seen.has(option)) throw new Error(`Repeated option: ${option}`);
    seen.add(option);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--output') output = value;
    else if (option === '--stage') stageId = value;
    else {
      seedCount = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(seedCount) || seedCount < 1 ||
        !Number.isSafeInteger(manifest.seeds.firstId + seedCount - 1)) throw new Error('Invalid seed count');
    }
  }
  const stages = stageId === undefined ? manifest.stages : manifest.stages.filter((stage) => stage.id === stageId);
  if (!stages.length) throw new Error(`Unknown stage: ${stageId}; use --list-stages`);
  let git: { commit: string; dirty: boolean } | null = null;
  try {
    git = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0,
    };
  } catch { /* Running outside a Git checkout is supported. */ }
  const path = resolve(output);
  const fd = openSync(path, 'wx'); // Never overwrite measurements from an earlier run.
  const write = (record: unknown) => {
    const data = Buffer.from(JSON.stringify(record) + '\n');
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
  };
  const start = performance.now();
  let completedSeeds = 0, completedWorlds = 0, seedId = manifest.seeds.firstId, parameterIndex = 0;
  const progress = () => {
    const fraction = completedSeeds / seedCount, filled = Math.floor(fraction * 24);
    const bar = `[${'#'.repeat(filled)}${'-'.repeat(24 - filled)}] ${completedSeeds}/${seedCount} seeds | ${completedWorlds} worlds | ${((performance.now() - start) / 1000).toFixed(1)}s`;
    process.stderr.write(process.stderr.isTTY ? `\r\x1b[2K${bar}` : bar + '\n');
  };
  try {
    write({ type: 'manifest', formatVersion: 1, startedAt: new Date().toISOString(), git,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      manifest: { ...manifest, seeds: { ...manifest.seeds, count: seedCount }, stages },
      parameters: calibrationParameterCombinations,
      layout: 'Each sample counts[stageIndex][queryIndex] follows manifest.stages; parameterIndex refers to parameters.' });
    progress();
    for (let i = 0; i < seedCount; i++) {
      seedId = manifest.seeds.firstId + i;
      const seed = manifest.seeds.prefix + seedId;
      for (parameterIndex = 0; parameterIndex < calibrationParameterCombinations.length; parameterIndex++) {
        const counts = measureCalibrationWorld(seed, calibrationParameterCombinations[parameterIndex], stages);
        write({ type: 'sample', seedId, parameterIndex, counts });
        completedWorlds++;
      }
      completedSeeds++;
      progress();
    }
    write({ type: 'complete', completedSeeds, completedWorlds, elapsedMs: performance.now() - start });
    process.stderr.write(`\nSaved measurements to ${path}\n`);
  } catch (error) {
    // Preserve complete preceding world records, never substitute zeros for failures.
    write({ type: 'error', seedId, parameterIndex, completedSeeds, completedWorlds,
      message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    closeSync(fd);
    if (process.stderr.isTTY) process.stderr.write('\n');
  }
}

try { main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
