import { constructBirdsFlowSupport } from './birdsFlowSupport';

const diffusionRates = [0, 0.01, 0.1, 1, 4, 16, 100];

for (const diffusionRate of diffusionRates) {
  const support = constructBirdsFlowSupport(diffusionRate);
  const offsets = [...support.epochOffsets].sort((left, right) => left - right);

  console.log(
    JSON.stringify({
      diffusionRate,
      coarseOffsetCount: support.coarseOffsets.size,
      epochOffsetCount: support.epochOffsets.size,
      firstOffset: offsets[0],
      lastOffset: offsets.at(-1),
      iterations: support.iterations,
    }),
  );
}
