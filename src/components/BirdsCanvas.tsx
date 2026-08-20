import { useEffect, useMemo, useState } from 'react';
import { useFramePerformance } from '../helpers/useFramePerformance';
import { useUrlSeed } from '../helpers/urlState';
import { useViewport2D } from '../helpers/useViewport2D';
import {
  Birds,
  type BirdsPopulationResolution,
  type BirdsPopulationSample,
} from '../models/birds/birds';
import { worldToScreen, type Size2D, type ViewportState } from '../utils/geometry/viewport2d';
import { CacheControl, type CacheUsage } from './CacheControl';
import { PerformanceControl } from './PerformanceControl';
import { SeedControl } from './SeedControl';
import { ViewportFrame } from './ViewportFrame';

const DEFAULT_SEED = 'Polis 3';
const DIFFUSION_RATE = 0.5;
const POPULATION_DENSITY = 2;
const INITIAL_VIEWPORT: ViewportState = { centerX: 0, centerY: 0, area: 16_384 };
const TARGET_CELL_PIXELS = 64;
const TARGET_TIME_STEP_PIXELS = 128;
const MAX_RENDER_SAMPLES = 1_000;
const TIME_ZOOM_EXPONENT = 2;
const TIME_WORLD_SCALE = 1 / 64;

export function BirdsCanvas() {
  const [seed, setSeed] = useUrlSeed(DEFAULT_SEED);
  const birds = useMemo(
    () => new Birds(seed, POPULATION_DENSITY, DIFFUSION_RATE),
    [seed],
  );
  const viewport = useViewport2D(INITIAL_VIEWPORT, {
    verticalScale: TIME_WORLD_SCALE,
    verticalZoomExponent: TIME_ZOOM_EXPONENT,
  });
  const { prepareContext, size, state, world } = viewport;
  const resolution = useMemo(
    () => birdsRenderResolution(birds, size, world, state),
    [birds, size, state, world],
  );
  const [cacheUsage, setCacheUsage] = useState<CacheUsage>(() => birds.getCacheUsage());
  const { measureFrame, performance } = useFramePerformance();

  useEffect(() => {
    const context = prepareContext();
    if (context === null) return;
    measureFrame(() => drawBirds(context, size, world, state, birds, resolution));
    updateCacheUsage(setCacheUsage, birds.getCacheUsage());
  }, [birds, measureFrame, prepareContext, resolution, size, state, world]);

  return (
    <>
      <title>{`Birds (${seed})`}</title>
      <ViewportFrame
        axisLabels={{ x: 'x', y: 't' }}
        canvasLabel="Pannable spacetime population view with future upward"
        viewport={viewport}
      >
        <SeedControl seed={seed} setSeed={setSeed} />
        <span>ρ = {POPULATION_DENSITY}</span>
        <span>D = {DIFFUSION_RATE}</span>
        <span>
          Δx = {formatResolution(resolution?.cellWidth)} · Δt ={' '}
          {formatResolution(resolution?.timeStep)}
        </span>
        <CacheControl
          usage={cacheUsage}
          clearCache={() => {
            birds.clearCache();
            setCacheUsage(birds.getCacheUsage());
          }}
        />
        <PerformanceControl performance={performance} />
      </ViewportFrame>
    </>
  );
}

function drawBirds(
  context: CanvasRenderingContext2D,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
  birds: Birds,
  resolution: BirdsPopulationResolution | undefined,
): number {
  drawBackground(context, size, viewport);
  const bounds = {
    minX: viewport.centerX - world.width / 2,
    maxX: viewport.centerX + world.width / 2,
    minTime: viewport.centerY - world.height / 2,
    maxTime: viewport.centerY + world.height / 2,
  };
  if (resolution === undefined) return 0;
  const firstTimeIndex = Math.floor(bounds.minTime / resolution.timeStep);
  const finalTimeIndex = Math.ceil(bounds.maxTime / resolution.timeStep);
  const firstCellIndex = Math.floor(bounds.minX / resolution.cellWidth);
  const finalCellIndex = Math.ceil(bounds.maxX / resolution.cellWidth);
  const rows = finalTimeIndex - firstTimeIndex + 1;
  const columns = finalCellIndex - firstCellIndex;
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(columns) ||
    rows <= 0 ||
    columns <= 0 ||
    rows * columns > MAX_RENDER_SAMPLES
  ) {
    drawLimitMessage(context, size);
    return 0;
  }

  let queries = 0;
  for (let timeIndex = firstTimeIndex; timeIndex <= finalTimeIndex; timeIndex += 1) {
    const result = birds.queryPopulation({
      min: bounds.minX,
      max: bounds.maxX,
      time: timeIndex * resolution.timeStep,
      resolution,
    });
    if (result.kind === 'size-limit') {
      drawLimitMessage(context, size);
      return queries;
    }
    for (const sample of result.samples) {
      drawPopulationSample(
        context,
        size,
        viewport,
        result.sampledTime,
        resolution,
        sample,
      );
      queries += 1;
    }
  }
  drawDirection(context);
  return queries;
}

function birdsRenderResolution(
  birds: Birds,
  size: Size2D,
  world: Size2D,
  viewport: ViewportState,
): BirdsPopulationResolution | undefined {
  const requested = birds.resolvePopulationResolution({
    targetCellWidth: (world.width / size.width) * TARGET_CELL_PIXELS,
    targetTimeStep: (world.height / size.height) * TARGET_TIME_STEP_PIXELS,
  });
  if (requested === undefined) return undefined;
  const bounds = {
    minX: viewport.centerX - world.width / 2,
    maxX: viewport.centerX + world.width / 2,
    minTime: viewport.centerY - world.height / 2,
    maxTime: viewport.centerY + world.height / 2,
  };
  const nearby = birds.getNearbyPopulationResolutions(requested, 16);
  let selected = nearby[0] ?? requested;
  for (const candidate of nearby) {
    if (candidate.cellWidth < requested.cellWidth) break;
    const columns = Math.ceil(bounds.maxX / candidate.cellWidth) - Math.floor(bounds.minX / candidate.cellWidth);
    const rows = Math.ceil(bounds.maxTime / candidate.timeStep) - Math.floor(bounds.minTime / candidate.timeStep) + 1;
    if (columns * rows > MAX_RENDER_SAMPLES) break;
    selected = candidate;
  }
  return selected;
}

function drawBackground(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
): void {
  context.fillStyle = '#080d13';
  context.fillRect(0, 0, size.width, size.height);
  const origin = worldToScreen(
    { x: 0, y: 0 },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  context.strokeStyle = '#29394a';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(origin.x, 0);
  context.lineTo(origin.x, size.height);
  context.stroke();
}

function drawPopulationSample(
  context: CanvasRenderingContext2D,
  size: Size2D,
  viewport: ViewportState,
  time: number,
  resolution: BirdsPopulationResolution,
  sample: BirdsPopulationSample,
): void {
  const left = worldToScreen(
    { x: sample.interval.min, y: time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const right = worldToScreen(
    { x: sample.interval.max, y: time },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const nextTime = worldToScreen(
    { x: 0, y: time + resolution.timeStep },
    size,
    viewport,
    TIME_ZOOM_EXPONENT,
    TIME_WORLD_SCALE,
  );
  const rowSpacing = Math.abs(nextTime.y - left.y);
  const thickness = Math.max(1, Math.ceil(rowSpacing) + 1);
  const expected = POPULATION_DENSITY * resolution.cellWidth;
  const intensity = expected === 0 ? 0 : 1 - Math.exp(-sample.count / expected);
  context.fillStyle = `rgb(105 215 255 / ${0.08 + 0.92 * intensity})`;
  context.fillRect(left.x, left.y - thickness / 2, Math.max(1, right.x - left.x), thickness);
}

function drawDirection(context: CanvasRenderingContext2D): void {
  const x = 18;
  const top = 66;
  context.strokeStyle = 'rgb(173 225 255 / 72%)';
  context.fillStyle = 'rgb(190 231 255 / 82%)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, top + 30);
  context.lineTo(x, top);
  context.lineTo(x - 4, top + 7);
  context.moveTo(x, top);
  context.lineTo(x + 4, top + 7);
  context.stroke();
  context.font = '11px ui-monospace, monospace';
  context.fillText('future', x + 8, top + 5);
}

function drawLimitMessage(context: CanvasRenderingContext2D, size: Size2D): void {
  context.fillStyle = 'rgb(255 196 107 / 88%)';
  context.font = '12px ui-monospace, monospace';
  context.textAlign = 'center';
  context.fillText('View exceeds the population rendering budget', size.width / 2, size.height / 2);
  context.textAlign = 'start';
}

function updateCacheUsage(
  setUsage: (update: (current: CacheUsage) => CacheUsage) => void,
  next: CacheUsage,
): void {
  setUsage((current) =>
    current.entries === next.entries && current.capacity === next.capacity ? current : next,
  );
}

function formatResolution(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 0.001 || value >= 10_000) return value.toExponential(2);
  return String(value);
}
