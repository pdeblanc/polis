import { useEffect, useRef } from 'react';
import {
  type BirdsQueryApi,
  type BirdsCell,
  type BirdsPopulationResolution,
} from '../models/birds/birds';
import {
  worldDimensions,
  type Size2D,
  type ViewportState,
} from '../utils/geometry/viewport2d';

const PREFETCH_FRAME_BUDGET_MS = 2;
const PREFETCH_LOOKAHEAD_SECONDS = 0.5;
const MIN_PREFETCH_ZOOM_VELOCITY = 0.05;

export function useBirdsViewportPrefetch(options: {
  readonly birds: BirdsQueryApi;
  readonly resolution: BirdsPopulationResolution | undefined;
  readonly resolveRenderResolution: (
    birds: BirdsQueryApi,
    size: Size2D,
    world: Size2D,
  ) => BirdsPopulationResolution | undefined;
  readonly size: Size2D;
  readonly verticalScale: number;
  readonly verticalZoomExponent: number;
  readonly viewport: ViewportState;
  readonly zoomVelocity: number;
}): void {
  const prefetchedRef = useRef<{
    readonly birds: BirdsQueryApi;
    readonly resolution: BirdsPopulationResolution;
    readonly cells: Set<string>;
  } | undefined>(undefined);
  const {
    birds,
    resolution,
    resolveRenderResolution,
    size,
    verticalScale,
    verticalZoomExponent,
    viewport,
    zoomVelocity,
  } = options;

  useEffect(() => {
    if (resolution === undefined || zoomVelocity >= -MIN_PREFETCH_ZOOM_VELOCITY) {
      prefetchedRef.current = undefined;
      return;
    }
    const nextResolution = birds.refinePopulationResolution(resolution);
    if (nextResolution === undefined) return;
    const projectedArea =
      viewport.area * Math.exp(Math.max(-10, zoomVelocity * PREFETCH_LOOKAHEAD_SECONDS));
    const projectedWorld = worldDimensions(
      size,
      projectedArea,
      verticalZoomExponent,
      verticalScale,
    );
    const projectedResolution = resolveRenderResolution(birds, size, projectedWorld);
    if (
      projectedResolution === undefined ||
      projectedResolution.cellWidth >= resolution.cellWidth
    ) return;

    const transitionArea = transitionAreaForResolution(
      birds,
      size,
      viewport.area,
      projectedArea,
      resolution,
      verticalZoomExponent,
      verticalScale,
      resolveRenderResolution,
    );
    const transitionWorld = worldDimensions(
      size,
      transitionArea,
      verticalZoomExponent,
      verticalScale,
    );
    const cells = populationCellsInView(viewport, transitionWorld, nextResolution);
    let record = prefetchedRef.current;
    if (record?.birds !== birds || record.resolution.cellWidth !== nextResolution.cellWidth) {
      record = { birds, resolution: nextResolution, cells: new Set() };
      prefetchedRef.current = record;
    }
    const pending = cells.filter((cell) => !record.cells.has(cellKey(cell)));
    let index = 0;
    let animationFrame: number | undefined;
    const prefetch = () => {
      const start = performance.now();
      do {
        const cell = pending[index];
        if (cell === undefined) return;
        birds.queryPopulation({ ...cell, resolution: nextResolution });
        record.cells.add(cellKey(cell));
        index += 1;
      } while (performance.now() - start < PREFETCH_FRAME_BUDGET_MS);
      animationFrame = requestAnimationFrame(prefetch);
    };
    animationFrame = requestAnimationFrame(prefetch);
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    };
  }, [
    birds,
    resolution,
    resolveRenderResolution,
    size,
    verticalScale,
    verticalZoomExponent,
    viewport,
    zoomVelocity,
  ]);
}

function transitionAreaForResolution(
  birds: BirdsQueryApi,
  size: Size2D,
  coarseArea: number,
  fineArea: number,
  coarseResolution: BirdsPopulationResolution,
  verticalZoomExponent: number,
  verticalScale: number,
  resolveRenderResolution: (
    birds: BirdsQueryApi,
    size: Size2D,
    world: Size2D,
  ) => BirdsPopulationResolution | undefined,
): number {
  let coarseLogArea = Math.log(coarseArea);
  let fineLogArea = Math.log(fineArea);
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const candidateLogArea = (coarseLogArea + fineLogArea) / 2;
    const world = worldDimensions(
      size,
      Math.exp(candidateLogArea),
      verticalZoomExponent,
      verticalScale,
    );
    const candidate = resolveRenderResolution(birds, size, world);
    if (candidate !== undefined && candidate.cellWidth < coarseResolution.cellWidth) {
      fineLogArea = candidateLogArea;
    } else {
      coarseLogArea = candidateLogArea;
    }
  }
  return Math.exp(fineLogArea);
}

function populationCellsInView(
  viewport: ViewportState,
  world: Size2D,
  resolution: BirdsPopulationResolution,
): readonly BirdsCell[] {
  const firstX = Math.floor((viewport.centerX - world.width / 2) / resolution.cellWidth);
  const finalX = Math.ceil((viewport.centerX + world.width / 2) / resolution.cellWidth);
  const firstTime = Math.floor((viewport.centerY - world.height / 2) / resolution.timeStep);
  const finalTime = Math.ceil((viewport.centerY + world.height / 2) / resolution.timeStep);
  const cells: BirdsCell[] = [];
  for (let timeIndex = firstTime; timeIndex <= finalTime; timeIndex += 1) {
    for (let spatialIndex = firstX; spatialIndex < finalX; spatialIndex += 1) {
      const min = spatialIndex * resolution.cellWidth;
      cells.push({ min, max: min + resolution.cellWidth, time: timeIndex * resolution.timeStep });
    }
  }
  return cells.sort((left, right) =>
    distanceFromCenter(left, viewport, resolution) -
    distanceFromCenter(right, viewport, resolution),
  );
}

function distanceFromCenter(
  cell: BirdsCell,
  viewport: ViewportState,
  resolution: BirdsPopulationResolution,
): number {
  return (
    Math.abs((cell.min + cell.max) / 2 / resolution.cellWidth - viewport.centerX / resolution.cellWidth) +
    Math.abs(cell.time / resolution.timeStep - viewport.centerY / resolution.timeStep)
  );
}

function cellKey(cell: BirdsCell): string {
  return `${cell.min}:${cell.max}@${cell.time}`;
}
