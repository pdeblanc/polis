import { describe, expect, it } from 'vitest';
import { Birds2a } from './birds2a';
import { Birds2aEngine } from './birds2aEngine';
import { createBirds2aMotionSupport } from './motionSupport';
import { birds2aPopulationSupport } from './populationSupport';

describe('single-origin population support', () => {
  it('covers the origin at zero and accumulates quarter-step bounds across scales', () => {
    const support = createBirds2aMotionSupport(0.5);
    const origin = { min: 1, max: 2 };
    const radius = Math.floor(support.quarterRadius);
    expect(birds2aPopulationSupport(origin, support, 0, 0.25)).toEqual(origin);
    expect(birds2aPopulationSupport(origin, support, 0, 4)).toEqual({ min: 0, max: 4 });
    expect(birds2aPopulationSupport(origin, support, 0.25, 1)).toEqual({ min: 1 - radius, max: 2 + radius });
    expect(birds2aPopulationSupport(origin, support, 1, 1)).toEqual({ min: -2 * radius, max: 2 + 2 * radius });
    expect(birds2aPopulationSupport(origin, support, 1.25, 1)).toEqual({ min: -3 * radius, max: 2 + 3 * radius });
    for (const time of [0.25, 1, 1.25, 100, 1_000_000]) {
      expect(birds2aPopulationSupport(origin, support, -time, 1)).toEqual(birds2aPopulationSupport(origin, support, time, 1));
    }
    expect(birds2aPopulationSupport(origin, support, 0.1, 1)).toBeUndefined();
    expect(birds2aPopulationSupport(origin, support, Infinity, 1)).toBeUndefined();
  });

  it('contains every populated retained expansion cell on both time branches', () => {
    for (const diffusion of [0, 0.5, 2]) for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }]) {
      const engine = new Birds2aEngine('support-expansion', 32, diffusion, origin);
      for (let index = 0; index < 4; index++) {
        const epoch = engine.expansion.getEpoch(index);
        for (const flow of epoch.ordinaryFlows) for (const frame of [flow.from, flow.to]) {
          const bound = birds2aPopulationSupport(origin, engine.motionSupport, frame.time, frame.cellWidth)!;
          for (const { cell, count } of frame.contributions) if (count > 0) {
            expect(cell.min).toBeGreaterThanOrEqual(bound.min);
            expect(cell.max).toBeLessThanOrEqual(bound.max);
          }
        }
      }
    }
  });

  it('excludes no population in sampled contraction rows', () => {
    const origin = { min: 0, max: 1 };
    for (const seed of ['support-a', 'support-b']) {
      const engine = new Birds2aEngine(seed, 8, 0.5, origin);
      const population = engine.queryCell({ ...origin, time: 0 });
      for (const width of [0.5, 1]) for (const time of [-0.125, 0, 0.125, 0.5]) {
        if (!Number.isInteger(time / (width ** 2 / 4))) continue;
        const bound = birds2aPopulationSupport(origin, engine.motionSupport, time, width)!;
        let total = 0;
        for (let index = bound.min / width - 1; index < bound.max / width + 1; index++) {
          const cell = { min: index * width, max: (index + 1) * width, time };
          const count = engine.queryCell(cell);
          if (cell.min < bound.min || cell.max > bound.max) expect(count).toBe(0);
          else total += count;
        }
        expect(total).toBe(population);
      }
    }
  });

  it('does not evaluate the model and rejects foreign capabilities', () => {
    const model = new Birds2a('support-api', 8, 0.5);
    const resolution = model.resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 0.25 })!;
    const usage = model.getCacheUsage();
    expect(model.populationSupport(1000, resolution)).toBeDefined();
    expect(model.getCacheUsage()).toEqual(usage);
    const other = new Birds2a('support-other', 8, 0.5);
    expect(() => other.populationSupport(0, resolution)).toThrow(/does not belong/);
  });
});
