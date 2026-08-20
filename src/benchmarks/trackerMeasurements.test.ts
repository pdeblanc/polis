import { describe, expect, it } from 'vitest';
import { measureTracker, TRACKER_BENCHMARK_CASES } from './trackerMeasurements';

describe('tracker measurements', () => {
  it('reports tracker and cumulative engine work', () => {
    const measurement = measureTracker({
      ...TRACKER_BENCHMARK_CASES[0],
      steps: 1,
    });

    expect(measurement.status).toBe('complete');
    expect(measurement.stepsCompleted).toBe(1);
    expect(measurement.modelQueries).toBeGreaterThan(0);
    expect(measurement.recursiveCalls).toBeGreaterThan(0);
    expect(measurement.minimumCellWidth).toBeGreaterThan(0);
    expect(measurement.minimumFlowDuration).toBeGreaterThan(0);
  });
});
