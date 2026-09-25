import { describe, expect, it } from 'vitest';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';
import { withMultinomialObserver } from '../utils/distributions/multinomial';
import { roundedNormal } from '../utils/distributions/roundedNormal';
import { BirdsExpansion, type ContributionFrame, type ContributionStep } from './birdsExpansion';

const total = (frame: ContributionFrame) => frame.contributions.reduce((s, c) => s + c.count, 0);
function checkStep(step: ContributionStep, population: number) {
  expect(total(step.from)).toBe(population);
  expect(total(step.to)).toBe(population);
  expect(step.allocations).toHaveLength(step.from.contributions.length);
  const incoming = new Map<number, number>();
  step.allocations.forEach((batch, i) => {
    expect(batch.fromCell).toBe(step.from.contributions[i].cell);
    expect(batch.destinations.reduce((s, v) => s + v.count, 0)).toBe(step.from.contributions[i].count);
    for (const { cell, count } of batch.destinations) {
      expect(Number.isSafeInteger(count) && count >= 0).toBe(true);
      expect(cell.max - cell.min).toBe(step.from.cellWidth);
      expect(Number.isInteger(cell.min / step.from.cellWidth)).toBe(true);
      if (count) incoming.set(cell.min, (incoming.get(cell.min) ?? 0) + count);
    }
  });
  expect(step.to.contributions.map(({ cell, count }) => [cell.min, count]))
    .toEqual([...incoming].sort(([a], [b]) => a - b));
}

describe('standalone Birds expansion', () => {
  it('initializes two shared Poisson totals and separate forward/backward allocations', () => {
    const seed = 'expansion-poisson', density = 2;
    const epoch = new BirdsExpansion(seed, density, 0.5).getEpoch(0);
    expect(epoch.roots.map((r) => r.cell)).toEqual([{ min: -16, max: 0 }, { min: 0, max: 16 }]);
    expect(epoch.cellWidth).toBe(16);
    expect(epoch.timeStep).toBe(256);
    const random = createAddressedRandom(seed);
    for (const init of epoch.introduced) {
      const { root } = init;
      expect(root.population).toBe(poissonQuantile(uniformUnit(random,
        ['birds-expansion.population', root.cell.min, root.cell.max]), 16 * density));
      expect(init.forwardStep.from).toBe(init.atZero);
      expect(init.backwardStep.from).toBe(init.atZero);
      expect(root.forward.time).toBe(256);
      expect(root.backward.time).toBe(-256);
      checkStep(init.forwardStep, root.population);
      checkStep(init.backwardStep, root.population);
    }
  });

  for (const diffusion of [0, 0.5, 2]) it(`retains and conserves all contributions across expansions at D=${diffusion}`, () => {
    const model = new BirdsExpansion('expansion-conservation', 2, diffusion);
    let introducedPopulation = 0;
    for (let index = 0; index <= 3; index++) {
      const epoch = model.getEpoch(index);
      expect(epoch.cellWidth).toBe(16 * 2 ** index);
      expect(epoch.timeStep).toBe(256 * 4 ** index);
      expect(epoch.roots.map((r) => r.cell)).toEqual([
        { min: -epoch.cellWidth, max: 0 }, { min: 0, max: epoch.cellWidth },
      ]);
      for (const init of epoch.introduced) {
        introducedPopulation += init.root.population;
        checkStep(init.forwardStep, init.root.population);
        checkStep(init.backwardStep, init.root.population);
      }
      expect(epoch.roots.reduce((s, r) => s + r.population, 0)).toBe(introducedPopulation);
      if (!index) continue;
      const previous = model.getEpoch(index - 1);
      expect(epoch.extensions.map((c) => c.root.cell.min)).toEqual([-2, -1, 0, 1].map((i) => i * previous.cellWidth));
      expect(epoch.extensions[1].root).toBe(previous.roots[0]);
      expect(epoch.extensions[2].root).toBe(previous.roots[1]);
      for (const cohort of epoch.extensions) {
        for (const [steps, initial, sign] of [
          [cohort.forwardSteps, cohort.root.forward, 1],
          [cohort.backwardSteps, cohort.root.backward, -1],
        ] as const) {
          expect(steps).toHaveLength(3);
          expect(steps[0].from).toBe(initial);
          steps.forEach((step, j) => {
            expect(step.origin).toBe(cohort.root.cell);
            expect(step.to.time).toBe(sign * (j + 2) * previous.timeStep);
            if (j) expect(step.from).toBe(steps[j - 1].to);
            checkStep(step, cohort.root.population);
          });
        }
      }
      for (const aggregation of epoch.aggregations) {
        for (const [branch, destination] of [
          ['forwardSteps', aggregation.root.forward], ['backwardSteps', aggregation.root.backward],
        ] as const) {
          const expected = new Map<number, number>();
          for (const child of aggregation.children) for (const { cell, count } of child[branch].at(-1)!.to.contributions) {
            const min = Math.floor(cell.min / epoch.cellWidth) * epoch.cellWidth;
            expected.set(min === 0 ? 0 : min, (expected.get(min) ?? 0) + count);
          }
          expect(destination.contributions.map(({ cell, count }) => [cell.min, count]))
            .toEqual([...expected].sort(([a], [b]) => a - b));
          expect(total(destination)).toBe(aggregation.root.population);
        }
      }
    }
    expect(model.retainedEpochCount).toBe(4);
  });

  it('precomputes the forward-variance kernel and its reflected backward kernel', () => {
    const model = new BirdsExpansion('kernels', 1, 0.5);
    expect(model.kernels.forward).toEqual(roundedNormal(0, Math.sqrt(0.5)));
    expect(model.kernels.backward).toEqual(model.kernels.forward.map(({ value, probability }) =>
      ({ value: value === 0 ? 0 : -value, probability })).reverse());
    const zero = new BirdsExpansion('stationary', 2, 0);
    for (const root of zero.getEpoch(3).roots) {
      expect(root.forward.contributions).toEqual([{ cell: root.cell, count: root.population }]);
      expect(root.backward.contributions).toEqual(root.forward.contributions);
    }
  });

  it('has stable addresses, reuses prior facts, and keeps the retained records immutable', () => {
    const model = new BirdsExpansion('addresses', 2, 1);
    const before = model.getEpoch(0), snapshot = JSON.stringify(before);
    const addresses: string[] = [];
    withMultinomialObserver((_n, _categories, address) => addresses.push(JSON.stringify(address)), () => model.getEpoch(3));
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses.length).toBeGreaterThan(0);
    withMultinomialObserver(() => { throw new Error('Retained query resampled a batch'); }, () => {
      expect(model.getEpoch(0)).toBe(before);
      model.getEpoch(2);
      model.getEpoch(3);
    });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(model.getEpoch(3)).toEqual(new BirdsExpansion('addresses', 2, 1).getEpoch(3));
    function checkFrozen(value: unknown, seen = new Set<unknown>()) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const item of Object.values(value)) checkFrozen(item, seen);
    }
    checkFrozen(model.getEpoch(3));
  });

  it('handles empty cohorts without inventing contributions', () => {
    const model = new BirdsExpansion('empty', 0, 2);
    withMultinomialObserver(() => { throw new Error('Empty cohort sampled a split'); }, () => {
      for (const root of model.getEpoch(3).roots) {
        expect(root.population).toBe(0);
        expect(root.forward.contributions).toEqual([]);
        expect(root.backward.contributions).toEqual([]);
      }
    });
  });

  it('rejects invalid parameters and epoch requests', () => {
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => new BirdsExpansion('bad', invalid, 1)).toThrow(RangeError);
      expect(() => new BirdsExpansion('bad', 1, invalid)).toThrow(RangeError);
      expect(() => new BirdsExpansion('bad', 1, 1).getEpoch(invalid)).toThrow(RangeError);
    }
    expect(() => new BirdsExpansion('bad', 1, 1).getEpoch(0.5)).toThrow(RangeError);
    expect(() => new BirdsExpansion('bad', 1, Number.MAX_VALUE)).toThrow(/offset precision/);
  });
});
