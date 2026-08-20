import { describe, expect, it } from 'vitest';
import { BirdsEngine } from './birdsEngine';
import type { BirdCell, BirdFlow } from './entities';
import {
  possibleFlowDestinations,
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

  it('fails explicitly for valid stages that are not implemented yet', () => {
    const engine = new BirdsEngine(SEED, POPULATION_DENSITY, DIFFUSION_RATE);
    const scale = birdsScale(1)!;

    expect(() => engine.queryCell(cell(0, 0, birdsScale(0)!.nextFlowDuration))).toThrow(
      /not implemented/,
    );
    expect(() => engine.queryFlow(flowAtEpochOneEntry(scale))).toThrow(/not implemented/);
  });
});

function flowAtEpochOneEntry(scale: NonNullable<ReturnType<typeof birdsScale>>): BirdFlow {
  return {
    source: cell(1, 0, 0),
    destination: cell(1, 0, scale.flowDuration),
  };
}
