import { expect, it } from 'vitest';
import { classifyBirds2aFlow, classifyBirds2FlowGeometry, isBirds2aExpansionFlow } from '../birds2a/classifiers';
import { classifyCompositeFlow, isCompositeMergeFlow } from './compositeClassifiers';
import { createBirds2aMotionSupport, isPossibleBirds2aFlow, isWithinBirds2MotionSupport } from '../birds2a/motionSupport';
import { isPossibleCompositeFlow } from './compositeMotionSupport';

it('direct ownership predicates agree with full classification on both time branches', () => {
  for (const origin of [{ min: 0, max: 1 }, { min: -8, max: -4 }, { min: 16, max: 32 }]) {
    for (const width of [0.125, 0.5, 1, 2, 4, 16]) {
      for (let slot = -17; slot <= 17; slot++) {
        for (const ratio of [0.5, 1, 2]) for (const step of [0.25, 0.5, 1, 2]) {
          const source = { min: -width, max: 0, time: slot * width ** 2 / 4 };
          const flow = { source, destination: { min: 0, max: width * ratio, time: source.time + step * width ** 2 } };
          expect(isBirds2aExpansionFlow(flow, origin)).toBe(classifyBirds2aFlow(flow, origin)?.kind === 'expansion');
          expect(isCompositeMergeFlow(flow)).toBe(classifyCompositeFlow(flow)?.kind === 'channel-merge');
        }
      }
    }
  }
});

it('checked support predicates reject illegal geometry and match radius-only checks for legal flows', () => {
  const origin = { min: 0, max: 1 };
  for (const diffusion of [0, 0.5, 4]) {
    const support = createBirds2aMotionSupport(diffusion);
    for (const time of [-4, -1, 0, 1, 4, NaN, Infinity, 0.1]) {
      for (const width of [0.5, 1, 2, 3, Infinity]) {
        for (const offset of [-128, -1, 0, 1, 128]) {
          const flow = { source: { min: 0, max: 1, time },
            destination: { min: offset * width, max: (offset + 1) * width, time: time + 1 } };
          const expected = !!classifyBirds2FlowGeometry(flow) && isWithinBirds2MotionSupport(flow, support);
          expect(isPossibleBirds2aFlow(flow, origin, support)).toBe(expected);
          expect(isPossibleCompositeFlow(flow, support)).toBe(expected);
          if (!classifyBirds2FlowGeometry(flow)) {
            expect(isCompositeMergeFlow(flow)).toBe(false);
            expect(isBirds2aExpansionFlow(flow, origin)).toBe(false);
          }
        }
      }
    }
  }
});
