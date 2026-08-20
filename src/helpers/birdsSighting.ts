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

interface TubeEntry {
  readonly cell: SightingCell;
  readonly count: number;
  readonly resolution: BirdsPopulationResolution;
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

/** An immutable observation backed by nested population cells ending in a singleton. */
export class Sighting {
  readonly cell: SightingCell;
  readonly resolution: BirdsPopulationResolution;

  readonly #birds: Birds;
  readonly #publicIndex: number;
  readonly #tube: readonly TubeEntry[];

  private constructor(birds: Birds, tube: readonly TubeEntry[], publicIndex: number) {
    const frozenTube = Object.freeze(tube.map(freezeEntry));
    const publicEntry = frozenTube[publicIndex];
    if (publicEntry === undefined || frozenTube.at(-1)?.count !== 1) {
      throw new Error("A sighting tube must contain its public cell and end in a singleton");
    }
    this.#birds = birds;
    this.#tube = frozenTube;
    this.#publicIndex = publicIndex;
    this.cell = publicEntry.cell;
    this.resolution = publicEntry.resolution;
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
    const root = freezeEntry({
      cell: selection.cell,
      count,
      resolution: selection.resolution,
    });
    return Sighting.#isolate(selection.birds, root, rank, budget);
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

  static #isolate(
    birds: Birds,
    root: TubeEntry,
    initialRank: number,
    budget: QueryBudget,
  ): Sighting {
    const tube = [root];
    let rank = initialRank;
    let entry = root;
    while (entry.count !== 1) {
      budget.takeRefinement();
      const finer = birds.refinePopulationResolution(entry.resolution);
      if (finer === undefined) throw new RangeError("No finer population resolution is available");
      const children = queryCells(
        birds,
        entry.cell.min,
        entry.cell.max,
        entry.cell.time,
        finer,
        budget,
      );
      let selected: (typeof children)[number] | undefined;
      for (const child of children) {
        if (rank < child.count) {
          selected = child;
          break;
        }
        rank -= child.count;
      }
      if (selected === undefined) {
        throw new Error("Selection rank is inconsistent with refined populations");
      }
      entry = freezeEntry({
        cell: { ...selected.interval, time: entry.cell.time },
        count: selected.count,
        resolution: finer,
      });
      tube.push(entry);
    }
    return new Sighting(birds, tube, 0);
  }

  #move(direction: 1 | -1, budget: QueryBudget): Sighting {
    const targetTime = this.cell.time + direction * this.resolution.timeStep;
    let singleton = this.#atSingleton();
    while (singleton.cell.time !== targetTime) {
      singleton = singleton.#moveSingletonToward(targetTime, direction, budget);
      singleton = singleton.#coarsenSingletonToward(this.resolution, budget);
    }
    return singleton.#rescale(this.resolution, budget);
  }

  #moveSingletonToward(
    targetTime: number,
    direction: 1 | -1,
    budget: QueryBudget,
  ): Sighting {
    let source = this.#atSingleton();
    for (;;) {
      const remaining = Math.abs(targetTime - source.cell.time);
      const flowResolution = source.#birds.getIncidentFlowResolution(
        source.cell,
        source.resolution,
      );
      if (flowResolution.duration > remaining) {
        source = source.#refineSingleton(budget);
        continue;
      }
      const result = queryIncidentFlows(
        source.#birds,
        source.cell,
        flowResolution,
        direction,
        budget,
      );
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
        return new Sighting(
          source.#birds,
          [{ cell: endpoint, count: 1, resolution: endpointResolution }],
          0,
        );
      }
      source = source.#refineSingleton(budget);
    }
  }

  #atSingleton(): Sighting {
    const singletonIndex = this.#tube.findIndex(({ count }) => count === 1);
    if (singletonIndex < 0) throw new Error("A sighting tube has no singleton cell");
    return new Sighting(this.#birds, this.#tube, singletonIndex);
  }

  #coarsenSingletonToward(
    maximumResolution: BirdsPopulationResolution,
    budget: QueryBudget,
  ): Sighting {
    let sighting = this.#atSingleton();
    while (sighting.#tube[0].resolution.cellWidth < maximumResolution.cellWidth) {
      const coarser = sighting.#coarserResolution();
      if (
        coarser === undefined ||
        !Number.isInteger(sighting.#tube[0].cell.time / coarser.timeStep)
      ) {
        break;
      }
      sighting = sighting.#extendCoarser(coarser, budget);
      if (sighting.#tube[0].count !== 1) return sighting.#atSingleton();
      sighting = new Sighting(sighting.#birds, sighting.#tube, 0);
    }
    return sighting;
  }

  #rescale(target: BirdsPopulationResolution, budget: QueryBudget): Sighting {
    validateResolution(this.#birds, target);
    let sighting = new Sighting(this.#birds, this.#tube, this.#publicIndex);
    while (sighting.#tube[0].resolution.cellWidth < target.cellWidth) {
      const coarser = sighting.#coarserResolution();
      if (coarser === undefined) {
        throw new RangeError("No coarser population resolution is available");
      }
      sighting = sighting.#extendCoarser(coarser, budget);
    }
    while (sighting.#tube.at(-1)!.resolution.cellWidth > target.cellWidth) {
      sighting = sighting.#atSingleton().#refineSingleton(budget);
    }
    const publicIndex = sighting.#tube.findIndex(
      ({ resolution }) => resolution.cellWidth === target.cellWidth,
    );
    if (publicIndex < 0 || !Number.isInteger(sighting.cell.time / target.timeStep)) {
      throw new RangeError("Target resolution is not compatible with this sighting");
    }
    const tube = sighting.#tube.map((entry, index) =>
      index === publicIndex ? freezeEntry({ ...entry, resolution: target }) : entry,
    );
    return new Sighting(sighting.#birds, tube, publicIndex);
  }

  #refineSingleton(budget: QueryBudget): Sighting {
    const publicEntry = this.#tube[this.#publicIndex];
    if (publicEntry.count !== 1) {
      throw new Error("Only a singleton sighting can refine its tracked tube");
    }
    if (this.#publicIndex + 1 < this.#tube.length) {
      return new Sighting(this.#birds, this.#tube, this.#publicIndex + 1);
    }
    budget.takeRefinement();
    const leaf = publicEntry;
    const finer = this.#birds.refinePopulationResolution(leaf.resolution);
    if (finer === undefined) throw new RangeError("No finer population resolution is available");
    const children = queryCells(
      this.#birds,
      leaf.cell.min,
      leaf.cell.max,
      leaf.cell.time,
      finer,
      budget,
    );
    const populated = children.filter(({ count }) => count !== 0);
    if (populated.length !== 1 || populated[0].count !== 1) {
      throw new Error("A singleton cell does not have exactly one singleton child");
    }
    const child = freezeEntry({
      cell: { ...populated[0].interval, time: leaf.cell.time },
      count: 1,
      resolution: finer,
    });
    const tube = [...this.#tube, child];
    return new Sighting(this.#birds, tube, tube.length - 1);
  }

  #coarserResolution(): BirdsPopulationResolution | undefined {
    const root = this.#tube[0];
    return this.#birds
      .getNearbyPopulationResolutions(root.resolution, 1)
      .find(({ cellWidth }) => cellWidth === root.resolution.cellWidth * 2);
  }

  #extendCoarser(
    coarser: BirdsPopulationResolution,
    budget: QueryBudget,
  ): Sighting {
    const root = this.#tube[0];
    if (!Number.isInteger(root.cell.time / coarser.timeStep)) {
      throw new RangeError("No coarser population cell exists at this sighting time");
    }
    const parentMin = Math.floor(root.cell.min / coarser.cellWidth) * coarser.cellWidth;
    const parent = freezeEntry({
      cell: { min: parentMin, max: parentMin + coarser.cellWidth, time: root.cell.time },
      count: queryCellCount(
        this.#birds,
        { min: parentMin, max: parentMin + coarser.cellWidth, time: root.cell.time },
        coarser,
        budget,
      ),
      resolution: coarser,
    });
    return new Sighting(
      this.#birds,
      [parent, ...this.#tube],
      this.#publicIndex + 1,
    );
  }
}

function freezeEntry(entry: TubeEntry): TubeEntry {
  return Object.freeze({
    cell: Object.freeze({ ...entry.cell }),
    count: entry.count,
    resolution: entry.resolution,
  });
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
  if (result.kind === "size-limit") {
    throw new Error("Sighting population query exceeded its result limit");
  }
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
  if (result.kind === "size-limit") {
    throw new Error("Sighting flow query exceeded its result limit");
  }
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
