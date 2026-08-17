import { Starfield, type StarfieldQueryStats } from '../models/starfield/starfield';
import { TerrainField, type TerrainQueryStats, type TerrainVertex } from '../models/terrain/terrain';

const BENCHMARK_SEED = 'Polis complexity benchmark';

export type TimedTerrainMeasurement = TerrainQueryStats & {
  readonly depth: number;
  readonly elapsedMilliseconds: number;
  readonly family: 'diamond' | 'square';
};

export type TimedStarfieldMeasurement = StarfieldQueryStats & {
  readonly cacheEntries: number;
  readonly elapsedMilliseconds: number;
  readonly experiment: 'box-expansion' | 'box-subdivision' | 'viewport';
  readonly queries: number;
  readonly scale: number;
};

export function terrainVertexAtDepth(
  family: TimedTerrainMeasurement['family'],
  depth: number,
): TerrainVertex {
  if (!Number.isInteger(depth) || depth < 3 || depth > 48) {
    throw new RangeError('Terrain benchmark depth must be an integer from 3 through 48');
  }
  const offset = 2 ** -depth;
  return {
    x: 0.5 + offset,
    y: family === 'square' ? 0.25 + offset : 0.25,
  };
}

export function measureTerrainPoint(
  family: TimedTerrainMeasurement['family'],
  depth: number,
): TimedTerrainMeasurement {
  const terrain = new TerrainField(BENCHMARK_SEED);
  const start = performance.now();
  terrain.queryVertex(terrainVertexAtDepth(family, depth));
  const elapsedMilliseconds = performance.now() - start;
  return { depth, elapsedMilliseconds, family, ...terrain.getLastQueryStats() };
}

export function measureStarfieldBox(
  experiment: 'box-expansion' | 'box-subdivision',
  depth: number,
): TimedStarfieldMeasurement {
  if (!Number.isInteger(depth) || depth < 0 || depth > 48) {
    throw new RangeError('Starfield benchmark depth must be an integer from 0 through 48');
  }
  const starfield = new Starfield(BENCHMARK_SEED);
  const scale = experiment === 'box-expansion' ? depth : -depth;
  const start = performance.now();
  starfield.queryCell({ minX: 0, minY: 0, edgeLength: 2 ** scale });
  const elapsedMilliseconds = performance.now() - start;
  return {
    cacheEntries: starfield.getCacheUsage().entries,
    elapsedMilliseconds,
    experiment,
    queries: 1,
    scale,
    ...starfield.getLastQueryStats(),
  };
}

export function measureStarfieldViewport(
  scale: number,
  columns = 16,
  rows = 9,
): TimedStarfieldMeasurement {
  if (!Number.isInteger(scale) || !Number.isInteger(columns) || !Number.isInteger(rows)) {
    throw new RangeError('Viewport scale and dimensions must be integers');
  }
  if (columns <= 0 || rows <= 0) {
    throw new RangeError('Viewport dimensions must be positive');
  }
  const starfield = new Starfield(BENCHMARK_SEED);
  const edgeLength = 2 ** scale;
  const totals = emptyStarfieldStats();
  const start = performance.now();

  for (let row = -Math.floor(rows / 2); row < Math.ceil(rows / 2); row += 1) {
    for (let column = -Math.floor(columns / 2); column < Math.ceil(columns / 2); column += 1) {
      starfield.queryCell({
        minX: column * edgeLength,
        minY: row * edgeLength,
        edgeLength,
      });
      addStarfieldStats(totals, starfield.getLastQueryStats());
    }
  }

  return {
    cacheEntries: starfield.getCacheUsage().entries,
    elapsedMilliseconds: performance.now() - start,
    experiment: 'viewport',
    queries: columns * rows,
    scale,
    ...totals,
  };
}

function emptyStarfieldStats(): StarfieldQueryStats {
  return {
    cacheHits: 0,
    cellsEvaluated: 0,
    maximumDepth: 0,
    poissonSamples: 0,
    populationSplits: 0,
    starsMaterialized: 0,
  };
}

function addStarfieldStats(total: StarfieldQueryStats, next: StarfieldQueryStats): void {
  const mutable = total as {
    -readonly [Key in keyof StarfieldQueryStats]: StarfieldQueryStats[Key];
  };
  mutable.cacheHits += next.cacheHits;
  mutable.cellsEvaluated += next.cellsEvaluated;
  mutable.maximumDepth = Math.max(mutable.maximumDepth, next.maximumDepth);
  mutable.poissonSamples += next.poissonSamples;
  mutable.populationSplits += next.populationSplits;
  mutable.starsMaterialized += next.starsMaterialized;
}
