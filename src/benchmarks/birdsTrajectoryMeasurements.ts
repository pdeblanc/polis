import {
  createSightingDiagnostics,
  Sighting,
  SightingBudgetExceededError,
  SightingResolutionLimitError,
} from '../helpers/birdsSighting';
import { Birds } from '../models/birds/birds';
import { birdsScale } from '../models/birds/scales';
import { brownianBinnedDisplacementMoments } from '../utils/math/brownian';

export interface BirdsTrajectoryOptions {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly maximumCandidates: number;
  readonly populationDensity: number;
  readonly retainedCollisionFreePaths: number;
  readonly seedPrefix?: string;
  readonly sourceSpatialIndex: number;
  readonly sourceTimeIndex: number;
  readonly steps: number;
}

export interface BirdsTrajectoryMeasurement {
  readonly attemptedCandidates: number;
  readonly brownianOneStepSecondMoment: number;
  readonly collisionFreePaths: number;
  readonly collisionFreeEligiblePaths: number;
  readonly collisionRejectedCompletedPaths: number;
  readonly completedPaths: number;
  readonly diffusionRate: number;
  readonly emptyStarts: number;
  readonly errorFailures: number;
  readonly horizon: number;
  readonly meanDisplacement: number;
  readonly meanIncrement: number;
  readonly meanSquaredDisplacement: number;
  readonly numericFailures: number;
  readonly queryBudgetFailures: number;
  readonly refinementBudgetFailures: number;
  readonly retentionOverflowPaths: number;
  readonly referenceMeanSquaredDisplacement: number;
  readonly retainedDisplacements: number;
  readonly retainedIncrements: number;
  readonly retainedCandidateIndices: string;
  readonly oneStepIncrementVariance: number;
  readonly lagOneIncrementCovariance: number;
}

type FailureKind = 'numeric' | 'query-budget' | 'refinement-budget' | 'error';

export function measureBirdsTrajectories(
  options: BirdsTrajectoryOptions,
): readonly BirdsTrajectoryMeasurement[] {
  validateOptions(options);
  const scale = birdsScale(options.epoch)!;
  const min = options.sourceSpatialIndex * scale.cellLength;
  const initialCell = {
    min,
    max: min + scale.cellLength,
    time: options.sourceTimeIndex * scale.nextFlowDuration,
  };
  const collisionFreePaths: number[][] = [];
  const retainedCandidateIndices: number[] = [];
  let emptyStarts = 0;
  let completedPaths = 0;
  let collisionFreeEligiblePaths = 0;
  let collisionRejectedCompletedPaths = 0;
  let retentionOverflowPaths = 0;
  const failures: Record<FailureKind, number> = {
    numeric: 0,
    'query-budget': 0,
    'refinement-budget': 0,
    error: 0,
  };

  for (let candidate = 0; candidate < options.maximumCandidates; candidate += 1) {
    const birds = new Birds(
      `${options.seedPrefix ?? 'Birds trajectories'}:model:${candidate}`,
      options.populationDensity,
      options.diffusionRate,
    );
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: scale.cellLength,
      targetTimeStep: scale.nextFlowDuration,
    });
    if (resolution === undefined) throw new Error('Trajectory resolution unavailable');
    const startCount = birds.queryPopulationCell({ cell: initialCell, resolution }).count;
    if (startCount === 0) {
      emptyStarts += 1;
      continue;
    }

    const diagnostics = createSightingDiagnostics();
    try {
      let sighting = Sighting.select(
        {
          birds,
          cell: initialCell,
          resolution,
          seed: `${options.seedPrefix ?? 'Birds trajectories'}:selection:${candidate}`,
        },
        { diagnostics },
      );
      const centers = [cellCenter(sighting.cell) / scale.cellLength];
      let remainedCollisionFree = startCount === 1;
      for (let step = 0; step < options.steps; step += 1) {
        const beforeNarrowing = diagnostics.asymmetricNarrowingAttempts;
        sighting = sighting.next({ diagnostics });
        const waypointCount = birds.queryPopulationCell({
          cell: sighting.cell,
          resolution: sighting.resolution,
        }).count;
        remainedCollisionFree &&=
          waypointCount === 1 &&
          diagnostics.asymmetricNarrowingAttempts === beforeNarrowing;
        centers.push(cellCenter(sighting.cell) / scale.cellLength);
      }
      completedPaths += 1;
      if (remainedCollisionFree) {
        collisionFreeEligiblePaths += 1;
        if (collisionFreePaths.length < options.retainedCollisionFreePaths) {
          collisionFreePaths.push(centers);
          retainedCandidateIndices.push(candidate);
        } else {
          retentionOverflowPaths += 1;
        }
      } else {
        collisionRejectedCompletedPaths += 1;
      }
    } catch (error) {
      failures[classifyFailure(error)] += 1;
    }
  }

  const increments = collisionFreePaths.flatMap((path) =>
    path.slice(1).map((position, index) => position - path[index]),
  );
  const meanIncrement = mean(increments);
  const oneStepIncrementVariance = mean(
    increments.map((increment) => (increment - meanIncrement) ** 2),
  );
  const lagProducts = collisionFreePaths.flatMap((path) => {
    const pathIncrements = path.slice(1).map((position, index) => position - path[index]);
    return pathIncrements.slice(1).map(
      (increment, index) =>
        (pathIncrements[index] - meanIncrement) * (increment - meanIncrement),
    );
  });
  const lagOneIncrementCovariance = mean(lagProducts);
  const brownianOneStepSecondMoment =
    brownianBinnedDisplacementMoments(
      scale.cellLength,
      scale.nextFlowDuration,
      options.diffusionRate,
    ).secondMoment / scale.cellLength ** 2;
  const horizons = [1, 2, 4, 8].filter((horizon) => horizon <= options.steps);

  return horizons.map((horizon) => {
    const displacements = collisionFreePaths.flatMap((path) =>
      path.slice(horizon).map((position, index) => position - path[index]),
    );
    return {
      diffusionRate: options.diffusionRate,
      horizon,
      attemptedCandidates: options.maximumCandidates,
      emptyStarts,
      completedPaths,
      collisionFreePaths: collisionFreePaths.length,
      collisionFreeEligiblePaths,
      collisionRejectedCompletedPaths,
      retentionOverflowPaths,
      queryBudgetFailures: failures['query-budget'],
      refinementBudgetFailures: failures['refinement-budget'],
      numericFailures: failures.numeric,
      errorFailures: failures.error,
      retainedIncrements: increments.length,
      retainedDisplacements: displacements.length,
      retainedCandidateIndices: retainedCandidateIndices.join(','),
      meanIncrement,
      oneStepIncrementVariance,
      lagOneIncrementCovariance,
      brownianOneStepSecondMoment,
      meanDisplacement: mean(displacements),
      meanSquaredDisplacement: mean(displacements.map((value) => value ** 2)),
      referenceMeanSquaredDisplacement: horizon * brownianOneStepSecondMoment,
    };
  });
}

function classifyFailure(error: unknown): FailureKind {
  if (error instanceof SightingBudgetExceededError) {
    return error.budget === 'query' ? 'query-budget' : 'refinement-budget';
  }
  if (error instanceof SightingResolutionLimitError) return 'numeric';
  return 'error';
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? Number.NaN
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function cellCenter(cell: { readonly min: number; readonly max: number }): number {
  return (cell.min + cell.max) / 2;
}

function validateOptions(options: BirdsTrajectoryOptions): void {
  if (birdsScale(options.epoch) === undefined) throw new RangeError('Trajectory epoch unavailable');
  for (const [name, value, minimum] of [
    ['maximum candidates', options.maximumCandidates, 1],
    ['retained paths', options.retainedCollisionFreePaths, 1],
    ['steps', options.steps, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new RangeError(`Trajectory ${name} must be a positive safe integer`);
    }
  }
  if (!Number.isFinite(options.populationDensity) || options.populationDensity < 0) {
    throw new RangeError('Trajectory population density must be finite and nonnegative');
  }
  if (!Number.isFinite(options.diffusionRate) || options.diffusionRate < 0) {
    throw new RangeError('Trajectory diffusion rate must be finite and nonnegative');
  }
  if (!Number.isSafeInteger(options.sourceSpatialIndex) || !Number.isSafeInteger(options.sourceTimeIndex)) {
    throw new RangeError('Trajectory source indices must be safe integers');
  }
}
