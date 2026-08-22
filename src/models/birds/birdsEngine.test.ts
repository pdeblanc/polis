import { describe, expect, it } from 'vitest';
import { BirdsEngine } from './birdsEngine';
import type { BirdCell, BirdFlow } from './entities';
import {
  possibleFlowDestinations,
  possibleFlowSources,
  possibleMidpointCells,
  possibleParentFlows,
} from './motionSupport';
import { birdsScale } from './scales';

const SEED = 'birds-engine-test';
const POPULATION_DENSITY = 2;
const DIFFUSION_RATE = 0.5;

function cell(epoch: number, spatialIndex: number, time: number): BirdCell {
  const length = birdsScale(epoch)!.cellLength;
  return { min: spatialIndex * length, max: (spatialIndex + 1) * length, time };
}

function equalResolutionFlows(
  source: BirdCell,
  duration: number,
): readonly BirdFlow[] {
  const length = source.max - source.min;
  return possibleFlowDestinations(source, duration, DIFFUSION_RATE)
    .filter((destination) => destination.max - destination.min === length)
    .map((destination) => ({ source, destination }));
}

describe('BirdsEngine coarse initialization', () => {
  it('returns the deterministic population for every coarse cell', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;

    expect(engine.queryCell(cell(0, -1_000, -12 * scale.flowDuration))).toBe(
      Math.round(POPULATION_DENSITY * scale.cellLength),
    );
    expect(engine.queryCell(cell(0, 1_000, 17 * scale.flowDuration))).toBe(
      Math.round(POPULATION_DENSITY * scale.cellLength),
    );
  });

  it('conserves coarse outgoing and incoming flows translation-independently', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const population = engine.queryCell(cell(0, 0, 0));

    for (const sourceIndex of [-20, 0, 17]) {
      const source = cell(0, sourceIndex, -3 * scale.flowDuration);
      const outgoing = equalResolutionFlows(source, scale.flowDuration);
      expect(outgoing.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
    }

    const destination = cell(0, 9, 4 * scale.flowDuration);
    const incoming = equalResolutionFlows(
      cell(0, 9, 3 * scale.flowDuration),
      scale.flowDuration,
    ).map((candidate) => ({
      source: cell(
        0,
        9 - (candidate.destination.min - candidate.source.min) / scale.cellLength,
        3 * scale.flowDuration,
      ),
      destination,
    }));
    expect(incoming.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
      population,
    );
  });

  it('returns zero outside support and rejects invalid geometry', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;

    expect(
      engine.queryFlow({
        source: cell(0, 0, 0),
        destination: cell(0, 10_000, scale.flowDuration),
      }),
    ).toBe(0);
    expect(() =>
      engine.queryFlow({
        source: cell(0, 0, 0),
        destination: cell(0, 1, 3),
      }),
    ).toThrow(RangeError);
  });
});

describe('BirdsEngine temporal Stages A-D', () => {
  it('conserves every Stage-A and Stage-C owned batch', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const source = cell(0, -2, 0);

    for (const parent of equalResolutionFlows(source, scale.flowDuration)) {
      const batch = engine.queryFlowTimeSubdivision(parent);
      expect(batch.entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(
        batch.parentCount,
      );
      for (const entry of batch.entries) {
        expect(
          engine.queryTwoStageFlow({
            source: parent.source,
            midpoint: entry.midpointCell,
            destination: parent.destination,
          }),
        ).toBe(entry.count);
      }
    }

    for (const parent of equalResolutionFlows(source, scale.halfFlowDuration)) {
      const batch = engine.queryFlowTimeSubdivision(parent);
      expect(batch.entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(
        batch.parentCount,
      );
    }
  });

  it('aggregates Stage B and D from the correct parent leg', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const cases = [
      equalResolutionFlows(cell(0, -1, 0), scale.halfFlowDuration)[0],
      equalResolutionFlows(
        cell(0, -1, scale.halfFlowDuration),
        scale.halfFlowDuration,
      )[0],
      equalResolutionFlows(cell(0, -1, 0), scale.nextFlowDuration)[0],
      equalResolutionFlows(
        cell(0, -1, scale.nextFlowDuration),
        scale.nextFlowDuration,
      )[0],
    ];

    for (const candidate of cases) {
      const parents = possibleParentFlows(candidate, DIFFUSION_RATE);
      const expected = parents.reduce((sum, parent) => {
        const midpoint =
          candidate.source.time === parent.source.time
            ? candidate.destination
            : candidate.source;
        return (
          sum +
          engine.queryTwoStageFlow({
            source: parent.source,
            midpoint,
            destination: parent.destination,
          })
        );
      }, 0);
      expect(engine.queryFlow(candidate)).toBe(expected);
    }
  });

  it('conserves total population after Stage B and Stage D aggregation', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const source = cell(0, 0, 0);
    const population = engine.queryCell(source);

    for (const duration of [scale.halfFlowDuration, scale.nextFlowDuration]) {
      const flows = equalResolutionFlows(source, duration);
      expect(flows.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
    }
  });

  it('is deterministic across query order and cache clearing', () => {
    const scale = birdsScale(0)!;
    const source = cell(0, -2, 0);
    const flows = [
      ...equalResolutionFlows(source, scale.halfFlowDuration),
      ...equalResolutionFlows(source, scale.nextFlowDuration),
    ];
    const first = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const second = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const forward = new Map(flows.map((candidate) => [JSON.stringify(candidate), first.queryFlow(candidate)]));
    const reverse = new Map(
      [...flows]
        .reverse()
        .map((candidate) => [JSON.stringify(candidate), second.queryFlow(candidate)]),
    );

    expect(reverse).toEqual(forward);
    first.clearCache();
    expect(new Map(flows.map((candidate) => [JSON.stringify(candidate), first.queryFlow(candidate)]))).toEqual(
      forward,
    );
  });

  it('caches canonical temporal batches rather than resampling entries', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const parent = equalResolutionFlows(cell(0, 0, 0), scale.flowDuration)[0];
    const midpoint = possibleMidpointCells(parent, DIFFUSION_RATE)[0];
    const entry = {
      source: parent.source,
      midpoint,
      destination: parent.destination,
    };

    const first = engine.queryTwoStageFlow(entry);
    const second = engine.queryTwoStageFlow(entry);

    expect(second).toBe(first);
    expect(engine.getLastQueryStats().cacheHits).toBeGreaterThan(0);
    expect(engine.getCacheUsage().entries).toBeGreaterThan(0);
  });

  it('continues through Stage-H entry flows across multiple epochs', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);

    for (const epoch of [1, 2]) {
      const scale = birdsScale(epoch)!;
      expect(
        engine.queryFlow({
          source: cell(epoch, 0, 0),
          destination: cell(epoch, 0, scale.flowDuration),
        }),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('BirdsEngine cell Stages E-F', () => {
  it('constructs Stage-E cells from equal-resolution Stage-D outflows', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;

    for (const timeIndex of [-7, -3, -2, -1, 1, 2, 3, 5]) {
      const target = cell(0, -4, timeIndex * scale.nextFlowDuration);
      const outgoing = equalResolutionFlows(target, scale.nextFlowDuration);
      const incoming = possibleFlowSources(
        target,
        scale.nextFlowDuration,
        DIFFUSION_RATE,
      )
        .filter((source) => source.max - source.min === scale.cellLength)
        .map((source) => ({ source, destination: target }));

      const population = engine.queryCell(target);
      expect(outgoing.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
      expect(incoming.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
    }
  });

  it('conserves each Stage-F cell subdivision and serves both child entries', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const parents = [
      cell(0, -3, 0),
      cell(0, -3, scale.nextFlowDuration),
      cell(1, -3, 0),
    ];

    for (const parent of parents) {
      const subdivision = engine.queryCellSubdivision(parent);
      expect(subdivision.children[0].count + subdivision.children[1].count).toBe(
        subdivision.parentCount,
      );
      expect(engine.queryCell(subdivision.children[0].cell)).toBe(
        subdivision.children[0].count,
      );
      expect(engine.queryCell(subdivision.children[1].cell)).toBe(
        subdivision.children[1].count,
      );
    }
  });

  it('supports repeated inward spatial subdivision at coarse-aligned times', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    let parent = cell(0, -1, 0);

    for (let epoch = 0; epoch < 8; epoch += 1) {
      const subdivision = engine.queryCellSubdivision(parent);
      expect(subdivision.children[0].count + subdivision.children[1].count).toBe(
        engine.queryCell(parent),
      );
      parent = subdivision.children[epoch % 2].cell;
    }
  });

  it('is deterministic across cell query order and cache clearing', () => {
    const scale = birdsScale(0)!;
    const cells = [
      cell(0, -2, scale.nextFlowDuration),
      cell(1, -4, 0),
      cell(1, -3, 0),
      cell(1, -4, scale.nextFlowDuration),
      cell(1, -3, scale.nextFlowDuration),
    ];
    const first = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const second = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const forward = new Map(cells.map((target) => [JSON.stringify(target), first.queryCell(target)]));
    const reverse = new Map(
      [...cells]
        .reverse()
        .map((target) => [JSON.stringify(target), second.queryCell(target)]),
    );

    expect(reverse).toEqual(forward);
    first.clearCache();
    expect(new Map(cells.map((target) => [JSON.stringify(target), first.queryCell(target)]))).toEqual(
      forward,
    );
  });

  it('caches the owned Stage-F batch', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const parent = cell(0, 0, birdsScale(0)!.nextFlowDuration);

    const first = engine.queryCellSubdivision(parent);
    const second = engine.queryCellSubdivision(parent);

    expect(second).toEqual(first);
    expect(engine.getLastQueryStats().cacheHits).toBeGreaterThan(0);
  });
});

describe('BirdsEngine spatial flow Stages G1-G2-H', () => {
  it('jointly splits every outflow while conserving source-child populations', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const parent = cell(0, -2, scale.nextFlowDuration);
    const cellSubdivision = engine.queryCellSubdivision(parent);
    const batch = engine.queryCellOutflowSubdivision(parent);

    for (const child of cellSubdivision.children) {
      expect(
        batch.entries
          .filter((entry) => entry.flow.source.min === child.cell.min)
          .reduce((sum, entry) => sum + entry.count, 0),
      ).toBe(child.count);
    }
    for (const parentFlow of equalResolutionFlows(parent, scale.nextFlowDuration)) {
      expect(
        batch.entries
          .filter(
            (entry) =>
              entry.flow.destination.min === parentFlow.destination.min &&
              entry.flow.destination.max === parentFlow.destination.max,
          )
          .reduce((sum, entry) => sum + entry.count, 0),
      ).toBe(engine.queryFlow(parentFlow));
    }
  });

  it('jointly splits every inflow while conserving destination-child populations', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const parent = cell(0, 3, 2 * scale.nextFlowDuration);
    const cellSubdivision = engine.queryCellSubdivision(parent);
    const batch = engine.queryCellInflowSubdivision(parent);

    for (const child of cellSubdivision.children) {
      expect(
        batch.entries
          .filter((entry) => entry.flow.destination.min === child.cell.min)
          .reduce((sum, entry) => sum + entry.count, 0),
      ).toBe(child.count);
    }
    const parentFlows = possibleFlowSources(parent, scale.nextFlowDuration, DIFFUSION_RATE)
      .filter((source) => source.max - source.min === scale.cellLength)
      .map((source) => ({ source, destination: parent }));
    for (const parentFlow of parentFlows) {
      expect(
        batch.entries
          .filter(
            (entry) =>
              entry.flow.source.min === parentFlow.source.min &&
              entry.flow.source.max === parentFlow.source.max,
          )
          .reduce((sum, entry) => sum + entry.count, 0),
      ).toBe(engine.queryFlow(parentFlow));
    }
  });

  it('reconciles each 2 x 2 flow table to both G1 and G2 margins', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(0)!;
    const parent = equalResolutionFlows(
      cell(0, -1, scale.nextFlowDuration),
      scale.nextFlowDuration,
    ).find((candidate) => engine.queryFlow(candidate) > 0)!;
    const result = engine.queryFlowSpaceSubdivision(parent);
    const outflows = engine.queryCellOutflowSubdivision(parent.source);
    const inflows = engine.queryCellInflowSubdivision(parent.destination);
    const [topLeft, topRight, bottomLeft, bottomRight] = result.entries;

    expect(result.entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      result.parentCount,
    );
    expect(topLeft.count + topRight.count).toBe(
      matchingCount(outflows.entries, topLeft.flow.source, parent.destination),
    );
    expect(bottomLeft.count + bottomRight.count).toBe(
      matchingCount(outflows.entries, bottomLeft.flow.source, parent.destination),
    );
    expect(topLeft.count + bottomLeft.count).toBe(
      matchingCount(inflows.entries, parent.source, topLeft.flow.destination),
    );
    expect(topRight.count + bottomRight.count).toBe(
      matchingCount(inflows.entries, parent.source, topRight.flow.destination),
    );
    for (const entry of result.entries) {
      expect(engine.queryFlow(entry.flow)).toBe(entry.count);
    }
  });

  it('conserves complete fine-resolution incidence after a full epoch', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(1)!;

    for (const timeIndex of [-2, 0, 3]) {
      const target = cell(1, -3, timeIndex * scale.flowDuration);
      const outgoing = possibleFlowDestinations(
        target,
        scale.flowDuration,
        DIFFUSION_RATE,
      )
        .filter((destination) => destination.max - destination.min === scale.cellLength)
        .map((destination) => ({ source: target, destination }));
      const incoming = possibleFlowSources(target, scale.flowDuration, DIFFUSION_RATE)
        .filter((source) => source.max - source.min === scale.cellLength)
        .map((source) => ({ source, destination: target }));
      const population = engine.queryCell(target);

      expect(outgoing.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
      expect(incoming.reduce((sum, candidate) => sum + engine.queryFlow(candidate), 0)).toBe(
        population,
      );
    }
  });

  it('is deterministic across H query order and cache clearing', () => {
    const scale = birdsScale(0)!;
    const parents = equalResolutionFlows(cell(0, 0, 0), scale.nextFlowDuration);
    const fineFlows = parents.flatMap((parent) => {
      const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
      return engine.queryFlowSpaceSubdivision(parent).entries.map(({ flow }) => flow);
    });
    const first = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const second = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const forward = new Map(
      fineFlows.map((candidate) => [JSON.stringify(candidate), first.queryFlow(candidate)]),
    );
    const reverse = new Map(
      [...fineFlows]
        .reverse()
        .map((candidate) => [JSON.stringify(candidate), second.queryFlow(candidate)]),
    );

    expect(reverse).toEqual(forward);
    first.clearCache();
    expect(
      new Map(
        fineFlows.map((candidate) => [JSON.stringify(candidate), first.queryFlow(candidate)]),
      ),
    ).toEqual(forward);
  });

  it('is deterministic under continuous LRU eviction', () => {
    const options = {
      flowCacheCapacity: 1,
      temporalBatchCacheCapacity: 1,
      cellCacheCapacity: 1,
      cellSubdivisionCacheCapacity: 1,
      cellIncidenceCacheCapacity: 1,
      flowReconciliationCacheCapacity: 1,
    } as const;
    const scale = birdsScale(1)!;
    const sources = [-3, 0, 4].map((index) => cell(1, index, 0));
    const flows = sources.flatMap((source) =>
      possibleFlowDestinations(source, scale.flowDuration, DIFFUSION_RATE)
        .filter((destination) => destination.max - destination.min === scale.cellLength)
        .slice(0, 3)
        .map((destination) => ({ source, destination })),
    );
    const baseline = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const evicting = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE, options);
    const expected = new Map(
      flows.map((candidate) => [JSON.stringify(candidate), baseline.queryFlow(candidate)]),
    );

    for (const candidate of [...flows].reverse()) {
      expect(evicting.queryFlow(candidate)).toBe(expected.get(JSON.stringify(candidate)));
    }
    expect(evicting.getCacheUsage().entries).toBeLessThanOrEqual(14);
  });
});

function matchingCount(
  entries: readonly { readonly flow: BirdFlow; readonly count: number }[],
  source: BirdCell,
  destination: BirdCell,
): number {
  return (
    entries.find(
      (entry) =>
        entry.flow.source.min === source.min &&
        entry.flow.source.max === source.max &&
        entry.flow.source.time === source.time &&
        entry.flow.destination.min === destination.min &&
        entry.flow.destination.max === destination.max &&
        entry.flow.destination.time === destination.time,
    )?.count ?? 0
  );
}
