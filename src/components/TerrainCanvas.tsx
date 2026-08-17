import { useEffect, useMemo, useState } from 'react';
import { useViewport2D } from '../helpers/useViewport2D';
import { useUrlSeed } from '../helpers/urlState';
import { useFramePerformance } from '../helpers/useFramePerformance';
import { terrainDependencyGraph } from '../helpers/terrainDependencies';
import { Terrain } from '../models/terrain/terrain';
import type { Point2D } from '../utils/geometry/point2d';
import { worldToScreen, type Size2D, type ViewportState } from '../utils/geometry/viewport2d';
import { SeedControl } from './SeedControl';
import { CacheControl, type CacheUsage } from './CacheControl';
import { ViewportFrame } from './ViewportFrame';
import { PerformanceControl } from './PerformanceControl';

const SAMPLE_CELL_PIXELS = 8;
const DEFAULT_SEED = 'Polis 2';
const INITIAL_VIEWPORT: ViewportState = { centerX: 0, centerY: 0, area: 16 };

export function TerrainCanvas() {
  const [seed, setSeed] = useUrlSeed(DEFAULT_SEED);
  const terrain = useMemo(() => new Terrain(seed), [seed]);
  const viewport = useViewport2D(INITIAL_VIEWPORT);
  const { cursor, prepareContext, size, state, world } = viewport;
  const [cacheUsage, setCacheUsage] = useState<CacheUsage>(() => terrain.getCacheUsage());
  const [showDependencies, setShowDependencies] = useState(true);
  const { measureFrame, performance } = useFramePerformance();

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    measureFrame(() => {
      const queries = drawTerrain(context, size, world, state, terrain);
      if (showDependencies) {
        drawTerrainDependencies(context, size, world, state, cursor);
      }
      return queries;
    });
    updateCacheUsage(setCacheUsage, terrain.getCacheUsage());
  }, [cursor, measureFrame, prepareContext, showDependencies, size, state, terrain, world]);

  return (
    <>
      <title>{`Terrain (${seed})`}</title>
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
        <PerformanceControl performance={performance} />
        <label>
          <input
            type="checkbox"
            checked={showDependencies}
            onChange={(event) => setShowDependencies(event.target.checked)}
          />{' '}
          Dependencies
        </label>
      </ViewportFrame>
    </>
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
  terrain: Terrain,
): number {
  context.fillStyle = '#0b0e14';
  context.fillRect(0, 0, size.width, size.height);

  const spacing = terrainSampleSpacing(size, world);
  if (!(spacing > 0) || !Number.isFinite(spacing)) return 0;

  const minX = viewport.centerX - world.width / 2;
  const maxX = viewport.centerX + world.width / 2;
  const minY = viewport.centerY - world.height / 2;
  const maxY = viewport.centerY + world.height / 2;
  const firstColumn = Math.floor(minX / spacing + 0.5);
  const finalColumn = Math.ceil(maxX / spacing + 0.5);
  const firstRow = Math.floor(minY / spacing + 0.5);
  const finalRow = Math.ceil(maxY / spacing + 0.5);
  let queries = 0;

  for (let row = firstRow; row < finalRow; row += 1) {
    for (let column = firstColumn; column < finalColumn; column += 1) {
      const vertex = { x: column * spacing, y: row * spacing };
      const { height } = terrain.sampleNearest(vertex, spacing);
      queries += 1;
      drawSampleCell(context, size, viewport, vertex, spacing, height);
    }
  }
  return queries;
}

function drawTerrainDependencies(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  cursor: Point2D,
) {
  const spacing = terrainSampleSpacing(size, world);
  if (!(spacing > 0) || !Number.isFinite(spacing)) return;
  const requested = {
    x: Math.round(cursor.x / spacing) * spacing,
    y: Math.round(cursor.y / spacing) * spacing,
  };
  const graph = terrainDependencyGraph(requested);

  context.strokeStyle = 'rgb(255 188 92 / 68%)';
  context.lineWidth = 1;
  context.beginPath();
  for (const edge of graph.edges) {
    const child = worldToScreen(edge.child, size, viewport);
    const parent = worldToScreen(edge.parent, size, viewport);
    context.moveTo(child.x, child.y);
    context.lineTo(parent.x, parent.y);
  }
  context.stroke();

  for (let index = graph.vertices.length - 1; index >= 0; index -= 1) {
    const point = worldToScreen(graph.vertices[index], size, viewport);
    const requestedVertex = index === 0;
    context.fillStyle = requestedVertex ? '#fff4d6' : '#ffc46b';
    context.beginPath();
    context.arc(point.x, point.y, requestedVertex ? 4 : 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

function terrainSampleSpacing(size: Size2D, world: Size2D): number {
  const worldPerPixel = Math.max(world.width / size.width, world.height / size.height);
  return 2 ** Math.ceil(Math.log2(worldPerPixel * SAMPLE_CELL_PIXELS));
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
