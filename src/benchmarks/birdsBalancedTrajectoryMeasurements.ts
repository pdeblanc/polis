import { birdsScale } from '../models/birds/scales';
import {
  screenBirdsTrajectoryCohort,
  summarizeBirdsTrajectoryPaths,
  type BirdsTrajectoryMoments,
  type ScreenedBirdsTrajectoryCohort,
} from './birdsTrajectoryMeasurements';

export interface BirdsBalancedTrajectoryOptions {
  readonly candidatesPerPhase: number;
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly pathsPerPhase: number;
  readonly populationDensity: number;
  readonly seedPrefix?: string;
  readonly steps: number;
}

export interface BirdsBalancedTrajectoryPhase {
  readonly attemptedCandidates: number;
  readonly collisionFreeEligiblePaths: number;
  readonly collisionRejectedCompletedPaths: number;
  readonly completedPaths: number;
  readonly emptyStarts: number;
  readonly errorFailures: number;
  readonly meanIncrement: number;
  readonly numericFailures: number;
  readonly queryBudgetFailures: number;
  readonly refinementBudgetFailures: number;
  readonly retainedCandidateIndices: string;
  readonly retainedPaths: number;
  readonly spatialIndex: number;
  readonly timeIndex: number;
}

export interface BirdsBalancedTrajectorySummary extends BirdsTrajectoryMoments {
  readonly attemptedCandidates: number;
  readonly balancedPaths: number;
  readonly diffusionRate: number;
  readonly maximumPhaseMeanIncrement: number;
  readonly minimumPhaseMeanIncrement: number;
  readonly phaseBalanceComplete: boolean;
  readonly phasesFilled: number;
  readonly rmsPhaseMeanIncrement: number;
  readonly totalPhases: number;
}

export interface BirdsBalancedTrajectoryMeasurement {
  readonly phases: readonly BirdsBalancedTrajectoryPhase[];
  readonly summaries: readonly BirdsBalancedTrajectorySummary[];
}

export function measureBirdsBalancedTrajectories(
  options: BirdsBalancedTrajectoryOptions,
): BirdsBalancedTrajectoryMeasurement {
  validateOptions(options);
  const scale = birdsScale(options.epoch)!;
  const spatialPhases = 2 ** options.epoch;
  const cohorts: Array<{
    readonly cohort: ScreenedBirdsTrajectoryCohort;
    readonly spatialIndex: number;
    readonly timeIndex: number;
  }> = [];

  for (let timeIndex = 1; timeIndex <= 4; timeIndex += 1) {
    for (let spatialIndex = 0; spatialIndex < spatialPhases; spatialIndex += 1) {
      cohorts.push({
        spatialIndex,
        timeIndex,
        cohort: screenBirdsTrajectoryCohort({
          epoch: options.epoch,
          maximumCandidates: options.candidatesPerPhase,
          retainedCollisionFreePaths: options.pathsPerPhase,
          stopWhenRetentionFilled: true,
          steps: options.steps,
          populationDensity: options.populationDensity,
          diffusionRate: options.diffusionRate,
          sourceSpatialIndex: spatialIndex,
          sourceTimeIndex: timeIndex,
          seedPrefix:
            `${options.seedPrefix ?? 'Birds balanced trajectories'}:` +
            `x${spatialIndex}:t${timeIndex}`,
        }),
      });
    }
  }

  const phases = cohorts.map(({ cohort, spatialIndex, timeIndex }) => {
    const moments = summarizeBirdsTrajectoryPaths(
      cohort.paths,
      scale.cellLength,
      scale.nextFlowDuration,
      options.diffusionRate,
      options.steps,
    )[0];
    return {
      spatialIndex,
      timeIndex,
      attemptedCandidates: cohort.attemptedCandidates,
      emptyStarts: cohort.emptyStarts,
      completedPaths: cohort.completedPaths,
      collisionFreeEligiblePaths: cohort.collisionFreeEligiblePaths,
      collisionRejectedCompletedPaths: cohort.collisionRejectedCompletedPaths,
      queryBudgetFailures: cohort.queryBudgetFailures,
      refinementBudgetFailures: cohort.refinementBudgetFailures,
      numericFailures: cohort.numericFailures,
      errorFailures: cohort.errorFailures,
      retainedPaths: cohort.paths.length,
      retainedCandidateIndices: cohort.retainedCandidateIndices.join(','),
      meanIncrement: moments?.meanIncrement ?? Number.NaN,
    };
  });
  const paths = cohorts.flatMap(({ cohort }) => cohort.paths);
  const phaseMeans = phases.map(({ meanIncrement }) => meanIncrement).filter(Number.isFinite);
  const phasesFilled = phases.filter(({ retainedPaths }) => retainedPaths === options.pathsPerPhase).length;
  const totalPhases = phases.length;
  const attemptedCandidates = phases.reduce((sum, phase) => sum + phase.attemptedCandidates, 0);
  const rmsPhaseMeanIncrement = Math.sqrt(
    phaseMeans.reduce((sum, value) => sum + value ** 2, 0) / phaseMeans.length,
  );
  const summaries = summarizeBirdsTrajectoryPaths(
    paths,
    scale.cellLength,
    scale.nextFlowDuration,
    options.diffusionRate,
    options.steps,
  ).map((moments) => ({
    diffusionRate: options.diffusionRate,
    attemptedCandidates,
    balancedPaths: paths.length,
    totalPhases,
    phasesFilled,
    phaseBalanceComplete: phasesFilled === totalPhases,
    minimumPhaseMeanIncrement: Math.min(...phaseMeans),
    maximumPhaseMeanIncrement: Math.max(...phaseMeans),
    rmsPhaseMeanIncrement,
    ...moments,
  }));

  return { phases, summaries };
}

function validateOptions(options: BirdsBalancedTrajectoryOptions): void {
  if (birdsScale(options.epoch) === undefined) throw new RangeError('Balanced epoch unavailable');
  if (options.epoch > 12) throw new RangeError('Balanced trajectory phase grid is too large');
  for (const value of [options.candidatesPerPhase, options.pathsPerPhase, options.steps]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError('Balanced trajectory counts must be positive safe integers');
    }
  }
}
