import { describe, expect, it } from 'vitest';
import { Birds2aExpansion } from './expansion';
import { classifyBirds2aFlow, type Birds2aCell, type Birds2aFlow } from './classifiers';
import {
  birds2aMidpointCellProbabilities, createBirds2aMotionSupport, isPossibleBirds2aFlow,
  possibleBirds2aFlowDestinations, possibleBirds2aFlowSources, possibleBirds2aParentFlows,
} from './motionSupport';

const origin = { min: 0, max: 1 };
const cell = (index: number, width: number, time: number): Birds2aCell =>
  ({ min: index * width, max: (index + 1) * width, time });

describe('Birds 2a motion support', () => {
  for (const diffusion of [0, 0.125, 0.5, 2, 4]) {
    it(`contains expansion output at diffusion ${diffusion}`, () => {
      const support = createBirds2aMotionSupport(diffusion);
      for (const origin of [{ min: 0, max: 1 }, { min: -2, max: -1 }, { min: 2, max: 4 }, { min: -0.5, max: 0 }]) {
        const expansion = new Birds2aExpansion('support', 64, diffusion, origin);
        for (let epoch = 0; epoch <= 3; epoch++) for (const step of expansion.getEpoch(epoch).ordinaryFlows) {
          for (const batch of step.allocations) for (const entry of batch.destinations) {
            const a = { ...batch.fromCell, time: step.from.time }, b = { ...entry.cell, time: step.to.time };
            const flow = a.time < b.time ? { source: a, destination: b } : { source: b, destination: a };
            expect(isPossibleBirds2aFlow(flow, origin, support)).toBe(true);
          }
        }
      }
    });

    it(`is closed under temporal and spatial refinement at diffusion ${diffusion}`, () => {
      const support = createBirds2aMotionSupport(diffusion);
      expect(2 * support.quarterRadius + 1).toBeLessThanOrEqual(support.entryRadius + 1e-12);
      for (const [duration, radius] of [[1, support.entryRadius], [0.5, support.halfRadius]]) {
        for (let offset = -Math.floor(radius); offset <= radius; offset++) {
          const parent = { source: cell(-3, 1, 5), destination: cell(-3 + offset, 1, 5 + duration) };
          const table = birds2aMidpointCellProbabilities(parent, origin, support);
          expect(table.reduce((sum, entry) => sum + entry.probability, 0)).toBeCloseTo(1, 12);
          for (const { cell: midpoint } of table) {
            expect(isPossibleBirds2aFlow({ source: parent.source, destination: midpoint }, origin, support)).toBe(true);
            expect(isPossibleBirds2aFlow({ source: midpoint, destination: parent.destination }, origin, support)).toBe(true);
          }
        }
      }
      for (let offset = -Math.floor(support.quarterRadius); offset <= support.quarterRadius; offset++) {
        for (const sourceChild of [0, 1]) for (const destinationChild of [0, 1]) {
          const source = cell(-4 + sourceChild, 0.5, 5), destination = cell(-4 + 2 * offset + destinationChild, 0.5, 5.25);
          expect(isPossibleBirds2aFlow({ source, destination }, origin, support)).toBe(true);
          expect(isPossibleBirds2aFlow({ source, destination: cell(-2 + offset, 1, 5.25) }, origin, support)).toBe(true);
          expect(isPossibleBirds2aFlow({ source: cell(-2, 1, 5), destination }, origin, support)).toBe(true);
        }
      }
    });

    it(`covers unsampled expansion kernel extremes at diffusion ${diffusion}`, () => {
      const support = createBirds2aMotionSupport(diffusion);
      const { kernels } = new Birds2aExpansion('kernel-support', 0, diffusion);
      const extremes = (table: readonly { value: number }[]) => [table[0].value, table.at(-1)!.value];
      for (const { value: d } of kernels.extension) {
        const base = Math.floor(d / 3), phase = d - 3 * base;
        for (const u0 of extremes(kernels.firstBridge[phase])) {
          const u = base + u0, secondBase = Math.floor((d - u) / 2), secondPhase = d - u - 2 * secondBase;
          for (const v0 of extremes(kernels.secondBridge[secondPhase])) {
            const v = u + secondBase + v0;
            for (const parity of [0, 1]) {
              const coarse = (x: number) => Math.floor((parity + x) / 2);
              for (const [from, to] of [[0, u], [u, v], [v, d]]) {
                expect(Math.abs(coarse(to) - coarse(from))).toBeLessThanOrEqual(support.quarterRadius);
              }
              expect(Math.abs(coarse(d) - coarse(u))).toBeLessThanOrEqual(support.halfRadius);
            }
          }
        }
      }
    });
  }

  it('enumerates sources and destinations consistently at all three widths and both time signs', () => {
    const support = createBirds2aMotionSupport(0.5);
    for (const width of [0.125, 1, 8]) for (const sign of [-1, 1]) for (const ratio of [1, 0.5, 0.25]) {
      const duration = width ** 2 * ratio, source = cell(-3, width, sign * 5 * width ** 2);
      const destinations = possibleBirds2aFlowDestinations(source, duration, origin, support);
      expect(new Set(destinations.map((cell) => JSON.stringify(cell))).size).toBe(destinations.length);
      for (const destination of destinations) {
        expect(isPossibleBirds2aFlow({ source, destination }, origin, support)).toBe(true);
        expect(possibleBirds2aFlowSources(destination, duration, origin, support)).toContainEqual(source);
      }
      // Independent scan wider than every possible window, including negative parents.
      for (const dw of [width / 2, width, width * 2]) {
        for (let i = -4 * support.entryRadius; i <= 4 * support.entryRadius; i++) {
          const destination = cell(i, dw, source.time + duration);
          const expected = isPossibleBirds2aFlow({ source, destination }, origin, support);
          expect(destinations.some((c) => c.min === destination.min && c.max === destination.max)).toBe(expected);
        }
      }
    }
  });

  it('inverts every tested midpoint category into both parent searches', () => {
    for (const diffusion of [0, 0.5, 2]) {
      const support = createBirds2aMotionSupport(diffusion);
      for (const width of [0.25, 1, 4]) for (const sign of [-1, 1]) for (const ratio of [1, 0.5]) {
        const radius = Math.floor(ratio === 1 ? support.entryRadius : support.halfRadius);
        for (const offset of [-radius, -1, 0, 1, radius]) {
          const start = sign * 5 * width ** 2;
          const parent = { source: cell(-2, width, start), destination: cell(-2 + offset, width, start + ratio * width ** 2) };
          for (const { cell: midpoint } of birds2aMidpointCellProbabilities(parent, origin, support)) {
            const legs = [{ source: parent.source, destination: midpoint }, { source: midpoint, destination: parent.destination }];
            for (const leg of legs) {
              const parents = possibleBirds2aParentFlows(leg, origin, support);
              expect(parents).toContainEqual(parent);
              for (const candidate of parents) {
                expect(birds2aMidpointCellProbabilities(candidate, origin, support).some(({ cell }) => cell.min === midpoint.min)).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('does not search expansion parents or fabricate their joint midpoint probabilities', () => {
    const support = createBirds2aMotionSupport(0.5);
    const flow: Birds2aFlow = { source: cell(0, 2, 0), destination: cell(1, 2, 2) };
    expect(classifyBirds2aFlow(flow, origin)?.kind).toBe('expansion');
    expect(possibleBirds2aParentFlows(flow, origin, support)).toEqual([]);
    expect(() => birds2aMidpointCellProbabilities(flow, origin, support)).toThrow('expansion supplies both legs');
  });

  it('rejects invalid geometry and stops at numeric window limits', () => {
    const support = createBirds2aMotionSupport(0);
    for (const diffusion of [-1, Infinity, NaN]) expect(() => createBirds2aMotionSupport(diffusion)).toThrow(RangeError);
    expect(possibleBirds2aFlowDestinations(cell(0, 1, 0.1), 1, origin, support)).toEqual([]);
    expect(possibleBirds2aFlowSources(cell(0, 1, 0), -1, origin, support)).toEqual([]);
    expect(possibleBirds2aFlowDestinations(cell(0, 1, 0), 3, origin, support)).toEqual([]);
    expect(() => possibleBirds2aFlowDestinations(cell(Number.MAX_SAFE_INTEGER - 1, 1, 0), 1, origin, support)).toThrow(RangeError);
    expect(Object.isFrozen(support.midpointKernels[1].midCell)).toBe(true);
  });
});
