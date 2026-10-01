/// <reference types="node" />
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { sampleStatistics, writeCalibrationTable } from './birds2CalibrationTable';

const header = {
  type: 'manifest', formatVersion: 1,
  manifest: { id: 'historical-manifest', seeds: { prefix: 'test:', firstId: 7, count: 3 },
    stages: [{ id: 'test-stage', title: 'Title, with "quotes"', description: 'Two\nlines', epoch: 0, record: 'atZero',
      queries: [0, 1].map((i) => ({ id: `q${i}`, kind: 'population', cell: { min: i, max: i + 1, time: 0 } })) }] },
  parameters: [1, 2].map((populationDensity) => ({ origin: { min: 0, max: 1 }, populationDensity, diffusionRate: 0.5 })),
  git: { commit: 'test', dirty: false }, runtime: { node: 'test' },
};
const samples = [9, 7, 8].flatMap((seedId) => [1, 0].map((parameterIndex) => ({
  type: 'sample', seedId, parameterIndex, counts: [[seedId - 6 + parameterIndex, 0]],
})));
const complete = { type: 'complete', completedSeeds: 3, completedWorlds: 6 };

it('transposes by parameter/query, sorts seeds, retains metadata, and calculates sample statistics', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polis-table-test-'));
  try {
    const input = join(dir, 'source.jsonl'), output = join(dir, 'table.jsonl');
    const source = [header, ...samples, complete].map((r) => JSON.stringify(r)).join('\n');
    writeFileSync(input, source);
    expect(await writeCalibrationTable(input, output)).toBe(4);
    const records = readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ type: 'query-summary', formatVersion: 1, manifestId: 'historical-manifest',
      stage: { title: 'Title, with "quotes"', description: 'Two\nlines' }, query: { id: 'q0' }, parameterIndex: 0,
      seeds: { firstId: 7, prefix: 'test:', count: 3 },
      statistics: { n: 3, mean: 2, variance: 1, min: 1, max: 3 }, data: [1, 2, 3] });
    expect(records[0].statistics.standardError).toBeCloseTo(Math.sqrt(1 / 3));
    expect(records[1]).toMatchObject({ query: { id: 'q1' }, data: [0, 0, 0], statistics: { variance: 0 } });
    expect(records[2]).toMatchObject({ parameterIndex: 1, data: [2, 3, 4], statistics: { mean: 3 } });
    expect(records[0].parameters).toEqual(header.parameters[0]);
    expect(records[0].query).toEqual(header.manifest.stages[0].queries[0]);
    expect(records[0].source.git).toEqual(header.git);
    await expect(writeCalibrationTable(input, output)).rejects.toThrow(/exist/i);
    expect(readFileSync(input, 'utf8')).toBe(source);
    await expect(writeCalibrationTable(input, input)).rejects.toThrow(/differ/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('rejects incomplete, duplicate, malformed and failed runs without producing a table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polis-table-invalid-'));
  try {
    const cases = [
      [header, ...samples],
      [header, ...samples.slice(1), complete],
      [header, ...samples, samples[0], complete],
      [header, { ...samples[0], counts: [[1]] }, complete],
      [header, { ...samples[0], counts: [[-1, 0]] }, complete],
      [header, { ...samples[0], counts: [[null, 0]] }, complete],
      [header, { ...samples[0], parameterIndex: 99 }, complete],
      [header, { type: 'error', message: 'failed' }],
      [header, ...samples, complete, samples[0]],
      [{ ...header, formatVersion: 2 }],
    ];
    for (const [index, records] of cases.entries()) {
      const input = join(dir, `${index}.jsonl`), output = join(dir, `${index}.queries.jsonl`);
      writeFileSync(input, records.map((r) => JSON.stringify(r)).join('\n'));
      await expect(writeCalibrationTable(input, output)).rejects.toThrow();
      expect(existsSync(output)).toBe(false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('uses undefined variance for a single seed, and stable variance for large nearby counts', () => {
  expect(sampleStatistics([7])).toEqual({ n: 1, mean: 7, variance: null, standardError: null, min: 7, max: 7 });
  expect(sampleStatistics([1e12 + 1, 1e12 + 2, 1e12 + 3]).variance).toBe(1);
});

it('preserves values across transpose-block boundaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polis-table-block-'));
  try {
    const queries = Array.from({ length: 257 }, (_, i) => ({ ...header.manifest.stages[0].queries[0], id: String(i) }));
    const expanded = { ...header, manifest: { ...header.manifest, stages: [{ ...header.manifest.stages[0], queries }] } };
    const worlds = samples.map((sample) => ({ ...sample, counts: [queries.map((_, i) => sample.seedId * 1000 + sample.parameterIndex * 100 + i)] }));
    const input = join(dir, 'source.jsonl'), output = join(dir, 'table.jsonl');
    writeFileSync(input, [expanded, ...worlds, complete].map((r) => JSON.stringify(r)).join('\n'));
    expect(await writeCalibrationTable(input, output)).toBe(514);
    const rows = readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows[256].data).toEqual([7256, 8256, 9256]);
    expect(rows[513].data).toEqual([7356, 8356, 9356]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
