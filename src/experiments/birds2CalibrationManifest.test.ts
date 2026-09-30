import { expect, it } from 'vitest';
import { classifyBirds2aCell, classifyBirds2aFlow } from '../models/birds2a/classifiers';
import { classifyBirds2aFlowTimeSubdivision } from '../models/birds2a/ownerClassifiers';
import { birds2CalibrationManifest as manifest, type CalibrationMeasurementQuery } from './birds2CalibrationManifest';

it('is a serializable specification with independent model parameters and seed IDs', () => {
  expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  expect(manifest.modelParameters).toEqual({
    origins: [{ min: 0, max: 1 }],
    populationDensities: [0.25, 2.5, 25, 250],
    diffusionRates: [0, 0.5, 2, 4],
  });
  expect(manifest.seeds).toEqual({ prefix: 'Polis Birds 2 expansion calibration:', firstId: 0, count: 1000 });
  expect(manifest.stages).toHaveLength(217);
  expect(manifest.stages.reduce((sum, stage) => sum + stage.queries.length, 0)).toBe(16199);
  const expansion = manifest.stages.filter((stage) => !stage.refinement);
  expect(expansion).toHaveLength(109);
  expect(expansion.reduce((sum, stage) => sum + stage.queries.length, 0)).toBe(7415);
});

it('targets the stated refinement owner for every query, including negative time', () => {
  const origin = { min: 0, max: 1 };
  for (const stage of manifest.stages) {
    if (!stage.refinement) continue;
    for (const query of stage.queries) {
      const flow = query.kind === 'population' ? undefined : query.from.time < query.to.time
        ? { source: query.from, destination: query.to } : { source: query.to, destination: query.from };
      const owner = query.kind === 'population' ? classifyBirds2aCell(query.cell, origin)
        : query.kind === 'flow' ? classifyBirds2aFlow(flow!, origin)
          : classifyBirds2aFlowTimeSubdivision(flow!, origin);
      expect(owner, `${stage.id}/${query.id}`).toMatchObject({ stage: stage.refinement.stage });
    }
  }
});

it('provides unique stage-scoped query IDs and finite aligned intervals', () => {
  expect(new Set(manifest.stages.map((stage) => stage.id)).size).toBe(manifest.stages.length);
  for (const stage of manifest.stages) {
    expect(stage.title).not.toBe('');
    expect(stage.description).not.toBe('');
    expect(stage.record).not.toBe('');
    expect(new Set(stage.queries.map((query) => query.id)).size).toBe(stage.queries.length);
    for (const query of stage.queries as readonly CalibrationMeasurementQuery[]) {
      const cells = query.kind === 'population' ? [query.cell]
        : query.kind === 'flow' ? [query.from, query.to] : [query.from, query.via, query.to];
      for (const cell of cells) {
        const width = cell.max - cell.min;
        expect(Number.isInteger(Math.log2(width))).toBe(true);
        expect(Number.isInteger(cell.min / width)).toBe(true);
        expect(Number.isFinite(cell.time)).toBe(true);
      }
      for (let i = 1; i < cells.length; i++) {
        expect(Math.abs(cells[i].time)).toBeGreaterThan(Math.abs(cells[i - 1].time));
      }
      if (stage.branch) {
        for (const cell of cells) if (cell.time !== 0) {
          expect(Math.sign(cell.time)).toBe(stage.branch === 'forward' ? 1 : -1);
        }
      }
    }
  }
});

it('keeps generation order, bridge alignment cases and fixed outlying queries', () => {
  const get = (id: string) => manifest.stages.find((stage) => stage.id === id)!;
  expect(manifest.stages.indexOf(get('epoch-1.forward.remaining-flow')))
    .toBeLessThan(manifest.stages.indexOf(get('epoch-1.forward.second-split')));
  expect(manifest.stages.indexOf(get('epoch-1.forward.coarsened-population')))
    .toBeLessThan(manifest.stages.indexOf(get('epoch-1.backward.direct-flow')));
  for (const [id, denominator] of [['first-split', 3], ['second-split', 2]] as const) {
    const phases = new Set(get(`epoch-1.forward.${id}`).queries.map((query) => {
      if (query.kind !== 'temporal-split') throw new Error('Expected a temporal split');
      const d = (query.to.min - query.from.min) / (query.from.max - query.from.min);
      return ((d % denominator) + denominator) % denominator;
    }));
    expect(phases.size).toBe(denominator);
  }
  expect(get('initial.forward.flows').queries).toContainEqual({
    id: 'destination-16', kind: 'flow',
    from: { min: 0, max: 1, time: 0 }, to: { min: 16, max: 17, time: 1 },
  });
  expect(get('epoch-3.forward.direct-flow').queries[0]).toEqual({
    id: 'widths-4-4/source--2/offset--4', kind: 'flow',
    from: { min: -8, max: -4, time: 16 }, to: { min: -24, max: -20, time: 64 },
  });
});
