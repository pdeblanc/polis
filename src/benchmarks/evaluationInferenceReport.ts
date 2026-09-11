/// <reference types="node" />
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { analyzeEvaluationCase, INFERENCE_REPLICATES } from './evaluationInference';
import { atomicJson, readCaseRecords, parseCases, sourceFingerprint, type CampaignManifest } from './evaluationCampaign';

const args = process.argv.slice(2);
const input = args.shift();
if (!input || input.startsWith('--')) throw new Error('Usage: analyze:birds-evaluation DIRECTORY [--cases 0,1] [--output DIRECTORY] [--plan]');
const flags = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--cases', '--output', '--plan'].includes(key) || flags.has(key)) throw new Error(`Invalid argument: ${key}`);
  if (key === '--plan') flags.set(key, 'true');
  else {
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    flags.set(key, value);
  }
}
const directory = resolve(input);
const manifest: CampaignManifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
if (manifest.format !== 1 || !['smoke', 'standard-A'].includes(manifest.plan?.tier)) throw new Error('Expected a resumable campaign manifest');
const cases = flags.has('--cases') ? parseCases(flags.get('--cases'), manifest.plan.cases.length) : manifest.selectedCases;
if (cases.some((i) => !manifest.selectedCases.includes(i))) throw new Error('Case was not selected in the collection manifest');
const output = resolve(flags.get('--output') ?? resolve(directory, 'analysis-v1'));
if (flags.has('--plan')) {
  console.log(JSON.stringify({ input: directory, output, cases, replicates: INFERENCE_REPLICATES, execution: false }, null, 2));
} else {
  mkdirSync(output, { recursive: true });
  const analysisIdentity = { format: 1, fingerprint: sourceFingerprint(), node: process.version,
    collectionManifest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), replicates: INFERENCE_REPLICATES };
  const manifestPath = resolve(output, 'manifest.json');
  if (existsSync(manifestPath)) {
    const saved = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (JSON.stringify(saved.identity) !== JSON.stringify(analysisIdentity)) throw new Error('Analysis identity changed; choose a new output directory');
  } else atomicJson(manifestPath, { identity: analysisIdentity, input: directory,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString() });
  for (const caseIndex of cases) {
    const records = readCaseRecords(directory, caseIndex);
    const digest = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    const path = resolve(output, `case-${caseIndex}.json`);
    if (existsSync(path)) {
      if (JSON.parse(readFileSync(path, 'utf8')).inputDigest === digest) { console.log(`Case ${caseIndex}: already analyzed`); continue; }
      throw new Error(`Case ${caseIndex} data changed; choose a new output directory`);
    }
    const trials = records.flatMap((r) => r.result ? [r.result] : []);
    if (!trials.length) { console.log(`Case ${caseIndex}: no completed trials; skipped`); continue; }
    console.log(`Case ${caseIndex}: analyzing ${trials.length}/${manifest.plan.trialsPerCase} trials`);
    let lastProgress = Date.now();
    const result = analyzeEvaluationCase(caseIndex, trials, manifest.plan, INFERENCE_REPLICATES, (message) => {
      if (Date.now() - lastProgress > 10000) { console.log(`Case ${caseIndex}: ${message}`); lastProgress = Date.now(); }
    });
    atomicJson(path, { ...result, inputDigest: digest, attemptedTrials: records.length,
      failedTrials: records.filter((r) => !r.result), finished: new Date().toISOString() });
    console.log(`Case ${caseIndex}: saved ${path}`);
  }
}
