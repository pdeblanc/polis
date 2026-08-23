import { Birds } from '../models/birds/birds';
import { birdsScale } from '../models/birds/scales';

export interface BirdsPopulationPhaseOptions {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly populationDensity: number;
  readonly sampleCount: number;
  readonly seedPrefix?: string;
  readonly timeIndices: readonly number[];
}

export interface BirdsPopulationPhaseSummary {
  readonly aggregateMean: number;
  readonly aggregateMeanError: number;
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly maximumCellMean: number;
  readonly maximumCellMeanIndex: number;
  readonly meanPerCell: number;
  readonly minimumCellMean: number;
  readonly minimumCellMeanIndex: number;
  readonly noiseCorrectedRmsCellBias: number;
  readonly observedRmsCellMeanError: number;
  readonly referenceAggregateMean: number;
  readonly referenceMeanPerCell: number;
  readonly populationDensity: number;
  readonly samples: number;
  readonly spatialPhases: number;
  readonly timeIndex: number;
}

/** Samples a complete coarse-cell-width block using paired seeds for every phase. */
export function measureBirdsPopulationPhases(
  options: BirdsPopulationPhaseOptions,
): readonly BirdsPopulationPhaseSummary[] {
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 2) {
    throw new RangeError('Population phase characterization requires at least two samples');
  }
  if (
    options.timeIndices.length === 0 ||
    options.timeIndices.some((index) => !Number.isSafeInteger(index))
  ) {
    throw new RangeError('Population phase time indices must be nonempty safe integers');
  }
  const scale = birdsScale(options.epoch);
  if (scale === undefined) throw new RangeError('Population phase epoch is unavailable');
  const spatialPhases = 2 ** options.epoch;
  if (!Number.isSafeInteger(spatialPhases)) {
    throw new RangeError('Population phase block exceeds exact array indexing');
  }
  const sums = options.timeIndices.map(() => new Array<number>(spatialPhases).fill(0));
  const squaredSums = options.timeIndices.map(() => new Array<number>(spatialPhases).fill(0));

  for (let sample = 0; sample < options.sampleCount; sample += 1) {
    const birds = new Birds(
      `${options.seedPrefix ?? 'Birds population phases'}:${options.epoch}:${sample}`,
      options.populationDensity,
      options.diffusionRate,
    );
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: scale.cellLength,
      targetTimeStep: scale.nextFlowDuration,
    });
    if (resolution === undefined) throw new Error('Population resolution unexpectedly unavailable');

    for (let timePhase = 0; timePhase < options.timeIndices.length; timePhase += 1) {
      const result = birds.queryPopulation({
        min: 0,
        max: spatialPhases * scale.cellLength,
        time: options.timeIndices[timePhase] * scale.nextFlowDuration,
        resolution,
      });
      if (result.kind !== 'population-profile' || result.samples.length !== spatialPhases) {
        throw new Error('Population phase block query unexpectedly failed');
      }
      for (let spatialIndex = 0; spatialIndex < spatialPhases; spatialIndex += 1) {
        const count = result.samples[spatialIndex].count;
        sums[timePhase][spatialIndex] += count;
        squaredSums[timePhase][spatialIndex] += count ** 2;
      }
    }
  }

  const referenceMeanPerCell = options.populationDensity * scale.cellLength;
  const referenceAggregateMean = referenceMeanPerCell * spatialPhases;
  return options.timeIndices.map((timeIndex, timePhase) => {
    const cellMeans = sums[timePhase].map((sum) => sum / options.sampleCount);
    const minimumCellMean = Math.min(...cellMeans);
    const maximumCellMean = Math.max(...cellMeans);
    const aggregateMean = cellMeans.reduce((total, mean) => total + mean, 0);
    const meanSquaredCellMeanError =
      cellMeans.reduce(
        (total, mean) => total + (mean - referenceMeanPerCell) ** 2,
        0,
      ) / spatialPhases;
    const estimatedSamplingMeanSquaredError =
      sums[timePhase].reduce((total, sum, spatialIndex) => {
        const correctedSumOfSquares =
          squaredSums[timePhase][spatialIndex] - sum ** 2 / options.sampleCount;
        const sampleVariance = Math.max(0, correctedSumOfSquares / (options.sampleCount - 1));
        return total + sampleVariance / options.sampleCount;
      }, 0) / spatialPhases;
    return {
      epoch: options.epoch,
      populationDensity: options.populationDensity,
      diffusionRate: options.diffusionRate,
      samples: options.sampleCount,
      spatialPhases,
      timeIndex,
      referenceMeanPerCell,
      meanPerCell: aggregateMean / spatialPhases,
      observedRmsCellMeanError: Math.sqrt(meanSquaredCellMeanError),
      noiseCorrectedRmsCellBias: Math.sqrt(
        Math.max(0, meanSquaredCellMeanError - estimatedSamplingMeanSquaredError),
      ),
      minimumCellMean,
      minimumCellMeanIndex: cellMeans.indexOf(minimumCellMean),
      maximumCellMean,
      maximumCellMeanIndex: cellMeans.indexOf(maximumCellMean),
      referenceAggregateMean,
      aggregateMean,
      aggregateMeanError: aggregateMean - referenceAggregateMean,
    };
  });
}
