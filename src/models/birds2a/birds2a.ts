import type { Seed } from '../../utils/rng/addressedRandom';
import { BirdsQueryApi } from '../birds/birdsQueryApi';
import { Birds2aEngine } from './birds2aEngine';
import { birds2aScale, classifyBirds2aCellGeometry } from './classifiers';
import type { ExpansionCell } from './expansion';
import { possibleBirds2aFlowDestinations, possibleBirds2aFlowSources } from './motionSupport';
import type { BirdsPopulationResolution } from '../birds/birdsQueryApi';
import { birds2aPopulationSupport } from './populationSupport';

/** Single-origin model with the same consumer capabilities as Birds 1. */
export class Birds2a extends BirdsQueryApi {
  readonly #engine: Birds2aEngine;
  constructor(seed: Seed, populationDensity: number, diffusionRate: number, origin?: ExpansionCell) {
    const engine = new Birds2aEngine(seed, populationDensity, diffusionRate, origin);
    super({
      engine,
      minimumEpoch: -Infinity,
      firstEpochAtWidth: (width) => Math.ceil(-Math.log2(width)),
      scale: (epoch) => {
        const scale = birds2aScale(2 ** -epoch);
        return scale && {
          epoch, cellLength: scale.cellWidth, childCellLength: scale.cellWidth / 2,
          flowDuration: scale.duration, halfFlowDuration: scale.halfDuration,
          nextFlowDuration: scale.quarterDuration,
        };
      },
      incidentDuration: (cell) => {
        const scale = classifyBirds2aCellGeometry(cell);
        if (!scale) throw new RangeError('Invalid Birds 2a cell');
        // Use the longest supported incidence aligned with this snapshot.
        return [scale.duration, scale.halfDuration, scale.quarterDuration]
          .find((duration) => Number.isInteger(cell.time / duration))!;
      },
      destinations: (cell, duration) => possibleBirds2aFlowDestinations(
        cell, duration, engine.expansion.origin, engine.motionSupport,
      ),
      sources: (cell, duration) => possibleBirds2aFlowSources(
        cell, duration, engine.expansion.origin, engine.motionSupport,
      ),
    });
    this.#engine = engine;
  }

  /** Geometry-only support at an exact snapshot time; never populates caches. */
  populationSupport(time: number, resolution: BirdsPopulationResolution): ExpansionCell | undefined {
    this.getNearbyPopulationResolutions(resolution, 0);
    return birds2aPopulationSupport(this.#engine.expansion.origin, this.#engine.motionSupport, time, resolution.cellWidth);
  }
}
