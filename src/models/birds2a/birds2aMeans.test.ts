import { expect, it } from 'vitest';
import { Birds2aMeans, Birds2aMeanQueries } from './birds2aMeans';
import { brownianIntervalTransitionProbability } from '../../utils/math/brownian';

const cell = (min: number, max: number, time: number) => ({ min, max, time });

it('matches analytic initial transitions and exact zero-diffusion intersections', () => {
  for (const diffusion of [0, 0.5, 2]) {
    const model = new Birds2aMeanQueries(2.5, diffusion);
    for (const time of [0, 0.25, 1, 16]) for (const min of [-2, 0, 1]) {
      const target = cell(min, min + 1, time);
      const expected = 2.5 * brownianIntervalTransitionProbability(cell(0, 1, 0), target, time, diffusion);
      expect(model.queryCell(target)).toBeCloseTo(expected, 8);
      expect(model.queryCell({ ...target, time: -time })).toBeCloseTo(expected, 8);
      expect(model.queryFlow({ source: cell(0, 1, 0), destination: target })).toBeCloseTo(expected, 8);
    }
  }
  const stationary = new Birds2aMeanQueries(4, 0);
  expect(stationary.queryTemporalSplit({ source: cell(0, 1, 1), destination: cell(0, 0.5, 4) }, cell(0.25, 0.75, 2))).toBe(1);
  expect(stationary.queryFlow({ source: cell(0, 1, 1), destination: cell(1, 2, 4) })).toBe(0);
});

it('conserves spatial partitions, reflects time, and integrates three-time joints', () => {
  const model = new Birds2aMeanQueries(5, 0.5);
  const source = cell(0, 1, 1), destination = cell(0, 1, 4);
  const total = model.queryFlow({ source, destination });
  expect(total).toBeGreaterThan(0);
  expect(model.queryFlow({ source, destination: cell(0, 0.5, 4) }) +
    model.queryFlow({ source, destination: cell(0.5, 1, 4) })).toBeCloseTo(total, 8);
  expect(model.queryFlow({ source: { ...destination, time: -4 }, destination: { ...source, time: -1 } })).toBeCloseTo(total, 8);
  const flow = { source, destination };
  const joint = model.queryTemporalSplit(flow, cell(-8, 8, 2));
  expect(joint).toBeCloseTo(total, 8);
  expect(model.queryTemporalSplit(flow, cell(-8, 0, 2)) + model.queryTemporalSplit(flow, cell(0, 8, 2))).toBeCloseTo(joint, 8);
  expect(model.queryTemporalSplit(flow, cell(0, 1, 2))).toBeLessThan(total);
  const shifted = new Birds2aMeanQueries(10, 0.5, { min: 2, max: 3 });
  expect(shifted.queryFlow({ source: cell(2, 3, 1), destination: cell(2, 3, 4) })).toBeCloseTo(2 * total, 8);
  const scaled = new Birds2aMeanQueries(5 / 4, 0.5, { min: 0, max: 4 });
  expect(scaled.queryFlow({ source: cell(0, 4, 16), destination: cell(0, 4, 64) })).toBeCloseTo(total, 8);
  // Restricting the initial position partitions the same path population.
  const left = new Birds2aMeanQueries(5, 0.5, { min: 0, max: 0.5 });
  const right = new Birds2aMeanQueries(5, 0.5, { min: 0.5, max: 1 });
  expect(left.queryFlow(flow) + right.queryFlow(flow)).toBeCloseTo(total, 8);
});

it('handles independent past and future conditional on the initial position', () => {
  const model = new Birds2aMeanQueries(1, 1);
  const past = cell(0, 1, -1), future = cell(0, 1, 1);
  const cross = model.queryFlow({ source: past, destination: future });
  expect(cross).toBeGreaterThan(model.queryCell(future) ** 2); // Shared random starting position.
  expect(cross).toBeLessThan(model.queryCell(future));
  expect(model.queryMarginal([past, cell(0, 0.5, 0), future]) +
    model.queryMarginal([past, cell(0.5, 1, 0), future])).toBeCloseTo(cross, 8);
});

it('shares the consumer API, returns fractional means, and rejects incident enumeration', () => {
  const model = new Birds2aMeans(2.5, 0.5);
  const resolution = model.resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 0.25 })!;
  const request = { min: 0, max: 1, time: 0, resolution };
  expect(model.queryCachedPopulation(request)).toMatchObject({ samples: [{ count: undefined }] });
  expect(model.queryPopulation(request)).toMatchObject({ samples: [{ count: 2.5 }] });
  expect(model.queryCachedPopulation(request)).toMatchObject({ samples: [{ count: 2.5 }] });
  const split = model.refinePopulationCell({ cell: cell(0, 1, 1), resolution })!;
  expect(split.children[0].count + split.children[1].count).toBeCloseTo(split.parentCount, 8);
  const flowResolution = model.resolveFlowResolution({ targetSourceWidth: 1, targetDestinationWidth: 1, targetDuration: 1 })!;
  expect(model.queryFlow({ source: cell(0, 1, 0), destination: cell(0, 1, 1), resolution: flowResolution }).count)
    .toBeCloseTo(model.queryCell(cell(0, 1, 1)), 8);
  expect(() => model.queryOutflows({ source: cell(0, 1, 0), resolution: flowResolution })).toThrow(/unsupported/);
  expect(() => model.queryInflows({ destination: cell(0, 1, 1), resolution: flowResolution })).toThrow(/unsupported/);
  expect(model.populationSupport(1)).toEqual({ min: -Infinity, max: Infinity });
  model.clearCache();
  expect(model.getCacheUsage().entries).toBe(0);
  expect(() => model.queryCell(cell(NaN, 1, 0))).toThrow();
  expect(() => new Birds2aMeans(-1, 1)).toThrow();
});

it('resolves narrow diffusion layers and nonzero tails beyond the simulation cutoff', () => {
  const model = new Birds2aMeanQueries(1, 1e-12);
  expect(model.queryCell(cell(0, 1, 1))).toBeCloseTo(1 - Math.sqrt(2 / Math.PI) * 1e-6, 10);
  const reference = new Birds2aMeanQueries(1, 1);
  expect(reference.queryCell(cell(8, 9, 1))).toBeGreaterThan(0);
  const small = reference.queryCell(cell(0, 1 / 1024, 1));
  expect(small).toBeGreaterThan(0);
  expect(small).toBeLessThan(1 / 1024);
});
