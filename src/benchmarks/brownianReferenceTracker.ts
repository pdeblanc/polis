import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { uniform, uniformUnit } from '../utils/distributions/uniform';
import { createAddressedRandom, type AddressedRandom } from '../utils/rng/addressedRandom';

export interface BrownianReferenceTrackerOptions {
  readonly candidateCount: number;
  readonly cellWidth: number;
  readonly diffusionRate: number;
  readonly maxQueries: number;
  readonly maxRefinements: number;
  readonly populationDensity: number;
  readonly ringCellCount: number;
  readonly seedPrefix?: string;
  readonly sourceCellIndex: number;
  readonly steps: number;
  readonly timeStep: number;
}

export type BrownianReferenceTrackerStatus =
  | 'complete'
  | 'empty-start'
  | 'query-budget'
  | 'refinement-budget'
  | 'numeric-resolution'
  | 'error';

export interface BrownianReferenceTrackerCandidate {
  readonly asymmetricNarrowingAttempts: number;
  readonly candidateIndex: number;
  readonly collisionThenSeparation: boolean;
  readonly initialPopulation: number;
  readonly joinSplitRejoin: boolean;
  readonly minimumCellWidth: number;
  readonly minimumTimeStep: number;
  readonly modelQueries: number;
  readonly outcomeDetail: string;
  readonly spatialRefinements: number;
  readonly status: BrownianReferenceTrackerStatus;
  readonly stepsCompleted: number;
  readonly trackedCorrectLabel: boolean;
}

export interface BrownianReferenceTrackerSummary {
  readonly asymmetricNarrowingAttempts: number;
  readonly attemptedCandidates: number;
  readonly collisionThenSeparationPaths: number;
  readonly completedCollisionThenSeparationPaths: number;
  readonly completedJoinSplitRejoinPaths: number;
  readonly completePaths: number;
  readonly diffusionRate: number;
  readonly emptyStarts: number;
  readonly errorFailures: number;
  readonly failedCollisionThenSeparationPaths: number;
  readonly failedJoinSplitRejoinPaths: number;
  readonly joinSplitRejoinPaths: number;
  readonly maximumSpatialRefinements: number;
  readonly minimumCellWidth: number;
  readonly minimumTimeStep: number;
  readonly numericResolutionFailures: number;
  readonly queryBudgetFailures: number;
  readonly refinementBudgetFailures: number;
  readonly trackedWrongLabelPaths: number;
  readonly totalModelQueries: number;
}

interface TrackerDiagnostics {
  asymmetricNarrowingAttempts: number;
  minimumCellWidth: number;
  minimumTimeStep: number;
  modelQueries: number;
  spatialRefinements: number;
}

interface SingletonState {
  readonly cellIndex: number;
  readonly cellWidth: number;
  readonly time: number;
  readonly timeStep: number;
}

class ReferenceBudgetError extends Error {
  constructor(readonly budget: 'query' | 'refinement') {
    super(`Brownian reference ${budget} budget exhausted`);
    this.name = 'ReferenceBudgetError';
  }
}

class ReferenceResolutionError extends Error {
  constructor(readonly dimension: 'spatial' | 'temporal') {
    super(`Brownian reference reached the numeric ${dimension} resolution limit`);
    this.name = 'ReferenceResolutionError';
  }
}

/**
 * A finite labeled Brownian population whose query surface exposes only anonymous counts.
 * Labels remain private ground truth for verifying the tracker result.
 */
class BrownianQuotientPopulation {
  readonly #basePositions: readonly (readonly number[])[];
  readonly #diffusionRate: number;
  readonly #positionCache: readonly Map<number, number>[];
  readonly #random: AddressedRandom;
  readonly #ringWidth: number;
  readonly #timeStep: number;

  constructor(options: BrownianReferenceTrackerOptions, candidateIndex: number) {
    this.#random = createAddressedRandom(
      `${options.seedPrefix ?? 'Brownian reference tracker'}:${candidateIndex}`,
    );
    this.#ringWidth = options.ringCellCount * options.cellWidth;
    this.#timeStep = options.timeStep;
    this.#diffusionRate = options.diffusionRate;
    const population = poissonQuantile(
      uniformUnit(this.#random, ['population']),
      options.populationDensity * this.#ringWidth,
    );
    const paths = Array.from({ length: population }, (_, bird) => {
      const positions = [uniform(this.#random, ['position', bird], 0, this.#ringWidth)];
      for (let step = 0; step < options.steps; step += 1) {
        positions.push(
          positions[step] +
            sampleNormal(
              this.#random,
              ['base-increment', step, bird],
              Math.sqrt(options.diffusionRate * options.timeStep),
            ),
        );
      }
      return positions;
    });
    this.#basePositions = paths;
    this.#positionCache = paths.map((positions) =>
      new Map(positions.map((position, step) => [step, position])),
    );
  }

  get population(): number {
    return this.#basePositions.length;
  }

  occupants(cellIndex: number, cellWidth: number, time: number): readonly number[] {
    const cellCount = this.#ringWidth / cellWidth;
    if (!Number.isSafeInteger(cellCount)) throw new Error('Reference cell width is off lattice');
    const wrappedCell = euclideanModulo(cellIndex, cellCount);
    const occupants: number[] = [];
    for (let bird = 0; bird < this.population; bird += 1) {
      const index = Math.floor(this.positionAt(bird, time) / cellWidth);
      if (euclideanModulo(index, cellCount) === wrappedCell) occupants.push(bird);
    }
    return occupants;
  }

  destinationCell(
    source: SingletonState,
    duration: number,
    destinationWidth: number,
  ): number {
    const occupants = this.occupants(source.cellIndex, source.cellWidth, source.time);
    if (occupants.length !== 1) {
      throw new Error(`Reference singleton source contains ${occupants.length} birds`);
    }
    return Math.floor(this.positionAt(occupants[0], source.time + duration) / destinationWidth);
  }

  positionAt(bird: number, time: number): number {
    const normalizedTime = time / this.#timeStep;
    if (!Number.isFinite(normalizedTime) || normalizedTime < 0) {
      throw new ReferenceResolutionError('temporal');
    }
    const cached = this.#positionCache[bird].get(normalizedTime);
    if (cached !== undefined) return cached;
    const left = Math.floor(normalizedTime);
    const right = left + 1;
    if (right >= this.#basePositions[bird].length) {
      throw new RangeError('Reference time is outside the generated experiment');
    }
    return this.#bridgePosition(
      bird,
      normalizedTime,
      left,
      right,
      this.#basePositions[bird][left],
      this.#basePositions[bird][right],
    );
  }

  #bridgePosition(
    bird: number,
    target: number,
    leftTime: number,
    rightTime: number,
    leftPosition: number,
    rightPosition: number,
  ): number {
    const midpoint = (leftTime + rightTime) / 2;
    if (midpoint === leftTime || midpoint === rightTime) {
      throw new ReferenceResolutionError('temporal');
    }
    let midpointPosition = this.#positionCache[bird].get(midpoint);
    if (midpointPosition === undefined) {
      midpointPosition =
        (leftPosition + rightPosition) / 2 +
        sampleNormal(
          this.#random,
          ['bridge', bird, leftTime, rightTime],
          Math.sqrt(this.#diffusionRate * this.#timeStep * (rightTime - leftTime) / 4),
        );
      this.#positionCache[bird].set(midpoint, midpointPosition);
    }
    if (target === midpoint) return midpointPosition;
    return target < midpoint
      ? this.#bridgePosition(
          bird,
          target,
          leftTime,
          midpoint,
          leftPosition,
          midpointPosition,
        )
      : this.#bridgePosition(
          bird,
          target,
          midpoint,
          rightTime,
          midpointPosition,
          rightPosition,
        );
  }
}

export function measureBrownianReferenceTracker(
  options: BrownianReferenceTrackerOptions,
): {
  readonly candidates: readonly BrownianReferenceTrackerCandidate[];
  readonly summary: BrownianReferenceTrackerSummary;
} {
  validateOptions(options);
  const candidates = Array.from({ length: options.candidateCount }, (_, candidateIndex) =>
    measureCandidate(options, candidateIndex),
  );
  const maximumSpatialRefinements = Math.max(
    0,
    ...candidates.map(({ spatialRefinements }) => spatialRefinements),
  );
  return {
    candidates,
    summary: {
      diffusionRate: options.diffusionRate,
      attemptedCandidates: candidates.length,
      emptyStarts: countStatus(candidates, 'empty-start'),
      completePaths: countStatus(candidates, 'complete'),
      queryBudgetFailures: countStatus(candidates, 'query-budget'),
      refinementBudgetFailures: countStatus(candidates, 'refinement-budget'),
      numericResolutionFailures: countStatus(candidates, 'numeric-resolution'),
      errorFailures: countStatus(candidates, 'error'),
      trackedWrongLabelPaths: candidates.filter(
        ({ status, trackedCorrectLabel }) => status === 'complete' && !trackedCorrectLabel,
      ).length,
      collisionThenSeparationPaths: candidates.filter(
        ({ collisionThenSeparation }) => collisionThenSeparation,
      ).length,
      joinSplitRejoinPaths: candidates.filter(({ joinSplitRejoin }) => joinSplitRejoin).length,
      completedCollisionThenSeparationPaths: candidates.filter(
        ({ collisionThenSeparation, status }) => collisionThenSeparation && status === 'complete',
      ).length,
      completedJoinSplitRejoinPaths: candidates.filter(
        ({ joinSplitRejoin, status }) => joinSplitRejoin && status === 'complete',
      ).length,
      failedCollisionThenSeparationPaths: candidates.filter(
        ({ collisionThenSeparation, status }) => collisionThenSeparation && status !== 'complete',
      ).length,
      failedJoinSplitRejoinPaths: candidates.filter(
        ({ joinSplitRejoin, status }) => joinSplitRejoin && status !== 'complete',
      ).length,
      asymmetricNarrowingAttempts: candidates.reduce(
        (sum, candidate) => sum + candidate.asymmetricNarrowingAttempts,
        0,
      ),
      maximumSpatialRefinements,
      minimumCellWidth: Math.min(...candidates.map(({ minimumCellWidth }) => minimumCellWidth)),
      minimumTimeStep: Math.min(...candidates.map(({ minimumTimeStep }) => minimumTimeStep)),
      totalModelQueries: candidates.reduce((sum, candidate) => sum + candidate.modelQueries, 0),
    },
  };
}

function measureCandidate(
  options: BrownianReferenceTrackerOptions,
  candidateIndex: number,
): BrownianReferenceTrackerCandidate {
  const model = new BrownianQuotientPopulation(options, candidateIndex);
  const diagnostics = createDiagnostics(options);
  const initialOccupants = queryOccupants(
    model,
    options.sourceCellIndex,
    options.cellWidth,
    0,
    diagnostics,
    options.maxQueries,
  );
  if (initialOccupants.length === 0) {
    return candidateResult(candidateIndex, 0, 'empty-start', '', 0, true, false, false, diagnostics);
  }
  const selectionRandom = createAddressedRandom(
    `${options.seedPrefix ?? 'Brownian reference tracker'}:selection:${candidateIndex}`,
  );
  const rank = Math.floor(uniformUnit(selectionRandom, ['selection']) * initialOccupants.length);
  let state: SingletonState;
  let selectedLabel: number;
  try {
    const selection = isolateRank(
      model,
      rank,
      {
        cellIndex: options.sourceCellIndex,
        cellWidth: options.cellWidth,
        time: 0,
        timeStep: options.timeStep,
      },
      diagnostics,
      options,
    );
    state = selection.state;
    selectedLabel = selection.selectedLabel;
  } catch (error) {
    const classified = classifyError(error);
    return candidateResult(
      candidateIndex,
      initialOccupants.length,
      classified.status,
      classified.detail,
      0,
      false,
      false,
      false,
      diagnostics,
    );
  }
  const collisionPattern = groundTruthCollisionPattern(model, selectedLabel, options);

  let stepsCompleted = 0;
  try {
    for (; stepsCompleted < options.steps; stepsCompleted += 1) {
      state = moveOneStep(model, state, options, diagnostics);
      const singleton = model.occupants(state.cellIndex, state.cellWidth, state.time);
      if (singleton.length !== 1 || singleton[0] !== selectedLabel) {
        return candidateResult(
          candidateIndex,
          initialOccupants.length,
          'complete',
          'Tracker completed with the wrong hidden label',
          stepsCompleted + 1,
          false,
          collisionPattern.collisionThenSeparation,
          collisionPattern.joinSplitRejoin,
          diagnostics,
        );
      }
    }
    return candidateResult(
      candidateIndex,
      initialOccupants.length,
      'complete',
      '',
      stepsCompleted,
      true,
      collisionPattern.collisionThenSeparation,
      collisionPattern.joinSplitRejoin,
      diagnostics,
    );
  } catch (error) {
    const classified = classifyError(error);
    return candidateResult(
      candidateIndex,
      initialOccupants.length,
      classified.status,
      classified.detail,
      stepsCompleted,
      false,
      collisionPattern.collisionThenSeparation,
      collisionPattern.joinSplitRejoin,
      diagnostics,
    );
  }
}

function isolateRank(
  model: BrownianQuotientPopulation,
  initialRank: number,
  initial: SingletonState,
  diagnostics: TrackerDiagnostics,
  options: BrownianReferenceTrackerOptions,
): { readonly selectedLabel: number; readonly state: SingletonState } {
  let state = initial;
  let rank = initialRank;
  let occupants = model.occupants(state.cellIndex, state.cellWidth, state.time);
  while (occupants.length !== 1) {
    takeRefinement(diagnostics, options.maxRefinements);
    assertSpatialResolution(state.cellIndex * state.cellWidth, state.cellWidth);
    takeQuery(diagnostics, options.maxQueries);
    const fineWidth = state.cellWidth / 2;
    const leftIndex = state.cellIndex * 2;
    const left = model.occupants(leftIndex, fineWidth, state.time);
    const right = model.occupants(leftIndex + 1, fineWidth, state.time);
    if (rank < left.length) {
      state = { ...state, cellIndex: leftIndex, cellWidth: fineWidth, timeStep: state.timeStep / 4 };
      occupants = left;
    } else {
      rank -= left.length;
      state = {
        ...state,
        cellIndex: leftIndex + 1,
        cellWidth: fineWidth,
        timeStep: state.timeStep / 4,
      };
      occupants = right;
    }
    observeState(diagnostics, state);
  }
  if (rank !== 0 || occupants[0] === undefined) {
    throw new Error('Reference selection rank is inconsistent with refined populations');
  }
  return { state, selectedLabel: occupants[0] };
}

function moveOneStep(
  model: BrownianQuotientPopulation,
  initial: SingletonState,
  options: BrownianReferenceTrackerOptions,
  diagnostics: TrackerDiagnostics,
): SingletonState {
  const queryStart = diagnostics.modelQueries;
  const refinementStart = diagnostics.spatialRefinements;
  const targetTime = initial.time + options.timeStep;
  let state = initial;
  while (state.time !== targetTime) {
    if (diagnostics.modelQueries - queryStart >= options.maxQueries) {
      throw new ReferenceBudgetError('query');
    }
    if (diagnostics.spatialRefinements - refinementStart > options.maxRefinements) {
      throw new ReferenceBudgetError('refinement');
    }
    const duration = Math.min(state.timeStep, targetTime - state.time);
    assertTemporalResolution(state.time, duration);
    takeQuery(diagnostics, queryStart + options.maxQueries);
    diagnostics.minimumTimeStep = Math.min(diagnostics.minimumTimeStep, duration);
    const destinationIndex = model.destinationCell(state, duration, state.cellWidth);
    const endpointCount = queryOccupants(
      model,
      destinationIndex,
      state.cellWidth,
      state.time + duration,
      diagnostics,
      queryStart + options.maxQueries,
    ).length;
    if (endpointCount === 1) {
      state = { ...state, cellIndex: destinationIndex, time: state.time + duration };
      state = coarsenSingleton(
        model,
        state,
        options.cellWidth,
        diagnostics,
        queryStart + options.maxQueries,
      );
      continue;
    }

    diagnostics.asymmetricNarrowingAttempts += 1;
    const fineWidth = state.cellWidth / 2;
    assertSpatialResolution(destinationIndex * state.cellWidth, state.cellWidth);
    takeQuery(diagnostics, queryStart + options.maxQueries);
    const fineDestination = model.destinationCell(state, duration, fineWidth);
    const fineEndpointCount = queryOccupants(
      model,
      fineDestination,
      fineWidth,
      state.time + duration,
      diagnostics,
      queryStart + options.maxQueries,
    ).length;
    if (fineEndpointCount === 1) {
      state = {
        cellIndex: fineDestination,
        cellWidth: fineWidth,
        time: state.time + duration,
        timeStep: state.timeStep / 4,
      };
      observeState(diagnostics, state);
      state = coarsenSingleton(
        model,
        state,
        options.cellWidth,
        diagnostics,
        queryStart + options.maxQueries,
      );
      continue;
    }

    takeRefinement(diagnostics, refinementStart + options.maxRefinements);
    takeQuery(diagnostics, queryStart + options.maxQueries);
    state = refineSingletonState(model, state);
    observeState(diagnostics, state);
  }
  return state;
}

function coarsenSingleton(
  model: BrownianQuotientPopulation,
  initial: SingletonState,
  maximumCellWidth: number,
  diagnostics: TrackerDiagnostics,
  queryLimit: number,
): SingletonState {
  let state = initial;
  while (state.cellWidth < maximumCellWidth) {
    const parentWidth = state.cellWidth * 2;
    const parentIndex = Math.floor(state.cellIndex / 2);
    const parentCount = queryOccupants(
      model,
      parentIndex,
      parentWidth,
      state.time,
      diagnostics,
      queryLimit,
    ).length;
    if (parentCount !== 1) break;
    state = {
      cellIndex: parentIndex,
      cellWidth: parentWidth,
      time: state.time,
      timeStep: state.timeStep * 4,
    };
  }
  return state;
}

function refineSingletonState(
  model: BrownianQuotientPopulation,
  state: SingletonState,
): SingletonState {
  const cellWidth = state.cellWidth / 2;
  const leftIndex = state.cellIndex * 2;
  const leftCount = model.occupants(leftIndex, cellWidth, state.time).length;
  const rightCount = model.occupants(leftIndex + 1, cellWidth, state.time).length;
  if (leftCount + rightCount !== 1) {
    throw new Error('Reference singleton does not have exactly one singleton child');
  }
  return {
    cellIndex: leftCount === 1 ? leftIndex : leftIndex + 1,
    cellWidth,
    time: state.time,
    timeStep: state.timeStep / 4,
  };
}

function groundTruthCollisionPattern(
  model: BrownianQuotientPopulation,
  selectedLabel: number,
  options: BrownianReferenceTrackerOptions,
): { readonly collisionThenSeparation: boolean; readonly joinSplitRejoin: boolean } {
  const pattern = Array.from({ length: options.steps + 1 }, (_, step) => {
    const time = step * options.timeStep;
    const cellIndex = Math.floor(model.positionAt(selectedLabel, time) / options.cellWidth);
    return model.occupants(cellIndex, options.cellWidth, time).length > 1;
  });
  return {
    collisionThenSeparation: containsPattern(pattern, [true, false]),
    joinSplitRejoin: containsPattern(pattern, [true, false, true]),
  };
}

function queryOccupants(
  model: BrownianQuotientPopulation,
  cellIndex: number,
  cellWidth: number,
  time: number,
  diagnostics: TrackerDiagnostics,
  queryLimit: number,
): readonly number[] {
  takeQuery(diagnostics, queryLimit);
  diagnostics.minimumCellWidth = Math.min(diagnostics.minimumCellWidth, cellWidth);
  return model.occupants(cellIndex, cellWidth, time);
}

function takeQuery(diagnostics: TrackerDiagnostics, limit: number): void {
  if (diagnostics.modelQueries >= limit) throw new ReferenceBudgetError('query');
  diagnostics.modelQueries += 1;
}

function takeRefinement(diagnostics: TrackerDiagnostics, limit: number): void {
  if (diagnostics.spatialRefinements >= limit) throw new ReferenceBudgetError('refinement');
  diagnostics.spatialRefinements += 1;
}

function observeState(diagnostics: TrackerDiagnostics, state: SingletonState): void {
  diagnostics.minimumCellWidth = Math.min(diagnostics.minimumCellWidth, state.cellWidth);
  diagnostics.minimumTimeStep = Math.min(diagnostics.minimumTimeStep, state.timeStep);
}

function createDiagnostics(options: BrownianReferenceTrackerOptions): TrackerDiagnostics {
  return {
    asymmetricNarrowingAttempts: 0,
    minimumCellWidth: options.cellWidth,
    minimumTimeStep: options.timeStep,
    modelQueries: 0,
    spatialRefinements: 0,
  };
}

function candidateResult(
  candidateIndex: number,
  initialPopulation: number,
  status: BrownianReferenceTrackerStatus,
  outcomeDetail: string,
  stepsCompleted: number,
  trackedCorrectLabel: boolean,
  collisionThenSeparation: boolean,
  joinSplitRejoin: boolean,
  diagnostics: TrackerDiagnostics,
): BrownianReferenceTrackerCandidate {
  return {
    candidateIndex,
    initialPopulation,
    status,
    outcomeDetail,
    stepsCompleted,
    trackedCorrectLabel,
    collisionThenSeparation,
    joinSplitRejoin,
    ...diagnostics,
  };
}

function classifyError(error: unknown): {
  readonly detail: string;
  readonly status: BrownianReferenceTrackerStatus;
} {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ReferenceBudgetError) {
    return { status: error.budget === 'query' ? 'query-budget' : 'refinement-budget', detail };
  }
  if (error instanceof ReferenceResolutionError) return { status: 'numeric-resolution', detail };
  return { status: 'error', detail };
}

function countStatus(
  candidates: readonly BrownianReferenceTrackerCandidate[],
  status: BrownianReferenceTrackerStatus,
): number {
  return candidates.filter((candidate) => candidate.status === status).length;
}

function containsPattern(values: readonly boolean[], pattern: readonly boolean[]): boolean {
  let matched = 0;
  for (const value of values) {
    if (value === pattern[matched]) matched += 1;
    if (matched === pattern.length) return true;
  }
  return false;
}

function sampleNormal(
  random: AddressedRandom,
  address: readonly (string | number)[],
  standardDeviation: number,
): number {
  if (standardDeviation === 0) return 0;
  const quantile = Math.max(uniformUnit(random, address), Number.EPSILON / 2);
  return standardDeviation * normalQuantile(quantile, 0, 1);
}

function assertSpatialResolution(min: number, width: number): void {
  const max = min + width;
  const midpoint = min + width / 2;
  const margin = 2 * Number.EPSILON * Math.max(Math.abs(min), Math.abs(max));
  if (width <= margin || midpoint === min || midpoint === max) {
    throw new ReferenceResolutionError('spatial');
  }
}

function assertTemporalResolution(time: number, duration: number): void {
  const next = time + duration;
  const margin = 2 * Number.EPSILON * Math.abs(time);
  if (duration <= margin || next === time || next - time !== duration) {
    throw new ReferenceResolutionError('temporal');
  }
}

function euclideanModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function validateOptions(options: BrownianReferenceTrackerOptions): void {
  for (const [name, value, minimum] of [
    ['candidate count', options.candidateCount, 1],
    ['ring cell count', options.ringCellCount, 1],
    ['steps', options.steps, 1],
    ['query budget', options.maxQueries, 1],
    ['refinement budget', options.maxRefinements, 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new RangeError(`Brownian reference tracker ${name} is invalid`);
    }
  }
  for (const [name, value, positive] of [
    ['cell width', options.cellWidth, true],
    ['time step', options.timeStep, true],
    ['population density', options.populationDensity, false],
    ['diffusion rate', options.diffusionRate, false],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
      throw new RangeError(`Brownian reference tracker ${name} is outside its domain`);
    }
  }
  if (!Number.isSafeInteger(options.sourceCellIndex)) {
    throw new RangeError('Brownian reference tracker source index must be a safe integer');
  }
}
