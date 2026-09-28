import { describe, expect, it } from 'vitest';
import { Birds2aEngine } from './birds2aEngine';
import { classifyBirds2aFlowSpaceSubdivision } from './ownerClassifiers';
import { possibleBirds2aFlowDestinations, possibleBirds2aFlowSources } from './motionSupport';
import type { Birds2aCell, Birds2aFlow } from './classifiers';
import { withMultinomialObserver } from '../../utils/distributions/multinomial';

const cell = (index: number, width: number, time: number): Birds2aCell =>
  ({ min: index * width, max: (index + 1) * width, time });
function incidentTotal(engine: Birds2aEngine, c: Birds2aCell, duration: number, outgoing: boolean) {
  return (outgoing ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources)(
    c, duration, engine.expansion.origin, engine.motionSupport,
  ).filter((other) => other.max - other.min === c.max - c.min)
    .reduce((sum, other) => sum + engine.queryFlow(outgoing ? { source: c, destination: other } : { source: other, destination: c }), 0);
}

describe('Birds 2a contraction engine', () => {
  for (const diffusion of [0, 0.5, 2]) it(`conserves populations through refinement at diffusion ${diffusion}`, () => {
    const engine = new Birds2aEngine('engine-conservation', 12, diffusion);
    for (const width of [1, 0.5]) for (const time of [-1, -0.25, 0, 0.25, 1, 1.25]) {
      for (const index of [-1, 0, 1]) {
        const c = cell(index, width, time), count = engine.queryCell(c);
        expect(Number.isSafeInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
        expect(engine.queryCell(cell(2 * index, width / 2, time)) + engine.queryCell(cell(2 * index + 1, width / 2, time))).toBe(count);
        expect(incidentTotal(engine, c, width ** 2 / 4, true)).toBe(count);
        expect(incidentTotal(engine, c, width ** 2 / 4, false)).toBe(count);
      }
    }
  });

  it('preserves all four spatial entries and mixed-width margins', () => {
    const engine = new Birds2aEngine('spatial-margins', 16, 0.5);
    for (const start of [-0.5, 0, 1.25]) for (const sourceIndex of [-1, 0, 1]) {
      const source = cell(sourceIndex, 1, start);
      for (const destination of possibleBirds2aFlowDestinations(source, 0.25, engine.expansion.origin, engine.motionSupport)) {
        if (destination.max - destination.min !== 1) continue;
        const parent = { source, destination }, owner = classifyBirds2aFlowSpaceSubdivision(parent, engine.expansion.origin)!;
        const counts = owner.childFlows.map((flow) => engine.queryFlow(flow));
        expect(counts.reduce((a, b) => a + b, 0)).toBe(engine.queryFlow(parent));
        expect(counts[0] + counts[1]).toBe(engine.queryFlow(owner.sourceMargins[0]));
        expect(counts[2] + counts[3]).toBe(engine.queryFlow(owner.sourceMargins[1]));
        expect(counts[0] + counts[2]).toBe(engine.queryFlow(owner.destinationMargins[0]));
        expect(counts[1] + counts[3]).toBe(engine.queryFlow(owner.destinationMargins[1]));
      }
    }
  });

  it('conserves the entire channel over successive refined time slices in both directions', () => {
    const engine = new Birds2aEngine('whole-channel', 24, 0.5);
    const population = engine.expansion.getEpoch(0).population;
    expect(population).toBeGreaterThan(0);
    for (const outgoing of [true, false]) {
      let cells = [cell(0, 0.5, 0), cell(1, 0.5, 0)];
      for (let step = 0; step < 4; step++) {
        const next = new Map<number, Birds2aCell>();
        for (const c of cells) for (const other of (outgoing ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources)(
          c, 0.0625, engine.expansion.origin, engine.motionSupport,
        )) if (other.max - other.min === 0.5) next.set(other.min, other);
        cells = [...next.values()];
        expect(cells.reduce((sum, c) => sum + engine.queryCell(c), 0)).toBe(population);
      }
    }
  });

  it('preserves cell margins for entry, half, and quarter duration flows across the expansion boundary', () => {
    for (const origin of [{ min: -1, max: 0 }, { min: 0.25, max: 0.5 }]) {
      const engine = new Birds2aEngine('temporal-margins', 32, 0.5, origin);
      const base = origin.max - origin.min;
      for (const width of [base / 2, base, 2 * base]) for (const slot of [-1, 0, 1, 2, 5]) {
        const c = { min: Math.floor(origin.min / width) * width, max: (Math.floor(origin.min / width) + 1) * width,
          time: slot * width ** 2 };
        const count = engine.queryCell(c);
        for (const ratio of [1, 0.5, 0.25]) {
          expect(incidentTotal(engine, c, ratio * width ** 2, true)).toBe(count);
          expect(incidentTotal(engine, c, ratio * width ** 2, false)).toBe(count);
        }
      }
    }
  });

  it('retrieves retained expansion output without new multinomial draws', () => {
    const engine = new Birds2aEngine('retained', 16, 0.5, { min: -0.5, max: 0 });
    const epochs = [engine.expansion.getEpoch(0), engine.expansion.getEpoch(1), engine.expansion.getEpoch(2)];
    withMultinomialObserver(() => { throw new Error('Resampled expansion output'); }, () => {
      for (const epoch of epochs) for (const step of epoch.ordinaryFlows) {
        for (const frame of [step.from, step.to]) for (const { cell, count } of frame.contributions) {
          expect(engine.queryCell({ ...cell, time: frame.time })).toBe(count);
        }
        for (const { fromCell, destinations } of step.allocations) for (const { cell, count } of destinations) {
          const from = { ...fromCell, time: step.from.time }, to = { ...cell, time: step.to.time };
          expect(engine.queryFlow(from.time < to.time ? { source: from, destination: to } : { source: to, destination: from })).toBe(count);
        }
      }
    });
  });

  it('replays results after cache clearing, reversed query order, and later expansion', () => {
    const make = () => new Birds2aEngine('replay', 12, 0.5, { min: 1, max: 2 });
    const engine = make(), replay = make();
    const cells = [cell(4, 0.25, 0.3125), cell(1, 1, -0.5), cell(2, 0.5, 1.25), cell(-1, 2, 6)];
    const flows: Birds2aFlow[] = [
      { source: cell(2, 0.5, 0.25), destination: cell(1, 1, 0.5) },
      { source: cell(1, 1, -0.5), destination: cell(2, 0.5, -0.25) },
      { source: cell(1, 1, 0), destination: cell(0, 1, 0.5) },
    ];
    const expected = [...cells.map((c) => engine.queryCell(c)), ...flows.map((f) => engine.queryFlow(f))];
    const read = (e: Birds2aEngine) => [...cells.map((c) => e.queryCell(c)), ...flows.map((f) => e.queryFlow(f))];
    for (const f of [...flows].reverse()) replay.queryFlow(f);
    for (const c of [...cells].reverse()) replay.queryCell(c);
    expect(read(replay)).toEqual(expected);
    const retained = engine.expansion.retainedEpochCount;
    engine.clearCache(); expect(engine.expansion.retainedEpochCount).toBe(retained);
    expect(read(engine)).toEqual(expected);
    engine.expansion.getEpoch(4); engine.clearCache();
    expect(read(engine)).toEqual(expected);
  });

  it('handles empty channels, invalid queries, and absent flow support', () => {
    const engine = new Birds2aEngine('empty', 0, 0.5);
    expect(engine.queryCell(cell(100, 2 ** -12, 2 ** -24))).toBe(0);
    expect(engine.queryFlow({ source: cell(0, 1, 0), destination: cell(100, 1, 1) })).toBe(0);
    expect(() => engine.queryCell(cell(0, 1, 0.1))).toThrow(RangeError);
    expect(() => engine.queryFlow({ source: cell(0, 1, 0), destination: cell(0, 1, 3) })).toThrow(RangeError);
    const nonempty = new Birds2aEngine('outside', 10, 0);
    expect(nonempty.queryFlow({ source: cell(0, 1, 0), destination: cell(100, 1, 1) })).toBe(0);
  });
});
