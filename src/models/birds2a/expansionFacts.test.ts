import { describe, expect, it } from 'vitest';
import { Birds2aExpansion, type ContributionFrame, type ContributionStep, type ExpansionCell } from './expansion';
import { classifyBirds2aCell, classifyBirds2aFlow, type Birds2aCell, type Birds2aFlow } from './classifiers';
import { readExpansionCell, readExpansionFlow } from './expansionFacts';
import { withMultinomialObserver } from '../../utils/distributions/multinomial';

function population(model: Birds2aExpansion, cell: Birds2aCell) {
  const construction = classifyBirds2aCell(cell, model.origin);
  if (construction?.kind !== 'expansion') throw new Error(`Not an expansion cell: ${JSON.stringify(cell)}`);
  return readExpansionCell(model, cell, construction.projection);
}
function flowCount(model: Birds2aExpansion, flow: Birds2aFlow) {
  const construction = classifyBirds2aFlow(flow, model.origin);
  if (construction?.kind !== 'expansion') throw new Error(`Not an expansion flow: ${JSON.stringify(flow)}`);
  return readExpansionFlow(model, construction.projection);
}
const coarse = (cell: ExpansionCell, width: number) => {
  const min = Math.floor(cell.min / width) * width;
  return { min: min === 0 ? 0 : min, max: min + width };
};
function checkFrame(model: Birds2aExpansion, frame: ContributionFrame) {
  for (const { cell, count } of frame.contributions) expect(population(model, { ...cell, time: frame.time })).toBe(count);
  // Check the next coarser legal population grid, including negative cells.
  const width = 2 * frame.cellWidth;
  if (!Number.isInteger(frame.time / (width ** 2 / 4))) return;
  const totals = new Map<number, number>();
  for (const { cell, count } of frame.contributions) {
    const min = coarse(cell, width).min;
    totals.set(min, (totals.get(min) ?? 0) + count);
  }
  for (const [min, count] of totals) expect(population(model, { min, max: min + width, time: frame.time })).toBe(count);
}
function checkStep(model: Birds2aExpansion, step: ContributionStep) {
  for (const allocation of step.allocations) for (const { cell, count } of allocation.destinations) {
    const from = { ...allocation.fromCell, time: step.from.time }, to = { ...cell, time: step.to.time };
    const flow = from.time < to.time ? { source: from, destination: to } : { source: to, destination: from };
    expect(flowCount(model, flow)).toBe(count);
  }
}

describe('Birds 2a expansion fact projections', () => {
  for (const diffusion of [0, 0.5, 2]) it(`retains every ordinary flow margin at diffusion ${diffusion}`, () => {
    const model = new Birds2aExpansion('ordinary-outputs', 48, diffusion, { min: -1, max: -0.5 });
    for (let i = 0; i <= 3; i++) {
      const epoch = model.getEpoch(i);
      expect(Object.isFrozen(epoch.ordinaryFlows)).toBe(true);
      expect(epoch.ordinaryFlows).toHaveLength(i === 0 ? 8 : 36);
      const geometries = new Set<string>();
      for (const step of epoch.ordinaryFlows) {
        const geometry = JSON.stringify([step.from.time, step.to.time, step.from.cellWidth, step.to.cellWidth]);
        expect(geometries.has(geometry)).toBe(false);
        geometries.add(geometry);
        expect(Object.isFrozen(step)).toBe(true);
        expect(Object.isFrozen(step.allocations)).toBe(true);
        checkStep(model, step);
        checkFrame(model, step.from); checkFrame(model, step.to);
        const incoming = new Map<number, number>();
        for (const batch of step.allocations) {
          expect(Object.isFrozen(batch.destinations)).toBe(true);
          expect(batch.destinations.reduce((sum, entry) => sum + entry.count, 0))
            .toBe(population(model, { ...batch.fromCell, time: step.from.time }));
          for (const { cell, count } of batch.destinations) {
            expect(count).toBeGreaterThan(0);
            incoming.set(cell.min, (incoming.get(cell.min) ?? 0) + count);
          }
        }
        expect([...incoming.values()].reduce((sum, count) => sum + count, 0)).toBe(epoch.population);
        for (const { cell, count } of step.to.contributions) expect(incoming.get(cell.min)).toBe(count);

        // Compare against the finest retained endpoint pairs, independently of
        // the flow reader (which must only retrieve already-aggregated entries).
        const extension = epoch.kind === 'expanded'
          ? (step.to.time > 0 ? epoch.forwardExtension : epoch.backwardExtension) : undefined;
        const raw = epoch.kind === 'initial'
          ? (step.to.time > 0 ? epoch.forwardStep : epoch.backwardStep)
          : extension && [extension.fromTwo, ...extension.steps].find((candidate) =>
            candidate.from.time === step.from.time && candidate.to.time === step.to.time);
        const expected = new Map<string, number>();
        if (raw) {
          for (const batch of raw.allocations) for (const { cell, count } of batch.destinations) {
            if (!count) continue;
            const key = `${coarse(batch.fromCell, step.from.cellWidth).min}:${coarse(cell, step.to.cellWidth).min}`;
            expected.set(key, (expected.get(key) ?? 0) + count);
          }
        } else {
          expect(step.from.time).toBe(0);
          const endpoint = extension!.steps.find((candidate) => candidate.to.time === step.to.time)!.to;
          for (const { cell, count } of endpoint.contributions) {
            const key = `${coarse(model.origin, step.from.cellWidth).min}:${coarse(cell, step.to.cellWidth).min}`;
            expected.set(key, (expected.get(key) ?? 0) + count);
          }
        }
        const actual = new Map(step.allocations.flatMap(({ fromCell, destinations }) =>
          destinations.map(({ cell, count }) => [`${fromCell.min}:${cell.min}`, count] as const)));
        expect(actual).toEqual(expected);
      }
    }
  });

  it('provides an eager table for every expansion-classified ordinary geometry, including empty channels', () => {
    const model = new Birds2aExpansion('all-geometries', 0, 1);
    model.getEpoch(3);
    withMultinomialObserver(() => { throw new Error('Flow read resampled'); }, () => {
      for (const width of [0.5, 1, 2, 4, 8, 16]) {
        for (const [fromWidth, toWidth, duration] of [
          [width, width, width ** 2], [width, width, width ** 2 / 2],
          [width, width, width ** 2 / 4], [width, 2 * width, width ** 2], [2 * width, width, width ** 2],
        ]) for (let time = -64; time + duration <= 64; time += duration) {
          const flow = { source: { min: 0, max: fromWidth, time },
            destination: { min: 0, max: toWidth, time: time + duration } };
          const construction = classifyBirds2aFlow(flow, model.origin);
          if (construction?.kind === 'expansion') expect(readExpansionFlow(model, construction.projection)).toBe(0);
        }
      }
    });
    expect(model.retainedEpochCount).toBe(4);
  });

  for (const origin of [{ min: 0, max: 1 }, { min: -2, max: -1 }, { min: 2, max: 4 }, { min: -0.5, max: 0 }]) {
    it(`recovers retained populations and chronological flows for origin ${origin.min}:${origin.max}`, () => {
      const model = new Birds2aExpansion('projection', 32, 0.5, origin);
      for (let i = 0; i <= 3; i++) {
        const epoch = model.getEpoch(i);
        checkFrame(model, epoch.forward); checkFrame(model, epoch.backward);
        if (epoch.kind === 'initial') {
          checkFrame(model, epoch.atZero);
          checkStep(model, epoch.forwardStep); checkStep(model, epoch.backwardStep);
        } else for (const extension of [epoch.forwardExtension, epoch.backwardExtension]) {
          // Duration-3T direct flows are expansion records, not ordinary hierarchy queries.
          checkFrame(model, extension.direct.to);
          for (const step of extension.steps) {
            checkFrame(model, step.to); checkStep(model, step);
          }
          // At twice the spatial width, 2T → 4T is a legal half-duration flow.
          const width = 2 * extension.fromTwo.from.cellWidth;
          const expected = new Map<string, { flow: Birds2aFlow; count: number }>();
          for (const batch of extension.fromTwo.allocations) for (const { cell, count } of batch.destinations) {
            const inner = { ...coarse(batch.fromCell, width), time: extension.fromTwo.from.time };
            const outer = { ...coarse(cell, width), time: extension.fromTwo.to.time };
            const flow = inner.time < outer.time ? { source: inner, destination: outer } : { source: outer, destination: inner };
            const key = JSON.stringify(flow);
            expected.set(key, { flow, count: (expected.get(key)?.count ?? 0) + count });
          }
          for (const { flow, count } of expected.values()) expect(flowCount(model, flow)).toBe(count);
        }
      }
    });
  }

  it('projects mixed-width margins without resampling', () => {
    const model = new Birds2aExpansion('joint-margins', 64, 1);
    const epoch = model.getEpoch(1);
    if (epoch.kind !== 'expanded') throw new Error('Expected expansion');
    withMultinomialObserver(() => { throw new Error('Projection resampled a batch'); }, () => {
      for (const extension of [epoch.forwardExtension, epoch.backwardExtension]) {
        const sign = Math.sign(extension.direct.from.time);
        const step = extension.steps[0];
        for (const allocation of step.allocations) {
          const targets = new Map<number, number>();
          for (const { cell, count } of allocation.destinations) {
            const min = coarse(cell, 2).min;
            targets.set(min, (targets.get(min) ?? 0) + count);
          }
          for (const [min, count] of targets) {
            const inner = { ...allocation.fromCell, time: sign }, outer = { min, max: min + 2, time: sign * 2 };
            expect(flowCount(model, sign > 0 ? { source: inner, destination: outer } : { source: outer, destination: inner })).toBe(count);
          }
        }
      }
    });
  });

  it('returns zero for absent channel contributions, not unknown or global population', () => {
    const model = new Birds2aExpansion('zeros', 32, 0.5);
    expect(population(model, { min: 1000, max: 1001, time: 2 })).toBe(0);
    expect(flowCount(model, { source: { min: 1, max: 2, time: 0 }, destination: { min: 0, max: 1, time: 1 } })).toBe(0);
    expect(flowCount(model, { source: { min: 1000, max: 1001, time: 1 }, destination: { min: 0, max: 1, time: 2 } })).toBe(0);
    const empty = new Birds2aExpansion('empty', 0, 1);
    expect(population(empty, { min: 0, max: 2, time: 4 })).toBe(0);
  });

  it('classifies cold facts and preserves projected answers after later expansion', () => {
    const model = new Birds2aExpansion('cold-projections', 32, 1);
    const flow = { source: { min: 0, max: 2, time: 8 }, destination: { min: -2, max: 0, time: 12 } };
    const construction = classifyBirds2aFlow(flow, model.origin);
    expect(model.retainedEpochCount).toBe(0);
    expect(construction?.kind).toBe('expansion');
    const count = flowCount(model, flow);
    expect(model.retainedEpochCount).toBe(3);
    model.getEpoch(4);
    expect(classifyBirds2aFlow(flow, model.origin)).toEqual(construction);
    expect(flowCount(model, flow)).toBe(count);
    const replay = new Birds2aExpansion('cold-projections', 32, 1);
    replay.getEpoch(1);
    expect(flowCount(replay, flow)).toBe(count);
  });
});
