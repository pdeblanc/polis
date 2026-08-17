import { useEffect, useMemo, useState } from 'react';
import { useViewport2D } from '../helpers/useViewport2D';
import { useUrlSeed } from '../helpers/urlState';
import { TerrainModel } from '../models/terrain/terrainModel';
import type { Point2D } from '../utils/geometry/point2d';
import { worldToScreen, type Size2D, type ViewportState } from '../utils/geometry/viewport2d';
import { SeedControl } from './SeedControl';
import { CacheControl, type CacheUsage } from './CacheControl';
import { ViewportFrame } from './ViewportFrame';

const SAMPLE_CELL_PIXELS = 8;
const DEFAULT_SEED = 'polis-terrain-1';
const INITIAL_VIEWPORT: ViewportState = { centerX: 0, centerY: 0, area: 16 };

export function TerrainCanvas() {
  const [seed, setSeed] = useUrlSeed(DEFAULT_SEED);
  const terrain = useMemo(() => new TerrainModel(seed), [seed]);
  const viewport = useViewport2D(INITIAL_VIEWPORT);
  const { prepareContext, size, state, world } = viewport;
  const [cacheUsage, setCacheUsage] = useState<CacheUsage>(() => terrain.getCacheUsage());

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    drawTerrain(context, size, world, state, terrain);
    updateCacheUsage(setCacheUsage, terrain.getCacheUsage());
  }, [prepareContext, size, state, terrain, world]);

  return (
    <ViewportFrame
      canvasLabel="Pannable and zoomable nearest-neighbor terrain viewport"
      viewport={viewport}
    >
      <SeedControl seed={seed} setSeed={setSeed} />
      <CacheControl
        usage={cacheUsage}
        clearCache={() => {
          terrain.clearCache();
          setCacheUsage(terrain.getCacheUsage());
        }}
      />
    </ViewportFrame>
  );
}

function updateCacheUsage(
  setUsage: (update: (current: CacheUsage) => CacheUsage) => void,
  next: CacheUsage,
) {
  setUsage((current) =>
    current.entries === next.entries && current.capacity === next.capacity ? current : next,
  );
}

function drawTerrain(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  terrain: TerrainModel,
) {
  context.fillStyle = '#0b0e14';
  context.fillRect(0, 0, size.width, size.height);

  const worldPerPixel = Math.max(world.width / size.width, world.height / size.height);
  const spacing = 2 ** Math.ceil(Math.log2(worldPerPixel * SAMPLE_CELL_PIXELS));
  if (!(spacing > 0) || !Number.isFinite(spacing)) return;

  const minX = viewport.centerX - world.width / 2;
  const maxX = viewport.centerX + world.width / 2;
  const minY = viewport.centerY - world.height / 2;
  const maxY = viewport.centerY + world.height / 2;
  const firstColumn = Math.floor(minX / spacing + 0.5);
  const finalColumn = Math.ceil(maxX / spacing + 0.5);
  const firstRow = Math.floor(minY / spacing + 0.5);
  const finalRow = Math.ceil(maxY / spacing + 0.5);

  for (let row = firstRow; row < finalRow; row += 1) {
    for (let column = firstColumn; column < finalColumn; column += 1) {
      const vertex = { x: column * spacing, y: row * spacing };
      const { height } = terrain.sampleNearest(vertex, spacing);
      drawSampleCell(context, size, viewport, vertex, spacing, height);
    }
  }
}

function drawSampleCell(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  vertex: Point2D,
  spacing: number,
  height: number,
) {
  const northwest = worldToScreen(
    { x: vertex.x - spacing / 2, y: vertex.y + spacing / 2 },
    size,
    viewport,
  );
  const southeast = worldToScreen(
    { x: vertex.x + spacing / 2, y: vertex.y - spacing / 2 },
    size,
    viewport,
  );
  const lightness = Math.max(4, Math.min(96, 50 + height * 16));
  context.fillStyle = `hsl(215 18% ${lightness}%)`;
  context.fillRect(
    Math.floor(northwest.x),
    Math.floor(northwest.y),
    Math.ceil(southeast.x) - Math.floor(northwest.x),
    Math.ceil(southeast.y) - Math.floor(northwest.y),
  );
}
