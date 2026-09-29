import { expect, it } from 'vitest';
import { createBirds2aMotionSupport, possibleBirds2aFlowDestinations, possibleBirds2aFlowSources } from '../birds2a/motionSupport';
import { possibleCompositeFlowDestinations, possibleCompositeFlowSources } from './compositeMotionSupport';

it('single-width enumeration equals filtering the ordered all-width enumeration', () => {
  const origin = { min: 0, max: 1 };
  for (const diffusion of [0, 0.5, 4]) {
    const support = createBirds2aMotionSupport(diffusion);
    for (const width of [0.125, 1, 4]) for (const index of [-17, 0, 3, 2 ** 40]) {
      for (const slot of [-16, -3, 0, 1, 16]) for (const step of [0.25, 0.5, 1, 2]) {
        const cell = { min: index * width, max: (index + 1) * width, time: slot * width ** 2 / 4 };
        const duration = step * width ** 2;
        for (const forward of [false, true]) {
          const channel = forward ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources;
          const composite = forward ? possibleCompositeFlowDestinations : possibleCompositeFlowSources;
          const all = channel(cell, duration, origin, support);
          expect(composite(cell, duration, support)).toEqual(all);
          for (const oppositeWidth of [width / 2, width, width * 2, width * 4, 0, -1, NaN, Infinity]) {
            const expected = all.filter((other) => other.max - other.min === oppositeWidth);
            expect(channel(cell, duration, origin, support, oppositeWidth)).toEqual(expected);
            expect(composite(cell, duration, support, oppositeWidth)).toEqual(expected);
          }
        }
      }
    }
  }
});

it('keeps invalid geometry empty and guards numeric index overflow', () => {
  const support = createBirds2aMotionSupport(0.5), origin = { min: 0, max: 1 };
  for (const width of [undefined, 1]) {
    const invalid = { min: 0.1, max: 1.1, time: 0 };
    expect(possibleBirds2aFlowSources(invalid, 1, origin, support, width)).toEqual([]);
    expect(possibleCompositeFlowSources(invalid, 1, support, width)).toEqual([]);
    const extreme = { min: 2 ** 53 - 1, max: 2 ** 53, time: 0 };
    expect(() => possibleBirds2aFlowDestinations(extreme, 1, origin, support, width)).toThrow(/precision/);
    expect(() => possibleCompositeFlowDestinations(extreme, 1, support, width)).toThrow(/precision/);
  }
});
