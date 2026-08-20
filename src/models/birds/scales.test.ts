import { describe, expect, it } from 'vitest';
import {
  BIRDS_COARSE_CELL_LENGTH,
  BIRDS_COARSE_FLOW_DURATION,
  birdsScale,
  epochForCellLength,
  euclideanModulo,
  isAligned,
} from './scales';

describe('Birds scales', () => {
  it('derives the canonical dyadic dimensions', () => {
    expect(birdsScale(0)).toEqual({
      epoch: 0,
      cellLength: BIRDS_COARSE_CELL_LENGTH,
      childCellLength: BIRDS_COARSE_CELL_LENGTH / 2,
      flowDuration: BIRDS_COARSE_FLOW_DURATION,
      halfFlowDuration: BIRDS_COARSE_FLOW_DURATION / 2,
      nextFlowDuration: BIRDS_COARSE_FLOW_DURATION / 4,
    });
    expect(birdsScale(2)?.cellLength).toBe(BIRDS_COARSE_CELL_LENGTH / 4);
    expect(birdsScale(2)?.flowDuration).toBe(BIRDS_COARSE_FLOW_DURATION / 16);
  });

  it('inverts only exact hierarchy cell lengths', () => {
    for (let epoch = 0; epoch <= 20; epoch += 1) {
      const scale = birdsScale(epoch)!;
      expect(epochForCellLength(scale.cellLength)).toBe(epoch);
    }
    expect(epochForCellLength(BIRDS_COARSE_CELL_LENGTH * 2)).toBeUndefined();
    expect(epochForCellLength(3)).toBeUndefined();
  });

  it('handles negative alignment and Euclidean residues', () => {
    expect(isAligned(-192, 64)).toBe(true);
    expect(isAligned(-191, 64)).toBe(false);
    expect(euclideanModulo(-3, 2)).toBe(1);
    expect(euclideanModulo(-4, 2)).toBe(0);
  });
});
