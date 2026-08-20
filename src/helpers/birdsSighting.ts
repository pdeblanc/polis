import {
  Birds,
  type BirdsFlowEndpoint,
  type BirdsFlowListResult,
  type BirdsFlowResolution,
  type BirdsPopulationResolution,
} from "../models/birds/birds";
import { uniformUnit } from "../utils/distributions/uniform";
import { createAddressedRandom, type Seed } from "../utils/rng/addressedRandom";

export const DEFAULT_SIGHTING_QUERY_BUDGET = 10_000;
export const DEFAULT_SIGHTING_REFINEMENT_BUDGET = 32;

export interface SightingCell {
  readonly max: number;
  readonly min: number;
  readonly time: number;
}

export interface SightingOptions {
  readonly maxQueries?: number;
  readonly maxRefinements?: number;
}

export interface SightingSelection {
  readonly birds: Birds;
  readonly cell: SightingCell;
  readonly resolution: BirdsPopulationResolution;
  readonly seed: Seed;
}

export class SightingBudgetExceededError extends Error {
  constructor(
    readonly budget: "query" | "refinement",
    readonly limit: number,
  ) {
    super(`Sighting ${budget} budget of ${limit} was exhausted`);
    this.name = "SightingBudgetExceededError";
  }
}

/** An immutable observation of one exchangeable bird within a population cell. */
export class Sighting {
  readonly cell: SightingCell;
  readonly resolution: BirdsPopulationResolution;

  readonly #birds: Birds;
  readonly #rank: number;

  private constructor(
    birds: Birds,
    cell: SightingCell,
    resolution: BirdsPopulationResolution,
    rank: number,
  ) {
    this.#birds = birds;
    this.cell = Object.freeze({ ...cell });
    this.resolution = resolution;
    this.#rank = rank;
    Object.freeze(this);
  }

  static select(selection: SightingSelection, options?: SightingOptions): Sighting {
    const budget = new QueryBudget(options);
    const count = queryCellCount(
      selection.birds,
      selection.cell,
      selection.resolution,
      budget,
    );
    if (count === 0) throw new RangeError("Cannot select a bird from an empty cell");
    const random = createAddressedRandom(selection.seed);
    const rank = Math.floor(
      uniformUnit(random, [
        "birds.sighting.selection",
        selection.cell.min,
        selection.cell.max,
        selection.cell.time,
        selection.resolution.cellWidth,
        selection.resolution.timeStep,
      ]) * count,
    );
    return new Sighting(selection.birds, selection.cell, selection.resolution, rank);
  }

  rescale(
    targetResolution: BirdsPopulationResolution,
    options?: SightingOptions,
  ): Sighting {
    return this.#rescale(targetResolution, new QueryBudget(options));
  }

  next(options?: SightingOptions): Sighting {
    return this.#move(1, new QueryBudget(options));
  }

  prev(options?: SightingOptions): Sighting {
    return this.#move(-1, new QueryBudget(options));
  }

  #move(direction: 1 | -1, budget: QueryBudget): Sighting {
    const targetTime = this.cell.time + direction * this.resolution.timeStep;
    let singleton = this.#toSingleton(budget);
    while (singleton.cell.time !== targetTime) {
      singleton = singleton.#moveSingletonToward(targetTime, direction, budget);
    }
    return singleton.#rescale(this.resolution, budget);
  }

  #moveSingletonToward(
    targetTime: number,
    direction: 1 | -1,
    budget: QueryBudget,
  ): Sighting {
    let source = new Sighting(this.#birds, this.cell, this.resolution, this.#rank);
    for (;;) {
      const remaining = Math.abs(targetTime - source.cell.time);
      const flowResolution = source.#birds.getIncidentFlowResolution(
        source.cell,
        source.resolution,
      );
      if (flowResolution.duration > remaining) {
        source = source.#refine(budget);
        continue;
      }
      const result = queryIncidentFlows(source.#birds, source.cell, flowResolution, direction, budget);
      const flow = singletonFlow(result);
      const endpoint = direction === 1 ? flow.destination : flow.source;
      const endpointResolution = populationResolutionAtWidth(
        source.#birds,
        source.resolution,
        direction === 1
          ? flowResolution.destinationCellWidth
          : flowResolution.sourceCellWidth,
      );
      const endpointCount = queryCellCount(
        source.#birds,
        endpoint,
        endpointResolution,
        budget,
      );
      if (endpointCount === 1) {
        return new Sighting(source.#birds, endpoint, endpointResolution, 0);
      }
      source = source.#refine(budget);
    }
  }

  #toSingleton(budget: QueryBudget): Sighting {
    let sighting = new Sighting(this.#birds, this.cell, this.resolution, this.#rank);
    for (;;) {
      const count = queryCellCount(
        sighting.#birds,
        sighting.cell,
        sighting.resolution,
        budget,
      );
      if (sighting.#rank >= count) {
        throw new Error("Sighting rank is inconsistent with the model population");
      }
      if (count === 1) return sighting;
      sighting = sighting.#refine(budget);
    }
  }

  #rescale(target: BirdsPopulationResolution, budget: QueryBudget): Sighting {
    validateResolution(this.#birds, target);
    let sighting = new Sighting(this.#birds, this.cell, this.resolution, this.#rank);
    while (sighting.resolution.cellWidth > target.cellWidth) {
      sighting = sighting.#refine(budget);
    }
    while (sighting.resolution.cellWidth < target.cellWidth) {
      sighting = sighting.#coarsen(budget);
    }
    if (
      sighting.resolution.cellWidth !== target.cellWidth ||
      !Number.isInteger(sighting.cell.time / target.timeStep)
    ) {
      throw new RangeError("Target resolution is not compatible with this sighting");
    }
    return new Sighting(sighting.#birds, sighting.cell, target, sighting.#rank);
  }

  #refine(budget: QueryBudget): Sighting {
    budget.takeRefinement();
    const finer = this.#birds.refinePopulationResolution(this.resolution);
    if (finer === undefined) throw new RangeError("No finer population resolution is available");
    const result = queryCells(
      this.#birds,
      this.cell.min,
      this.cell.max,
      this.cell.time,
      finer,
      budget,
    );
    let rank = this.#rank;
    for (const sample of result) {
      if (rank < sample.count) {
        return new Sighting(
          this.#birds,
          { ...sample.interval, time: this.cell.time },
          finer,
          rank,
        );
      }
      rank -= sample.count;
    }
    throw new Error("Sighting rank is inconsistent with refined populations");
  }

  #coarsen(budget: QueryBudget): Sighting {
    const coarser = this.#birds
      .getNearbyPopulationResolutions(this.resolution, 1)
      .find(({ cellWidth }) => cellWidth === this.resolution.cellWidth * 2);
    if (coarser === undefined) throw new RangeError("No coarser population resolution is available");
    if (!Number.isInteger(this.cell.time / coarser.timeStep)) {
      throw new RangeError("No coarser population cell exists at this sighting time");
    }
    const parentMin = Math.floor(this.cell.min / coarser.cellWidth) * coarser.cellWidth;
    const siblings = queryCells(
      this.#birds,
      parentMin,
      parentMin + coarser.cellWidth,
      this.cell.time,
      this.resolution,
      budget,
    );
    let rank = this.#rank;
    for (const sibling of siblings) {
      if (sibling.interval.min === this.cell.min) break;
      rank += sibling.count;
    }
    return new Sighting(
      this.#birds,
      { min: parentMin, max: parentMin + coarser.cellWidth, time: this.cell.time },
      coarser,
      rank,
    );
  }
}

class QueryBudget {
  readonly maxQueries: number;
  readonly maxRefinements: number;
  #remainingQueries: number;
  #remainingRefinements: number;

  constructor(options: SightingOptions = {}) {
    const maxQueries = options.maxQueries ?? DEFAULT_SIGHTING_QUERY_BUDGET;
    const maxRefinements =
      options.maxRefinements ?? DEFAULT_SIGHTING_REFINEMENT_BUDGET;
    if (!Number.isSafeInteger(maxQueries) || maxQueries < 1) {
      throw new RangeError("Sighting maxQueries must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxRefinements) || maxRefinements < 0) {
      throw new RangeError("Sighting maxRefinements must be a nonnegative safe integer");
    }
    this.maxQueries = maxQueries;
    this.maxRefinements = maxRefinements;
    this.#remainingQueries = maxQueries;
    this.#remainingRefinements = maxRefinements;
  }

  take(): void {
    if (this.#remainingQueries === 0) {
      throw new SightingBudgetExceededError("query", this.maxQueries);
    }
    this.#remainingQueries -= 1;
  }

  takeRefinement(): void {
    if (this.#remainingRefinements === 0) {
      throw new SightingBudgetExceededError("refinement", this.maxRefinements);
    }
    this.#remainingRefinements -= 1;
  }
}

function queryCellCount(
  birds: Birds,
  cell: SightingCell,
  resolution: BirdsPopulationResolution,
  budget: QueryBudget,
): number {
  const samples = queryCells(birds, cell.min, cell.max, cell.time, resolution, budget);
  if (
    samples.length !== 1 ||
    samples[0].interval.min !== cell.min ||
    samples[0].interval.max !== cell.max
  ) {
    throw new RangeError("Sighting cell does not match its population resolution");
  }
  return samples[0].count;
}

function queryCells(
  birds: Birds,
  min: number,
  max: number,
  time: number,
  resolution: BirdsPopulationResolution,
  budget: QueryBudget,
) {
  budget.take();
  const result = birds.queryPopulation({ min, max, time, resolution });
  if (result.kind === "size-limit") throw new Error("Sighting population query exceeded its result limit");
  if (result.sampledTime !== time) {
    throw new RangeError("Sighting time does not lie on the population resolution lattice");
  }
  return result.samples;
}

function validateResolution(birds: Birds, resolution: BirdsPopulationResolution): void {
  birds.getNearbyPopulationResolutions(resolution, 0);
}

function populationResolutionAtWidth(
  birds: Birds,
  origin: BirdsPopulationResolution,
  width: number,
): BirdsPopulationResolution {
  let resolution = origin;
  while (resolution.cellWidth > width) {
    const finer = birds.refinePopulationResolution(resolution);
    if (finer === undefined) break;
    resolution = finer;
  }
  while (resolution.cellWidth < width) {
    const coarser = birds
      .getNearbyPopulationResolutions(resolution, 1)
      .find(({ cellWidth }) => cellWidth === resolution.cellWidth * 2);
    if (coarser === undefined) break;
    resolution = coarser;
  }
  if (resolution.cellWidth !== width) {
    throw new RangeError("Flow endpoint width has no population resolution");
  }
  return resolution;
}

function queryIncidentFlows(
  birds: Birds,
  cell: BirdsFlowEndpoint,
  resolution: BirdsFlowResolution,
  direction: 1 | -1,
  budget: QueryBudget,
): BirdsFlowListResult {
  budget.take();
  return direction === 1
    ? birds.queryOutflows({ source: cell, resolution })
    : birds.queryInflows({ destination: cell, resolution });
}

function singletonFlow(result: BirdsFlowListResult) {
  if (result.kind === "size-limit") throw new Error("Sighting flow query exceeded its result limit");
  const populated = result.flows.filter(({ count }) => count !== 0);
  const total = populated.reduce((sum, { count }) => sum + count, 0);
  if (total !== 1 || populated.length !== 1 || populated[0].count !== 1) {
    throw new Error(
      `A singleton sighting has incident total ${total} across ${populated.length} flows ` +
        `at ${JSON.stringify(result.resolution)}`,
    );
  }
  return populated[0];
}
