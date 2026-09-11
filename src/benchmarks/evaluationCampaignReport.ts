/// <reference types="node" />
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, cpus, platform } from 'node:os';
import { evaluationPlan, type EvaluationPlan } from './evaluationProtocol';
import { runSmokeTrial, summarizeSmoke, type SmokeTrial } from './evaluationSmoke';
import { atomicJson, sourceFingerprint, verifyResume, trialPath, readCaseRecords, nextTrial, parseCases,
  type TrialRecord, type CampaignManifest } from './evaluationCampaign';

const script = fileURLToPath(import.meta.url);
if (process.argv[2] === '--worker') {
  const plan = evaluationPlan(process.argv[3] as EvaluationPlan['tier']);
  try {
    const result = runSmokeTrial(Number(process.argv[4]), Number(process.argv[5]), (id) => {
      process.send?.({ kind: 'query', id, rss: process.memoryUsage().rss });
    }, plan);
    process.send?.({ kind: 'result', result }, () => process.disconnect());
  } catch (error) {
    process.send?.({ kind: 'failure', detail: String(error) }, () => process.disconnect());
  }
} else {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--tier', '--output', '--resume', '--cases', '--max-trials', '--session-minutes', '--plan'].includes(key) || flags.has(key)) throw new Error(`Unknown or duplicate argument: ${key}`);
    if (key === '--plan') flags.set(key, 'true');
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`); flags.set(key, value); }
  }
  if (flags.has('--resume') && ['--tier', '--output', '--cases', '--plan'].some((k) => flags.has(k))) throw new Error('Resume uses the saved tier and case selection');
  const tier = flags.get('--tier') ?? 'standard-A';
  if (tier !== 'smoke' && tier !== 'standard-A') throw new Error('Only smoke and standard-A collection are implemented');
  const plan = evaluationPlan(tier);
  const selectedCases = parseCases(flags.get('--cases'), plan.cases.length);
  const maxTrials = flags.has('--max-trials') ? Number(flags.get('--max-trials')) : Infinity;
  const minutes = Number(flags.get('--session-minutes') ?? 120);
  if ((maxTrials !== Infinity && (!Number.isSafeInteger(maxTrials) || maxTrials < 1)) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 120) throw new Error('Invalid session limit');
  if (flags.has('--plan')) console.log(JSON.stringify({ ...plan, selectedCases, expectedTrials: selectedCases.length * plan.trialsPerCase,
    execution: false, analysis: 'Point estimates only; bootstrap/TV calibration and batches B–F are not implemented' }, null, 2));
  else await campaign();

  async function campaign() {
    const directory = resolve(flags.get('--resume') ?? flags.get('--output') ?? `artifacts/evaluation-${tier}-${Date.now()}`);
    const manifestPath = resolve(directory, 'manifest.json');
    let manifest: CampaignManifest;
    const fingerprint = sourceFingerprint();
    if (flags.has('--resume')) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      verifyResume(manifest, fingerprint);
    } else {
      mkdirSync(dirname(directory), { recursive: true }); mkdirSync(directory);
      manifest = { format: 1, plan, selectedCases, fingerprint, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        node: process.version, started: new Date().toISOString(), queryMs: 2000, caseMs: 600000, rssBytes: 2 * 1024 ** 3,
        summaryStatus: 'Point estimates only; no bootstrap or reference Monte Carlo. Not the full A–F suite.' };
      atomicJson(manifestPath, { ...manifest, host: hostname(), cpu: cpus()[0]?.model, platform: platform(),
        dirtyStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
        dirtyDiff: execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 }),
        memoryEnforcement: 'Query-boundary RSS samples and 1536 MiB V8 heap cap, not continuous RSS enforcement' });
    }
    const lock = resolve(directory, 'lock.json');
    if (existsSync(lock)) {
      const owner = JSON.parse(readFileSync(lock, 'utf8'));
      if (owner.host !== hostname()) throw new Error('Lock belongs to another host; inspect it before resuming');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw error; }
      if (alive) throw new Error('Campaign is already running');
      unlinkSync(lock);
    }
    const fd = openSync(lock, 'wx'); writeFileSync(fd, JSON.stringify({ host: hostname(), pid: process.pid })); closeSync(fd);
    const activePath = resolve(directory, 'active.json');
    const interruptedPath = resolve(directory, 'interrupted.json');
    const interrupted: { caseIndex: number; trial: number; elapsedMs: number }[] = existsSync(interruptedPath) ? JSON.parse(readFileSync(interruptedPath, 'utf8')) : [];
    let stop = false;
    const onSignal = () => { stop = true; };
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    try {
      if (existsSync(activePath)) {
        const active = JSON.parse(readFileSync(activePath, 'utf8'));
        if (!existsSync(trialPath(directory, active.caseIndex, active.trial))) {
          interrupted.push({ caseIndex: active.caseIndex, trial: active.trial, elapsedMs: Math.min(manifest.caseMs, Math.max(0, Date.now() - active.started)) });
          atomicJson(interruptedPath, interrupted);
        }
        unlinkSync(activePath);
      }
      const sessionStart = Date.now();
      let attempts = 0;
      for (const caseIndex of manifest.selectedCases) {
        let records = readCaseRecords(directory, caseIndex);
        let spent = records.reduce((s, r) => s + r.elapsedMs, 0) + interrupted.filter((r) => r.caseIndex === caseIndex).reduce((s, r) => s + r.elapsedMs, 0);
        let trial = nextTrial(directory, caseIndex, manifest.plan.trialsPerCase);
        while (trial !== undefined && spent < manifest.caseMs && !stop && attempts < maxTrials && Date.now() - sessionStart < minutes * 60000) {
          const started = Date.now();
          atomicJson(activePath, { caseIndex, trial, started });
          const record = await runWorker(manifest, caseIndex, trial, Math.min(manifest.caseMs - spent, minutes * 60000 - (Date.now() - sessionStart)));
          atomicJson(trialPath(directory, caseIndex, trial), record);
          unlinkSync(activePath);
          spent += record.elapsedMs; attempts++;
          console.log(`Case ${caseIndex}, trial ${trial}: ${record.status}`);
          trial = nextTrial(directory, caseIndex, manifest.plan.trialsPerCase);
        }
        // Strip redundant raw response payloads before retaining a whole case in memory.
        records = readCaseRecords(directory, caseIndex);
        const completed = records.flatMap((r) => r.result ? [r.result] : []);
        for (const r of completed) for (const o of r.observations) delete o.result;
        const summary = summarizeSmoke(caseIndex, completed, manifest.plan);
        atomicJson(resolve(directory, `case-${caseIndex}.json`), { ...summary,
          collectionStatus: records.length === manifest.plan.trialsPerCase ? 'all-trials-attempted' : spent >= manifest.caseMs ? 'case-budget-exhausted' : 'paused',
          analysisStatus: manifest.summaryStatus, attemptedTrials: records.length, elapsedMs: spent,
          failedTrials: records.filter((r) => !r.result) });
        if (stop || attempts >= maxTrials || Date.now() - sessionStart >= minutes * 60000) break;
      }
      console.log(`Checkpoint: ${directory}`);
    } finally {
      process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); unlinkSync(lock);
    }
  }
}

function runWorker(manifest: CampaignManifest, caseIndex: number, trial: number, remainingMs: number): Promise<TrialRecord> {
  return new Promise((done) => {
    const start = Date.now();
    const child = fork(script, ['--worker', manifest.plan.tier, String(caseIndex), String(trial)], {
      execArgv: ['--import', 'tsx', '--max-old-space-size=1536'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let pending: Omit<TrialRecord, 'caseIndex' | 'trial' | 'elapsedMs'> | undefined;
    let query: string | undefined;
    let stderr = '';
    let timer: ReturnType<typeof setTimeout>;
    const finish = (status: string, detail?: string, result?: SmokeTrial) => {
      if (pending) return;
      pending = { status, detail, result, query }; clearTimeout(timer); clearTimeout(deadline); child.kill('SIGKILL');
    };
    const deadline = setTimeout(() => finish('deadline'), Math.max(1, remainingMs));
    timer = setTimeout(() => finish('startup-timeout'), 10000);
    child.stderr?.on('data', (data) => { stderr = (stderr + String(data)).slice(-8000); });
    child.on('message', (message: { kind: string; id?: string | null; rss?: number; result?: SmokeTrial; detail?: string }) => {
      if (pending) return;
      if (message.kind === 'result') finish('complete', undefined, message.result);
      else if (message.kind === 'failure') finish('error', message.detail);
      else if (message.kind === 'query') {
        clearTimeout(timer); query = message.id ?? undefined;
        if ((message.rss ?? 0) > manifest.rssBytes) finish('memory-limit');
        else if (query) timer = setTimeout(() => finish('query-timeout'), manifest.queryMs);
      }
    });
    child.on('error', (error) => { clearTimeout(timer); clearTimeout(deadline); done({ caseIndex, trial, elapsedMs: Date.now() - start, status: 'worker-error', detail: error.message }); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); clearTimeout(deadline);
      done({ caseIndex, trial, elapsedMs: Date.now() - start, ...(pending ?? { status: 'worker-exit', detail: `${code}/${signal}: ${stderr}`, query }) });
    });
  });
}
