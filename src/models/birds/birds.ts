import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsEngine } from './birdsEngine';
import { classifyCell } from './classifiers';
import { possibleFlowDestinations, possibleFlowSources } from './motionSupport';
import { birdsScale, epochForCellLength, BIRDS_COARSE_CELL_LENGTH } from './scales';
import { BirdsQueryApi } from './birdsQueryApi';

export * from './birdsQueryApi';

/** Fixed-initialization Birds 1 model. */
export class Birds extends BirdsQueryApi {
  readonly #engine: BirdsEngine;

  constructor(seed: Seed, populationDensity: number, diffusionRate: number) {
    const engine = new BirdsEngine(seed, populationDensity, diffusionRate);
    super({
      engine,
      minimumEpoch: 0,
      scale: birdsScale,
      firstEpochAtWidth: (width) => Math.max(0, Math.ceil(Math.log2(BIRDS_COARSE_CELL_LENGTH) - Math.log2(width))),
      incidentDuration: (cell) => {
        const construction = classifyCell(cell);
        if (construction === undefined) throw new RangeError('Population cell does not lie in the Birds hierarchy');
        return construction.kind === 'spatial-child'
          ? birdsScale(epochForCellLength(cell.max - cell.min)!)!.flowDuration
          : construction.outgoingDuration;
      },
      destinations: (cell, duration) => possibleFlowDestinations(cell, duration, diffusionRate),
      sources: (cell, duration) => possibleFlowSources(cell, duration, diffusionRate),
    });
    this.#engine = engine;
  }

  getLastQueryStats() { return this.#engine.getLastQueryStats(); }
  getTotalQueryStats() { return this.#engine.getTotalQueryStats(); }
}
