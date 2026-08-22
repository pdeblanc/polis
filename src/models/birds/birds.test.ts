import { describe, expect, it } from 'vitest';
import {
  BIRDS_MAX_POPULATION_CELLS_PER_QUERY,
  Birds,
  type BirdsFlowEndpoint,
} from './birds';

describe('Birds resolution capabilities', () => {
  it('selects the coarsest population resolution within both requested bounds', () => {
    const birds = new Birds('public-birds', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 10,
      targetTimeStep: 100,
    });

    expect(resolution).toEqual({ cellWidth: 8, timeOrigin: 0, timeStep: 16 });
    expect(birds.refinePopulationResolution(resolution!)).toEqual({
      cellWidth: 4,
      timeOrigin: 0,
      timeStep: 4,
    });
    expect(
      birds.getNearbyPopulationResolutions(resolution!, 1).map(({ cellWidth }) => cellWidth),
    ).toEqual([16, 8, 4]);
  });

  it('selects equal or adjacent flow resolutions without exposing epochs', () => {
    const birds = new Birds('public-birds', 2, 0.5);

    const adjacent = birds.resolveFlowResolution({
        targetSourceWidth: 10,
        targetDestinationWidth: 20,
        targetDuration: 100,
      });
    expect(adjacent).toEqual({
      sourceCellWidth: 8,
      destinationCellWidth: 16,
      duration: 64,
      timeOrigin: 0,
      timeStep: 64,
    });
    expect(birds.refineFlowResolution(adjacent!)).toEqual({
      sourceCellWidth: 4,
      destinationCellWidth: 8,
      duration: 16,
      timeOrigin: 0,
      timeStep: 16,
    });
    expect(
      birds.getNearbyFlowResolutions(adjacent!, 1).map(({ sourceCellWidth, duration }) => [
        sourceCellWidth,
        duration,
      ]),
    ).toEqual([
      [8, 64],
      [4, 16],
    ]);
    expect(
      birds.resolveFlowResolution({
        targetSourceWidth: 10,
        targetDestinationWidth: 10,
        targetDuration: 40,
      }),
    ).toMatchObject({ sourceCellWidth: 8, destinationCellWidth: 8, duration: 32 });
  });

  it('rejects capabilities created by another model instance', () => {
    const first = new Birds('first', 2, 0.5);
    const second = new Birds('second', 2, 0.5);
    const resolution = first.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;

    expect(() =>
      second.queryPopulation({ min: 0, max: 16, time: 0, resolution }),
    ).toThrow(/does not belong/);
  });
});

describe('Birds population profiles', () => {
  it('reports missing cached cells without evaluating them', () => {
    const birds = new Birds('cached-population-profile', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const request = { min: 0, max: 32, time: 0, resolution };

    expect(birds.queryCachedPopulation(request)).toMatchObject({
      kind: 'population-profile',
      samples: [{ count: undefined }, { count: undefined }],
    });
    birds.queryPopulation({ ...request, max: 16 });
    expect(birds.queryCachedPopulation(request)).toMatchObject({
      kind: 'population-profile',
      samples: [{ count: expect.any(Number) }, { count: undefined }],
    });
  });

  it('snaps time, covers the requested interval, and reports exact choices', () => {
    const birds = new Birds('population-profile', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 8,
      targetTimeStep: 16,
    })!;
    const result = birds.queryPopulation({ min: -1, max: 9, time: 11, resolution });

    expect(result.kind).toBe('population-profile');
    if (result.kind !== 'population-profile') return;
    expect(result.sampledTime).toBe(16);
    expect(result.samples.map(({ interval }) => interval)).toEqual([
      { min: -8, max: 0 },
      { min: 0, max: 8 },
      { min: 8, max: 16 },
    ]);
    expect(result.samples.every(({ count }) => Number.isSafeInteger(count) && count >= 0)).toBe(true);
  });

  it('returns an explicit size-limit result instead of a partial profile', () => {
    const birds = new Birds('population-limit', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const result = birds.queryPopulation({
      min: 0,
      max: resolution.cellWidth * (BIRDS_MAX_POPULATION_CELLS_PER_QUERY + 1),
      time: 0,
      resolution,
    });

    expect(result).toMatchObject({
      kind: 'size-limit',
      limit: BIRDS_MAX_POPULATION_CELLS_PER_QUERY,
      requiredCount: BIRDS_MAX_POPULATION_CELLS_PER_QUERY + 1,
    });
  });
});

describe('Birds population continuation', () => {
  it('queries, refines, and coarsens canonical cells without exposing hierarchy stages', () => {
    const birds = new Birds('population-continuation', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const cell = { min: 0, max: 16, time: 0 };
    const sample = birds.queryPopulationCell({ cell, resolution });
    const subdivision = birds.refinePopulationCell({ cell, resolution })!;

    expect(sample.count).toBe(32);
    expect(subdivision.parentCount).toBe(sample.count);
    expect(subdivision.children.reduce((sum, child) => sum + child.count, 0)).toBe(
      sample.count,
    );
    expect(
      birds.coarsenPopulationCell({
        cell: subdivision.children[0].cell,
        resolution: subdivision.resolution,
      }),
    ).toEqual({ cell, count: sample.count, resolution });

    const unalignedChild = {
      ...subdivision.children[0].cell,
      time: subdivision.resolution.timeStep,
    };
    expect(
      birds.coarsenPopulationCell({
        cell: unalignedChild,
        resolution: subdivision.resolution,
      }),
    ).toBeUndefined();
  });

  it('combines incidence resolution and bounded flow discovery', () => {
    const birds = new Birds('incident-continuation', 2, 0.5);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const initial = { min: 0, max: 16, time: 0 };
    expect(
      birds.queryIncidentFlows({
        cell: initial,
        direction: 'outgoing',
        maximumDuration: 64,
        resolution,
      }),
    ).toMatchObject({ kind: 'duration-limit', maximumDuration: 64 });

    const intermediate = { min: 0, max: 16, time: 64 };
    const result = birds.queryIncidentFlows({
      cell: intermediate,
      direction: 'outgoing',
      maximumDuration: 64,
      resolution,
    });
    expect(result.kind).toBe('flows');
    if (result.kind === 'flows') {
      expect(result.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(
        birds.queryPopulationCell({ cell: intermediate, resolution }).count,
      );
    }
  });
});

describe('Birds flow queries', () => {
  it('exposes the canonical population-incidence capability at each cell stage', () => {
    const birds = new Birds('incident-capability', 2, 0.5);
    const coarse = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const fine = birds.refinePopulationResolution(coarse)!;
    const incidentResolution = (
      cell: BirdsFlowEndpoint,
      resolution: typeof coarse,
    ) =>
      birds.queryIncidentFlows({
        cell,
        direction: 'outgoing',
        maximumDuration: 256,
        resolution,
      }).resolution;

    expect(
      incidentResolution({ min: 0, max: 16, time: 0 }, coarse),
    ).toMatchObject({ sourceCellWidth: 16, destinationCellWidth: 16, duration: 256 });
    expect(
      incidentResolution({ min: 0, max: 16, time: 64 }, coarse),
    ).toMatchObject({ sourceCellWidth: 16, destinationCellWidth: 16, duration: 64 });
    expect(
      incidentResolution({ min: 0, max: 8, time: 0 }, fine),
    ).toMatchObject({ sourceCellWidth: 8, destinationCellWidth: 8, duration: 64 });

    const child = { min: 0, max: 8, time: 0 };
    const childCount = birds.queryPopulation({ ...child, resolution: fine });
    const equal = birds.resolveFlowResolution({
      targetSourceWidth: 8,
      targetDestinationWidth: 8,
      targetDuration: 64,
    })!;
    const equalOutflows = birds.queryOutflows({ source: child, resolution: equal });
    expect(childCount.kind).toBe('population-profile');
    expect(equalOutflows.kind).toBe('flows');
    if (childCount.kind === 'population-profile' && equalOutflows.kind === 'flows') {
      expect(equalOutflows.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(
        childCount.samples[0].count,
      );
    }
  });

  it('keeps individual, outgoing, and incoming queries consistent', () => {
    const birds = new Birds('public-flow', 2, 0.5);
    const resolution = birds.resolveFlowResolution({
      targetSourceWidth: 16,
      targetDestinationWidth: 16,
      targetDuration: 256,
    })!;
    const source: BirdsFlowEndpoint = { min: 0, max: 16, time: 0 };
    const outflows = birds.queryOutflows({ source, resolution });

    expect(outflows.kind).toBe('flows');
    if (outflows.kind !== 'flows') return;
    expect(outflows.flows.map(({ destination }) => destination.min)).toEqual(
      [...outflows.flows].map(({ destination }) => destination.min).sort((a, b) => a - b),
    );
    expect(outflows.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(32);

    for (const flow of outflows.flows) {
      expect(birds.queryFlow({ source: flow.source, destination: flow.destination, resolution })).toEqual(
        flow,
      );
      const inflows = birds.queryInflows({ destination: flow.destination, resolution });
      expect(inflows.kind).toBe('flows');
      if (inflows.kind === 'flows') {
        expect(inflows.flows).toContainEqual(flow);
      }
    }
  });

  it('requires exact spatial and temporal lattice endpoints', () => {
    const birds = new Birds('flow-lattice', 2, 0.5);
    const resolution = birds.resolveFlowResolution({
      targetSourceWidth: 16,
      targetDestinationWidth: 16,
      targetDuration: 256,
    })!;

    expect(() =>
      birds.queryOutflows({ source: { min: 1, max: 17, time: 0 }, resolution }),
    ).toThrow(/spatial lattice/);
    expect(() =>
      birds.queryOutflows({ source: { min: 0, max: 16, time: 1 }, resolution }),
    ).toThrow(/temporal lattice/);
  });
});
