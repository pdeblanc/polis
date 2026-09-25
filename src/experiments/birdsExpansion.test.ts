import { describe, expect, it } from 'vitest';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';
import { withMultinomialObserver } from '../utils/distributions/multinomial';
import { roundedNormal } from '../utils/distributions/roundedNormal';
import { BirdsExpansion, type BridgeBatch, type ChannelExtension, type ContributionFrame, type ContributionStep } from './birdsExpansion';

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

function checkBridge(batch: BridgeBatch) {
  expect(batch.intermediates.reduce((s, v) => s + v.count, 0)).toBe(batch.count);
  for (const { cell, count } of batch.intermediates) {
    expect(Number.isSafeInteger(count) && count >= 0).toBe(true);
    expect(cell.max - cell.min).toBe(batch.fromCell.max - batch.fromCell.min);
  }
}

function checkExtension(extension: ChannelExtension, input: ContributionFrame, population: number) {
  const { direct, bridges, steps, coarsened } = extension;
  expect(direct.from).toBe(input);
  expect(direct.to.time).toBe(4 * input.time);
  checkStep(direct, population);
  expect(steps[0].from).toBe(input);
  expect(steps[1].from).toBe(steps[0].to);
  expect(steps[2].from).toBe(steps[1].to);
  expect(steps[2].to).toBe(direct.to);
  steps.forEach((step, i) => {
    expect(step.to.time).toBe((i + 2) * input.time);
    checkStep(step, population);
  });
  const positiveFlows = direct.allocations.flatMap(({ fromCell, destinations }) =>
    destinations.filter(({ count }) => count > 0).map(({ cell, count }) => [fromCell.min, cell.min, count]));
  expect(bridges.map(({ late }) => [late.fromCell.min, late.toCell.min, late.count])).toEqual(positiveFlows);

  // Independently marginalize each retained four-time joint count onto its three
  // edges, verifying more than just conservation of whole-frame totals.
  const expectedEdges = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  for (const { late, early } of bridges) {
    checkBridge(late);
    expect([late.fromTime, late.time, late.toTime]).toEqual([1, 3, 4].map((n) => n * input.time));
    expect(early.map((batch) => [batch.toCell.min, batch.count])).toEqual(
      late.intermediates.filter(({ count }) => count > 0).map(({ cell, count }) => [cell.min, count]));
    for (const batch of early) {
      checkBridge(batch);
      expect(batch.fromCell).toBe(late.fromCell);
      expect([batch.fromTime, batch.time, batch.toTime]).toEqual([1, 2, 3].map((n) => n * input.time));
      for (const { cell, count } of batch.intermediates) if (count) {
        const points = [late.fromCell.min, cell.min, batch.toCell.min, late.toCell.min];
        expectedEdges.forEach((edges, i) => {
          const key = JSON.stringify(points.slice(i, i + 2));
          edges.set(key, (edges.get(key) ?? 0) + count);
        });
      }
    }
  }
  steps.forEach((step, i) => {
    const actual = new Map(step.allocations.flatMap(({ fromCell, destinations }) =>
      destinations.map(({ cell, count }) => [JSON.stringify([fromCell.min, cell.min]), count] as const)));
    expect(actual).toEqual(expectedEdges[i]);
  });
  const expected = new Map<number, number>();
  for (const { cell, count } of direct.to.contributions) {
    const min = Math.floor(cell.min / coarsened.cellWidth) * coarsened.cellWidth;
    expected.set(min === 0 ? 0 : min, (expected.get(min) ?? 0) + count);
  }
  expect(coarsened.cellWidth).toBe(2 * input.cellWidth);
  expect(coarsened.time).toBe(direct.to.time);
  expect(coarsened.contributions.map(({ cell, count }) => [cell.min, count]))
    .toEqual([...expected].sort(([a], [b]) => a - b));
  expect(total(coarsened)).toBe(population);
}

describe('single-origin Birds expansion', () => {
  for (const origin of [{ min: 0, max: 16 }, { min: 16, max: 32 }, { min: 32, max: 64 },
    { min: -64, max: -32 }, { min: -0.5, max: 0 }]) {
    it(`initializes the specified origin [${origin.min}, ${origin.max})`, () => {
      const seed = 'expansion-poisson', density = 2, width = origin.max - origin.min;
      const suppliedOrigin = { ...origin };
      const model = new BirdsExpansion(seed, density, 0.5, suppliedOrigin);
      suppliedOrigin.min = 123; // Caller mutation must not change the model's origin.
      const epoch = model.getEpoch(0);
      expect(epoch.kind).toBe('initial');
      if (epoch.kind !== 'initial') throw new Error('Expected initialization');
      expect(epoch.origin).toEqual(origin);
      expect(epoch.cellWidth).toBe(width);
      expect(epoch.timeStep).toBe(width ** 2);
      expect(epoch.population).toBe(poissonQuantile(uniformUnit(createAddressedRandom(seed),
        ['birds-expansion.population', origin.min, origin.max]), width * density));
      expect(epoch.forwardStep.from).toBe(epoch.atZero);
      expect(epoch.backwardStep.from).toBe(epoch.atZero);
      expect(epoch.forward.time).toBe(width ** 2);
      expect(epoch.backward.time).toBe(-(width ** 2));
      checkStep(epoch.forwardStep, epoch.population);
      checkStep(epoch.backwardStep, epoch.population);
    });
  }

  for (const diffusion of [0, 0.5, 2]) it(`conserves one fixed channel and every joint allocation at D=${diffusion}`, () => {
    const model = new BirdsExpansion('expansion-conservation', 2, diffusion, { min: -64, max: -32 });
    const initial = model.getEpoch(0);
    for (let index = 1; index <= 3; index++) {
      const epoch = model.getEpoch(index), previous = model.getEpoch(index - 1);
      if (epoch.kind !== 'expanded') throw new Error('Expected expansion');
      expect(epoch.origin).toBe(initial.origin);
      expect(epoch.population).toBe(initial.population);
      expect(epoch.cellWidth).toBe(32 * 2 ** index);
      expect(epoch.timeStep).toBe(1024 * 4 ** index);
      checkExtension(epoch.forwardExtension, previous.forward, initial.population);
      checkExtension(epoch.backwardExtension, previous.backward, initial.population);
      expect(epoch.forward).toBe(epoch.forwardExtension.coarsened);
      expect(epoch.backward).toBe(epoch.backwardExtension.coarsened);
    }
    expect(model.retainedEpochCount).toBe(4);
  });

  it('precomputes the direct and bridge kernels at their respective variances', () => {
    const { kernels } = new BirdsExpansion('kernels', 1, 0.5);
    expect(kernels.initial).toEqual(roundedNormal(0, Math.sqrt(0.5)));
    expect(kernels.extension).toEqual(roundedNormal(0, Math.sqrt(1.5)));
    expect(kernels.lateBridge).toEqual([0, 1 / 3, 2 / 3].map((mean) => roundedNormal(mean, Math.sqrt(1 / 3))));
    expect(kernels.earlyBridge).toEqual([0, 0.5].map((mean) => roundedNormal(mean, 0.5)));
    for (const [forward, backward] of [[kernels.initial, kernels.initialBackward], [kernels.extension, kernels.extensionBackward]]) {
      expect(backward).toEqual(forward.map(({ value, probability }) =>
        ({ value: value === 0 ? 0 : -value, probability })).reverse());
    }
  });

  it('uses the right bridge phases for positive/negative displacements in both time directions', () => {
    const model = new BirdsExpansion('bridge-phases', 20, 0.5, { min: -16, max: 0 });
    model.getEpoch(0);
    const phases = new Set<string>();
    const displacements = new Set<number>(), directions = new Set<number>();
    withMultinomialObserver((_n, categories, address) => {
      if (address[3] !== 'bridge') return;
      const [fromTime, toTime, time, fromMin, fromMax, toMin] = address.slice(4, 10) as number[];
      const width = fromMax - fromMin, delta = (toMin - fromMin) / width;
      const fraction = (time - fromTime) / (toTime - fromTime);
      const variance = 0.5 * Math.abs(toTime - fromTime) / width ** 2 * fraction * (1 - fraction);
      const expected = roundedNormal(fraction * delta, Math.sqrt(variance));
      expect(categories).toHaveLength(expected.length);
      categories.forEach((category, i) => {
        expect(category.address).toEqual([fromMin + expected[i].value * width, fromMax + expected[i].value * width]);
        expect(category.probability).toBeCloseTo(expected[i].probability, 12);
      });
      const denominator = fraction === 0.5 ? 2 : 3;
      phases.add(`${denominator}:${((delta % denominator) + denominator) % denominator}`);
      displacements.add(Math.sign(delta)); directions.add(Math.sign(time));
    }, () => model.getEpoch(2));
    expect(phases).toEqual(new Set(['2:0', '2:1', '3:0', '3:1', '3:2']));
    expect(displacements).toEqual(new Set([-1, 0, 1]));
    expect(directions).toEqual(new Set([-1, 1]));
  });

  it('generates endpoints before bridge splits, without sampling adjacent forward hops', () => {
    const model = new BirdsExpansion('order', 2, 0.5);
    model.getEpoch(0);
    const stages: number[] = [];
    withMultinomialObserver((_n, _categories, address) => {
      const [kind, from, to, middle] = address.slice(3, 7);
      expect(Math.abs(from as number)).toBe(256);
      const stage = kind === 'transport' ? 0 : Math.abs(middle as number) === 768 ? 1 : 2;
      expect(Math.abs(to as number)).toBe(stage === 2 ? 768 : 1024);
      stages.push(stage + ((from as number) < 0 ? 3 : 0));
    }, () => model.getEpoch(1));
    expect(new Set(stages)).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
  });

  it('has stable, origin-specific addresses and retains immutable earlier facts', () => {
    const model = new BirdsExpansion('addresses', 2, 1);
    const addresses: string[] = [];
    const before = withMultinomialObserver((_n, _c, address) => addresses.push(JSON.stringify(address)), () => model.getEpoch(0));
    const snapshot = JSON.stringify(before);
    withMultinomialObserver((_n, _c, address) => addresses.push(JSON.stringify(address)), () => {
      model.getEpoch(3);
      new BirdsExpansion('addresses', 2, 1, { min: 16, max: 32 }).getEpoch(3);
    });
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses.length).toBeGreaterThan(0);
    withMultinomialObserver(() => { throw new Error('Retained query resampled a batch'); }, () => {
      expect(model.getEpoch(0)).toBe(before);
      model.getEpoch(2); model.getEpoch(3);
    });
    expect(JSON.stringify(before)).toBe(snapshot);
    const direct = new BirdsExpansion('addresses', 2, 1);
    direct.getEpoch(3);
    for (let i = 0; i <= 3; i++) expect(model.getEpoch(i)).toEqual(direct.getEpoch(i));
    function checkFrozen(value: unknown, seen = new Set<unknown>()) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const item of Object.values(value)) checkFrozen(item, seen);
    }
    checkFrozen(model.getEpoch(3));
  });

  it('keeps zero-diffusion birds inside the coarse cell containing the origin', () => {
    const model = new BirdsExpansion('stationary', 2, 0, { min: -32, max: -16 });
    for (let i = 0; i <= 4; i++) {
      const epoch = model.getEpoch(i), min = Math.floor(model.origin.min / epoch.cellWidth) * epoch.cellWidth;
      expect(epoch.forward.contributions).toEqual([{ cell: { min, max: min + epoch.cellWidth }, count: epoch.population }]);
      expect(epoch.backward.contributions).toEqual(epoch.forward.contributions);
    }
  });

  it('handles an empty origin without sampling splits', () => {
    const model = new BirdsExpansion('empty', 0, 2);
    withMultinomialObserver(() => { throw new Error('Empty channel sampled a split'); }, () => {
      const epoch = model.getEpoch(3);
      expect(epoch.population).toBe(0);
      expect(epoch.forward.contributions).toEqual([]);
      expect(epoch.backward.contributions).toEqual([]);
      if (epoch.kind !== 'expanded') throw new Error('Expected expansion');
      checkExtension(epoch.forwardExtension, model.getEpoch(2).forward, 0);
      checkExtension(epoch.backwardExtension, model.getEpoch(2).backward, 0);
    });
  });

  it('rejects invalid parameters, origins and epoch requests', () => {
    for (const invalid of [-1, NaN, Infinity]) {
      expect(() => new BirdsExpansion('bad', invalid, 1)).toThrow(RangeError);
      expect(() => new BirdsExpansion('bad', 1, invalid)).toThrow(RangeError);
      expect(() => new BirdsExpansion('bad', 1, 1).getEpoch(invalid)).toThrow(RangeError);
    }
    for (const origin of [{ min: 0, max: 0 }, { min: 0, max: 3 }, { min: 1, max: 17 }, { min: 0, max: Infinity }]) {
      expect(() => new BirdsExpansion('bad', 1, 1, origin)).toThrow(RangeError);
    }
    expect(() => new BirdsExpansion('bad', 1, 1).getEpoch(0.5)).toThrow(RangeError);
    expect(() => new BirdsExpansion('bad', 1, Number.MAX_VALUE)).toThrow(/offset precision/);
  });
});
