import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsQueryApi } from '../birds/birdsQueryApi';
import { Birds2aEngine } from './birds2aEngine';
import type { ExpansionCell } from './expansion';
import { birds2QueryBackend } from './queryBackend';
import { birds2aPopulationSupport } from './populationSupport';

/** Single-origin model with the same consumer capabilities as Birds 1. */
export class Birds2a extends BirdsQueryApi {
  readonly #engine: Birds2aEngine;
  constructor(seed: Seed, populationDensity: number, diffusionRate: number, origin?: ExpansionCell) {
    const engine = new Birds2aEngine(seed, populationDensity, diffusionRate, origin);
    super(birds2QueryBackend(engine, engine.expansion.origin, engine.motionSupport));
    this.#engine = engine;
  }

  /** Geometry-only support at an exact snapshot time; never populates caches. */
  populationSupport(time: number): ExpansionCell | undefined {
    return birds2aPopulationSupport(this.#engine.expansion.origin, this.#engine.expansion.kernels,
      this.#engine.motionSupport.midpointKernels, time);
  }
}
