import { expect, it } from 'vitest';
import { classifyBirds2aFlow, type Birds2aFlow } from '../birds2a/classifiers';
import { classifyCompositeFlow } from './compositeClassifiers';
import { createBirds2aMotionSupport, isWithinBirds2MotionSupport,
  birds2aMidpointCellProbabilities, possibleBirds2aParentFlows,
  possibleBirds2aFlowDestinations, possibleBirds2aFlowSources } from '../birds2a/motionSupport';
import { compositeMidpointCellProbabilities, possibleCompositeParentFlows,
  possibleCompositeFlowDestinations, possibleCompositeFlowSources } from './compositeMotionSupport';

it('parent searches preserve the full-table reference results and ordering', () => {
  for (const diffusion of [0, 0.5, 4]) {
    const support = createBirds2aMotionSupport(diffusion);
    for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }]) {
      for (const width of [0.25, 1, 2]) for (const slot of [-17, -4, -1, 0, 1, 4, 17]) {
        for (const fraction of [0.25, 0.5]) for (const offset of [-3, 0, 3]) {
          const time = slot * width ** 2 * fraction;
          const flow: Birds2aFlow = { source: { min: -width, max: 0, time },
            destination: { min: offset * width, max: (offset + 1) * width, time: time + width ** 2 * fraction } };
          for (const composite of [false, true]) {
            const construction = composite ? classifyCompositeFlow(flow) : classifyBirds2aFlow(flow, origin);
            let expected: readonly Birds2aFlow[] = [];
            if (construction?.kind === 'temporal-aggregation' && isWithinBirds2MotionSupport(flow, support)) {
              const first = construction.leg === 'first', midpoint = first ? flow.destination : flow.source;
              const endpoints = composite
                ? (first ? possibleCompositeFlowDestinations : possibleCompositeFlowSources)(
                  first ? flow.source : flow.destination, construction.parentDuration, support)
                : (first ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources)(
                  first ? flow.source : flow.destination, construction.parentDuration, origin, support);
              expected = endpoints.filter((cell) => cell.max - cell.min === width)
                .map((cell) => first ? { source: flow.source, destination: cell } : { source: cell, destination: flow.destination })
                .filter((parent) => (composite ? compositeMidpointCellProbabilities(parent, support)
                  : birds2aMidpointCellProbabilities(parent, origin, support))
                  .some(({ cell }) => cell.min === midpoint.min));
            }
            expect(composite ? possibleCompositeParentFlows(flow, support)
              : possibleBirds2aParentFlows(flow, origin, support)).toEqual(expected);
          }
        }
      }
    }
  }
});
