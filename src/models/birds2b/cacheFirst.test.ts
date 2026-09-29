import { afterEach, describe, expect, it, vi } from 'vitest';
import { Birds2aEngine } from '../birds2a/birds2aEngine';
import * as channelClassifiers from '../birds2a/classifiers';
import * as compositeClassifiers from './compositeClassifiers';
import { Birds2bEngine } from './birds2bEngine';
import { CompositeEngine } from './compositeEngine';

afterEach(() => vi.restoreAllMocks());

for (const layer of ['channel', 'sum', 'composite'] as const) {
  describe(`${layer} cache-first queries`, () => {
    it('validates misses but skips classification on hits, including zero and cached-only reads', () => {
      const cellSpy = layer === 'composite'
        ? vi.spyOn(compositeClassifiers, 'classifyCompositeCell')
        : layer === 'channel' ? vi.spyOn(channelClassifiers, 'classifyBirds2aCell')
          : vi.spyOn(channelClassifiers, 'classifyBirds2aCellGeometry');
      const flowSpy = layer === 'composite'
        ? vi.spyOn(compositeClassifiers, 'classifyCompositeFlow')
        : vi.spyOn(channelClassifiers, 'classifyBirds2aFlow');
      const model = layer === 'channel' ? new Birds2aEngine('cache-first', 0, 0.5)
        : layer === 'sum' ? new Birds2bEngine('cache-first', 0, 0.5)
          : new CompositeEngine('cache-first', 0.5, { queryCell: () => 0, queryFlow: () => 0 });
      const cell = { min: 0, max: 1, time: 0 };
      const flow = { source: cell, destination: { ...cell, time: 1 } };
      expect(model.queryCachedCell(cell)).toBeUndefined();
      expect(model.getCacheUsage().entries).toBe(0);
      expect(model.queryCell(cell)).toBe(0);
      expect(model.queryFlow(flow)).toBe(0);
      expect(cellSpy).toHaveBeenCalled(); expect(flowSpy).toHaveBeenCalled();
      cellSpy.mockClear(); flowSpy.mockClear();
      expect(model.queryCell({ ...cell })).toBe(0);
      expect(model.queryCachedCell({ ...cell, min: -0 })).toBe(0);
      expect(model.queryFlow({ source: { ...cell }, destination: { ...flow.destination } })).toBe(0);
      expect(cellSpy).not.toHaveBeenCalled(); expect(flowSpy).not.toHaveBeenCalled();
      const entries = model.getCacheUsage().entries;
      for (const invalid of [
        { ...cell, time: 0.1 }, { ...cell, min: 0.1 }, { ...cell, max: 0 },
        { ...cell, time: NaN }, { ...cell, time: Infinity },
      ]) {
        expect(() => model.queryCell(invalid)).toThrow(RangeError);
        expect(() => model.queryCachedCell(invalid)).toThrow(RangeError);
        expect(() => model.queryFlow({ source: invalid, destination: flow.destination })).toThrow(RangeError);
      }
      expect(model.getCacheUsage().entries).toBe(entries);
      model.clearCache();
      cellSpy.mockClear(); flowSpy.mockClear();
      expect(model.queryCell(cell)).toBe(0);
      expect(model.queryFlow(flow)).toBe(0);
      expect(cellSpy).toHaveBeenCalled(); expect(flowSpy).toHaveBeenCalled();
    });
  });
}
