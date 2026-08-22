import { describe, expect, it } from 'vitest';
import type { BirdCell, BirdFlow, BirdTwoStageFlow } from './entities';
import {
  classifyCanonicalCell,
  classifyCanonicalFlow,
  classifyCanonicalTwoStageFlow,
  classifyCell,
  classifyFlow,
  classifyTwoStageFlow,
  type CellConstruction,
} from './classifiers';
import { BIRDS_COARSE_CELL_LENGTH, birdsScale } from './scales';

function cell(
  epoch: number,
  spatialIndex: number,
  time: number,
): BirdCell {
  const length = birdsScale(epoch)!.cellLength;
  return {
    min: spatialIndex * length,
    max: (spatialIndex + 1) * length,
    time,
  };
}

function flow(
  sourceEpoch: number,
  sourceIndex: number,
  destinationEpoch: number,
  destinationIndex: number,
  startTime: number,
  duration: number,
): BirdFlow {
  return {
    source: cell(sourceEpoch, sourceIndex, startTime),
    destination: cell(destinationEpoch, destinationIndex, startTime + duration),
  };
}

describe('classifyCell', () => {
  it('classifies every alignment residue in the first two epochs', () => {
    for (const epoch of [0, 1]) {
      const scale = birdsScale(epoch)!;
      for (let timeIndex = -8; timeIndex <= 8; timeIndex += 1) {
        const construction = classifyCell(
          cell(epoch, -3, timeIndex * scale.nextFlowDuration),
        );
        expect(construction).toBeDefined();

        if (timeIndex % 4 === 0) {
          expect(construction?.kind).toBe(epoch === 0 ? 'coarse-initialized' : 'spatial-child');
        } else {
          expect(construction?.kind).toBe('temporally-introduced');
          expect(construction?.epoch).toBe(epoch);
        }
      }
    }
  });

  it('returns spatial parents and Euclidean child indices at negative positions', () => {
    const scale = birdsScale(3)!;
    const left = classifyCell(cell(3, -4, 0));
    const right = classifyCell(cell(3, -3, 0));

    expect(left).toMatchObject({ kind: 'spatial-child', epoch: 2, childIndex: 0 });
    expect(right).toMatchObject({ kind: 'spatial-child', epoch: 2, childIndex: 1 });
    if (left?.kind === 'spatial-child' && right?.kind === 'spatial-child') {
      expect(left.parentCell).toEqual(right.parentCell);
      expect(left.parentCell).toEqual({
        min: -4 * scale.cellLength,
        max: -2 * scale.cellLength,
        time: 0,
      });
      expect(left.subdivisionOwner).toEqual(left.parentCell);
    }
  });

  it('rejects invalid lengths, spatial boundaries, and time alignments', () => {
    expect(classifyCell({ min: 0, max: 3, time: 0 })).toBeUndefined();
    expect(classifyCell({ min: 1, max: 17, time: 0 })).toBeUndefined();
    expect(classifyCell({ min: 0, max: 16, time: 1 })).toBeUndefined();
    expect(classifyCell({ min: 0, max: 16, time: Number.NaN })).toBeUndefined();
    expect(classifyCell({ min: Number.POSITIVE_INFINITY, max: Number.POSITIVE_INFINITY, time: 0 }))
      .toBeUndefined();
    expect(
      classifyCell({ min: 0, max: BIRDS_COARSE_CELL_LENGTH / 2 ** 540, time: 0 }),
    ).toBeUndefined();
  });

  it('gives sampled fine cells at coarse-aligned times finite spatial ancestry', () => {
    let state = 0x1234_5678;
    const nextInteger = (limit: number) => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state % limit;
    };

    for (let sample = 0; sample < 500; sample += 1) {
      const epoch = nextInteger(18);
      const spatialIndex = nextInteger(2_001) - 1_000;
      const coarseTimeIndex = nextInteger(2_001) - 1_000;
      let current = cell(
        epoch,
        spatialIndex,
        coarseTimeIndex * birdsScale(0)!.flowDuration,
      );
      let construction: CellConstruction | undefined;
      let steps = 0;

      while (true) {
        construction = classifyCell(current);
        if (construction?.kind !== 'spatial-child') break;
        current = construction.parentCell;
        steps += 1;
        expect(steps).toBeLessThanOrEqual(epoch);
      }

      expect(construction?.kind).toBe('coarse-initialized');
      expect(steps).toBe(epoch);
    }
  });
});

describe('classifyFlow', () => {
  it('classifies initialization and every stage-produced flow in epochs zero and one', () => {
    for (const epoch of [0, 1]) {
      const scale = birdsScale(epoch)!;
      const entry = classifyFlow(flow(epoch, -2, epoch, 3, -scale.flowDuration, scale.flowDuration));
      const firstHalf = classifyFlow(flow(epoch, -2, epoch, 3, 0, scale.halfFlowDuration));
      const secondHalf = classifyFlow(
        flow(epoch, -2, epoch, 3, -scale.halfFlowDuration, scale.halfFlowDuration),
      );
      const quarter = classifyFlow(flow(epoch, -2, epoch, 3, 0, scale.nextFlowDuration));
      const sourceMixed = classifyFlow(
        flow(epoch + 1, -3, epoch, 3, 0, scale.nextFlowDuration),
      );
      const destinationMixed = classifyFlow(
        flow(epoch, -2, epoch + 1, 7, 0, scale.nextFlowDuration),
      );

      expect(entry?.kind).toBe(epoch === 0 ? 'coarse-initialized' : 'fully-spatially-refined');
      expect(firstHalf).toMatchObject({
        kind: 'temporal-aggregation',
        epoch,
        stage: 'B',
        leg: 'first',
      });
      expect(secondHalf).toMatchObject({
        kind: 'temporal-aggregation',
        epoch,
        stage: 'B',
        leg: 'second',
        enclosingStartTime: -scale.flowDuration,
        enclosingEndTime: 0,
      });
      expect(quarter).toMatchObject({ kind: 'temporal-aggregation', epoch, stage: 'D' });
      expect(sourceMixed).toMatchObject({ kind: 'source-spatial-child', epoch, stage: 'G1' });
      expect(destinationMixed).toMatchObject({
        kind: 'destination-spatial-child',
        epoch,
        stage: 'G2',
      });
    }
  });

  it('returns concrete H containing-flow and child metadata', () => {
    const scale = birdsScale(2)!;
    const construction = classifyFlow(
      flow(2, -3, 2, 4, -scale.flowDuration, scale.flowDuration),
    );

    expect(construction).toMatchObject({
      kind: 'fully-spatially-refined',
      epoch: 1,
      stage: 'H',
      sourceChildIndex: 1,
      destinationChildIndex: 0,
    });
    if (construction?.kind === 'fully-spatially-refined') {
      expect(classifyFlow(construction.containingFlow)).toMatchObject({
        kind: 'temporal-aggregation',
        epoch: 1,
        stage: 'D',
      });
      expect(construction.subdivisionOwner).toEqual(construction.containingFlow);
    }
  });

  it('describes first- and second-leg parent searches at negative times', () => {
    const scale = birdsScale(0)!;
    const first = classifyFlow(
      flow(0, 0, 0, 1, -2 * scale.halfFlowDuration, scale.halfFlowDuration),
    );
    const second = classifyFlow(
      flow(0, 1, 0, 2, -scale.halfFlowDuration, scale.halfFlowDuration),
    );

    expect(first).toMatchObject({
      kind: 'temporal-aggregation',
      leg: 'first',
      parentFlowSearch: { kind: 'destinations-from-source' },
    });
    expect(second).toMatchObject({
      kind: 'temporal-aggregation',
      leg: 'second',
      parentFlowSearch: { kind: 'sources-to-destination' },
    });
  });

  it('rejects invalid durations, alignments, directions, and scale combinations', () => {
    const scale = birdsScale(0)!;
    expect(classifyFlow(flow(0, 0, 0, 1, 0, 3))).toBeUndefined();
    expect(classifyFlow(flow(0, 0, 0, 1, 1, scale.halfFlowDuration))).toBeUndefined();
    expect(classifyFlow(flow(0, 0, 0, 1, 0, -scale.flowDuration))).toBeUndefined();
    expect(classifyFlow(flow(0, 0, 2, 1, 0, birdsScale(1)!.nextFlowDuration))).toBeUndefined();
  });
});

describe('classifyTwoStageFlow', () => {
  function twoStage(
    epoch: number,
    startTime: number,
    duration: number,
    midpointTime = startTime + duration / 2,
  ): BirdTwoStageFlow {
    return {
      source: cell(epoch, -2, startTime),
      midpoint: cell(epoch, 0, midpointTime),
      destination: cell(epoch, 3, startTime + duration),
    };
  }

  it('classifies Stage A and C for the first two epochs', () => {
    for (const epoch of [0, 1]) {
      const scale = birdsScale(epoch)!;
      expect(classifyTwoStageFlow(twoStage(epoch, -scale.flowDuration, scale.flowDuration))).toMatchObject({
        kind: 'epoch-time-subdivision',
        epoch,
        stage: 'A',
        normalizedDuration: 1,
      });
      expect(
        classifyTwoStageFlow(
          twoStage(epoch, -scale.halfFlowDuration, scale.halfFlowDuration),
        ),
      ).toMatchObject({
        kind: 'half-flow-time-subdivision',
        epoch,
        stage: 'C',
        normalizedDuration: 0.5,
      });
    }
  });

  it('rejects a wrong midpoint, duration, alignment, or mixed cell width', () => {
    const scale = birdsScale(0)!;
    expect(classifyTwoStageFlow(twoStage(0, 0, scale.flowDuration, 1))).toBeUndefined();
    expect(classifyTwoStageFlow(twoStage(0, 0, scale.nextFlowDuration))).toBeUndefined();
    expect(classifyTwoStageFlow(twoStage(0, 1, scale.flowDuration))).toBeUndefined();
    expect(
      classifyTwoStageFlow({
        ...twoStage(0, 0, scale.flowDuration),
        midpoint: cell(1, 0, scale.halfFlowDuration),
      }),
    ).toBeUndefined();
  });
});

describe('canonical classifiers', () => {
  it('agree with validated classifiers for legal hierarchy objects', () => {
    for (const epoch of [0, 1, 2, 3]) {
      const scale = birdsScale(epoch)!;
      const legalCell = cell(epoch, -3, -scale.flowDuration);
      const legalFlow = flow(
        epoch,
        -3,
        epoch,
        2,
        -scale.flowDuration,
        scale.flowDuration,
      );
      const twoStage: BirdTwoStageFlow = {
        source: legalFlow.source,
        midpoint: cell(epoch, 0, -scale.flowDuration / 2),
        destination: legalFlow.destination,
      };

      expect(classifyCanonicalCell(legalCell)).toEqual(classifyCell(legalCell));
      expect(classifyCanonicalFlow(legalFlow)).toEqual(classifyFlow(legalFlow));
      expect(classifyCanonicalTwoStageFlow(twoStage)).toEqual(
        classifyTwoStageFlow(twoStage),
      );
    }
  });
});
