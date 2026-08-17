import { useEffect, useMemo, useState } from 'react';
import { useViewport2D } from '../helpers/useViewport2D';
import { useUrlSeed } from '../helpers/urlState';
import { CacheControl, type CacheUsage } from './CacheControl';
import { SeedControl } from './SeedControl';
import { ViewportFrame } from './ViewportFrame';
import {
  cellContainingPoint,
  dependencyAncestor,
  type HierarchyCell,
} from '../models/starfield/hierarchy';
import { Starfield } from '../models/starfield/starfield';
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

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    drawBackground(context, size, state);
    drawStarfield(context, size, world, state, starfield);
    if (showHierarchy) {
      drawHierarchy(context, size, world, state, cursor);
    }
    updateCacheUsage(setCacheUsage, starfield.getCacheUsage());
  }, [cursor, prepareContext, showHierarchy, size, starfield, state, world]);

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
) {
  const worldPerPixel = world.width / size.width;
  const edgeLength = 2 ** Math.ceil(Math.log2(worldPerPixel * RENDER_CELL_PIXELS));
  if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) return;
  const maxX = viewport.centerX + world.width / 2;
  const maxY = viewport.centerY + world.height / 2;
  const startX = Math.floor((viewport.centerX - world.width / 2) / edgeLength) * edgeLength;
  const startY = Math.floor((viewport.centerY - world.height / 2) / edgeLength) * edgeLength;
  const columnCount = Math.max(0, Math.ceil((maxX - startX) / edgeLength));
  const rowCount = Math.max(0, Math.ceil((maxY - startY) / edgeLength));

  for (let column = 0; column < columnCount; column += 1) {
    const cellX = startX + column * edgeLength;
    for (let row = 0; row < rowCount; row += 1) {
      const cellY = startY + row * edgeLength;
      const cell = { minX: cellX, minY: cellY, edgeLength };
      const result = starfield.queryCell(cell);
      if (result.positions === undefined) {
        drawAggregateCell(context, size, world, viewport, cell, result.count);
      } else {
        drawPositions(context, size, world, viewport, result.positions);
      }
    }
  }
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
  cell: HierarchyCell,
  count: number,
) {
  const northwest = worldToScreen(
    { x: cell.minX, y: cell.minY + cell.edgeLength },
    size,
    viewport,
  );
  const cellPixels = (cell.edgeLength / world.width) * size.width;
  const starArea = Math.PI * STAR_RADIUS ** 2;
  const brightness = 1 - Math.exp(-(count * starArea) / cell.edgeLength ** 2);
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
