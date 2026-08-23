import { Birds } from '../models/birds/birds';
import { birdsScale } from '../models/birds/scales';

export interface BirdsFlowPhaseOptions {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly populationDensity: number;
  readonly sampleCount: number;
  readonly seedPrefix?: string;
  readonly timeIndices: readonly number[];
}

export interface BirdsFlowPhaseDetail {
  readonly driftInCellWidths: number;
  readonly meanPopulation: number;
  readonly spatialIndex: number;
  readonly timeIndex: number;
}

export interface BirdsFlowPhaseSummary {
  readonly aggregateDriftInCellWidths: number;
  readonly conservationFailures: number;
  readonly diffusionRate: number;
  readonly duration: number;
  readonly durationOverCellWidthSquared: number;
  readonly epoch: number;
  readonly maximumPhaseDrift: number;
  readonly maximumPhaseIndex: number;
  readonly meanAbsolutePhaseDrift: number;
  readonly meanPopulationPerCell: number;
  readonly minimumPhaseDrift: number;
  readonly minimumPhaseIndex: number;
  readonly reflectionPairRmsResidual: number;
  readonly rmsPhaseDrift: number;
  readonly samples: number;
  readonly spatialPhases: number;
  readonly timeIndex: number;
}

export interface BirdsFlowPhaseMeasurement {
  readonly details: readonly BirdsFlowPhaseDetail[];
  readonly summaries: readonly BirdsFlowPhaseSummary[];
}

/** Measures complete-outflow drift for every fine cell spanning one coarse-cell width. */
export function measureBirdsFlowPhases(
  options: BirdsFlowPhaseOptions,
): BirdsFlowPhaseMeasurement {
  validateOptions(options);
  const scale = birdsScale(options.epoch)!;
  const spatialPhases = 2 ** options.epoch;
  if (!Number.isSafeInteger(spatialPhases)) {
    throw new RangeError('Flow phase block exceeds exact array indexing');
  }
  const populationTotals = options.timeIndices.map(() =>
    new Array<number>(spatialPhases).fill(0),
  );
  const displacementTotals = options.timeIndices.map(() =>
    new Array<number>(spatialPhases).fill(0),
  );
  const durations = new Array<number | undefined>(options.timeIndices.length);
  const conservationFailures = new Array<number>(options.timeIndices.length).fill(0);

  for (let sample = 0; sample < options.sampleCount; sample += 1) {
    const birds = new Birds(
      `${options.seedPrefix ?? 'Birds flow phases'}:${options.epoch}:${sample}`,
      options.populationDensity,
      options.diffusionRate,
    );
    const populationResolution = birds.resolvePopulationResolution({
      targetCellWidth: scale.cellLength,
      targetTimeStep: scale.nextFlowDuration,
    });
    if (populationResolution === undefined) throw new Error('Population resolution unavailable');

    for (let timePhase = 0; timePhase < options.timeIndices.length; timePhase += 1) {
      const time = options.timeIndices[timePhase] * scale.nextFlowDuration;
      for (let spatialIndex = 0; spatialIndex < spatialPhases; spatialIndex += 1) {
        const min = spatialIndex * scale.cellLength;
        const source = { min, max: min + scale.cellLength, time };
        const population = birds.queryPopulationCell({
          cell: source,
          resolution: populationResolution,
        }).count;
        const flowResolution = birds.resolveIncidentFlowResolution({
          cell: source,
          resolution: populationResolution,
        });
        durations[timePhase] ??= flowResolution.duration;
        if (durations[timePhase] !== flowResolution.duration) {
          throw new Error('Flow phase row has inconsistent durations');
        }
        const outflows = birds.queryOutflows({ source, resolution: flowResolution });
        if (outflows.kind !== 'flows') throw new Error('Complete outflow query exceeded its size limit');
        const outflowPopulation = outflows.flows.reduce((total, flow) => total + flow.count, 0);
        if (outflowPopulation !== population) conservationFailures[timePhase] += 1;
        const sourceCenter = (source.min + source.max) / 2;
        const displacement = outflows.flows.reduce((total, flow) => {
          const destinationCenter = (flow.destination.min + flow.destination.max) / 2;
          return total + flow.count * (destinationCenter - sourceCenter);
        }, 0);
        populationTotals[timePhase][spatialIndex] += population;
        displacementTotals[timePhase][spatialIndex] += displacement;
      }
    }
  }

  const details: BirdsFlowPhaseDetail[] = [];
  const summaries = options.timeIndices.map((timeIndex, timePhase) => {
    const phaseDrifts = displacementTotals[timePhase].map((displacement, spatialIndex) => {
      const population = populationTotals[timePhase][spatialIndex];
      const drift = population === 0 ? 0 : displacement / population / scale.cellLength;
      details.push({
        timeIndex,
        spatialIndex,
        meanPopulation: population / options.sampleCount,
        driftInCellWidths: drift,
      });
      return drift;
    });
    const aggregatePopulation = populationTotals[timePhase].reduce((sum, value) => sum + value, 0);
    const aggregateDisplacement = displacementTotals[timePhase].reduce(
      (sum, value) => sum + value,
      0,
    );
    const minimumPhaseDrift = Math.min(...phaseDrifts);
    const maximumPhaseDrift = Math.max(...phaseDrifts);
    let reflectionResidualSquares = 0;
    for (let index = 0; index < spatialPhases / 2; index += 1) {
      reflectionResidualSquares += (phaseDrifts[index] + phaseDrifts[spatialPhases - 1 - index]) ** 2;
    }
    const duration = durations[timePhase];
    if (duration === undefined) throw new Error('No flow phase duration was evaluated');
    return {
      epoch: options.epoch,
      samples: options.sampleCount,
      diffusionRate: options.diffusionRate,
      spatialPhases,
      timeIndex,
      duration,
      durationOverCellWidthSquared: duration / scale.cellLength ** 2,
      meanPopulationPerCell: aggregatePopulation / options.sampleCount / spatialPhases,
      aggregateDriftInCellWidths:
        aggregatePopulation === 0
          ? 0
          : aggregateDisplacement / aggregatePopulation / scale.cellLength,
      meanAbsolutePhaseDrift:
        phaseDrifts.reduce((sum, drift) => sum + Math.abs(drift), 0) / spatialPhases,
      rmsPhaseDrift: Math.sqrt(
        phaseDrifts.reduce((sum, drift) => sum + drift ** 2, 0) / spatialPhases,
      ),
      reflectionPairRmsResidual: Math.sqrt(reflectionResidualSquares / (spatialPhases / 2)),
      minimumPhaseDrift,
      minimumPhaseIndex: phaseDrifts.indexOf(minimumPhaseDrift),
      maximumPhaseDrift,
      maximumPhaseIndex: phaseDrifts.indexOf(maximumPhaseDrift),
      conservationFailures: conservationFailures[timePhase],
    };
  });

  return { details, summaries };
}

function validateOptions(options: BirdsFlowPhaseOptions): void {
  if (!Number.isSafeInteger(options.sampleCount) || options.sampleCount < 2) {
    throw new RangeError('Flow phase characterization requires at least two samples');
  }
  if (birdsScale(options.epoch) === undefined) throw new RangeError('Flow phase epoch is unavailable');
  if (!Number.isFinite(options.populationDensity) || options.populationDensity < 0) {
    throw new RangeError('Flow phase population density must be finite and nonnegative');
  }
  if (!Number.isFinite(options.diffusionRate) || options.diffusionRate < 0) {
    throw new RangeError('Flow phase diffusion rate must be finite and nonnegative');
  }
  if (
    options.timeIndices.length === 0 ||
    options.timeIndices.some((index) => !Number.isSafeInteger(index))
  ) {
    throw new RangeError('Flow phase time indices must be nonempty safe integers');
  }
}
