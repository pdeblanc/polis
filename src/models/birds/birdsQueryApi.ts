import type { BirdsEngine } from './birdsEngine';
import type { BirdCell, BirdFlow } from './entities';
import { isAligned, type BirdsScale } from './scales';

/** Geometry and engine operations needed by the shared consumer API. */
export interface BirdsQueryBackend {
  readonly engine: Pick<BirdsEngine, 'queryCell' | 'queryCachedCell' | 'queryCellSubdivision' | 'queryFlow' | 'getCacheUsage' | 'clearCache'>;
  readonly minimumEpoch: number;
  readonly scale: (epoch: number) => BirdsScale | undefined;
  readonly firstEpochAtWidth: (width: number) => number;
  readonly incidentDuration: (cell: BirdCell) => number;
  readonly destinations: (cell: BirdCell, duration: number) => readonly BirdCell[];
  readonly sources: (cell: BirdCell, duration: number) => readonly BirdCell[];
}

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

export interface BirdsCachedPopulationSample {
  readonly count: number | undefined;
  readonly interval: { readonly max: number; readonly min: number };
}

export interface BirdsPopulationCellSample {
  readonly cell: BirdsCell;
  readonly count: number;
  readonly resolution: BirdsPopulationResolution;
}

export interface BirdsPopulationSubdivision {
  readonly children: readonly [BirdsPopulationCellSample, BirdsPopulationCellSample];
  readonly parentCount: number;
  readonly resolution: BirdsPopulationResolution;
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

export type BirdsCachedPopulationResult =
  | {
      readonly kind: 'population-profile';
      readonly resolution: BirdsPopulationResolution;
      readonly sampledTime: number;
      readonly samples: readonly BirdsCachedPopulationSample[];
    }
  | Extract<BirdsPopulationResult, { readonly kind: 'size-limit' }>;

export interface BirdsCell {
  readonly max: number;
  readonly min: number;
  readonly time: number;
}

export type BirdsFlowEndpoint = BirdsCell;

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

export type BirdsIncidentFlowResult =
  | BirdsFlowListResult
  | {
      readonly kind: 'duration-limit';
      readonly maximumDuration: number;
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
export class BirdsQueryApi {
  readonly #backend: BirdsQueryBackend;
  readonly #engine: BirdsQueryBackend["engine"];
  readonly #populationResolutions = new WeakMap<
    BirdsPopulationResolution,
    PopulationResolutionFacts
  >();
  readonly #flowResolutions = new WeakMap<BirdsFlowResolution, FlowResolutionFacts>();

  constructor(backend: BirdsQueryBackend) {
    this.#backend = backend;
    this.#engine = backend.engine;
  }

  resolvePopulationResolution(request: {
    readonly targetCellWidth: number;
    readonly targetTimeStep: number;
  }): BirdsPopulationResolution | undefined {
    validatePositiveFinite(request.targetCellWidth, 'Target population cell width');
    validatePositiveFinite(request.targetTimeStep, 'Target population time step');

    for (let epoch = this.#backend.firstEpochAtWidth(request.targetCellWidth); ; epoch += 1) {
      const scale = this.#backend.scale(epoch);
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
    return this.#backend.scale(facts.epoch + 1) === undefined
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
    for (let epoch = Math.max(this.#backend.minimumEpoch, facts.epoch - radius); epoch <= facts.epoch + radius; epoch += 1) {
      if (this.#backend.scale(epoch) !== undefined) results.push(this.#createPopulationResolution(epoch));
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

    let sourceEpoch = this.#backend.firstEpochAtWidth(request.targetSourceWidth);
    let destinationEpoch = this.#backend.firstEpochAtWidth(request.targetDestinationWidth);
    if (sourceEpoch > destinationEpoch + 1) destinationEpoch = sourceEpoch - 1;
    if (destinationEpoch > sourceEpoch + 1) sourceEpoch = destinationEpoch - 1;

    for (;;) {
      const sourceScale = this.#backend.scale(sourceEpoch);
      const destinationScale = this.#backend.scale(destinationEpoch);
      if (sourceScale === undefined || destinationScale === undefined) return undefined;
      const duration = supportedDuration(this.#backend.scale, sourceEpoch, destinationEpoch, request.targetDuration);
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
      this.#backend.scale(facts.sourceEpoch + 1) === undefined ||
      this.#backend.scale(facts.destinationEpoch + 1) === undefined
    ) {
      return undefined;
    }
    return this.#createFlowResolution(
      facts.sourceEpoch + 1,
      facts.destinationEpoch + 1,
      correspondingDuration(this.#backend.scale, resolution.duration, facts.sourceEpoch, facts.sourceEpoch + 1),
    );
  }

  getNearbyFlowResolutions(
    resolution: BirdsFlowResolution,
    radius = 2,
  ): readonly BirdsFlowResolution[] {
    const facts = this.#flowResolutionFacts(resolution);
    validateNearbyRadius(radius);
    const minimumShift = -Math.min(radius, facts.sourceEpoch - this.#backend.minimumEpoch, facts.destinationEpoch - this.#backend.minimumEpoch);
    const results: BirdsFlowResolution[] = [];
    for (let shift = minimumShift; shift <= radius; shift += 1) {
      const sourceEpoch = facts.sourceEpoch + shift;
      const destinationEpoch = facts.destinationEpoch + shift;
      if (this.#backend.scale(sourceEpoch) === undefined || this.#backend.scale(destinationEpoch) === undefined) continue;
      results.push(
        this.#createFlowResolution(
          sourceEpoch,
          destinationEpoch,
          correspondingDuration(this.#backend.scale, resolution.duration, facts.sourceEpoch, sourceEpoch),
        ),
      );
    }
    return results;
  }

  /** Returns the canonical flow incidence whose total is this cell's population. */
  resolveIncidentFlowResolution(request: {
    readonly cell: BirdsFlowEndpoint;
    readonly resolution: BirdsPopulationResolution;
  }): BirdsFlowResolution {
    const facts = this.#populationResolutionFacts(request.resolution);
    const cell = exactCell(request.cell, request.resolution.cellWidth, 'Population cell');
    const duration = this.#backend.incidentDuration(cell);
    return this.#createFlowResolution(facts.epoch, facts.epoch, duration);
  }

  queryPopulationCell(request: {
    readonly cell: BirdsCell;
    readonly resolution: BirdsPopulationResolution;
  }): BirdsPopulationCellSample {
    const facts = this.#populationResolutionFacts(request.resolution);
    const cell = exactCell(request.cell, request.resolution.cellWidth, 'Population cell');
    const scale = this.#backend.scale(facts.epoch)!;
    if (!isAligned(cell.time, scale.nextFlowDuration)) {
      throw new RangeError('Population cell does not lie on the capability temporal lattice');
    }
    return {
      cell,
      count: this.#engine.queryCell(cell),
      resolution: request.resolution,
    };
  }

  refinePopulationCell(request: {
    readonly cell: BirdsCell;
    readonly resolution: BirdsPopulationResolution;
  }): BirdsPopulationSubdivision | undefined {
    const facts = this.#populationResolutionFacts(request.resolution);
    const cell = exactCell(request.cell, request.resolution.cellWidth, 'Population cell');
    const resolution =
      this.#backend.scale(facts.epoch + 1) === undefined
        ? undefined
        : this.#createPopulationResolution(facts.epoch + 1);
    if (resolution === undefined) return undefined;
    const subdivision = this.#engine.queryCellSubdivision(cell);
    const childSample = (index: 0 | 1): BirdsPopulationCellSample => ({
      cell: subdivision.children[index].cell,
      count: subdivision.children[index].count,
      resolution,
    });
    return {
      children: [childSample(0), childSample(1)],
      parentCount: subdivision.parentCount,
      resolution,
    };
  }

  coarsenPopulationCell(request: {
    readonly cell: BirdsCell;
    readonly resolution: BirdsPopulationResolution;
  }): BirdsPopulationCellSample | undefined {
    const facts = this.#populationResolutionFacts(request.resolution);
    const cell = exactCell(request.cell, request.resolution.cellWidth, 'Population cell');
    if (facts.epoch <= this.#backend.minimumEpoch || this.#backend.scale(facts.epoch - 1) === undefined) return undefined;
    const resolution = this.#createPopulationResolution(facts.epoch - 1);
    if (!isAligned(cell.time, resolution.timeStep)) return undefined;
    const min = Math.floor(cell.min / resolution.cellWidth) * resolution.cellWidth;
    const parent = { min, max: min + resolution.cellWidth, time: cell.time };
    return {
      cell: parent,
      count: this.#engine.queryCell(parent),
      resolution,
    };
  }

  queryIncidentFlows(request: {
    readonly cell: BirdsCell;
    readonly direction: 'incoming' | 'outgoing';
    readonly maximumDuration: number;
    readonly resolution: BirdsPopulationResolution;
  }): BirdsIncidentFlowResult {
    validatePositiveFinite(request.maximumDuration, 'Maximum incident-flow duration');
    const resolution = this.resolveIncidentFlowResolution(request);
    if (resolution.duration > request.maximumDuration) {
      return {
        kind: 'duration-limit',
        maximumDuration: request.maximumDuration,
        resolution,
      };
    }
    return request.direction === 'outgoing'
      ? this.queryOutflows({ source: request.cell, resolution })
      : this.queryInflows({ destination: request.cell, resolution });
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
    const scale = this.#backend.scale(facts.epoch)!;
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

  queryCachedPopulation(request: {
    readonly max: number;
    readonly min: number;
    readonly resolution: BirdsPopulationResolution;
    readonly time: number;
  }): BirdsCachedPopulationResult {
    const facts = this.#populationResolutionFacts(request.resolution);
    validateInterval(request.min, request.max, 'Cached population query interval');
    if (!Number.isFinite(request.time)) {
      throw new RangeError('Cached population query time must be finite');
    }
    const scale = this.#backend.scale(facts.epoch)!;
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

    const samples: BirdsCachedPopulationSample[] = [];
    for (let index = firstIndex; index < finalIndex; index += 1) {
      const min = index * scale.cellLength;
      samples.push({
        count: this.#engine.queryCachedCell({
          min,
          max: min + scale.cellLength,
          time: sampledTime,
        }),
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
    const destinations = this.#backend.destinations(source, request.resolution.duration).filter(
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
    const sources = this.#backend.sources(destination, request.resolution.duration).filter(
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

  getCacheUsage(): { readonly capacity: number; readonly entries: number } {
    return this.#engine.getCacheUsage();
  }

  clearCache(): void {
    this.#engine.clearCache();
  }

  #createPopulationResolution(epoch: number): BirdsPopulationResolution {
    const scale = this.#backend.scale(epoch)!;
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
      destinationCellWidth: this.#backend.scale(destinationEpoch)!.cellLength,
      duration,
      sourceCellWidth: this.#backend.scale(sourceEpoch)!.cellLength,
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

function supportedDuration(
  birdsScale: BirdsQueryBackend["scale"],
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
  birdsScale: BirdsQueryBackend["scale"],
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
