import { describe, expect, it } from 'vitest';
import { classifyBirds2aCell, classifyBirds2aFlow } from '../birds2a/classifiers';
import { birds2aDependencyBounds, birds2aDependencyRank } from '../birds2a/dependencyRanks';
import { classifyCompositeCell, classifyCompositeFlow } from './compositeClassifiers';
import { classifyCompositeFlowTimeSubdivision } from './compositeOwnerClassifiers';
import { CompositeEngine } from './compositeEngine';
import { Birds2bEngine, BIRDS_2B_GEOMETRY_ORIGIN as origin } from './birds2bEngine';
import { possibleCompositeFlowDestinations, possibleCompositeFlowSources } from './compositeMotionSupport';

describe('composite ownership and refinement', () => {
  it('has unit-channel boundary geometry across scales, signs and mixed widths', () => {
    const kind = (value: { kind: string } | undefined) => value?.kind === 'expansion' ? 'channel-merge' : value?.kind;
    for (const width of [0.125, 0.5, 1, 2, 4, 16]) {
      for (let slot = -20; slot <= 20; slot++) {
        const cell = { min: -width, max: 0, time: slot * width ** 2 / 4 };
        expect(kind(classifyCompositeCell(cell))).toBe(kind(classifyBirds2aCell(cell, origin)));
        for (const factor of [0.5, 1, 2]) for (const duration of [width ** 2, width ** 2 / 2, width ** 2 / 4]) {
          const flow = { source: cell, destination: { min: 0, max: width * factor, time: cell.time + duration } };
          expect(kind(classifyCompositeFlow(flow))).toBe(kind(classifyBirds2aFlow(flow, origin)));
        }
      }
    }
    for (const width of [1, 2]) expect(classifyCompositeCell({ min: 0, max: width, time: 4 })?.kind).toBe('channel-merge');
    expect(classifyCompositeCell({ min: 0, max: 0.5, time: 4 })?.kind).toBe('spatial-child');
    expect(() => classifyCompositeFlowTimeSubdivision({
      source: { min: 0, max: 2, time: 0 }, destination: { min: 0, max: 2, time: 4 },
    })).toThrow(/both legs/);
  });

  it('reads only boundary facts, conserves populations and has finite descending ancestry', () => {
    const source = new Birds2bEngine('composite-conservation', 2, 0.5);
    let bounds = birds2aDependencyBounds({ role: 'cell', cell: { min: 0, max: 1, time: 0 } }, origin);
    let edges = 0, reads = 0;
    const model = new CompositeEngine('composite-conservation', 0.5, {
      queryCell(cell) {
        expect(classifyCompositeCell(cell)?.kind).toBe('channel-merge');
        reads++; return source.queryCell(cell);
      },
      queryFlow(flow) {
        expect(classifyCompositeFlow(flow)?.kind).toBe('channel-merge');
        reads++; return source.queryFlow(flow);
      },
    }, ({ dependent, dependency }) => {
      edges++;
      expect(birds2aDependencyRank(dependency, origin, bounds)).toBeLessThan(birds2aDependencyRank(dependent, origin, bounds)!);
    });
    const cells = [[0.5, 0.0625], [1, 0.5], [1, 4], [2, 4], [1, 5], [1, -5], [2, 16]];
    for (const [width, time] of cells) {
      const cell = { min: 0, max: width, time };
      // Generous proof window also contains incoming/outgoing and subdivision query roots.
      bounds = { ceilingWidth: 16, timeRadius: 256 };
      const count = model.queryCell(cell);
      const split = model.queryCellSubdivision(cell);
      expect(split.children.reduce((sum, child) => sum + child.count, 0)).toBe(count);
      if (classifyCompositeCell(cell)?.kind === 'channel-merge') expect(count).toBe(source.queryCell(cell));
      for (const duration of [width ** 2 / 4, width ** 2 / 2, width ** 2]) {
        if (!Number.isInteger(time / duration)) continue;
        for (const forward of [true, false]) {
          const others = (forward ? possibleCompositeFlowDestinations : possibleCompositeFlowSources)(cell, duration, model.motionSupport);
          for (const otherWidth of new Set(others.map((other) => other.max - other.min))) {
            const total = others.filter((other) => other.max - other.min === otherWidth).reduce((sum, other) =>
              sum + model.queryFlow(forward ? { source: cell, destination: other } : { source: other, destination: cell }), 0);
            expect(total).toBe(count);
          }
        }
      }
    }
    expect(edges).toBeGreaterThan(0); expect(reads).toBeGreaterThan(0);
    const retained = source.getCacheUsage();
    model.clearCache();
    expect(source.getCacheUsage()).toEqual(retained);
  }, 20000);

  it('replays aggregate-owned facts independently of order and disposable caches', () => {
    const create = () => new CompositeEngine('composite-replay', 0.5, new Birds2bEngine('composite-replay', 2, 0.5));
    const a = create(), b = create();
    const cells = [-1, 0, 1].map((min) => ({ min: min / 2, max: (min + 1) / 2, time: 0.125 }));
    expect(a.queryCachedCell(cells[0])).toBeUndefined();
    expect(a.getCacheUsage().entries).toBe(0);
    const counts = cells.map((cell) => a.queryCell(cell));
    for (const cell of [...cells].reverse()) b.queryCell(cell);
    expect(cells.map((cell) => b.queryCell(cell))).toEqual(counts);
    expect(cells.map((cell) => a.queryCachedCell(cell))).toEqual(counts);
    a.clearCache();
    expect(a.queryCachedCell(cells[0])).toBeUndefined();
    expect(cells.map((cell) => a.queryCell(cell))).toEqual(counts);
  });

  it('conserves individual flow margins below and across merge boundaries', () => {
    const source = new Birds2bEngine('composite-margins', 8, 0.5);
    const model = new CompositeEngine('composite-margins', 0.5, source);
    const replay = new CompositeEngine('composite-margins', 0.5, new Birds2bEngine('composite-margins', 8, 0.5));
    const half = (cell: { min: number; max: number; time: number }) => {
      const middle = (cell.min + cell.max) / 2;
      return [{ ...cell, max: middle }, { ...cell, min: middle }];
    };
    for (const [width, time] of [[1, 0], [1, 0.25], [2, 3], [2, 4], [2, -5], [4, 16]]) {
      const flow = { source: { min: 0, max: width, time },
        destination: { min: 0, max: width, time: time + width ** 2 / 4 } };
      const rows = half(flow.source), columns = half(flow.destination);
      const children = rows.flatMap((source) => columns.map((destination) => ({ source, destination })));
      const counts = children.map((child) => model.queryFlow(child));
      expect(counts.reduce((a, b) => a + b, 0)).toBe(model.queryFlow(flow));
      for (let i = 0; i < 2; i++) {
        expect(counts[2 * i] + counts[2 * i + 1]).toBe(model.queryFlow({ source: rows[i], destination: flow.destination }));
        expect(counts[i] + counts[i + 2]).toBe(model.queryFlow({ source: flow.source, destination: columns[i] }));
      }
      if (classifyCompositeFlow(flow)?.kind === 'channel-merge') expect(model.queryFlow(flow)).toBe(source.queryFlow(flow));
      for (const child of [...children].reverse()) replay.queryFlow(child);
      expect(children.map((child) => replay.queryFlow(child))).toEqual(counts);
      model.clearCache();
      expect(children.map((child) => model.queryFlow(child))).toEqual(counts);
    }
  }, 20000);
});
