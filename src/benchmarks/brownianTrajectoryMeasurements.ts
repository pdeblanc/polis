import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { uniform, uniformUnit } from '../utils/distributions/uniform';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import {
  summarizeBirdsTrajectoryPaths,
  type BirdsTrajectoryMoments,
} from './birdsTrajectoryMeasurements';

export interface BrownianTrajectoryOptions {
  readonly candidateCount: number;
  readonly cellWidth: number;
  readonly diffusionRate: number;
  readonly populationDensity: number;
  readonly retainedCollisionFreePaths: number;
  readonly ringCellCount: number;
  readonly seedPrefix?: string;
  readonly sourceSpatialIndex: number;
  readonly steps: number;
  readonly stopWhenRetentionFilled?: boolean;
  readonly timeStep: number;
}

export interface BrownianTrajectoryCohort {
  readonly attemptedCandidates: number;
  readonly collisionFreeEligiblePaths: number;
  readonly collisionRejectedPaths: number;
  readonly collisionThenSeparationPaths: number;
  readonly emptyStarts: number;
  readonly joinSplitRejoinPaths: number;
  readonly paths: readonly (readonly number[])[];
  readonly retainedCandidateIndices: readonly number[];
  readonly retentionOverflowPaths: number;
}

export interface BrownianTrajectoryMeasurement extends BirdsTrajectoryMoments {
  readonly attemptedCandidates: number;
  readonly collisionFreePaths: number;
  readonly collisionFreeEligiblePaths: number;
  readonly collisionRejectedPaths: number;
  readonly collisionThenSeparationPaths: number;
  readonly diffusionRate: number;
  readonly emptyStarts: number;
  readonly joinSplitRejoinPaths: number;
  readonly retainedCandidateIndices: string;
  readonly retentionOverflowPaths: number;
}

/**
 * Screens labeled Brownian trajectories using only anonymous population counts at the
 * requested observation resolution. Labels are retained solely to establish ground truth.
 */
export function screenBrownianTrajectoryCohort(
  options: BrownianTrajectoryOptions,
): BrownianTrajectoryCohort {
  validateOptions(options);
  const ringWidth = options.ringCellCount * options.cellWidth;
  const sourceCell = euclideanModulo(options.sourceSpatialIndex, options.ringCellCount);
  const paths: number[][] = [];
  const retainedCandidateIndices: number[] = [];
  let attemptedCandidates = 0;
  let emptyStarts = 0;
  let collisionFreeEligiblePaths = 0;
  let collisionRejectedPaths = 0;
  let collisionThenSeparationPaths = 0;
  let joinSplitRejoinPaths = 0;
  let retentionOverflowPaths = 0;

  for (let candidate = 0; candidate < options.candidateCount; candidate += 1) {
    attemptedCandidates += 1;
    const random = createAddressedRandom(
      `${options.seedPrefix ?? 'Brownian trajectories'}:${candidate}`,
    );
    const population = poissonQuantile(
      uniformUnit(random, ['population']),
      options.populationDensity * ringWidth,
    );
    const positions = Array.from({ length: population }, (_, bird) =>
      uniform(random, ['position', bird], 0, ringWidth),
    );
    const occupants = positions
      .map((position, bird) => ({ bird, cell: cellIndex(position, options.cellWidth) }))
      .filter(({ cell }) => cell === sourceCell);
    if (occupants.length === 0) {
      emptyStarts += 1;
      continue;
    }

    const selected = occupants[
      Math.floor(uniformUnit(random, ['selection']) * occupants.length)
    ].bird;
    const selectedInitialCell = cellIndex(positions[selected], options.cellWidth);
    const lift = options.sourceSpatialIndex - selectedInitialCell;
    const path = [selectedInitialCell + lift + 0.5];
    const collided = [occupants.length > 1];
    const incrementStandardDeviation = Math.sqrt(options.diffusionRate * options.timeStep);

    for (let step = 0; step < options.steps; step += 1) {
      for (let bird = 0; bird < positions.length; bird += 1) {
        positions[bird] += brownianIncrement(
          uniformUnit(random, ['increment', step, bird]),
          incrementStandardDeviation,
        );
      }
      const selectedCell = cellIndex(positions[selected], options.cellWidth);
      path.push(selectedCell + lift + 0.5);
      const wrappedSelectedCell = euclideanModulo(selectedCell, options.ringCellCount);
      const occupancy = positions.reduce(
        (count, position) =>
          count +
          Number(
            euclideanModulo(cellIndex(position, options.cellWidth), options.ringCellCount) ===
              wrappedSelectedCell,
          ),
        0,
      );
      collided.push(occupancy > 1);
    }

    if (collided.every((value) => !value)) {
      collisionFreeEligiblePaths += 1;
      if (paths.length < options.retainedCollisionFreePaths) {
        paths.push(path);
        retainedCandidateIndices.push(candidate);
        if (options.stopWhenRetentionFilled && paths.length === options.retainedCollisionFreePaths) {
          break;
        }
      } else {
        retentionOverflowPaths += 1;
      }
    } else {
      collisionRejectedPaths += 1;
      if (containsPattern(collided, [true, false])) collisionThenSeparationPaths += 1;
      if (containsPattern(collided, [true, false, true])) joinSplitRejoinPaths += 1;
    }
  }

  return {
    attemptedCandidates,
    paths,
    retainedCandidateIndices,
    emptyStarts,
    collisionFreeEligiblePaths,
    collisionRejectedPaths,
    collisionThenSeparationPaths,
    joinSplitRejoinPaths,
    retentionOverflowPaths,
  };
}

export function measureBrownianTrajectories(
  options: BrownianTrajectoryOptions,
): readonly BrownianTrajectoryMeasurement[] {
  const cohort = screenBrownianTrajectoryCohort(options);
  return summarizeBirdsTrajectoryPaths(
    cohort.paths,
    options.cellWidth,
    options.timeStep,
    options.diffusionRate,
    options.steps,
  ).map((moments) => ({
    diffusionRate: options.diffusionRate,
    attemptedCandidates: cohort.attemptedCandidates,
    emptyStarts: cohort.emptyStarts,
    collisionFreePaths: cohort.paths.length,
    collisionFreeEligiblePaths: cohort.collisionFreeEligiblePaths,
    collisionRejectedPaths: cohort.collisionRejectedPaths,
    collisionThenSeparationPaths: cohort.collisionThenSeparationPaths,
    joinSplitRejoinPaths: cohort.joinSplitRejoinPaths,
    retentionOverflowPaths: cohort.retentionOverflowPaths,
    retainedCandidateIndices: cohort.retainedCandidateIndices.join(','),
    ...moments,
  }));
}

function containsPattern(values: readonly boolean[], pattern: readonly boolean[]): boolean {
  let matched = 0;
  for (const value of values) {
    if (value === pattern[matched]) matched += 1;
    if (matched === pattern.length) return true;
  }
  return false;
}

function brownianIncrement(quantile: number, standardDeviation: number): number {
  if (standardDeviation === 0) return 0;
  // The addressed uniform can equal zero but never one. Replacing that single endpoint
  // by half a binary64 ulp avoids an infinite reference displacement without imposing
  // the model sampler's six-sigma clamp.
  return standardDeviation * normalQuantile(Math.max(quantile, Number.EPSILON / 2), 0, 1);
}

function cellIndex(position: number, cellWidth: number): number {
  return Math.floor(position / cellWidth);
}

function euclideanModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function validateOptions(options: BrownianTrajectoryOptions): void {
  for (const [name, value] of [
    ['candidate count', options.candidateCount],
    ['retained paths', options.retainedCollisionFreePaths],
    ['ring cell count', options.ringCellCount],
    ['steps', options.steps],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Brownian trajectory ${name} must be a positive safe integer`);
    }
  }
  for (const [name, value, allowZero] of [
    ['cell width', options.cellWidth, false],
    ['time step', options.timeStep, false],
    ['population density', options.populationDensity, true],
    ['diffusion rate', options.diffusionRate, true],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
      throw new RangeError(`Brownian trajectory ${name} is outside its domain`);
    }
  }
  if (!Number.isSafeInteger(options.sourceSpatialIndex)) {
    throw new RangeError('Brownian trajectory source index must be a safe integer');
  }
}
