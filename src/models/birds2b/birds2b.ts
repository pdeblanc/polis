import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsQueryApi } from '../birds/birdsQueryApi';
import { birds2QueryBackend } from '../birds2a/queryBackend';
import { Birds2bEngine, BIRDS_2B_GEOMETRY_ORIGIN } from './birds2bEngine';

/** Global reference model: the explicit sum of canonical single-origin channels. */
export class Birds2b extends BirdsQueryApi {
  readonly #engine: Birds2bEngine;

  constructor(seed: Seed, populationDensity: number, diffusionRate: number) {
    const engine = new Birds2bEngine(seed, populationDensity, diffusionRate);
    super(birds2QueryBackend(engine, BIRDS_2B_GEOMETRY_ORIGIN, engine.motionSupport));
    this.#engine = engine;
  }

  getChannelUsage() { return this.#engine.getChannelUsage(); }
}
