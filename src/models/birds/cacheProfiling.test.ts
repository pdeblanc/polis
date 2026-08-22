import { describe, expect, it } from 'vitest';
import { BirdsEngine } from './birdsEngine';
import { BirdsCacheProfiler } from './cacheProfiling';

describe('Birds cache profiling', () => {
  it('records key, hit, miss, and insertion work by cache family', () => {
    const cacheProfiler = new BirdsCacheProfiler();
    const engine = new BirdsEngine('cache profile', 2, 0.5, { cacheProfiler });
    const cell = { min: 0, max: 16, time: 0 };

    engine.queryCell(cell);
    engine.queryCell(cell);

    expect(cacheProfiler.snapshot().get('cell')).toMatchObject({
      getHits: 1,
      getMisses: 1,
      keys: 2,
      sets: 1,
    });
  });
});
