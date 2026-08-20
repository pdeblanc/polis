import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsEngine, type BirdsEngineStats } from './birdsEngine';
import { classifyCell } from './classifiers';
import type { BirdCell, BirdFlow } from './entities';
import { possibleFlowDestinations, possibleFlowSources } from './motionSupport';
import { birdsScale, isAligned } from './scales';

export const BIRDS_MAX_POPULATION_CELLS_PER_QUERY = 65_536;
export const BIRDS_MAX_FLOWS_PER_QUERY = 65_536;
export const BIRDS_MAX_NEARBY_RESOLUTION_RADIUS = 16;

export interface BirdsPopulationResolution {
  readonly cellWidth: number;
  readonly timeOrigin: 0;
  readonly timeStep: number;
}

export interface BirdsFlowResolution {
  readonly destinationCellWidth: number;
  readonly duration: number;
  readonly sourceCellWidth: number;
  readonly timeOrigin: 0;
  readonly timeStep: number;
}

export interface BirdsPopulationSample {
  readonly count: number;
  readonly interval: { readonly max: number; readonly min: number };
}

export type BirdsPopulationResult =
  | {
      readonly kind: 'population-profile';
      readonly resolution: BirdsPopulationResolution;
      readonly sampledTime: number;
      readonly samples: readonly BirdsPopulationSample[];
    }
  | {
      readonly kind: 'size-limit';
      readonly limit: number;
      readonly requiredCount: number;
      readonly resolution: BirdsPopulationResolution;
      readonly sampledTime: number;
    };

export interface BirdsFlowEndpoint {
  readonly max: number;
  readonly min: number;
  readonly time: number;
}

export interface BirdsFlowSample {
  readonly count: number;
  readonly destination: BirdsFlowEndpoint;
  readonly source: BirdsFlowEndpoint;
}

export type BirdsFlowListResult =
  | {
      readonly flows: readonly BirdsFlowSample[];
      readonly kind: 'flows';
      readonly resolution: BirdsFlowResolution;
    }
  | {
      readonly kind: 'size-limit';
      readonly limit: number;
      readonly requiredCount: number;
      readonly resolution: BirdsFlowResolution;
    };

interface PopulationResolutionFacts {
  readonly epoch: number;
}

interface FlowResolutionFacts {
  readonly destinationEpoch: number;
  readonly sourceEpoch: number;
}

/** Consumer-facing Birds API. Hierarchy epochs, stages, owners, and ranks remain private. */
export class Birds {
  readonly #diffusionRate: number;
  readonly #engine: BirdsEngine;
  readonly #populationResolutions = new WeakMap<
    BirdsPopulationResolution,
    PopulationResolutionFacts
  >();
  readonly #flowResolutions = new WeakMap<BirdsFlowResolution, FlowResolutionFacts>();

  constructor(seed: Seed, populationDensity: number, diffusionRate: number) {
    this.#diffusionRate = diffusionRate;
    this.#engine = new BirdsEngine(seed, populationDensity, diffusionRate);
  }

  resolvePopulationResolution(request: {
    readonly targetCellWidth: number;
    readonly targetTimeStep: number;
  }): BirdsPopulationResolution | undefined {
    validatePositiveFinite(request.targetCellWidth, 'Target population cell width');
    validatePositiveFinite(request.targetTimeStep, 'Target population time step');

    for (let epoch = 0; ; epoch += 1) {
      const scale = birdsScale(epoch);
      if (scale === undefined) return undefined;
      if (
        scale.cellLength <= request.targetCellWidth &&
        scale.nextFlowDuration <= request.targetTimeStep
      ) {
        return this.#createPopulationResolution(epoch);
      }
    }
  }

  refinePopulationResolution(
    resolution: BirdsPopulationResolution,
  ): BirdsPopulationResolution | undefined {
    const facts = this.#populationResolutionFacts(resolution);
    return birdsScale(facts.epoch + 1) === undefined
      ? undefined
      : this.#createPopulationResolution(facts.epoch + 1);
  }

  getNearbyPopulationResolutions(
    resolution: BirdsPopulationResolution,
    radius = 2,
  ): readonly BirdsPopulationResolution[] {
    const facts = this.#populationResolutionFacts(resolution);
    validateNearbyRadius(radius);
    const results: BirdsPopulationResolution[] = [];
    for (let epoch = Math.max(0, facts.epoch - radius); epoch <= facts.epoch + radius; epoch += 1) {
      if (birdsScale(epoch) !== undefined) results.push(this.#createPopulationResolution(epoch));
    }
    return results;
  }

  resolveFlowResolution(request: {
    readonly targetDestinationWidth: number;
    readonly targetDuration: number;
    readonly targetSourceWidth: number;
  }): BirdsFlowResolution | undefined {
    validatePositiveFinite(request.targetSourceWidth, 'Target flow source width');
    validatePositiveFinite(request.targetDestinationWidth, 'Target flow destination width');
    validatePositiveFinite(request.targetDuration, 'Target flow duration');

    let sourceEpoch = firstEpochAtWidth(request.targetSourceWidth);
    let destinationEpoch = firstEpochAtWidth(request.targetDestinationWidth);
    if (sourceEpoch === undefined || destinationEpoch === undefined) return undefined;
    if (sourceEpoch > destinationEpoch + 1) destinationEpoch = sourceEpoch - 1;
    if (destinationEpoch > sourceEpoch + 1) sourceEpoch = destinationEpoch - 1;

    for (;;) {
      const sourceScale = birdsScale(sourceEpoch);
      const destinationScale = birdsScale(destinationEpoch);
      if (sourceScale === undefined || destinationScale === undefined) return undefined;
      const duration = supportedDuration(sourceEpoch, destinationEpoch, request.targetDuration);
      if (duration !== undefined) {
        return this.#createFlowResolution(sourceEpoch, destinationEpoch, duration);
      }
      sourceEpoch += 1;
      destinationEpoch += 1;
    }
  }

  refineFlowResolution(resolution: BirdsFlowResolution): BirdsFlowResolution | undefined {
    const facts = this.#flowResolutionFacts(resolution);
    if (
      birdsScale(facts.sourceEpoch + 1) === undefined ||
      birdsScale(facts.destinationEpoch + 1) === undefined
    ) {
      return undefined;
    }
    return this.#createFlowResolution(
      facts.sourceEpoch + 1,
      facts.destinationEpoch + 1,
      correspondingDuration(resolution.duration, facts.sourceEpoch, facts.sourceEpoch + 1),
    );
  }

  getNearbyFlowResolutions(
    resolution: BirdsFlowResolution,
    radius = 2,
  ): readonly BirdsFlowResolution[] {
    const facts = this.#flowResolutionFacts(resolution);
    validateNearbyRadius(radius);
    const minimumShift = -Math.min(radius, facts.sourceEpoch, facts.destinationEpoch);
    const results: BirdsFlowResolution[] = [];
    for (let shift = minimumShift; shift <= radius; shift += 1) {
      const sourceEpoch = facts.sourceEpoch + shift;
      const destinationEpoch = facts.destinationEpoch + shift;
      if (birdsScale(sourceEpoch) === undefined || birdsScale(destinationEpoch) === undefined) break;
      results.push(
        this.#createFlowResolution(
          sourceEpoch,
          destinationEpoch,
          correspondingDuration(resolution.duration, facts.sourceEpoch, sourceEpoch),
        ),
      );
    }
    return results;
  }

  /** Returns the canonical flow incidence whose total is this cell's population. */
  getIncidentFlowResolution(
    cellEndpoint: BirdsFlowEndpoint,
    populationResolution: BirdsPopulationResolution,
  ): BirdsFlowResolution {
    const facts = this.#populationResolutionFacts(populationResolution);
    const cell = exactCell(cellEndpoint, populationResolution.cellWidth, 'Population cell');
    const construction = classifyCell(cell);
    if (construction === undefined) {
      throw new RangeError('Population cell does not lie in the Birds hierarchy');
    }
    const scale = birdsScale(facts.epoch)!;
    const duration =
      construction.kind === 'spatial-child'
        ? scale.flowDuration
        : construction.outgoingDuration;
    return this.#createFlowResolution(facts.epoch, facts.epoch, duration);
  }

  queryPopulation(request: {
    readonly max: number;
    readonly min: number;
    readonly resolution: BirdsPopulationResolution;
    readonly time: number;
  }): BirdsPopulationResult {
    const facts = this.#populationResolutionFacts(request.resolution);
    validateInterval(request.min, request.max, 'Population query interval');
    if (!Number.isFinite(request.time)) throw new RangeError('Population query time must be finite');
    const scale = birdsScale(facts.epoch)!;
    const sampledTime = snapNearest(request.time, scale.nextFlowDuration);
    const firstIndex = Math.floor(request.min / scale.cellLength);
    const finalIndex = Math.ceil(request.max / scale.cellLength);
    validateIndices(firstIndex, finalIndex);
    const requiredCount = finalIndex - firstIndex;
    if (requiredCount > BIRDS_MAX_POPULATION_CELLS_PER_QUERY) {
      return {
        kind: 'size-limit',
        limit: BIRDS_MAX_POPULATION_CELLS_PER_QUERY,
        requiredCount,
        resolution: request.resolution,
        sampledTime,
      };
    }

    const samples: BirdsPopulationSample[] = [];
    for (let index = firstIndex; index < finalIndex; index += 1) {
      const min = index * scale.cellLength;
      samples.push({
        count: this.#engine.queryCell({ min, max: min + scale.cellLength, time: sampledTime }),
        interval: { min, max: min + scale.cellLength },
      });
    }
    return {
      kind: 'population-profile',
      resolution: request.resolution,
      sampledTime,
      samples,
    };
  }

  queryFlow(request: {
    readonly destination: BirdsFlowEndpoint;
    readonly resolution: BirdsFlowResolution;
    readonly source: BirdsFlowEndpoint;
  }): BirdsFlowSample {
    this.#flowResolutionFacts(request.resolution);
    const flow = this.#exactFlow(request.source, request.destination, request.resolution);
    return { source: request.source, destination: request.destination, count: this.#engine.queryFlow(flow) };
  }

  queryOutflows(request: {
    readonly resolution: BirdsFlowResolution;
    readonly source: BirdsFlowEndpoint;
  }): BirdsFlowListResult {
    this.#flowResolutionFacts(request.resolution);
    const source = exactCell(request.source, request.resolution.sourceCellWidth, 'Flow source');
    if (!isAligned(source.time, request.resolution.duration)) {
      throw new RangeError('Flow source does not lie on the capability temporal lattice');
    }
    const expectedTime = source.time + request.resolution.duration;
    const destinations = possibleFlowDestinations(
      source,
      request.resolution.duration,
      this.#diffusionRate,
    ).filter(
      (destination) =>
        destination.max - destination.min === request.resolution.destinationCellWidth &&
        destination.time === expectedTime,
    );
    if (destinations.length > BIRDS_MAX_FLOWS_PER_QUERY) {
      return sizeLimit(destinations.length, request.resolution);
    }
    return {
      kind: 'flows',
      resolution: request.resolution,
      flows: destinations
        .map((destination) => flowSample(source, destination, this.#engine.queryFlow({ source, destination })))
        .filter(({ count }) => count !== 0),
    };
  }

  queryInflows(request: {
    readonly destination: BirdsFlowEndpoint;
    readonly resolution: BirdsFlowResolution;
  }): BirdsFlowListResult {
    this.#flowResolutionFacts(request.resolution);
    const destination = exactCell(
      request.destination,
      request.resolution.destinationCellWidth,
      'Flow destination',
    );
    if (!isAligned(destination.time, request.resolution.duration)) {
      throw new RangeError('Flow destination does not lie on the capability temporal lattice');
    }
    const expectedTime = destination.time - request.resolution.duration;
    const sources = possibleFlowSources(
      destination,
      request.resolution.duration,
      this.#diffusionRate,
    ).filter(
      (source) =>
        source.max - source.min === request.resolution.sourceCellWidth &&
        source.time === expectedTime,
    );
    if (sources.length > BIRDS_MAX_FLOWS_PER_QUERY) {
      return sizeLimit(sources.length, request.resolution);
    }
    return {
      kind: 'flows',
      resolution: request.resolution,
      flows: sources
        .map((source) => flowSample(source, destination, this.#engine.queryFlow({ source, destination })))
        .filter(({ count }) => count !== 0),
    };
  }

  getLastQueryStats(): BirdsEngineStats {
    return this.#engine.getLastQueryStats();
  }

  getCacheUsage(): { readonly capacity: number; readonly entries: number } {
    return this.#engine.getCacheUsage();
  }

  clearCache(): void {
    this.#engine.clearCache();
  }

  #createPopulationResolution(epoch: number): BirdsPopulationResolution {
    const scale = birdsScale(epoch)!;
    const resolution = Object.freeze({
      cellWidth: scale.cellLength,
      timeOrigin: 0 as const,
      timeStep: scale.nextFlowDuration,
    });
    this.#populationResolutions.set(resolution, { epoch });
    return resolution;
  }

  #createFlowResolution(
    sourceEpoch: number,
    destinationEpoch: number,
    duration: number,
  ): BirdsFlowResolution {
    const resolution = Object.freeze({
      destinationCellWidth: birdsScale(destinationEpoch)!.cellLength,
      duration,
      sourceCellWidth: birdsScale(sourceEpoch)!.cellLength,
      timeOrigin: 0 as const,
      timeStep: duration,
    });
    this.#flowResolutions.set(resolution, { sourceEpoch, destinationEpoch });
    return resolution;
  }

  #populationResolutionFacts(resolution: BirdsPopulationResolution): PopulationResolutionFacts {
    const facts = this.#populationResolutions.get(resolution);
    if (facts === undefined) throw new RangeError('Population resolution does not belong to this model');
    return facts;
  }

  #flowResolutionFacts(resolution: BirdsFlowResolution): FlowResolutionFacts {
    const facts = this.#flowResolutions.get(resolution);
    if (facts === undefined) throw new RangeError('Flow resolution does not belong to this model');
    return facts;
  }

  #exactFlow(
    sourceEndpoint: BirdsFlowEndpoint,
    destinationEndpoint: BirdsFlowEndpoint,
    resolution: BirdsFlowResolution,
  ): BirdFlow {
    const source = exactCell(sourceEndpoint, resolution.sourceCellWidth, 'Flow source');
    const destination = exactCell(
      destinationEndpoint,
      resolution.destinationCellWidth,
      'Flow destination',
    );
    if (destination.time - source.time !== resolution.duration || !isAligned(source.time, resolution.duration)) {
      throw new RangeError('Flow endpoints do not lie on the capability temporal lattice');
    }
    return { source, destination };
  }
}

function firstEpochAtWidth(targetWidth: number): number | undefined {
  for (let epoch = 0; ; epoch += 1) {
    const scale = birdsScale(epoch);
    if (scale === undefined) return undefined;
    if (scale.cellLength <= targetWidth) return epoch;
  }
}

function supportedDuration(
  sourceEpoch: number,
  destinationEpoch: number,
  targetDuration: number,
): number | undefined {
  if (sourceEpoch !== destinationEpoch) {
    const coarseEpoch = Math.min(sourceEpoch, destinationEpoch);
    const duration = birdsScale(coarseEpoch)!.nextFlowDuration;
    return duration <= targetDuration ? duration : undefined;
  }
  const scale = birdsScale(sourceEpoch)!;
  return [scale.flowDuration, scale.halfFlowDuration, scale.nextFlowDuration].find(
    (duration) => duration <= targetDuration,
  );
}

function correspondingDuration(
  duration: number,
  fromSourceEpoch: number,
  toSourceEpoch: number,
): number {
  const fromScale = birdsScale(fromSourceEpoch)!;
  const toScale = birdsScale(toSourceEpoch)!;
  return duration * (toScale.flowDuration / fromScale.flowDuration);
}

function exactCell(endpoint: BirdsFlowEndpoint, width: number, name: string): BirdCell {
  validateInterval(endpoint.min, endpoint.max, name);
  if (!Number.isFinite(endpoint.time)) throw new RangeError(`${name} time must be finite`);
  if (endpoint.max - endpoint.min !== width || !isAligned(endpoint.min, width)) {
    throw new RangeError(`${name} does not lie on the capability spatial lattice`);
  }
  return endpoint;
}

function flowSample(source: BirdCell, destination: BirdCell, count: number): BirdsFlowSample {
  return { source, destination, count };
}

function sizeLimit(
  requiredCount: number,
  resolution: BirdsFlowResolution,
): BirdsFlowListResult {
  return { kind: 'size-limit', limit: BIRDS_MAX_FLOWS_PER_QUERY, requiredCount, resolution };
}

function snapNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function validatePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
}

function validateInterval(min: number, max: number, name: string): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new RangeError(`${name} must have finite, increasing bounds`);
  }
}

function validateIndices(first: number, final: number): void {
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(final) ||
    !Number.isSafeInteger(final - first)
  ) {
    throw new RangeError('Birds query indices exceed exact integer precision');
  }
}

function validateNearbyRadius(radius: number): void {
  if (
    !Number.isSafeInteger(radius) ||
    radius < 0 ||
    radius > BIRDS_MAX_NEARBY_RESOLUTION_RADIUS
  ) {
    throw new RangeError(
      `Nearby resolution radius must be an integer from 0 through ${BIRDS_MAX_NEARBY_RESOLUTION_RADIUS}`,
    );
  }
}
