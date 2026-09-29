import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsQueryApi } from '../birds/birdsQueryApi';
import { birds2QueryBackend } from '../birds2a/queryBackend';
import { Birds2bEngine, BIRDS_2B_GEOMETRY_ORIGIN } from './birds2bEngine';
import { CompositeEngine } from './compositeEngine';

/** Global model: merge channel boundary facts, then refine their aggregate. */
export class Birds2b extends BirdsQueryApi {
  readonly #engine: Birds2bEngine;

  constructor(seed: Seed, populationDensity: number, diffusionRate: number) {
    const engine = new Birds2bEngine(seed, populationDensity, diffusionRate);
    const composite = new CompositeEngine(seed, diffusionRate, engine);
    super(birds2QueryBackend({
      queryCell: (cell) => composite.queryCell(cell),
      queryFlow: (flow) => composite.queryFlow(flow),
      queryCachedCell: (cell) => composite.queryCachedCell(cell),
      queryCellSubdivision: (cell) => composite.queryCellSubdivision(cell),
      clearCache: () => { composite.clearCache(); engine.clearCache(); },
      getCacheUsage: () => {
        const a = composite.getCacheUsage(), b = engine.getCacheUsage();
        return { entries: a.entries + b.entries, capacity: a.capacity + b.capacity };
      },
    }, BIRDS_2B_GEOMETRY_ORIGIN, composite.motionSupport));
    this.#engine = engine;
  }

  getChannelUsage() { return this.#engine.getChannelUsage(); }
}
