import { useEffect, useMemo, useState } from 'react';
import { useViewport2D } from '../helpers/useViewport2D';
import { useFramePerformance } from '../helpers/useFramePerformance';
import { useUrlSeed } from '../helpers/urlState';
import { CacheControl, type CacheUsage } from './CacheControl';
import { SeedControl } from './SeedControl';
import { ViewportFrame } from './ViewportFrame';
import { PerformanceControl } from './PerformanceControl';
import {
  cellContainingPoint,
  dependencyAncestor,
  type HierarchyCell,
} from '../models/starfield/hierarchy';
import { Starfield, type StarfieldTile } from '../models/starfield/starfield';
import type { Point2D } from '../utils/geometry/point2d';
import { worldToScreen, type Size2D, type ViewportState } from '../utils/geometry/viewport2d';

const MIN_CELL_PIXELS = 8;
const RENDER_CELL_PIXELS = 16;
const STAR_RADIUS = 0.025;
const DEFAULT_SEED = 'Polis 1';
const INITIAL_VIEWPORT: ViewportState = { centerX: 0, centerY: 0, area: 64 };

export function StarfieldHierarchyCanvas() {
  const [seed, setSeed] = useUrlSeed(DEFAULT_SEED);
  const starfield = useMemo(() => new Starfield(seed), [seed]);
  const viewport = useViewport2D(INITIAL_VIEWPORT);
  const { cursor, prepareContext, size, state, world } = viewport;
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [cacheUsage, setCacheUsage] = useState<CacheUsage>(() => starfield.getCacheUsage());
  const { measureFrame, performance } = useFramePerformance();

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    measureFrame(() => {
      drawBackground(context, size, state);
      const queries = drawStarfield(context, size, world, state, starfield);
      if (showHierarchy) {
        drawHierarchy(context, size, world, state, cursor);
      }
      return queries;
    });
    updateCacheUsage(setCacheUsage, starfield.getCacheUsage());
  }, [cursor, measureFrame, prepareContext, showHierarchy, size, starfield, state, world]);

  return (
    <>
      <title>{`Starfield (${seed})`}</title>
      <ViewportFrame
        canvasLabel="Pannable and zoomable starfield hierarchy viewport"
        viewport={viewport}
      >
        <SeedControl seed={seed} setSeed={setSeed} />
        <CacheControl
          usage={cacheUsage}
          clearCache={() => {
            starfield.clearCache();
            setCacheUsage(starfield.getCacheUsage());
          }}
        />
        <PerformanceControl performance={performance} />
        <label>
          <input
            type="checkbox"
            checked={showHierarchy}
            onChange={(event) => setShowHierarchy(event.target.checked)}
          />{' '}
          Hierarchy
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

function drawBackground(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
) {
  context.fillStyle = '#0b0e14';
  context.fillRect(0, 0, size.width, size.height);

  const origin = worldToScreen({ x: 0, y: 0 }, size, viewport);
  context.strokeStyle = '#2d3749';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(origin.x, 0);
  context.lineTo(origin.x, size.height);
  context.moveTo(0, origin.y);
  context.lineTo(size.width, origin.y);
  context.stroke();
}

function drawHierarchy(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  cursor: Point2D,
) {
  const worldPerPixel = world.width / size.width;
  const minimumEdge = 2 ** Math.ceil(Math.log2(worldPerPixel * MIN_CELL_PIXELS));
  if (!(minimumEdge > 0) || !Number.isFinite(minimumEdge)) return;
  const cells = dependencyChain(cellContainingPoint(cursor, minimumEdge));

  [...cells].reverse().forEach((cell, index) => {
    drawCell(context, size, viewport, cell, index, cells.length);
  });

  const pointer = worldToScreen(cursor, size, viewport);
  context.fillStyle = '#f3f7ff';
  context.beginPath();
  context.arc(pointer.x, pointer.y, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawStarfield(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  starfield: Starfield,
): number {
  const worldPerPixel = world.width / size.width;
  const edgeLength = 2 ** Math.ceil(Math.log2(worldPerPixel * RENDER_CELL_PIXELS));
  if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) return 0;
  const minX = viewport.centerX - world.width / 2;
  const maxX = viewport.centerX + world.width / 2;
  const minY = viewport.centerY - world.height / 2;
  const maxY = viewport.centerY + world.height / 2;
  const tiles = starfield.queryTiles({ minX, minY, maxX, maxY }, edgeLength);

  for (const tile of tiles) {
    if (tile.positions === undefined) {
      drawAggregateCell(context, size, world, viewport, tile);
    } else {
      drawPositions(context, size, world, viewport, tile.positions);
    }
  }
  return tiles.length;
}

function drawPositions(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  positions: readonly Point2D[],
) {
  const radiusPixels = (STAR_RADIUS / world.width) * size.width;
  const areaPixels = Math.PI * radiusPixels ** 2;

  if (areaPixels <= 1) {
    context.fillStyle = `rgb(245 248 255 / ${areaPixels})`;
    for (const position of positions) {
      const screen = worldToScreen(position, size, viewport);
      context.fillRect(Math.floor(screen.x), Math.floor(screen.y), 1, 1);
    }
    return;
  }

  context.fillStyle = '#f5f8ff';
  context.beginPath();
  for (const position of positions) {
    const screen = worldToScreen(position, size, viewport);
    context.moveTo(screen.x + radiusPixels, screen.y);
    context.arc(screen.x, screen.y, radiusPixels, 0, Math.PI * 2);
  }
  context.fill();
}

function drawAggregateCell(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  tile: StarfieldTile,
) {
  const edgeLength = tile.bounds.maxX - tile.bounds.minX;
  const northwest = worldToScreen(
    { x: tile.bounds.minX, y: tile.bounds.maxY },
    size,
    viewport,
  );
  const cellPixels = (edgeLength / world.width) * size.width;
  const starArea = Math.PI * STAR_RADIUS ** 2;
  const brightness = 1 - Math.exp(-(tile.count * starArea) / edgeLength ** 2);
  context.fillStyle = `rgb(237 243 255 / ${brightness})`;
  context.fillRect(northwest.x, northwest.y, cellPixels, cellPixels);
}

function dependencyChain(requestedCell: HierarchyCell): HierarchyCell[] {
  const cells = [requestedCell];
  let ancestor = dependencyAncestor(requestedCell);

  while (ancestor !== undefined) {
    cells.push(ancestor.cell);
    ancestor = dependencyAncestor(ancestor.cell);
  }

  return cells;
}

function drawCell(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  cell: HierarchyCell,
  index: number,
  count: number,
) {
  const northwest = worldToScreen(
    { x: cell.minX, y: cell.minY + cell.edgeLength },
    size,
    viewport,
  );
  const southeast = worldToScreen(
    { x: cell.minX + cell.edgeLength, y: cell.minY },
    size,
    viewport,
  );
  const intensity = 0.3 + (0.7 * (index + 1)) / count;

  context.strokeStyle = `rgb(126 174 255 / ${intensity})`;
  context.lineWidth = index === count - 1 ? 2 : 1;
  context.strokeRect(
    Math.round(northwest.x) + 0.5,
    Math.round(northwest.y) + 0.5,
    Math.round(southeast.x - northwest.x),
    Math.round(southeast.y - northwest.y),
  );
}
