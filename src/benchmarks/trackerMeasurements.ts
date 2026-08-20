import {
  createSightingDiagnostics,
  Sighting,
  SightingBudgetExceededError,
} from '../helpers/birdsSighting';
import { Birds, type BirdsPopulationResolution } from '../models/birds/birds';
import type { BirdsEngineStats } from '../models/birds/birdsEngine';

export interface TrackerBenchmarkCase {
  readonly cell: { readonly min: number; readonly max: number; readonly time: number };
  readonly diffusionRate: number;
  readonly maxQueries: number;
  readonly maxRefinements: number;
  readonly name: string;
  readonly populationDensity: number;
  readonly seed: string;
  readonly selectionSeed: string;
  readonly steps: number;
  readonly targetCellWidth: number;
  readonly targetTimeStep: number;
}

export interface TrackerMeasurement extends BirdsEngineStats {
  readonly asymmetricNarrowingAttempts: number;
  readonly cacheEntriesAdded: number;
  readonly elapsedMilliseconds: number;
  readonly minimumCellWidth: number;
  readonly minimumFlowDuration: number;
  readonly modelQueries: number;
  readonly name: string;
  readonly outcomeDetail: string;
  readonly recursiveCalls: number;
  readonly spatialRefinements: number;
  readonly status: 'complete' | 'query-budget' | 'refinement-budget' | 'error';
  readonly stepsCompleted: number;
}

export const TRACKER_BENCHMARK_CASES: readonly TrackerBenchmarkCase[] = [
  {
    name: 'sparse-zero-diffusion',
    seed: 'Tracker sparse',
    selectionSeed: 'Tracker sparse sighting',
    populationDensity: 1 / 16,
    diffusionRate: 0,
    cell: { min: 0, max: 16, time: 0 },
    targetCellWidth: 16,
    targetTimeStep: 64,
    steps: 8,
    maxQueries: 10_000,
    maxRefinements: 32,
  },
  {
    name: 'dense-moving',
    seed: 'Tracker dense',
    selectionSeed: 'Tracker dense sighting',
    populationDensity: 0.5,
    diffusionRate: 0.5,
    cell: { min: 0, max: 4, time: 0 },
    targetCellWidth: 4,
    targetTimeStep: 4,
    steps: 2,
    maxQueries: 10_000,
    maxRefinements: 32,
  },
  {
    name: 'known-polis-3-meeting',
    seed: 'Polis 3',
    selectionSeed: 'Polis 3 · sighting',
    populationDensity: 2,
    diffusionRate: 0.5,
    cell: { min: 5.3125, max: 5.375, time: 6.9921875 },
    targetCellWidth: 0.0625,
    targetTimeStep: 0.0009765625,
    steps: 3,
    maxQueries: 10_000,
    maxRefinements: 16,
  },
];

export function measureTracker(testCase: TrackerBenchmarkCase): TrackerMeasurement {
  const birds = new Birds(testCase.seed, testCase.populationDensity, testCase.diffusionRate);
  const resolution = birds.resolvePopulationResolution({
    targetCellWidth: testCase.targetCellWidth,
    targetTimeStep: testCase.targetTimeStep,
  });
  if (resolution === undefined) throw new RangeError('Tracker benchmark resolution is unavailable');
  return measureWithModel(birds, resolution, testCase);
}

function measureWithModel(
  birds: Birds,
  resolution: BirdsPopulationResolution,
  testCase: TrackerBenchmarkCase,
): TrackerMeasurement {
  const diagnostics = createSightingDiagnostics();
  const beforeStats = birds.getTotalQueryStats();
  const beforeCache = birds.getCacheUsage().entries;
  let status: TrackerMeasurement['status'] = 'complete';
  let outcomeDetail = '';
  let stepsCompleted = 0;
  const start = performance.now();
  try {
    let sighting = Sighting.select(
      {
        birds,
        cell: testCase.cell,
        resolution,
        seed: testCase.selectionSeed,
      },
      { diagnostics, maxQueries: testCase.maxQueries, maxRefinements: testCase.maxRefinements },
    );
    for (; stepsCompleted < testCase.steps; stepsCompleted += 1) {
      sighting = sighting.next({
        diagnostics,
        maxQueries: testCase.maxQueries,
        maxRefinements: testCase.maxRefinements,
      });
    }
  } catch (error) {
    status =
      error instanceof SightingBudgetExceededError
        ? error.budget === 'query'
          ? 'query-budget'
          : 'refinement-budget'
        : 'error';
    outcomeDetail = error instanceof Error ? error.message : String(error);
  }
  const elapsedMilliseconds = performance.now() - start;
  const stats = subtractStats(birds.getTotalQueryStats(), beforeStats);
  return {
    name: testCase.name,
    status,
    outcomeDetail,
    stepsCompleted,
    elapsedMilliseconds,
    cacheEntriesAdded: birds.getCacheUsage().entries - beforeCache,
    ...diagnostics,
    ...stats,
    recursiveCalls: recursiveCalls(stats),
  };
}

function subtractStats(after: BirdsEngineStats, before: BirdsEngineStats): BirdsEngineStats {
  return {
    cacheHits: after.cacheHits - before.cacheHits,
    cellsEvaluated: after.cellsEvaluated - before.cellsEvaluated,
    cellSubdivisionsEvaluated:
      after.cellSubdivisionsEvaluated - before.cellSubdivisionsEvaluated,
    incidenceBatchesEvaluated:
      after.incidenceBatchesEvaluated - before.incidenceBatchesEvaluated,
    flowReconciliationsEvaluated:
      after.flowReconciliationsEvaluated - before.flowReconciliationsEvaluated,
    flowsEvaluated: after.flowsEvaluated - before.flowsEvaluated,
    maximumDepth: after.maximumDepth,
    samplerCalls: after.samplerCalls - before.samplerCalls,
    temporalBatchesEvaluated:
      after.temporalBatchesEvaluated - before.temporalBatchesEvaluated,
    twoStageEntriesEvaluated:
      after.twoStageEntriesEvaluated - before.twoStageEntriesEvaluated,
  };
}

function recursiveCalls(stats: BirdsEngineStats): number {
  return (
    stats.cacheHits +
    stats.cellsEvaluated +
    stats.cellSubdivisionsEvaluated +
    stats.incidenceBatchesEvaluated +
    stats.flowReconciliationsEvaluated +
    stats.flowsEvaluated +
    stats.temporalBatchesEvaluated +
    stats.twoStageEntriesEvaluated
  );
}
