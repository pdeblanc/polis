import { describe, expect, it } from 'vitest';
import {
  constructBirdsFlowSupport,
  midpointOffsets,
  possibleQuarterFlowOffsets,
} from './birdsFlowSupport';

describe('Birds flow-support construction experiment', () => {
  it('uses distinct zero-diffusion mid-cell and cell-boundary kernels', () => {
    expect([...midpointOffsets(0, 0, 1)]).toEqual([0]);
    expect([...midpointOffsets(1, 0, 1)]).toEqual([0, 1]);
  });

  it('combines both halves and both subdivisions', () => {
    expect([...possibleQuarterFlowOffsets(1, 0)].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it.each([0, 0.01, 0.1, 1, 4, 16, 100])(
    'reaches a finite closed fixed point for diffusion rate %s',
    (diffusionRate) => {
      const support = constructBirdsFlowSupport(diffusionRate);
      const ordered = [...support.epochOffsets].sort((left, right) => left - right);

      expect(support.iterations).toBeLessThan(20);
      expect(ordered[0]).toBe(-ordered.at(-1)!);
      expect(ordered).toEqual(
        Array.from({ length: ordered.length }, (_, index) => ordered[0] + index),
      );
      for (const parentOffset of support.epochOffsets) {
        for (const quarterOffset of possibleQuarterFlowOffsets(
          parentOffset,
          diffusionRate,
        )) {
          for (const childShift of [-1, 0, 1]) {
            expect(support.epochOffsets.has(2 * quarterOffset + childShift)).toBe(true);
          }
        }
      }
    },
  );

});
