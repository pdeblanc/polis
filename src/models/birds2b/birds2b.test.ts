import { describe, expect, it } from 'vitest';
import { Birds2aEngine } from '../birds2a/birds2aEngine';
import { Birds2b } from './birds2b';
import { Birds2bEngine } from './birds2bEngine';
import { originChannelAt, originChannelsIn, originSearchWindow } from './channels';
import { createBirds2aMotionSupport } from '../birds2a/motionSupport';

describe('Birds 2b origin selection', () => {
  it('partitions both half-lines without gaps or duplicate boundaries', () => {
    expect(originChannelsIn({ min: -8, max: 8 })).toEqual([
      { min: -8, max: -4 }, { min: -4, max: -2 }, { min: -2, max: -1 }, { min: -1, max: 0 },
      { min: 0, max: 1 }, { min: 1, max: 2 }, { min: 2, max: 4 }, { min: 4, max: 8 },
    ]);
    for (const x of [-8, -7, -4, -2, -1, -0.5, 0, 0.5, 1, 2, 4, 7, 8, 2 ** 40,
      4 - 2 * Number.EPSILON, -4 - 4 * Number.EPSILON]) {
      const origin = originChannelAt(x);
      expect(origin.min).toBeLessThanOrEqual(x);
      expect(origin.max).toBeGreaterThan(x);
    }
    expect(originChannelsIn({ min: 1, max: 2 })).toEqual([{ min: 1, max: 2 }]);
  });

  it('bounds the entire tail before pruning candidates, without creating channels', () => {
    const support = createBirds2aMotionSupport(0.5);
    const cell = { min: 0, max: 1, time: 4096 };
    expect(originSearchWindow(cell, support)).toEqual({ min: -896, max: 1024 });
    expect(originSearchWindow({ ...cell, time: -4096 }, support)).toEqual(originSearchWindow(cell, support));
    const model = new Birds2bEngine('selection', 1, 0.5);
    expect(model.candidateOrigins({ min: -0.5, max: 0, time: 0 })).toEqual([{ min: -1, max: 0 }]);
    expect(model.candidateOrigins({ min: 2 ** 30, max: 2 ** 30 + 1, time: 0 })).toEqual([{ min: 2 ** 30, max: 2 ** 31 }]);
    expect(model.candidateOrigins(cell).length).toBeLessThan(25);
    expect(model.getChannelUsage()).toEqual({ channels: 0, expansionEpochs: 0 });
  });
});

describe('Birds 2b explicit channel sum', () => {
  it('matches a wider reference sum and does not omit populated channels', () => {
    const seed = 'global-reference', density = 0.5, diffusion = 0.5;
    const global = new Birds2bEngine(seed, density, diffusion);
    const channels = originChannelsIn({ min: -32, max: 32 }).map((origin) => ({
      origin, engine: new Birds2aEngine(seed, density, diffusion, origin),
    }));
    for (const cell of [
      { min: 0, max: 1, time: 0 }, { min: -1, max: 0, time: -0.25 },
      { min: 0, max: 1, time: 0.5 }, { min: 1, max: 2, time: 1 },
    ]) {
      const candidates = global.candidateOrigins(cell);
      let sum = 0;
      for (const { origin, engine } of channels) {
        const count = engine.queryCell(cell);
        if (count) expect(candidates).toContainEqual(origin);
        sum += count;
      }
      expect(global.queryCell(cell)).toBe(sum);
    }
    const flow = { source: { min: 0, max: 1, time: 0 }, destination: { min: 1, max: 2, time: 1 } };
    expect(global.queryFlow(flow)).toBe(channels.reduce((sum, { engine }) => sum + engine.queryFlow(flow), 0));
  });

  it('conserves spatial subdivisions and incoming/outgoing totals through the API', () => {
    const model = new Birds2b('global-conservation', 1, 0.5);
    for (const [width, time] of [[1, 0], [1, 0.5], [2, 1]]) {
      const resolution = model.resolvePopulationResolution({ targetCellWidth: width, targetTimeStep: width ** 2 / 4 })!;
      const cell = { min: 0, max: width, time };
      const count = model.queryPopulationCell({ cell, resolution }).count;
      const split = model.refinePopulationCell({ cell, resolution })!;
      expect(split.children[0].count + split.children[1].count).toBe(count);
      for (const direction of ['incoming', 'outgoing'] as const) {
        const result = model.queryIncidentFlows({ cell, resolution, direction, maximumDuration: width ** 2 });
        expect(result.kind).toBe('flows');
        if (result.kind !== 'flows') throw new Error('Expected flows');
        expect(result.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(count);
      }
    }
  });

  it('has cache-only global reads and replays independently of query order and clearing', () => {
    const a = new Birds2bEngine('global-replay', 1, 0.5), b = new Birds2bEngine('global-replay', 1, 0.5);
    const cells = [-1, 0, 1].map((min) => ({ min, max: min + 1, time: 0.25 }));
    for (const cell of cells) expect(a.queryCachedCell(cell)).toBeUndefined();
    expect(a.getChannelUsage().channels).toBe(0);
    const counts = cells.map((cell) => a.queryCell(cell));
    for (const cell of [...cells].reverse()) b.queryCell(cell);
    expect(cells.map((cell) => b.queryCell(cell))).toEqual(counts);
    const retained = a.getChannelUsage();
    expect(cells.map((cell) => a.queryCachedCell(cell))).toEqual(counts);
    a.clearCache();
    expect(a.getChannelUsage()).toEqual(retained);
    expect(a.getCacheUsage().entries).toBe(0);
    expect(cells.map((cell) => a.queryCell(cell))).toEqual(counts);
  });

  it('conserves mixed-width flow margins', () => {
    const model = new Birds2b('mixed-global', 1, 0.5);
    for (const [sourceWidth, destinationWidth] of [[1, 2], [2, 1]]) {
      const resolution = model.resolveFlowResolution({ targetSourceWidth: sourceWidth,
        targetDestinationWidth: destinationWidth, targetDuration: 1 })!;
      const source = { min: 0, max: sourceWidth, time: 0 };
      const destination = { min: 0, max: destinationWidth, time: 1 };
      const outflows = model.queryOutflows({ source, resolution });
      const inflows = model.queryInflows({ destination, resolution });
      expect(outflows.kind).toBe('flows'); expect(inflows.kind).toBe('flows');
      if (outflows.kind !== 'flows' || inflows.kind !== 'flows') throw new Error('Expected flows');
      const population = (cell: typeof source) => model.queryPopulationCell({ cell,
        resolution: model.resolvePopulationResolution({ targetCellWidth: cell.max, targetTimeStep: cell.max ** 2 / 4 })!,
      }).count;
      expect(outflows.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(population(source));
      expect(inflows.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(population(destination));
    }
  });

  it('handles empty populations and rejects invalid queries', () => {
    const model = new Birds2bEngine('empty', 0, 0);
    expect(model.queryCell({ min: 0, max: 1, time: 0.25 })).toBe(0);
    expect(model.getChannelUsage().channels).toBe(0);
    expect(() => model.queryCell({ min: 0, max: 1, time: 0.1 })).toThrow();
    expect(() => model.queryFlow({ source: { min: 0, max: 1, time: 0 }, destination: { min: 0, max: 1, time: 3 } })).toThrow();
  });
});
