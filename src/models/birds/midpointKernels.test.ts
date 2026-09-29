import { describe, expect, it } from 'vitest';
import { roundedNormal } from '../../utils/distributions/roundedNormal';
import {
  createMidpointKernels,
  getMidpointKernel,
  midpointKernelForFlow,
  midpointKernelContainsCell,
  type MidpointAlignment,
  type NormalizedDuration,
} from './midpointKernels';

describe('Birds midpoint kernels', () => {
  it('direct membership matches translated tables, including floating-point limits', () => {
    for (const diffusion of [0, 0.5, 4]) {
      const kernels = createMidpointKernels(diffusion);
      for (const duration of [1, 0.5] as const) for (const offset of [-9, -2, 0, 3, 8]) {
        const table = midpointKernelForFlow(kernels, offset, duration);
        for (const source of [-(2 ** 40), -3, 0, 2 ** 52]) for (const width of [0.125, 1, 8]) {
          for (let i = -20; i <= 20; i++) {
            const min = (source + i) * width;
            const expected = table.some(({ value, probability }) =>
              probability > 0 && (source + value) * width === min);
            expect(midpointKernelContainsCell(kernels, offset, duration, source, width, min)).toBe(expected);
          }
        }
      }
    }
  });

  it('does not treat zero-probability entries as support', () => {
    const pair = { midCell: [{ value: 0, probability: 0 }, { value: 1, probability: 1 }],
      cellBoundary: [{ value: 0, probability: 1 }] };
    const kernels = { 1: pair, 0.5: pair };
    expect(midpointKernelContainsCell(kernels, 0, 1, 0, 1, 0)).toBe(false);
    expect(midpointKernelContainsCell(kernels, 0, 1, 0, 1, 1)).toBe(true);
    expect(() => midpointKernelContainsCell(kernels, Infinity, 1, 0, 1, 0)).toThrow(RangeError);
  });

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
