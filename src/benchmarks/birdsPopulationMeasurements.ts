import { Birds } from '../models/birds/birds';
import { birdsScale } from '../models/birds/scales';

export interface BirdsPopulationCase {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly name: string;
  readonly populationDensity: number;
  readonly spatialIndex: number;
  readonly timeIndex: number;
}

export interface BirdsPopulationMeasurement {
  readonly cellWidth: number;
  readonly diffusionRate: number;
  readonly empiricalMean: number;
  readonly empiricalVariance: number;
  readonly epoch: number;
  readonly maximum: number;
  readonly meanError: number;
  readonly minimum: number;
  readonly name: string;
  readonly poissonMean: number;
  readonly poissonZeroProbability: number;
  readonly populationDensity: number;
  readonly samples: number;
  readonly totalVariationDistance: number;
  readonly varianceToMean: number;
  readonly zeroFrequency: number;
}

export const BIRDS_POPULATION_CASES: readonly BirdsPopulationCase[] = [
  {
    name: 'coarse-initial',
    epoch: 0,
    populationDensity: 0.5,
    diffusionRate: 0.5,
    spatialIndex: 0,
    timeIndex: 0,
  },
  {
    name: 'coarse-moved',
    epoch: 0,
    populationDensity: 0.5,
    diffusionRate: 0.5,
    spatialIndex: 0,
    timeIndex: 1,
  },
  {
    name: 'epoch-1',
    epoch: 1,
    populationDensity: 0.5,
    diffusionRate: 0.5,
    spatialIndex: 0,
    timeIndex: 1,
  },
  {
    name: 'epoch-2',
    epoch: 2,
    populationDensity: 0.5,
    diffusionRate: 0.5,
    spatialIndex: 1,
    timeIndex: 1,
  },
  ...[4, 6, 8].map((epoch): BirdsPopulationCase => {
    const scale = birdsScale(epoch)!;
    return {
      name: `epoch-${epoch}-density-compensated`,
      epoch,
      // Hold the reference marginal at four birds as the cell width shrinks.
      populationDensity: 4 / scale.cellLength,
      diffusionRate: 0.5,
      spatialIndex: 1,
      timeIndex: 1,
    };
  }),
];

export function measureBirdsPopulationMarginal(
  testCase: BirdsPopulationCase,
  sampleCount: number,
  seedPrefix = 'Birds population characterization',
): BirdsPopulationMeasurement {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) {
    throw new RangeError('Population characterization requires at least two samples');
  }
  const scale = birdsScale(testCase.epoch);
  if (scale === undefined) throw new RangeError('Population characterization epoch is unavailable');
  const min = testCase.spatialIndex * scale.cellLength;
  const time = testCase.timeIndex * scale.nextFlowDuration;
  const counts: number[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const birds = new Birds(
      `${seedPrefix}:${testCase.name}:${index}`,
      testCase.populationDensity,
      testCase.diffusionRate,
    );
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: scale.cellLength,
      targetTimeStep: scale.nextFlowDuration,
    });
    if (resolution === undefined) throw new Error('Population resolution unexpectedly unavailable');
    counts.push(
      birds.queryPopulationCell({
        cell: { min, max: min + scale.cellLength, time },
        resolution,
      }).count,
    );
  }

  return summarizePopulationCounts(testCase, scale.cellLength, counts);
}

export function summarizePopulationCounts(
  testCase: BirdsPopulationCase,
  cellWidth: number,
  counts: readonly number[],
): BirdsPopulationMeasurement {
  if (counts.length < 2 || counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new RangeError('Population samples must contain at least two nonnegative safe integers');
  }
  const sum = counts.reduce((total, count) => total + count, 0);
  const empiricalMean = sum / counts.length;
  const squaredError = counts.reduce(
    (total, count) => total + (count - empiricalMean) ** 2,
    0,
  );
  const empiricalVariance = squaredError / (counts.length - 1);
  const poissonMean = testCase.populationDensity * cellWidth;
  const minimum = Math.min(...counts);
  const maximum = Math.max(...counts);

  return {
    name: testCase.name,
    epoch: testCase.epoch,
    samples: counts.length,
    populationDensity: testCase.populationDensity,
    diffusionRate: testCase.diffusionRate,
    cellWidth,
    poissonMean,
    empiricalMean,
    meanError: empiricalMean - poissonMean,
    empiricalVariance,
    varianceToMean: empiricalMean === 0 ? Number.NaN : empiricalVariance / empiricalMean,
    minimum,
    maximum,
    zeroFrequency: counts.filter((count) => count === 0).length / counts.length,
    poissonZeroProbability: Math.exp(-poissonMean),
    totalVariationDistance: poissonTotalVariation(counts, poissonMean, maximum),
  };
}

function poissonTotalVariation(
  counts: readonly number[],
  mean: number,
  maximumObserved: number,
): number {
  const frequencies = new Array<number>(maximumObserved + 1).fill(0);
  for (const count of counts) frequencies[count] += 1;

  let probability = Math.exp(-mean);
  let coveredProbability = 0;
  let absoluteDifference = 0;
  for (let count = 0; count <= maximumObserved; count += 1) {
    if (count > 0) probability *= mean / count;
    coveredProbability += probability;
    absoluteDifference += Math.abs(frequencies[count] / counts.length - probability);
  }
  // All unobserved values above the sample maximum form one exact tail bin.
  absoluteDifference += Math.max(0, 1 - coveredProbability);
  return absoluteDifference / 2;
}
