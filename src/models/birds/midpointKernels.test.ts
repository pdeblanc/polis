import { describe, expect, it } from 'vitest';
import { roundedNormal } from '../../utils/distributions/roundedNormal';
import {
  createMidpointKernels,
  getMidpointKernel,
  midpointKernelForFlow,
  type MidpointAlignment,
  type NormalizedDuration,
} from './midpointKernels';

describe('Birds midpoint kernels', () => {
  it('constructs the two zero-diffusion limits at both durations', () => {
    const kernels = createMidpointKernels(0);

    for (const duration of [1, 0.5] as const) {
      expect(kernels[duration].midCell).toEqual([{ value: 0, probability: 1 }]);
      expect(kernels[duration].cellBoundary).toEqual([
        { value: 0, probability: 0.5 },
        { value: 1, probability: 0.5 },
      ]);
    }
  });

  it.each([
    [1, 'mid-cell', 0] as const,
    [1, 'cell-boundary', 0.5] as const,
    [0.5, 'mid-cell', 0] as const,
    [0.5, 'cell-boundary', 0.5] as const,
  ])(
    'constructs the duration %s %s kernel from its Brownian midpoint variance',
    (duration: NormalizedDuration, alignment: MidpointAlignment, mean: number) => {
      const diffusionRate = 2;
      const kernels = createMidpointKernels(diffusionRate);
      const expected = roundedNormal(
        mean,
        Math.sqrt((diffusionRate * duration) / 4),
      );

      expect(getMidpointKernel(kernels, duration, alignment)).toEqual(expected);
    },
  );

  it('normalizes all four kernels', () => {
    const kernels = createMidpointKernels(3);

    for (const duration of [1, 0.5] as const) {
      for (const table of [kernels[duration].midCell, kernels[duration].cellBoundary]) {
        expect(table.reduce((sum, mass) => sum + mass.probability, 0)).toBeCloseTo(1, 15);
      }
    }
  });

  it('selects alignment by parity and translates without changing probabilities', () => {
    const kernels = createMidpointKernels(1);
    const even = midpointKernelForFlow(kernels, 6, 1);
    const positiveOdd = midpointKernelForFlow(kernels, 7, 1);
    const negativeOdd = midpointKernelForFlow(kernels, -7, 1);

    expect(even).toEqual(
      kernels[1].midCell.map(({ value, probability }) => ({ value: value + 3, probability })),
    );
    expect(positiveOdd).toEqual(
      kernels[1].cellBoundary.map(({ value, probability }) => ({
        value: value + 3,
        probability,
      })),
    );
    expect(negativeOdd).toEqual(
      kernels[1].cellBoundary.map(({ value, probability }) => ({
        value: value - 4,
        probability,
      })),
    );
  });

  it('rejects invalid diffusion rates and flow offsets', () => {
    expect(() => createMidpointKernels(-1)).toThrow(RangeError);
    expect(() => createMidpointKernels(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => midpointKernelForFlow(createMidpointKernels(1), 0.5, 1)).toThrow(RangeError);
  });
});
