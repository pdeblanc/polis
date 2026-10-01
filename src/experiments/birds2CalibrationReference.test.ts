/// <reference types="node" />
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { writeCalibrationReference } from './birds2CalibrationReference';
import { measureCalibrationMeans } from './birds2CalibrationMeasurements';
import { birds2CalibrationManifest } from './birds2CalibrationManifest';

it('writes matching query metadata and Poisson means, without samples or seed dependence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polis-reference-test-'));
  try {
    const stages = birds2CalibrationManifest.stages.filter((stage) =>
      ['initial.origin-population', 'initial.forward.flows', 'epoch-1.forward.first-split', 'refinement.origin.level-0.forward.A'].includes(stage.id))
      .map((stage) => ({ ...stage, queries: stage.queries.slice(0, 2) }));
    const parameters = [0, 1, 10].map((populationDensity) => ({ origin: { min: 0, max: 1 }, populationDensity, diffusionRate: 0.5 }));
    const header = { type: 'manifest', formatVersion: 1, manifest: { ...birds2CalibrationManifest, stages }, parameters };
    const input = join(dir, 'samples.jsonl'), output = join(dir, 'means.jsonl');
    // Means require only the manifest, not a completed sampling campaign.
    const source = JSON.stringify(header) + '\n';
    writeFileSync(input, source);
    const progress: number[] = [];
    const count = await writeCalibrationReference(input, output, (completed) => progress.push(completed));
    const rows = readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(rows).toHaveLength(count);
    expect(progress).toEqual([0, 1, 2, 3]);
    const expected = parameters.flatMap((p) => measureCalibrationMeans(p, stages).flat());
    expect(rows.map((row) => row.distribution.mean)).toEqual(expected);
    expect(rows[0]).toMatchObject({ type: 'query-reference', formatVersion: 1, parameterIndex: 0,
      parameters: parameters[0], stage: { id: stages[0].id }, query: stages[0].queries[0],
      distribution: { kind: 'poisson', mean: 0 } });
    expect(rows.every((row) => !('data' in row) && !('statistics' in row) && !('seeds' in row))).toBe(true);
    expect(rows.map((row) => row.query.id)).toEqual(parameters.flatMap(() => stages.flatMap((stage) => stage.queries.map((q) => q.id))));
    await expect(writeCalibrationReference(input, output)).rejects.toThrow(/exist/i);
    await expect(writeCalibrationReference(input, input)).rejects.toThrow(/differ/);
    expect(readFileSync(input, 'utf8')).toBe(source);
    const bad = join(dir, 'bad.jsonl');
    writeFileSync(bad, 'null\n');
    await expect(writeCalibrationReference(bad, join(dir, 'bad-output.jsonl'))).rejects.toThrow(/header/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
