import { describe, expect, it } from 'vitest';
import { classifyFlow } from './classifiers';
import type { BirdCell, BirdFlow } from './entities';
import {
  classifyCellInflowSubdivisionOwner,
  classifyCellOutflowSubdivisionOwner,
  classifyCellSubdivisionOwner,
  classifyFlowSpaceSubdivisionOwner,
  classifyFlowTimeSubdivisionOwner,
} from './ownerClassifiers';
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

describe('cell owner projections', () => {
  it('gives the same capabilities to every cell construction kind', () => {
    const coarseScale = birdsScale(0)!;
    const examples = [
      cell(0, -1, 0),
      cell(0, -1, coarseScale.nextFlowDuration),
      cell(1, -1, 0),
    ];

    for (const example of examples) {
      const subdivision = classifyCellSubdivisionOwner(example)!;
      const outflows = classifyCellOutflowSubdivisionOwner(example)!;
      const inflows = classifyCellInflowSubdivisionOwner(example)!;
      const scale = birdsScale(subdivision.epoch)!;

      expect(subdivision.children).toEqual([
        { min: example.min, max: example.min + scale.childCellLength, time: example.time },
        { min: example.min + scale.childCellLength, max: example.max, time: example.time },
      ]);
      expect(outflows).toMatchObject({
        stage: 'G1',
        ownerCell: example,
        sourceChildren: subdivision.children,
        flowDuration: scale.nextFlowDuration,
        destinationTime: example.time + scale.nextFlowDuration,
      });
      expect(inflows).toMatchObject({
        stage: 'G2',
        ownerCell: example,
        destinationChildren: subdivision.children,
        flowDuration: scale.nextFlowDuration,
        sourceTime: example.time - scale.nextFlowDuration,
      });
    }
  });

  it('preserves negative-coordinate child geometry', () => {
    const owner = classifyCellSubdivisionOwner(cell(2, -3, 0));

    expect(owner?.children).toEqual([
      { min: -12, max: -10, time: 0 },
      { min: -10, max: -8, time: 0 },
    ]);
  });

  it('rejects structurally invalid cells from every projection', () => {
    const invalid = { min: 1, max: 17, time: 0 };

    expect(classifyCellSubdivisionOwner(invalid)).toBeUndefined();
    expect(classifyCellOutflowSubdivisionOwner(invalid)).toBeUndefined();
    expect(classifyCellInflowSubdivisionOwner(invalid)).toBeUndefined();
  });
});

describe('flow owner projections', () => {
  it('classifies initialized and H entry flows as Stage-A owners', () => {
    for (const epoch of [0, 1, 4]) {
      const scale = birdsScale(epoch)!;
      const owner = classifyFlowTimeSubdivisionOwner(
        flow(epoch, -2, 3, -scale.flowDuration, scale.flowDuration),
      );

      expect(owner).toMatchObject({
        kind: 'epoch-flow-time-subdivision',
        epoch,
        stage: 'A',
        midpointTime: -scale.flowDuration / 2,
        midpointCellLength: scale.cellLength,
        normalizedDuration: 1,
      });
    }
  });

  it('classifies Stage-B flows as Stage-C owners', () => {
    const epoch = 2;
    const scale = birdsScale(epoch)!;
    const owner = classifyFlowTimeSubdivisionOwner(
      flow(epoch, -2, 3, -scale.halfFlowDuration, scale.halfFlowDuration),
    );

    expect(owner).toMatchObject({
      kind: 'half-flow-time-subdivision',
      epoch,
      stage: 'C',
      midpointTime: -scale.halfFlowDuration / 2,
      midpointCellLength: scale.cellLength,
      normalizedDuration: 0.5,
    });
  });

  it('classifies Stage-D flows as complete Stage-H owners', () => {
    for (const epoch of [0, 1, 3]) {
      const scale = birdsScale(epoch)!;
      const parent = flow(epoch, -3, 4, -scale.nextFlowDuration, scale.nextFlowDuration);
      const owner = classifyFlowSpaceSubdivisionOwner(parent)!;

      expect(owner).toMatchObject({
        kind: 'flow-space-subdivision',
        epoch,
        stage: 'H',
        ownerFlow: parent,
      });
      expect(owner.childFlows).toHaveLength(4);
      expect(owner.childFlows.map((child) => classifyFlow(child)?.kind)).toEqual([
        'fully-spatially-refined',
        'fully-spatially-refined',
        'fully-spatially-refined',
        'fully-spatially-refined',
      ]);
    }
  });

  it('does not confuse construction with unrelated subdivision capability', () => {
    const scale = birdsScale(0)!;
    const entry = flow(0, 0, 1, 0, scale.flowDuration);
    const half = flow(0, 0, 1, 0, scale.halfFlowDuration);
    const quarter = flow(0, 0, 1, 0, scale.nextFlowDuration);

    expect(classifyFlowTimeSubdivisionOwner(entry)?.stage).toBe('A');
    expect(classifyFlowTimeSubdivisionOwner(half)?.stage).toBe('C');
    expect(classifyFlowTimeSubdivisionOwner(quarter)).toBeUndefined();
    expect(classifyFlowSpaceSubdivisionOwner(entry)).toBeUndefined();
    expect(classifyFlowSpaceSubdivisionOwner(half)).toBeUndefined();
    expect(classifyFlowSpaceSubdivisionOwner(quarter)?.stage).toBe('H');
  });

  it('rejects mixed-resolution and invalid flows', () => {
    const scale = birdsScale(0)!;
    const mixed: BirdFlow = {
      source: cell(1, 0, 0),
      destination: cell(0, 0, scale.nextFlowDuration),
    };
    const invalid = flow(0, 0, 1, 0, 3);

    expect(classifyFlowTimeSubdivisionOwner(mixed)).toBeUndefined();
    expect(classifyFlowSpaceSubdivisionOwner(mixed)).toBeUndefined();
    expect(classifyFlowTimeSubdivisionOwner(invalid)).toBeUndefined();
    expect(classifyFlowSpaceSubdivisionOwner(invalid)).toBeUndefined();
  });
});
