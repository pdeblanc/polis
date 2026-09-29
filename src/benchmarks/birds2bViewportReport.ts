/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Birds2bEngine } from '../models/birds2b/birds2bEngine';
import { CompositeEngine } from '../models/birds2b/compositeEngine';

// Fixed reference workloads, isolated so a slow case cannot leave a runaway process.
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  const width = Number(args[1]);
  const mode = args[2];
  const source = new Birds2bEngine('Polis 5', 2, 0.5);
  const engine = mode === 'composite' ? new CompositeEngine('Polis 5', 0.5, source) : source;
  const cells = [];
  for (let row = -12; row <= 12; row++) for (let column = -12; column < 12; column++) {
    cells.push({ min: column * width, max: (column + 1) * width, time: row * width ** 2 / 4 });
  }
  const selectionStart = performance.now();
  // Reference selector diagnostic only; composite queries select at their merge boundaries.
  const candidates = cells.map((cell) => source.candidateOrigins(cell).length);
  const selectionMs = performance.now() - selectionStart;
  let expected: number[] | undefined;
  for (const phase of ['cold', 'warm']) {
    const start = performance.now();
    const counts = cells.map((cell) => engine.queryCell(cell));
    const elapsedMs = performance.now() - start;
    if (expected && counts.some((count, index) => count !== expected![index])) throw new Error('Warm replay differs');
    expected = counts;
    console.log(JSON.stringify({ mode, width, phase, cells: cells.length, elapsedMs, referenceSelectionMs: selectionMs,
      maxCandidates: Math.max(...candidates), meanCandidates: candidates.reduce((a, b) => a + b, 0) / candidates.length,
      checksum: counts.reduce((a, b) => a + b, 0), ...source.getChannelUsage() }));
  }
} else {
  if (args.length) throw new Error('No benchmark options are currently supported');
  console.log(JSON.stringify({ kind: 'metadata', seed: 'Polis 5', density: 2, diffusion: 0.5,
    node: process.version, platform: process.platform, arch: process.arch, timeoutMs: 20_000 }));
  for (const width of [1, 0.25]) for (const mode of ['reference', 'composite']) {
    try {
      process.stdout.write(execFileSync(process.execPath,
        ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', String(width), mode],
        { encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }));
    } catch (error) {
      const failure = error as { code?: string; stdout?: string; message?: string };
      if (failure.stdout) process.stdout.write(failure.stdout);
      console.log(JSON.stringify({ mode, width, status: failure.code === 'ETIMEDOUT' ? 'timeout' : 'error', message: failure.message }));
      process.exitCode = 1;
    }
  }
}
