import { describe, expect, it } from 'vitest';
import { Sighting } from '../../helpers/birdsSighting';
import { Birds2a } from './birds2a';
import { Birds2aEngine } from './birds2aEngine';

describe('Birds 2a shared consumer API', () => {
  it('resolves scales on both sides of initialization and keeps capabilities model-local', () => {
    const model = new Birds2a('api', 4, 0.5);
    for (const width of [0.125, 1, 2, 64]) {
      const resolution = model.resolvePopulationResolution({ targetCellWidth: width, targetTimeStep: width ** 2 / 4 })!;
      expect(resolution.cellWidth).toBe(width);
      expect(model.getNearbyPopulationResolutions(resolution, 1).map((r) => r.cellWidth)).toEqual([width * 2, width, width / 2]);
      expect(model.coarsenPopulationCell({ cell: { min: 0, max: width, time: 0 }, resolution })?.resolution.cellWidth).toBe(width * 2);
      const flow = model.resolveFlowResolution({ targetSourceWidth: width, targetDestinationWidth: width, targetDuration: width ** 2 })!;
      expect(model.getNearbyFlowResolutions(flow, 1).map((r) => r.duration)).toEqual([width ** 2 * 4, width ** 2, width ** 2 / 4]);
      expect(model.refineFlowResolution(flow)?.duration).toBe(width ** 2 / 4);
    }
    const foreign = new Birds2a('other', 4, 0.5).resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 1 })!;
    expect(() => model.queryPopulation({ min: 0, max: 1, time: 0, resolution: foreign })).toThrow(/does not belong/);
  });

  it('agrees with the engine and conserves subdivisions and both incident directions', () => {
    const origin = { min: -2, max: 0 };
    const model = new Birds2a('api', 4, 0.5, origin);
    const engine = new Birds2aEngine('api', 4, 0.5, origin);
    for (const width of [1, 2, 4]) for (const time of [-4, -1, 0, 0.25, 1, 4]) {
      if (!Number.isInteger(time / (width ** 2 / 4))) continue;
      const resolution = model.resolvePopulationResolution({ targetCellWidth: width, targetTimeStep: width ** 2 / 4 })!;
      const cell = { min: -width, max: 0, time };
      const count = model.queryPopulationCell({ cell, resolution }).count;
      expect(count).toBe(engine.queryCell(cell));
      const children = model.refinePopulationCell({ cell, resolution })!;
      expect(children.children.reduce((sum, child) => sum + child.count, 0)).toBe(count);
      for (const direction of ['incoming', 'outgoing'] as const) {
        const flows = model.queryIncidentFlows({ cell, resolution, direction, maximumDuration: width ** 2 });
        expect(flows.kind).toBe('flows');
        if (flows.kind !== 'flows') throw new Error('Expected incident flows');
        expect(flows.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(count);
        for (const flow of flows.flows) expect(model.queryFlow({ ...flow, resolution: flows.resolution }).count).toBe(flow.count);
      }
    }
  });

  it('reads cached populations without evaluating anything and replays after clearing', () => {
    const model = new Birds2a('cached-api', 8, 0.5);
    const resolution = model.resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 0.25 })!;
    const request = { min: 0, max: 2, time: 0, resolution };
    const before = model.getCacheUsage();
    const missing = model.queryCachedPopulation(request);
    expect(missing.kind === 'population-profile' && missing.samples.every((s) => s.count === undefined)).toBe(true);
    expect(model.getCacheUsage()).toEqual(before);
    const result = model.queryPopulation(request);
    expect(model.queryCachedPopulation(request)).toEqual(result);
    model.clearCache();
    expect(model.queryPopulation(request)).toEqual(result);
  });

  it('runs the existing immutable tracker through the shared API', () => {
    let model: Birds2a | undefined;
    for (let seed = 0; seed < 32; seed++) {
      const candidate = new Birds2a(String(seed), 1, 0);
      const resolution = candidate.resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 0.25 })!;
      if (candidate.queryPopulationCell({ cell: { min: 0, max: 1, time: 0 }, resolution }).count === 1) {
        model = candidate; break;
      }
    }
    expect(model).toBeDefined();
    const resolution = model!.resolvePopulationResolution({ targetCellWidth: 1, targetTimeStep: 0.25 })!;
    const sighting = Sighting.select({ birds: model!, cell: { min: 0, max: 1, time: 0 }, resolution, seed: 'selection' });
    const next = sighting.next();
    expect(next.cell.time).toBe(resolution.timeStep);
    expect(next.prev().cell).toEqual(sighting.cell);
    expect(sighting.prev().next().cell).toEqual(sighting.cell);
    const coarse = model!.getNearbyPopulationResolutions(resolution, 1)[0];
    expect(sighting.rescale(coarse).rescale(resolution).cell).toEqual(sighting.cell);
  });
});
