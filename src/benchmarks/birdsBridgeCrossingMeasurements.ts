import normalCdf from '@stdlib/stats-base-dists-normal-cdf';
import { BirdsEngine } from '../models/birds/birdsEngine';
import type { BirdCell, BirdFlow } from '../models/birds/entities';
import { midpointCellProbabilities } from '../models/birds/motionSupport';
import { birdsScale } from '../models/birds/scales';
import { brownianIntervalTransitionProbability } from '../utils/math/brownian';

export interface BirdsBridgeCrossingOptions {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly populationDensity: number;
  readonly seedPrefix?: string;
  readonly trials: number;
}

export interface BirdsBridgeMeasurement {
  readonly birdsMidpointMean: number;
  readonly birdsMidpointVariance: number;
  readonly configuredBrownianTotalVariation: number;
  readonly durationRatio: number;
  readonly empiricalBrownianTotalVariation: number;
  readonly empiricalConfiguredTotalVariation: number;
  readonly flowOffset: number;
  readonly parentBirds: number;
  readonly referenceTailOutsideConfiguredSupport: number;
}

export interface BirdsChildCrossingMeasurement {
  readonly birdsCrossingProbability: number;
  readonly birdsDirectionImbalance: number;
  readonly birdsRetentionProbability: number;
  readonly brownianCrossingProbability: number;
  readonly brownianRetentionProbability: number;
  readonly durationRatio: number;
  readonly parentBirds: number;
}

export interface BirdsBridgeCrossingMeasurement {
  readonly bridges: readonly BirdsBridgeMeasurement[];
  readonly crossings: readonly BirdsChildCrossingMeasurement[];
}

interface BridgeAccumulator {
  readonly flow: BirdFlow;
  readonly midpointCounts: Map<number, number>;
  parentBirds: number;
}

export function measureBirdsBridgeAndCrossing(
  options: BirdsBridgeCrossingOptions,
): BirdsBridgeCrossingMeasurement {
  validateOptions(options);
  const scale = birdsScale(options.epoch)!;
  const source = indexedCell(0, scale.cellLength, 0);
  const bridgeCases = [
    ...[scale.flowDuration, scale.halfFlowDuration].flatMap((duration) =>
      (options.diffusionRate === 0 ? [0] : [0, 1]).map((offset) => ({ duration, offset })),
    ),
  ];
  const bridgeAccumulators: BridgeAccumulator[] = bridgeCases.map(({ duration, offset }) => ({
    flow: {
      source,
      destination: indexedCell(offset, scale.cellLength, duration),
    },
    midpointCounts: new Map(),
    parentBirds: 0,
  }));
  const crossingFlow: BirdFlow = {
    source,
    destination: indexedCell(0, scale.cellLength, scale.nextFlowDuration),
  };
  const crossingCounts = [0, 0, 0, 0];
  let crossingParentBirds = 0;

  for (let trial = 0; trial < options.trials; trial += 1) {
    const engine = new BirdsEngine(
      `${options.seedPrefix ?? 'Birds bridge crossing'}:${trial}`,
      options.populationDensity,
      options.diffusionRate,
    );
    for (const accumulator of bridgeAccumulators) {
      const subdivision = engine.queryFlowTimeSubdivision(accumulator.flow);
      accumulator.parentBirds += subdivision.parentCount;
      for (const entry of subdivision.entries) {
        const index = entry.midpointCell.min / scale.cellLength;
        accumulator.midpointCounts.set(
          index,
          (accumulator.midpointCounts.get(index) ?? 0) + entry.count,
        );
      }
    }
    const subdivision = engine.queryFlowSpaceSubdivision(crossingFlow);
    crossingParentBirds += subdivision.parentCount;
    for (const entry of subdivision.entries) {
      const sourceChild = (entry.flow.source.min - source.min) / scale.childCellLength;
      const destinationChild =
        (entry.flow.destination.min - crossingFlow.destination.min) / scale.childCellLength;
      crossingCounts[sourceChild * 2 + destinationChild] += entry.count;
    }
  }

  return {
    bridges: bridgeAccumulators.map((accumulator) =>
      summarizeBridge(accumulator, options.diffusionRate),
    ),
    crossings: [
      summarizeCrossing(
        crossingCounts,
        crossingParentBirds,
        crossingFlow,
        options.diffusionRate,
      ),
    ],
  };
}

function summarizeBridge(
  accumulator: BridgeAccumulator,
  diffusionRate: number,
): BirdsBridgeMeasurement {
  const width = accumulator.flow.source.max - accumulator.flow.source.min;
  const duration = accumulator.flow.destination.time - accumulator.flow.source.time;
  const durationRatio = duration / width ** 2;
  const configured = midpointCellProbabilities(accumulator.flow, diffusionRate).map(
    ({ cell, probability }) => ({ index: cell.min / width, probability }),
  );
  const empirical = configured.map(({ index }) => ({
    index,
    probability: (accumulator.midpointCounts.get(index) ?? 0) / accumulator.parentBirds,
  }));
  const brownian = configured.map(({ index }) => ({
    index,
    probability: brownianBridgeMidpointProbability(
      accumulator.flow,
      indexedCell(index, width, accumulator.flow.source.time + duration / 2),
      diffusionRate,
    ),
  }));
  const referenceMass = brownian.reduce((sum, entry) => sum + entry.probability, 0);
  const referenceTailOutsideConfiguredSupport = Math.max(0, 1 - referenceMass);
  const configuredBrownianTotalVariation =
    0.5 *
    (sumAbsoluteDifferences(configured, brownian) + referenceTailOutsideConfiguredSupport);
  const empiricalBrownianTotalVariation =
    0.5 * (sumAbsoluteDifferences(empirical, brownian) + referenceTailOutsideConfiguredSupport);
  const birdsMidpointMean = empirical.reduce(
    (sum, { index, probability }) => sum + index * probability,
    0,
  );
  const birdsMidpointVariance = empirical.reduce(
    (sum, { index, probability }) => sum + (index - birdsMidpointMean) ** 2 * probability,
    0,
  );
  return {
    durationRatio,
    flowOffset:
      accumulator.flow.destination.min / width - accumulator.flow.source.min / width,
    parentBirds: accumulator.parentBirds,
    birdsMidpointMean,
    birdsMidpointVariance,
    empiricalConfiguredTotalVariation: 0.5 * sumAbsoluteDifferences(empirical, configured),
    configuredBrownianTotalVariation,
    empiricalBrownianTotalVariation,
    referenceTailOutsideConfiguredSupport,
  };
}

function summarizeCrossing(
  counts: readonly number[],
  parentBirds: number,
  flow: BirdFlow,
  diffusionRate: number,
): BirdsChildCrossingMeasurement {
  const width = flow.source.max - flow.source.min;
  const duration = flow.destination.time - flow.source.time;
  const durationRatio = duration / width ** 2;
  const birdsRetentionProbability = (counts[0] + counts[3]) / parentBirds;
  const birdsCrossingProbability = (counts[1] + counts[2]) / parentBirds;
  const birdsDirectionImbalance = (counts[1] - counts[2]) / parentBirds;
  const brownianTable = brownianChildTransitionTable(flow, diffusionRate);
  const brownianRetentionProbability = brownianTable[0] + brownianTable[3];
  return {
    durationRatio,
    parentBirds,
    birdsRetentionProbability,
    birdsCrossingProbability,
    birdsDirectionImbalance,
    brownianRetentionProbability,
    brownianCrossingProbability: 1 - brownianRetentionProbability,
  };
}

/** Conditional midpoint-cell probability for uniform starts and cell-valued endpoints. */
export function brownianBridgeMidpointProbability(
  flow: BirdFlow,
  midpoint: BirdCell,
  diffusionRate: number,
): number {
  const duration = flow.destination.time - flow.source.time;
  if (diffusionRate === 0) {
    const sameEndpoint =
      flow.source.min === flow.destination.min && flow.source.max === flow.destination.max;
    return sameEndpoint && midpoint.min === flow.source.min && midpoint.max === flow.source.max
      ? 1
      : 0;
  }
  const denominator = brownianIntervalTransitionProbability(
    flow.source,
    flow.destination,
    duration,
    diffusionRate,
  );
  if (denominator === 0) return 0;
  const halfStandardDeviation = Math.sqrt(diffusionRate * duration / 2);
  const integrand = (position: number): number => {
    const midpointDensity =
      (normalCdf((position - flow.source.min) / halfStandardDeviation, 0, 1) -
        normalCdf((position - flow.source.max) / halfStandardDeviation, 0, 1)) /
      (flow.source.max - flow.source.min);
    const endpointProbability =
      normalCdf((flow.destination.max - position) / halfStandardDeviation, 0, 1) -
      normalCdf((flow.destination.min - position) / halfStandardDeviation, 0, 1);
    return midpointDensity * endpointProbability;
  };
  return simpsonIntegral(integrand, midpoint.min, midpoint.max, 512) / denominator;
}

function brownianChildTransitionTable(flow: BirdFlow, diffusionRate: number): readonly number[] {
  const width = flow.source.max - flow.source.min;
  const childWidth = width / 2;
  const duration = flow.destination.time - flow.source.time;
  const denominator = brownianIntervalTransitionProbability(
    flow.source,
    flow.destination,
    duration,
    diffusionRate,
  );
  const weights: number[] = [];
  for (let sourceChild = 0; sourceChild < 2; sourceChild += 1) {
    for (let destinationChild = 0; destinationChild < 2; destinationChild += 1) {
      const childSource = indexedCell(
        2 * (flow.source.min / width) + sourceChild,
        childWidth,
        flow.source.time,
      );
      const childDestination = indexedCell(
        2 * (flow.destination.min / width) + destinationChild,
        childWidth,
        flow.destination.time,
      );
      weights.push(
        0.5 *
          brownianIntervalTransitionProbability(
            childSource,
            childDestination,
            duration,
            diffusionRate,
          ) /
          denominator,
      );
    }
  }
  return weights;
}

function sumAbsoluteDifferences(
  left: readonly { readonly probability: number }[],
  right: readonly { readonly probability: number }[],
): number {
  return left.reduce(
    (sum, entry, index) => sum + Math.abs(entry.probability - right[index].probability),
    0,
  );
}

function simpsonIntegral(
  fn: (value: number) => number,
  min: number,
  max: number,
  intervals: number,
): number {
  const step = (max - min) / intervals;
  let sum = fn(min) + fn(max);
  for (let index = 1; index < intervals; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4) * fn(min + index * step);
  }
  return (sum * step) / 3;
}

function indexedCell(index: number, width: number, time: number): BirdCell {
  return { min: index * width, max: (index + 1) * width, time };
}

function validateOptions(options: BirdsBridgeCrossingOptions): void {
  if (birdsScale(options.epoch) === undefined) throw new RangeError('Bridge epoch unavailable');
  if (!Number.isSafeInteger(options.trials) || options.trials < 1) {
    throw new RangeError('Bridge trials must be a positive safe integer');
  }
  for (const [name, value] of [
    ['population density', options.populationDensity],
    ['diffusion rate', options.diffusionRate],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Bridge ${name} must be finite and nonnegative`);
    }
  }
}
