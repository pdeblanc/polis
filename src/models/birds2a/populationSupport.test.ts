import { describe, expect, it } from 'vitest';
import { Birds2a } from './birds2a';
import { Birds2aEngine } from './birds2aEngine';
import { birds2aPopulationSupport } from './populationSupport';

describe('single-origin population support', () => {
  it('uses tight expansion endpoint bounds and accepts arbitrary finite times', () => {
    const model = new Birds2a('support', 1, 0.5);
    for (const [time, min, max] of [
      [0, 0, 1], [1, -4, 5], [4, -11, 12], [16, -26, 26],
      [64, -56, 56], [256, -112, 112], [1024, -224, 224], [4096, -448, 448],
    ]) {
      expect(model.populationSupport(time)).toEqual({ min, max });
      expect(model.populationSupport(-time)).toEqual({ min, max });
    }
    for (const time of [0.1, 0.25, 0.75, 1.5, 2, 3, 4095.5, 4096.5]) {
      const bound = model.populationSupport(time)!;
      expect(bound).toBeDefined();
      expect(bound.max).toBeGreaterThan(bound.min);
    }
    expect(model.populationSupport(Infinity)).toBeUndefined();
    expect(model.populationSupport(NaN)).toBeUndefined();
  });

  it('contains every populated retained expansion cell on both time branches', () => {
    for (const diffusion of [0, (0.5 / 6) ** 2, 0.5, 2]) for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }]) {
      const engine = new Birds2aEngine('support-expansion', 32, diffusion, origin);
      for (let index = 0; index < 4; index++) {
        const epoch = engine.expansion.getEpoch(index);
        for (const flow of epoch.ordinaryFlows) for (const frame of [flow.from, flow.to]) {
          const bound = roundToGrid(birds2aPopulationSupport(origin, engine.expansion.kernels, engine.motionSupport.midpointKernels, frame.time)!, frame.cellWidth);
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
      for (const width of [0.5, 1]) for (const time of [-3.5, -1.75, -0.125, 0, 0.125, 0.5, 1.25, 2.5, 3.75]) {
        if (!Number.isInteger(time / (width ** 2 / 4))) continue;
        const bound = roundToGrid(birds2aPopulationSupport(origin, engine.expansion.kernels, engine.motionSupport.midpointKernels, time)!, width);
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

  it('does not evaluate populations and is independent of seed and density', () => {
    const model = new Birds2a('support-api', 8, 0.5);
    const usage = model.getCacheUsage();
    expect(model.populationSupport(1000)).toBeDefined();
    expect(model.getCacheUsage()).toEqual(usage);
    const other = new Birds2a('support-other', 1, 0.5);
    expect(other.populationSupport(1000)).toEqual(model.populationSupport(1000));
    const engine = new Birds2aEngine('no-expansion', 8, 0.5);
    expect(engine.expansion.retainedEpochCount).toBe(0);
    expect(birds2aPopulationSupport(engine.expansion.origin, engine.expansion.kernels,
      engine.motionSupport.midpointKernels, 4096)).toEqual({ min: -448, max: 448 });
    expect(engine.expansion.retainedEpochCount).toBe(0);
  });
});

function roundToGrid(bound: { min: number; max: number }, width: number) {
  return { min: Math.floor(bound.min / width) * width, max: Math.ceil(bound.max / width) * width };
}
