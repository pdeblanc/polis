import { describe, expect, it } from 'vitest';
import { classifyFlow } from './classifiers';
import type { BirdCell, BirdFlow } from './entities';
import {
  clearBirdsMotionSupportCache,
  constructBirdsMotionSupport,
  isPossibleFlow,
  possibleCanonicalFlowDestinations,
  possibleCanonicalFlowSources,
  possibleCanonicalParentFlows,
  possibleFlowDestinations,
  possibleFlowSources,
  possibleMidpointCells,
  possibleParentFlows,
} from './motionSupport';
import { birdsScale } from './scales';

function cell(epoch: number, spatialIndex: number, time: number): BirdCell {
  const length = birdsScale(epoch)!.cellLength;
  return { min: spatialIndex * length, max: (spatialIndex + 1) * length, time };
}

function flow(
  epoch: number,
  sourceIndex: number,
  destinationIndex: number,
  startTime: number,
  duration: number,
): BirdFlow {
  return {
    source: cell(epoch, sourceIndex, startTime),
    destination: cell(epoch, destinationIndex, startTime + duration),
  };
}

function containsCell(cells: readonly BirdCell[], target: BirdCell): boolean {
  return cells.some(
    (candidate) =>
      candidate.min === target.min &&
      candidate.max === target.max &&
      candidate.time === target.time,
  );
}

describe('canonical motion support', () => {
  it('matches validated enumeration for legal hierarchy cells and flows', () => {
    for (const epoch of [0, 1, 2, 3]) {
      const scale = birdsScale(epoch)!;
      const source = cell(epoch, -2, 0);
      for (const duration of [
        scale.flowDuration,
        scale.halfFlowDuration,
        scale.nextFlowDuration,
      ]) {
        expect(possibleCanonicalFlowDestinations(source, duration, 0.5)).toEqual(
          possibleFlowDestinations(source, duration, 0.5),
        );
        const destination = cell(epoch, 2, duration);
        expect(possibleCanonicalFlowSources(destination, duration, 0.5)).toEqual(
          possibleFlowSources(destination, duration, 0.5),
        );
      }

      const midpoint = possibleFlowDestinations(
        source,
        scale.halfFlowDuration,
        0.5,
      )[0];
      if (midpoint !== undefined) {
        const leg = { source, destination: midpoint };
        expect(possibleCanonicalParentFlows(leg, 0.5)).toEqual(
          possibleParentFlows(leg, 0.5),
        );
      }
    }
  });
});

function containsFlow(flows: readonly BirdFlow[], target: BirdFlow): boolean {
  return flows.some(
    (candidate) =>
      containsCell([candidate.source], target.source) &&
      containsCell([candidate.destination], target.destination),
  );
}

describe('Birds motion support', () => {
  it.each([0, 0.01, 0.1, 1, 4, 16, 100])(
    'constructs a finite fixed point for diffusion rate %s',
    (diffusionRate) => {
      const support = constructBirdsMotionSupport(diffusionRate);

      expect(support.iterations).toBeGreaterThan(0);
      expect(support.iterations).toBeLessThan(20);
      expect(support.coarseOffsets.length).toBeGreaterThan(0);
      expect(support.epochOffsets.length).toBeGreaterThanOrEqual(
        support.coarseOffsets.length,
      );
      expect(support.halfDurationOffsets.length).toBeGreaterThan(0);
      expect(support.quarterDurationOffsets.length).toBeGreaterThan(0);
      for (const values of [
        support.coarseOffsets,
        support.epochOffsets,
        support.halfDurationOffsets,
        support.quarterDurationOffsets,
      ]) {
        expect(values).toEqual([...values].sort((left, right) => left - right));
      }
    },
  );

  it('is independent of derived-support cache state', () => {
    const before = constructBirdsMotionSupport(2);
    clearBirdsMotionSupportCache();
    const after = constructBirdsMotionSupport(2);

    expect(after).toEqual(before);
  });

  it('translates the two zero-diffusion midpoint alignments exactly', () => {
    const scale = birdsScale(0)!;
    const even = flow(0, -2, 0, 0, scale.flowDuration);
    const odd = flow(0, -2, -1, 0, scale.flowDuration);

    expect(possibleMidpointCells(even, 0)).toEqual([cell(0, -1, scale.halfFlowDuration)]);
    expect(possibleMidpointCells(odd, 0)).toEqual([
      cell(0, -2, scale.halfFlowDuration),
      cell(0, -1, scale.halfFlowDuration),
    ]);
  });

  it('recovers every parent from both of its Stage-A legs', () => {
    const diffusionRate = 1;
    const scale = birdsScale(0)!;
    const source = cell(0, -2, 0);

    for (const destination of possibleFlowDestinations(
      source,
      scale.flowDuration,
      diffusionRate,
    ).filter((candidate) => candidate.max - candidate.min === scale.cellLength)) {
      const parent = { source, destination };
      for (const midpoint of possibleMidpointCells(parent, diffusionRate)) {
        expect(
          containsFlow(possibleParentFlows({ source, destination: midpoint }, diffusionRate), parent),
        ).toBe(true);
        expect(
          containsFlow(
            possibleParentFlows({ source: midpoint, destination }, diffusionRate),
            parent,
          ),
        ).toBe(true);
      }
    }
  });

  it('recovers every Stage-B parent from both Stage-C legs', () => {
    const diffusionRate = 0.5;
    const scale = birdsScale(1)!;
    const parent = flow(1, -1, 2, 0, scale.halfFlowDuration);
    expect(isPossibleFlow(parent, diffusionRate)).toBe(true);

    for (const midpoint of possibleMidpointCells(parent, diffusionRate)) {
      expect(
        containsFlow(
          possibleParentFlows({ source: parent.source, destination: midpoint }, diffusionRate),
          parent,
        ),
      ).toBe(true);
      expect(
        containsFlow(
          possibleParentFlows({ source: midpoint, destination: parent.destination }, diffusionRate),
          parent,
        ),
      ).toBe(true);
    }
  });

  it('makes forward and inverse incidence enumeration agree across legal resolutions', () => {
    for (const diffusionRate of [0, 0.25, 2]) {
      for (const epoch of [0, 1, 2]) {
        const scale = birdsScale(epoch)!;
        const source = cell(epoch, -3, 0);
        for (const duration of [
          scale.flowDuration,
          scale.halfFlowDuration,
          scale.nextFlowDuration,
        ]) {
          for (const destination of possibleFlowDestinations(
            source,
            duration,
            diffusionRate,
          )) {
            expect(isPossibleFlow({ source, destination }, diffusionRate)).toBe(true);
            expect(
              containsCell(
                possibleFlowSources(destination, duration, diffusionRate),
                source,
              ),
            ).toBe(true);
          }
        }
      }
    }
  });

  it('includes equal and adjacent endpoint resolutions where both are legal', () => {
    const scale = birdsScale(1)!;
    const source = cell(1, -3, 0);

    const entryDestinations = possibleFlowDestinations(source, scale.flowDuration, 0);
    expect(new Set(entryDestinations.map((destination) => destination.max - destination.min))).toEqual(
      new Set([scale.cellLength, birdsScale(0)!.cellLength]),
    );

    const quarterDestinations = possibleFlowDestinations(source, scale.nextFlowDuration, 0);
    expect(
      new Set(quarterDestinations.map((destination) => destination.max - destination.min)),
    ).toEqual(new Set([scale.cellLength, scale.childCellLength]));
  });

  it('distinguishes structurally legal zero support from invalid geometry', () => {
    const scale = birdsScale(0)!;
    const outside = flow(0, 0, 10_000, 0, scale.flowDuration);
    const invalid = flow(0, 0, 1, 0, 3);

    expect(classifyFlow(outside)).toBeDefined();
    expect(isPossibleFlow(outside, 1)).toBe(false);
    expect(classifyFlow(invalid)).toBeUndefined();
    expect(isPossibleFlow(invalid, 1)).toBe(false);
    expect(possibleMidpointCells(outside, 1)).toEqual([]);
    expect(possibleParentFlows(invalid, 1)).toEqual([]);
  });

  it('returns incidence cells in increasing geometric order', () => {
    const scale = birdsScale(1)!;
    const destinations = possibleFlowDestinations(cell(1, -3, 0), scale.nextFlowDuration, 1);
    const sources = possibleFlowSources(cell(1, 4, scale.nextFlowDuration), scale.nextFlowDuration, 1);

    for (const cells of [destinations, sources]) {
      expect(cells).toEqual(
        [...cells].sort((left, right) => left.min - right.min || left.max - right.max),
      );
    }
  });
});
