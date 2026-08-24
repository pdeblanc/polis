import { birdsScale } from '../models/birds/scales';
import {
  screenBrownianTrajectoryCohort,
  type BrownianTrajectoryCohort,
} from './brownianTrajectoryMeasurements';
import {
  summarizeBirdsTrajectoryPaths,
  type BirdsTrajectoryMoments,
} from './birdsTrajectoryMeasurements';

export interface BrownianBalancedTrajectoryOptions {
  readonly candidatesPerPhase: number;
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly pathsPerPhase: number;
  readonly populationDensity: number;
  readonly ringCellCount: number;
  readonly seedPrefix?: string;
  readonly steps: number;
}

export interface BrownianBalancedTrajectorySummary extends BirdsTrajectoryMoments {
  readonly attemptedCandidates: number;
  readonly balancedPaths: number;
  readonly collisionRejectedPaths: number;
  readonly collisionThenSeparationPaths: number;
  readonly diffusionRate: number;
  readonly emptyStarts: number;
  readonly joinSplitRejoinPaths: number;
  readonly phaseBalanceComplete: boolean;
  readonly phasesFilled: number;
  readonly totalPhases: number;
}

export interface BrownianBalancedTrajectoryPhase {
  readonly attemptedCandidates: number;
  readonly collisionFreeEligiblePaths: number;
  readonly collisionRejectedPaths: number;
  readonly collisionThenSeparationPaths: number;
  readonly emptyStarts: number;
  readonly joinSplitRejoinPaths: number;
  readonly retainedCandidateIndices: string;
  readonly retainedPaths: number;
  readonly spatialIndex: number;
  readonly timeIndex: number;
}

export interface BrownianBalancedTrajectoryMeasurement {
  readonly phases: readonly BrownianBalancedTrajectoryPhase[];
  readonly summaries: readonly BrownianBalancedTrajectorySummary[];
}

export function measureBrownianBalancedTrajectories(
  options: BrownianBalancedTrajectoryOptions,
): BrownianBalancedTrajectoryMeasurement {
  const scale = birdsScale(options.epoch);
  if (scale === undefined) throw new RangeError('Brownian comparison epoch unavailable');
  if (options.epoch > 12) throw new RangeError('Brownian comparison phase grid is too large');
  const cohorts: Array<{
    readonly cohort: BrownianTrajectoryCohort;
    readonly spatialIndex: number;
    readonly timeIndex: number;
  }> = [];

  for (let timeIndex = 1; timeIndex <= 4; timeIndex += 1) {
    for (let spatialIndex = 0; spatialIndex < 2 ** options.epoch; spatialIndex += 1) {
      cohorts.push({
        spatialIndex,
        timeIndex,
        cohort: screenBrownianTrajectoryCohort({
          candidateCount: options.candidatesPerPhase,
          cellWidth: scale.cellLength,
          diffusionRate: options.diffusionRate,
          populationDensity: options.populationDensity,
          retainedCollisionFreePaths: options.pathsPerPhase,
          ringCellCount: options.ringCellCount,
          seedPrefix:
            `${options.seedPrefix ?? 'Brownian balanced trajectories'}:` +
            `x${spatialIndex}:t${timeIndex}`,
          sourceSpatialIndex: spatialIndex,
          steps: options.steps,
          stopWhenRetentionFilled: true,
          timeStep: scale.nextFlowDuration,
        }),
      });
    }
  }

  const phases = cohorts.map(({ cohort, spatialIndex, timeIndex }) => ({
    spatialIndex,
    timeIndex,
    attemptedCandidates: cohort.attemptedCandidates,
    emptyStarts: cohort.emptyStarts,
    collisionFreeEligiblePaths: cohort.collisionFreeEligiblePaths,
    collisionRejectedPaths: cohort.collisionRejectedPaths,
    collisionThenSeparationPaths: cohort.collisionThenSeparationPaths,
    joinSplitRejoinPaths: cohort.joinSplitRejoinPaths,
    retainedPaths: cohort.paths.length,
    retainedCandidateIndices: cohort.retainedCandidateIndices.join(','),
  }));
  const paths = cohorts.flatMap(({ cohort }) => cohort.paths);
  const totalPhases = phases.length;
  const phasesFilled = phases.filter(({ retainedPaths }) => retainedPaths === options.pathsPerPhase).length;
  const totals = phases.reduce(
    (result, phase) => ({
      attemptedCandidates: result.attemptedCandidates + phase.attemptedCandidates,
      collisionRejectedPaths: result.collisionRejectedPaths + phase.collisionRejectedPaths,
      collisionThenSeparationPaths:
        result.collisionThenSeparationPaths + phase.collisionThenSeparationPaths,
      joinSplitRejoinPaths: result.joinSplitRejoinPaths + phase.joinSplitRejoinPaths,
      emptyStarts: result.emptyStarts + phase.emptyStarts,
    }),
    {
      attemptedCandidates: 0,
      collisionRejectedPaths: 0,
      collisionThenSeparationPaths: 0,
      joinSplitRejoinPaths: 0,
      emptyStarts: 0,
    },
  );
  const summaries = summarizeBirdsTrajectoryPaths(
    paths,
    scale.cellLength,
    scale.nextFlowDuration,
    options.diffusionRate,
    options.steps,
  ).map((moments) => ({
    diffusionRate: options.diffusionRate,
    balancedPaths: paths.length,
    totalPhases,
    phasesFilled,
    phaseBalanceComplete: phasesFilled === totalPhases,
    ...totals,
    ...moments,
  }));

  return { phases, summaries };
}
