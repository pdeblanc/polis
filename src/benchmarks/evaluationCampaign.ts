/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { EvaluationPlan } from './evaluationProtocol';
import type { SmokeTrial } from './evaluationSmoke';

export interface CampaignManifest {
  format: 1; plan: EvaluationPlan; selectedCases: number[]; fingerprint: string; commit: string;
  node: string; started: string; queryMs: number; caseMs: number; rssBytes: number;
  summaryStatus: string;
}
export type TrialRecord = { caseIndex: number; trial: number; elapsedMs: number; status: string; detail?: string; query?: string; result?: SmokeTrial };
export function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}
export function sourceFingerprint(): string {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z',
    'src', 'package.json', 'package-lock.json', 'tsconfig.app.json', 'docs/BIRDS_EVALUATION.md'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}
export function verifyResume(manifest: CampaignManifest, fingerprint: string, node = process.version) {
  if (manifest.format !== 1 || manifest.fingerprint !== fingerprint || manifest.node !== node) {
    throw new Error('Resume refused: source/dependencies/protocol or Node version differs from the saved manifest');
  }
}
export function trialPath(directory: string, caseIndex: number, trial: number) {
  return resolve(directory, `trial-${caseIndex}-${trial}.json`);
}
export function readCaseRecords(directory: string, caseIndex: number): TrialRecord[] {
  return readdirSync(directory).filter((name) => new RegExp(`^trial-${caseIndex}-[0-9]+\\.json$`).test(name))
    .map((name) => {
      const record = JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as TrialRecord;
      // Raw API payloads remain on disk; summaries only need counts and flows.
      for (const observation of record.result?.observations ?? []) delete observation.result;
      return record;
    }).sort((a, b) => a.trial - b.trial);
}
export function nextTrial(directory: string, caseIndex: number, count: number): number | undefined {
  for (let trial = 0; trial < count; trial++) if (!existsSync(trialPath(directory, caseIndex, trial))) return trial;
  return undefined;
}
export function parseCases(value: string | undefined, count: number): number[] {
  const selected = value === undefined ? Array.from({ length: count }, (_, i) => i) : value.split(',').map(Number);
  if (!selected.length || value === '' || new Set(selected).size !== selected.length ||
      selected.some((v) => !Number.isSafeInteger(v) || v < 0 || v >= count)) throw new Error('Invalid or duplicate case indices');
  return selected.sort((a, b) => a - b);
}
