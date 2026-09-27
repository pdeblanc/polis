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
