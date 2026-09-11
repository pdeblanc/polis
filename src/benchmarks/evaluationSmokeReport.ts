/// <reference types="node" />
import { fork, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { SMOKE_CASES, SMOKE_STRATA, runSmokeTrial, summarizeSmoke, type SmokeTrial } from './evaluationSmoke';

const script = fileURLToPath(import.meta.url);
if (process.argv[2] === '--worker') {
  try {
    const result = runSmokeTrial(Number(process.argv[3]), Number(process.argv[4]), (id) => {
      process.send?.({ kind: 'query', id, rss: process.memoryUsage().rss });
    });
    process.send?.({ kind: 'result', result }, () => process.disconnect());
  } catch (error) {
    process.send?.({ kind: 'failure', detail: error instanceof Error ? error.stack : String(error) }, () => process.disconnect());
  }
} else {
  const output = resolve(process.argv[2] ?? `artifacts/evaluation-smoke-${Date.now()}`);
  // Never overwrite an existing run directory.
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output, { recursive: false });
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const files = ['docs/BIRDS_EVALUATION.md', 'src/benchmarks/evaluationSmoke.ts', 'src/benchmarks/evaluationSmokeReport.ts'];
  const manifest = { protocol: 1, tier: 'smoke', started: new Date().toISOString(), commit: git(['rev-parse', 'HEAD']),
    dirtyStatus: git(['status', '--short']), node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model,
    cases: SMOKE_CASES, strata: SMOKE_STRATA, trialsPerCase: 32, seedTemplate: 'Polis evaluation protocol 1 trial r',
    limits: { queryMs: 2000, caseMs: 600000, sessionMs: 7200000, rssBytes: 2 * 1024 ** 3, records: 65536 },
    memoryEnforcement: 'RSS sampled at query boundaries; V8 heap capped at 1536 MiB. Not a continuous RSS ceiling.',
    hashes: Object.fromEntries(files.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])),
    workingDiff: git(['diff', 'HEAD']), bootstrap: false, referenceMonteCarlo: false };
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const records: (SmokeTrial | { caseIndex: number; trial: number; status: string; detail?: string; query?: string })[] = [];
  const sessionStart = Date.now();
  for (let caseIndex = 0; caseIndex < SMOKE_CASES.length; caseIndex++) {
    const caseStart = Date.now();
    for (let trial = 0; trial < 32; trial++) {
      if (Date.now() - caseStart >= 600000 || Date.now() - sessionStart >= 7200000) break;
      const record = await new Promise<typeof records[number]>((done) => {
        const child = fork(script, ['--worker', String(caseIndex), String(trial)], {
          execArgv: ['--import', 'tsx', '--max-old-space-size=1536'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        let query: string | undefined;
        let timer: ReturnType<typeof setTimeout>;
        let stderr = '';
        let finished = false;
        const finish = (result: typeof records[number]) => {
          if (finished) return;
          finished = true; clearTimeout(timer); clearTimeout(caseTimer);
          child.kill();
          // Await exit so the next benchmark never overlaps a previous worker.
          child.once('exit', () => done(result));
        };
        const failure = (status: string, detail?: string) => finish({ caseIndex, trial, status, detail, query });
        const caseTimer = setTimeout(() => failure('case-timeout'), Math.min(600000 - (Date.now() - caseStart), 7200000 - (Date.now() - sessionStart)));
        timer = setTimeout(() => failure('startup-timeout'), 10000);
        child.stderr?.on('data', (data) => { stderr = (stderr + String(data)).slice(-8000); });
        child.on('message', (message: { kind: string; id?: string | null; rss?: number; result?: SmokeTrial; detail?: string }) => {
          if (finished) return;
          if (message.kind === 'result') finish(message.result!);
          else if (message.kind === 'failure') failure('error', message.detail);
          else if (message.kind === 'query') {
            clearTimeout(timer); query = message.id ?? undefined;
            if ((message.rss ?? 0) > 2 * 1024 ** 3) failure('memory-limit');
            else if (query) timer = setTimeout(() => failure('query-timeout'), 2000);
          }
        });
        child.once('error', (error) => failure('worker-error', error.message));
        child.once('exit', (code, signal) => {
          if (!finished) { finished = true; clearTimeout(timer); clearTimeout(caseTimer); done({ caseIndex, trial, status: 'worker-exit', detail: `${code}/${signal}: ${stderr}`, query }); }
        });
      });
      records.push(record);
      appendFileSync(resolve(output, 'trials.jsonl'), JSON.stringify(record) + '\n');
      if ((trial + 1) % 8 === 0 || record.status !== 'complete') console.log(`Case ${caseIndex + 1}/4 trial ${trial + 1}/32: ${record.status}`);
    }
    const summary = summarizeSmoke(caseIndex, records.filter((r): r is SmokeTrial => r.caseIndex === caseIndex && r.status === 'complete' && 'observations' in r));
    writeFileSync(resolve(output, `case-${caseIndex}.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ caseIndex, completedTrials: summary.completedTrials, statuses: summary.statuses,
      consistencyFailures: summary.consistencyFailures.length, replayFailures: summary.replayFailures.length }));
  }
  writeFileSync(resolve(output, 'run.json'), JSON.stringify({ finished: new Date().toISOString(), attempted: records.length,
    completed: records.filter((r) => r.status === 'complete').length, expected: 128 }, null, 2));
  console.log(`Artifacts: ${output}`);
}
