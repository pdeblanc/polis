/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { Birds2aExpansion } from '../models/birds2a/expansion';
import { birds2ExpansionManifest as manifest, type ExpansionMeasurementStage } from './birds2ExpansionManifest';
import { measureExpansionWorld, readExpansionMeasurements } from './birds2ExpansionMeasurements';

it('reads every stage, preserves zero observations and matches a filtered run', () => {
  const parameters = { origin: { min: 0, max: 1 }, populationDensity: 2.5, diffusionRate: 0.5 };
  const all = measureExpansionWorld('measurement-test', parameters, manifest.stages);
  expect(all).toHaveLength(manifest.stages.length);
  for (const [index, counts] of all.entries()) {
    expect(counts).toHaveLength(manifest.stages[index].queries.length);
    expect(counts.every((count) => Number.isSafeInteger(count) && count >= 0)).toBe(true);
  }
  const stageIndex = manifest.stages.findIndex((stage) => stage.id === 'epoch-2.backward.second-split');
  expect(measureExpansionWorld('measurement-test', parameters, [manifest.stages[stageIndex]])).toEqual([all[stageIndex]]);
  const empty = measureExpansionWorld('empty-measurement', { ...parameters, populationDensity: 0 }, manifest.stages);
  expect(empty.flat().every((count) => count === 0)).toBe(true);
});

it('reads nonzero three-time counts and rejects missing records or incompatible geometry', () => {
  const model = new Birds2aExpansion('bridge-reader', 250, 0.5);
  const epoch = model.getEpoch(1);
  if (epoch.kind !== 'expanded') throw new Error('Expected expansion');
  for (const branch of ['forward', 'backward'] as const) {
    for (const record of ['firstBridges', 'secondBridges'] as const) {
      const batches = epoch[`${branch}Extension`][record];
      const batch = batches.find((batch) => batch.intermediates.some(({ count }) => count > 0))!;
      expect(batch).toBeDefined();
      const stage: ExpansionMeasurementStage = { id: 'test', title: 'Test', description: 'Test',
        epoch: 1, branch, record: `${branch}Extension.${record}`,
        queries: batch.intermediates.map(({ cell }, index) => ({
          id: String(index), kind: 'temporal-split',
          from: { ...batch.fromCell, time: batch.fromTime }, via: { ...cell, time: batch.time },
          to: { ...batch.toCell, time: batch.toTime },
        })),
      };
      expect(readExpansionMeasurements(epoch, stage)).toEqual(batch.intermediates.map(({ count }) => count));
      expect(readExpansionMeasurements(epoch, stage).reduce((a, b) => a + b, 0)).toBe(batch.count);
      expect(() => readExpansionMeasurements(epoch, { ...stage, record: 'notThere' })).toThrow(/Missing/);
    }
  }
  const stage = manifest.stages[0];
  expect(() => readExpansionMeasurements(model.getEpoch(0), { ...stage, queries: [{
    id: 'invalid-time', kind: 'population', cell: { min: 0, max: 1, time: 0.25 },
  }] })).toThrow(/geometry/);
});

it('CLI writes self-describing samples, advances progress and refuses to overwrite output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polis-expansion-test-'));
  const output = join(directory, 'measurements.jsonl');
  const cli = (args: string[]) => spawnSync(process.execPath,
    ['--import', 'tsx', resolve('src/experiments/birds2ExpansionRunner.ts'), ...args],
    { encoding: 'utf8', timeout: 15000 });
  try {
    const args = ['--seed-count', '2', '--stage', 'initial.origin-population', '--output', output];
    const run = cli(args);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain('2/2 seeds');
    expect(run.stderr).toContain('32 worlds');
    const original = readFileSync(output, 'utf8');
    const lines = original.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0].manifest.seeds.count).toBe(2);
    expect(lines[0].manifest.stages.map((stage: { id: string }) => stage.id)).toEqual(['initial.origin-population']);
    const samples = lines.filter((line) => line.type === 'sample');
    expect(samples).toHaveLength(32);
    expect(samples[0]).toMatchObject({ seedId: 0, parameterIndex: 0 });
    expect(samples.at(-1)).toMatchObject({ seedId: 1, parameterIndex: 15 });
    expect(samples.every((sample) => sample.counts.length === 1 && sample.counts[0].length === 1)).toBe(true);
    expect(lines.at(-1)).toMatchObject({ type: 'complete', completedSeeds: 2, completedWorlds: 32 });
    const fullOutput = join(directory, 'all-stages.jsonl');
    const full = cli(['--seed-count', '1', '--output', fullOutput]);
    expect(full.status, full.stderr).toBe(0);
    const fullLines = readFileSync(fullOutput, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(fullLines[0].manifest.stages).toHaveLength(manifest.stages.length);
    const fullSamples = fullLines.filter((line) => line.type === 'sample');
    expect(fullSamples).toHaveLength(16);
    for (const [index, sample] of fullSamples.entries()) {
      expect(sample.counts.flat()).toHaveLength(7415);
      expect(sample.counts[0]).toEqual(samples[index].counts[0]);
    }
    expect(cli(args).status).not.toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(original);
    expect(cli(['--seed-count', '0', '--output', join(directory, 'bad-count')]).status).not.toBe(0);
    expect(cli(['--stage', 'not-a-stage', '--output', join(directory, 'bad-stage')]).status).not.toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 20000);
