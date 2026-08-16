import type { Point2D } from './point2d';

export type Size2D = {
  readonly width: number;
  readonly height: number;
};

export type ViewportState = {
  readonly centerX: number;
  readonly centerY: number;
  readonly area: number;
};

export function worldDimensions(size: Size2D, area: number): Size2D {
  const aspectRatio = size.width / size.height;
  return {
    width: Math.sqrt(area * aspectRatio),
    height: Math.sqrt(area / aspectRatio),
  };
}

export function screenToWorld(
  point: Point2D,
  size: Size2D,
  viewport: ViewportState,
): Point2D {
  const world = worldDimensions(size, viewport.area);
  return {
    x: viewport.centerX + (point.x / size.width - 0.5) * world.width,
    y: viewport.centerY + (0.5 - point.y / size.height) * world.height,
  };
}

export function worldToScreen(
  point: Point2D,
  size: Size2D,
  viewport: ViewportState,
): Point2D {
  const world = worldDimensions(size, viewport.area);
  return {
    x: ((point.x - viewport.centerX) / world.width + 0.5) * size.width,
    y: (0.5 - (point.y - viewport.centerY) / world.height) * size.height,
  };
}

export function zoomAround(
  viewport: ViewportState,
  size: Size2D,
  anchorScreen: Point2D,
  areaFactor: number,
): ViewportState {
  const anchor = screenToWorld(anchorScreen, size, viewport);
  const area = viewport.area * areaFactor;
  const world = worldDimensions(size, area);
  return {
    area,
    centerX: anchor.x - (anchorScreen.x / size.width - 0.5) * world.width,
    centerY: anchor.y - (0.5 - anchorScreen.y / size.height) * world.height,
  };
}
