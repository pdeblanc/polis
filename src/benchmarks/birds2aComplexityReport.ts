/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Birds2aRequestLimit, birds2aComplexityCases, measureBirds2aComplexity,
  type Birds2aComplexityCase } from './birds2aComplexity';

const args = process.argv.slice(2);
if (args[0] === '--worker') {
  const spec = JSON.parse(args[1]) as Birds2aComplexityCase;
  try {
    console.log(JSON.stringify({ status: 'ok', ...measureBirds2aComplexity(spec, Number(args[2])) }));
  } catch (error) {
    console.log(JSON.stringify({ ...spec, status: error instanceof Birds2aRequestLimit ? 'request-limit' : 'error',
      error: error instanceof Error ? error.message : String(error) }));
    if (!(error instanceof Birds2aRequestLimit)) process.exitCode = 1;
  }
} else {
  let sweep = false, filter: string | undefined, timeoutMs = 15_000, maxRequests = 250_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sweep') sweep = true;
    else if (args[i] === '--case') filter = args[++i];
    else if (args[i] === '--timeout-ms') timeoutMs = Number(args[++i]);
    else if (args[i] === '--max-requests') maxRequests = Number(args[++i]);
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (![timeoutMs, maxRequests].every((n) => Number.isSafeInteger(n) && n > 0) ||
    (args.includes('--case') && !filter)) throw new Error('Expected positive integer limits and a nonempty case filter');
  const cases = birds2aComplexityCases(sweep).filter((spec) => !filter || spec.id.includes(filter));
  if (!cases.length) throw new Error('No benchmark cases match');
  console.log(JSON.stringify({ kind: 'metadata', node: process.version, platform: process.platform, arch: process.arch,
    cases: cases.length, timeoutMs, maxRequests, timestamp: new Date().toISOString() }));
  for (const spec of cases) {
    console.error(`Benchmarking ${spec.id}`);
    try {
      process.stdout.write(execFileSync(process.execPath,
        ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', JSON.stringify(spec), String(maxRequests)],
        { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
      const failure = error as { code?: string; stdout?: string; message?: string };
      if (failure.stdout?.trim()) process.stdout.write(failure.stdout);
      else console.log(JSON.stringify({ ...spec, status: failure.code === 'ETIMEDOUT' ? 'timeout' : 'error', error: failure.message }));
      if (failure.code !== 'ETIMEDOUT') process.exitCode = 1;
    }
  }
}
