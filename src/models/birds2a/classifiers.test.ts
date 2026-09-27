import { describe, expect, it } from 'vitest';
import { birds2aScale, classifyBirds2aCell, classifyBirds2aCellSubdivision, classifyBirds2aFlow, type Birds2aCell } from './classifiers';

const origin = { min: 0, max: 1 };
const cell = (width: number, time: number, index = 0): Birds2aCell => ({ min: index * width, max: (index + 1) * width, time });

describe('Birds 2a entry classifiers', () => {
  it('supports dyadic scales on both sides of the unit initialization', () => {
    for (const exponent of [-30, -4, 0, 1, 6, 30]) {
      const width = 2 ** exponent;
      expect(birds2aScale(width)).toEqual({ cellWidth: width, duration: width ** 2,
        halfDuration: width ** 2 / 2, quarterDuration: width ** 2 / 4 });
    }
    for (const width of [0, -1, 3, Infinity, NaN]) expect(birds2aScale(width)).toBeUndefined();
  });

  it('locates the finest retained frame, independent of requested spatial position', () => {
    for (const sign of [-1, 1]) {
      expect(classifyBirds2aCell(cell(1, sign), origin)).toMatchObject({ kind: 'expansion',
        projection: { kind: 'initial-endpoint', epoch: 0, cellWidth: 1, branch: sign > 0 ? 'forward' : 'backward' } });
      for (let epoch = 1; epoch <= 5; epoch++) {
        const width = 2 ** (epoch - 1), duration = width ** 2;
        for (const slot of [2, 3, 4]) for (const index of [-100, 0, 100]) {
          expect(classifyBirds2aCell(cell(width, sign * slot * duration, index), origin)).toMatchObject({
            kind: 'expansion', projection: { kind: 'extension-frame', epoch, cellWidth: width, slot },
          });
          expect(classifyBirds2aCell(cell(width / 2, sign * slot * duration, index), origin)?.kind).toBe('spatial-child');
        }
      }
    }
  });

  it('does not manufacture expansion facts at unrecorded times or before origin initialization', () => {
    expect(classifyBirds2aCell(cell(1, 0.25), origin)).toEqual({ kind: 'temporal-aggregation', stage: 'E', outgoingDuration: 0.25 });
    expect(classifyBirds2aCell(cell(1, 5, -1), origin)).toEqual({ kind: 'spatial-child', stage: 'F',
      subdivisionOwner: { min: -2, max: 0, time: 5 }, childIndex: 1 });
    expect(classifyBirds2aCell(cell(2, 5), origin)).toEqual({ kind: 'temporal-aggregation', stage: 'E', outgoingDuration: 1 });
    expect(classifyBirds2aCell(cell(0.5, 0), origin)?.kind).toBe('spatial-child');
    expect(classifyBirds2aCell(cell(1, 0), { min: 32, max: 64 })?.kind).toBe('spatial-child');
    expect(classifyBirds2aCell(cell(32, 1024), { min: 32, max: 64 })).toMatchObject({
      kind: 'expansion', projection: { kind: 'initial-endpoint', epoch: 0 },
    });
  });

  it('classifies inherited origin flows, retained legs, and unresolved cross-batch couplings', () => {
    expect(classifyBirds2aFlow({ source: cell(2, 0), destination: cell(2, 4) }, origin)).toMatchObject({
      kind: 'expansion', projection: { kind: 'origin-endpoint', frame: { epoch: 1, slot: 4 } },
    });
    expect(classifyBirds2aFlow({ source: cell(2, 2), destination: cell(2, 4) }, origin)).toMatchObject({
      kind: 'unresolved-expansion-coupling', epoch: 1, branch: 'forward',
    });
    expect(classifyBirds2aFlow({ source: cell(2, -4), destination: cell(2, -2) }, origin)).toMatchObject({
      kind: 'unresolved-expansion-coupling', epoch: 1, branch: 'backward',
    });
    expect(classifyBirds2aFlow({ source: cell(1, 1), destination: cell(2, 2) }, origin)?.kind).toBe('expansion');
    expect(classifyBirds2aFlow({ source: cell(2, 4), destination: cell(2, 8) }, origin)).toMatchObject({
      kind: 'expansion', projection: { kind: 'extension-step', epoch: 2, stepIndex: 0 },
    });
  });

  it('supplies ordinary contraction dependencies below or between retained records', () => {
    expect(classifyBirds2aFlow({ source: cell(0.5, 0, -1), destination: cell(0.5, 0.25) }, origin)).toEqual({
      kind: 'spatial-reconciliation', stage: 'H',
      subdivisionOwner: { source: cell(1, 0, -1), destination: cell(1, 0.25) },
      sourceChildIndex: 1, destinationChildIndex: 0,
    });
    expect(classifyBirds2aFlow({ source: cell(0.5, 0), destination: cell(1, 0.25) }, origin)?.kind).toBe('source-subdivision');
    expect(classifyBirds2aFlow({ source: cell(1, 0), destination: cell(0.5, 0.25) }, origin)?.kind).toBe('destination-subdivision');
    expect(classifyBirds2aFlow({ source: cell(1, 0.25), destination: cell(1, 0.5) }, origin)).toEqual({
      kind: 'temporal-aggregation', stage: 'D', leg: 'second', parentDuration: 0.5, enclosingStartTime: 0, enclosingEndTime: 0.5,
    });
    expect(classifyBirds2aFlow({ source: cell(1, -0.5), destination: cell(1, 0) }, origin)).toEqual({
      kind: 'temporal-aggregation', stage: 'B', leg: 'second', parentDuration: 1, enclosingStartTime: -1, enclosingEndTime: 0,
    });
  });

  it('rejects invalid geometry rather than confusing it with an empty contribution', () => {
    for (const invalid of [{ min: 0, max: 3, time: 0 }, { min: 0.5, max: 1.5, time: 0 },
      { min: 0, max: 1, time: 0.1 }, { min: 0, max: 1, time: Infinity }]) {
      expect(classifyBirds2aCell(invalid, origin)).toBeUndefined();
    }
    for (const flow of [
      { source: cell(1, 1), destination: cell(1, 0) },
      { source: cell(1, 0), destination: cell(1, 3) },
      { source: cell(1, 0.25), destination: cell(1, 0.75) },
      { source: cell(0.25, 0), destination: cell(1, 0.25) },
    ]) expect(classifyBirds2aFlow(flow, origin)).toBeUndefined();
  });

  it('classifies cell-subdivision batches separately from their parent populations', () => {
    for (const time of [-4, -3, -2, -1, 0, 1, 2, 3, 4]) {
      expect(classifyBirds2aCellSubdivision(cell(2, time, -1), origin)).toMatchObject({
        kind: 'expansion', children: [cell(1, time, -2), cell(1, time, -1)],
      });
      expect(classifyBirds2aCell(cell(1, time), origin)?.kind).toBe('expansion');
      expect(classifyBirds2aCellSubdivision(cell(1, time), origin)?.kind).toBe('binomial');
    }
    expect(classifyBirds2aCellSubdivision(cell(2, 5), origin)?.kind).toBe('binomial');
    expect(classifyBirds2aCellSubdivision(cell(3, 0), origin)).toBeUndefined();
  });
});
