import { Birds } from '../models/birds/birds';
import { birdsScale } from '../models/birds/scales';
import { brownianIntervalTransitionProbability } from '../utils/math/brownian';
import { poissonTotalVariation } from './birdsPopulationMeasurements';

export interface BirdsFlowMarginalOptions {
  readonly destinationOffsets: readonly number[];
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly populationDensity: number;
  readonly sampleCount: number;
  readonly seedPrefix?: string;
  readonly sourceSpatialIndex: number;
  readonly sourceTimeIndex: number;
}

export interface BirdsFlowMarginalMeasurement {
  readonly brownianProbability: number;
  readonly cellWidth: number;
  readonly conservationFailures: number;
  readonly destinationOffset: number;
  readonly diffusionRate: number;
  readonly duration: number;
  readonly empiricalMean: number;
  readonly empiricalVariance: number;
  readonly epoch: number;
  readonly meanError: number;
  readonly meanOutflowPopulation: number;
  readonly meanSourcePopulation: number;
  readonly poissonMean: number;
  readonly poissonZeroProbability: number;
  readonly populationDensity: number;
  readonly samples: number;
  readonly totalVariationDistance: number;
  readonly varianceToMean: number;
  readonly zeroFrequency: number;
}

export function measureBirdsFlowMarginals(
  options: BirdsFlowMarginalOptions,
): readonly BirdsFlowMarginalMeasurement[] {
  validateOptions(options);
  const scale = birdsScale(options.epoch)!;
  const sourceMin = options.sourceSpatialIndex * scale.cellLength;
  const source = {
    min: sourceMin,
    max: sourceMin + scale.cellLength,
    time: options.sourceTimeIndex * scale.nextFlowDuration,
  };
  const counts = options.destinationOffsets.map(() => [] as number[]);
  let sourcePopulationTotal = 0;
  let outflowPopulationTotal = 0;
  let conservationFailures = 0;
  let duration: number | undefined;

  for (let sample = 0; sample < options.sampleCount; sample += 1) {
    const birds = new Birds(
      `${options.seedPrefix ?? 'Birds flow marginals'}:${options.epoch}:${sample}`,
      options.populationDensity,
      options.diffusionRate,
    );
    const populationResolution = birds.resolvePopulationResolution({
      targetCellWidth: scale.cellLength,
      targetTimeStep: scale.nextFlowDuration,
    });
    if (populationResolution === undefined) throw new Error('Population resolution unavailable');
    const sourcePopulation = birds.queryPopulationCell({ cell: source, resolution: populationResolution }).count;
    const flowResolution = birds.resolveIncidentFlowResolution({ cell: source, resolution: populationResolution });
    duration ??= flowResolution.duration;
    const outflows = birds.queryOutflows({ source, resolution: flowResolution });
    if (outflows.kind !== 'flows') throw new Error('Complete outflow query exceeded its size limit');
    const outflowPopulation = outflows.flows.reduce((total, flow) => total + flow.count, 0);
    sourcePopulationTotal += sourcePopulation;
    outflowPopulationTotal += outflowPopulation;
    if (outflowPopulation !== sourcePopulation) conservationFailures += 1;

    for (let index = 0; index < options.destinationOffsets.length; index += 1) {
      const destinationMin = sourceMin + options.destinationOffsets[index] * scale.cellLength;
      counts[index].push(
        birds.queryFlow({
          source,
          destination: {
            min: destinationMin,
            max: destinationMin + scale.cellLength,
            time: source.time + flowResolution.duration,
          },
          resolution: flowResolution,
        }).count,
      );
    }
  }

  if (duration === undefined) throw new Error('No flow samples were evaluated');
  return options.destinationOffsets.map((destinationOffset, index) => {
    const destinationMin = sourceMin + destinationOffset * scale.cellLength;
    const probability = brownianIntervalTransitionProbability(
      source,
      { min: destinationMin, max: destinationMin + scale.cellLength },
      duration,
      options.diffusionRate,
    );
    return summarizeFlowCounts({
      counts: counts[index],
      probability,
      destinationOffset,
      duration,
      cellWidth: scale.cellLength,
      options,
      sourcePopulationTotal,
      outflowPopulationTotal,
      conservationFailures,
    });
  });
}

function summarizeFlowCounts(input: {
  readonly cellWidth: number;
  readonly conservationFailures: number;
  readonly counts: readonly number[];
  readonly destinationOffset: number;
  readonly duration: number;
  readonly options: BirdsFlowMarginalOptions;
  readonly outflowPopulationTotal: number;
  readonly probability: number;
  readonly sourcePopulationTotal: number;
}): BirdsFlowMarginalMeasurement {
  const empiricalMean = input.counts.reduce((sum, count) => sum + count, 0) / input.counts.length;
  const empiricalVariance =
    input.counts.reduce((sum, count) => sum + (count - empiricalMean) ** 2, 0) /
    (input.counts.length - 1);
  const poissonMean = input.options.populationDensity * input.cellWidth * input.probability;
  return {
    epoch: input.options.epoch,
    samples: input.options.sampleCount,
    populationDensity: input.options.populationDensity,
    diffusionRate: input.options.diffusionRate,
    cellWidth: input.cellWidth,
    duration: input.duration,
    destinationOffset: input.destinationOffset,
    brownianProbability: input.probability,
    poissonMean,
    empiricalMean,
    meanError: empiricalMean - poissonMean,
    empiricalVariance,
    varianceToMean: empiricalMean === 0 ? Number.NaN : empiricalVariance / empiricalMean,
    zeroFrequency: input.counts.filter((count) => count === 0).length / input.counts.length,
    poissonZeroProbability: Math.exp(-poissonMean),
    totalVariationDistance: poissonTotalVariation(
      input.counts,
      poissonMean,
      Math.max(...input.counts),
    ),
    meanSourcePopulation: input.sourcePopulationTotal / input.options.sampleCount,
    meanOutflowPopulation: input.outflowPopulationTotal / input.options.sampleCount,
    conservationFailures: input.conservationFailures,
  };
}

function validateOptions(options: BirdsFlowMarginalOptions): void {
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 2) {
    throw new RangeError('Flow characterization requires at least two samples');
  }
  if (birdsScale(options.epoch) === undefined) throw new RangeError('Flow epoch is unavailable');
  if (!Number.isFinite(options.populationDensity) || options.populationDensity < 0) {
    throw new RangeError('Flow population density must be finite and nonnegative');
  }
  if (!Number.isFinite(options.diffusionRate) || options.diffusionRate < 0) {
    throw new RangeError('Flow diffusion rate must be finite and nonnegative');
  }
  if (
    !Number.isSafeInteger(options.sourceSpatialIndex) ||
    !Number.isSafeInteger(options.sourceTimeIndex) ||
    options.destinationOffsets.length === 0 ||
    options.destinationOffsets.some((offset) => !Number.isSafeInteger(offset))
  ) {
    throw new RangeError('Flow source and destination offsets must be safe integers');
  }
}
