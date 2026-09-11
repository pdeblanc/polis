/// <reference types="node" />
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluationPlan } from './evaluationProtocol';
import { SMOKE_CASES, SMOKE_STRATA, smokeObservations, runSmokeTrial, countStatistics } from './evaluationSmoke';
import { atomicJson, nextTrial, readCaseRecords, trialPath, parseCases, verifyResume, type CampaignManifest } from './evaluationCampaign';

describe('evaluation campaign', () => {
  it('summarizes high-mean unions without Poisson underflow', () => {
    const result = countStatistics([1088, 1089], 1088);
    expect(result.K).toBeGreaterThan(1088);
    expect(result.tv).toBeGreaterThan(0);
    expect(result.tv).toBeLessThan(1);
  });
  it('preserves smoke inputs and expands the prescribed standard-A matrix', () => {
    expect(evaluationPlan('smoke').cases).toEqual(SMOKE_CASES);
    expect(evaluationPlan('smoke').strata).toEqual(SMOKE_STRATA);
    const plan = evaluationPlan('standard-A');
    expect(plan.cases).toHaveLength(120);
    expect(plan.trialsPerCase).toBe(512);
    expect(plan.strata).toHaveLength(16);
    expect(evaluationPlan('standard-A')).toEqual(plan);
    expect(new Set(plan.cases.map((c) => JSON.stringify(c))).size).toBe(120);
    for (const c of plan.cases) {
      expect(c.rho * c.L).toBe(c.mu);
      expect([0.25, 1]).toContain(c.T / c.L ** 2);
      expect(smokeObservations(c, plan.strata)).toHaveLength(1296);
    }
  });
  it('does not replay trials after the first 32', () => {
    let calls = 0;
    const trial = runSmokeTrial(0, 32, (id) => { if (id !== null) calls++; }, evaluationPlan('standard-A'));
    expect(calls).toBe(1296);
    expect(trial.consistency.failures).toEqual([]);
    expect(trial.replayFailures).toEqual([]);
  });
  it('resumes past committed failures, ignores temporary files, and preserves checkpoints', () => {
    const directory = mkdtempSync(join(tmpdir(), 'polis-campaign-test-'));
    try {
      const path = trialPath(directory, 0, 0);
      atomicJson(path, { caseIndex: 0, trial: 0, status: 'query-timeout', elapsedMs: 2000 });
      const original = readFileSync(path, 'utf8');
      atomicJson(`${trialPath(directory, 0, 1)}.tmp`, { incomplete: true });
      expect(nextTrial(directory, 0, 2)).toBe(1);
      expect(readCaseRecords(directory, 0)).toHaveLength(1);
      atomicJson(trialPath(directory, 0, 1), { caseIndex: 0, trial: 1, status: 'error', elapsedMs: 1 });
      expect(nextTrial(directory, 0, 2)).toBeUndefined();
      expect(readFileSync(path, 'utf8')).toBe(original);
    } finally { rmSync(directory, { recursive: true }); }
  });
  it('rejects mismatched sources or runtime and invalid selections', () => {
    const manifest = { format: 1, fingerprint: 'abc', node: 'v1' } as CampaignManifest;
    expect(() => verifyResume(manifest, 'abc', 'v1')).not.toThrow();
    expect(() => verifyResume(manifest, 'def', 'v1')).toThrow();
    expect(() => verifyResume(manifest, 'abc', 'v2')).toThrow();
    expect(parseCases('3,1', 4)).toEqual([1, 3]);
    for (const value of ['', '1,1', '-1', '4', 'NaN']) expect(() => parseCases(value, 4)).toThrow();
  });
});
