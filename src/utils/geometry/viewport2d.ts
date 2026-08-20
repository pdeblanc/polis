import type { Point2D } from "./point2d";

export type Size2D = {
  readonly width: number;
  readonly height: number;
};

export type ViewportState = {
  readonly centerX: number;
  readonly centerY: number;
  readonly area: number;
};

export type ViewportFlight = {
  readonly duration: number;
  readonly stateAt: (elapsed: number) => ViewportState;
};

const MAX_APPARENT_PAN_ACCELERATION = 12;
const MAX_LOG_AREA_ACCELERATION = 12;
const MIN_FLIGHT_SECONDS = 0.45;
const FLIGHT_BOUND_SAMPLES = 2_048;
const SMOOTHERSTEP_MAX_ACCELERATION = 5.773502691896258;

export function createResetFlight(
  start: ViewportState,
  target: ViewportState,
  size: Size2D,
  verticalZoomExponent = 1,
  verticalScale = 1,
): ViewportFlight {
  const distance = Math.hypot(
    target.centerX - start.centerX,
    target.centerY - start.centerY,
  );
  const startScale = Math.sqrt(start.area);
  const targetScale = Math.sqrt(target.area);
  const peakScale = Math.max(startScale, targetScale) + distance / 2;
  const peakArea = constrainViewport(
    { ...start, area: peakScale ** 2 },
    size,
    verticalZoomExponent,
    verticalScale,
  ).area;
  const startLogArea = Math.log(start.area);
  const peakLogArea = Math.log(peakArea);
  const targetLogArea = Math.log(target.area);
  const logAreaChange = targetLogArea - startLogArea;
  const logAreaBump = Math.max(
    0,
    peakLogArea - (startLogArea + targetLogArea) / 2,
  );
  const centerProgress = [0];
  let centerProgressTotal = 0;
  let logAreaAcceleration = 0;
  let previousCenterVelocity = 0;

  for (let index = 0; index <= FLIGHT_BOUND_SAMPLES; index += 1) {
    const time = index / FLIGHT_BOUND_SAMPLES;
    const zoomProgress = smootherstep(time);
    const progressVelocity = smootherstepVelocity(time);
    const progressAcceleration = smootherstepAcceleration(time);
    const logArea = flightLogArea(
      startLogArea,
      logAreaChange,
      logAreaBump,
      zoomProgress,
    );
    const centerVelocity = progressVelocity * Math.exp(logArea / 2);
    if (index > 0) {
      centerProgressTotal +=
        (previousCenterVelocity + centerVelocity) / (2 * FLIGHT_BOUND_SAMPLES);
      centerProgress.push(centerProgressTotal);
    }
    previousCenterVelocity = centerVelocity;

    const logAreaVelocityByProgress =
      logAreaChange + 4 * logAreaBump * (1 - 2 * zoomProgress);
    const logAreaAccelerationByProgress = -8 * logAreaBump;
    logAreaAcceleration = Math.max(
      logAreaAcceleration,
      Math.abs(
        logAreaAccelerationByProgress * progressVelocity ** 2 +
          logAreaVelocityByProgress * progressAcceleration,
      ),
    );
  }

  const apparentPanAcceleration =
    centerProgressTotal === 0
      ? 0
      : (distance * SMOOTHERSTEP_MAX_ACCELERATION) / centerProgressTotal;

  const durationSeconds = Math.max(
    MIN_FLIGHT_SECONDS,
    Math.sqrt((apparentPanAcceleration * 1.01) / MAX_APPARENT_PAN_ACCELERATION),
    Math.sqrt((logAreaAcceleration * 1.01) / MAX_LOG_AREA_ACCELERATION),
  );

  return {
    duration: durationSeconds * 1_000,
    stateAt(elapsed) {
      if (elapsed <= 0) return start;
      const seconds = Math.max(0, Math.min(durationSeconds, elapsed / 1_000));
      if (seconds < durationSeconds) {
        const time = seconds / durationSeconds;
        const zoomProgress = smootherstep(time);
        const progress = interpolatedProgress(
          centerProgress,
          centerProgressTotal,
          time,
        );
        return {
          area: Math.exp(
            flightLogArea(
              startLogArea,
              logAreaChange,
              logAreaBump,
              zoomProgress,
            ),
          ),
          centerX: lerp(start.centerX, target.centerX, progress),
          centerY: lerp(start.centerY, target.centerY, progress),
        };
      }
      return target;
    },
  };
}

/**
 * Keeps a viewport within the spatial resolution representable around its center.
 * At the minimum, one CSS pixel spans one floating-point relative epsilon.
 */
export function constrainViewport(
  viewport: ViewportState,
  size: Size2D,
  verticalZoomExponent = 1,
  verticalScale = 1,
): ViewportState {
  validateVerticalZoomExponent(verticalZoomExponent);
  validateVerticalScale(verticalScale);
  const aspectRatio = size.width / size.height;
  const coordinateScale = Math.max(
    1,
    Math.abs(viewport.centerX),
    Math.abs(viewport.centerY),
  );
  const minimumWorldPerPixel = Number.EPSILON * coordinateScale;
  const minimumWidth = minimumWorldPerPixel * size.width;
  const minimumHeight = minimumWorldPerPixel * size.height;
  const maximumLogArea = Math.min(
    Math.log(Number.MAX_VALUE),
    (verticalZoomExponent + 1) * Math.log(Number.MAX_VALUE) -
      Math.log(aspectRatio) +
      Math.log(verticalScale),
    ((verticalZoomExponent + 1) * Math.log(Number.MAX_VALUE) +
      Math.log(aspectRatio) -
      Math.log(verticalScale)) /
      verticalZoomExponent,
  );
  const maximumArea = Math.exp(maximumLogArea);
  const minimumArea = Math.min(
    maximumArea,
    Math.max(
      (verticalScale * minimumWidth ** (verticalZoomExponent + 1)) / aspectRatio,
      (minimumHeight ** (verticalZoomExponent + 1) * aspectRatio / verticalScale) **
        (1 / verticalZoomExponent),
    ) * 1.000000000001,
  );
  const requestedArea = Number.isNaN(viewport.area)
    ? minimumArea
    : viewport.area;

  return {
    ...viewport,
    area: Math.min(maximumArea, Math.max(minimumArea, requestedArea)),
  };
}

function smootherstep(value: number): number {
  return value ** 3 * (value * (value * 6 - 15) + 10);
}

function smootherstepVelocity(value: number): number {
  return 30 * value ** 2 * (value - 1) ** 2;
}

function smootherstepAcceleration(value: number): number {
  return 60 * value * (2 * value ** 2 - 3 * value + 1);
}

function flightLogArea(
  start: number,
  change: number,
  bump: number,
  progress: number,
): number {
  return start + change * progress + 4 * bump * progress * (1 - progress);
}

function interpolatedProgress(
  cumulative: readonly number[],
  total: number,
  time: number,
): number {
  if (total === 0) return time;
  const position = time * FLIGHT_BOUND_SAMPLES;
  const index = Math.min(FLIGHT_BOUND_SAMPLES - 1, Math.floor(position));
  return (
    lerp(cumulative[index], cumulative[index + 1], position - index) / total
  );
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export function worldDimensions(
  size: Size2D,
  area: number,
  verticalZoomExponent = 1,
  verticalScale = 1,
): Size2D {
  validateVerticalZoomExponent(verticalZoomExponent);
  validateVerticalScale(verticalScale);
  const aspectRatio = size.width / size.height;
  const logWidth =
    (Math.log(area) + Math.log(aspectRatio) - Math.log(verticalScale)) /
    (verticalZoomExponent + 1);
  const width = Math.exp(logWidth);
  return {
    width,
    height: area / width,
  };
}

export function screenToWorld(
  point: Point2D,
  size: Size2D,
  viewport: ViewportState,
  verticalZoomExponent = 1,
  verticalScale = 1,
): Point2D {
  const world = worldDimensions(size, viewport.area, verticalZoomExponent, verticalScale);
  return {
    x: viewport.centerX + (point.x / size.width - 0.5) * world.width,
    y: viewport.centerY + (0.5 - point.y / size.height) * world.height,
  };
}

export function worldToScreen(
  point: Point2D,
  size: Size2D,
  viewport: ViewportState,
  verticalZoomExponent = 1,
  verticalScale = 1,
): Point2D {
  const world = worldDimensions(size, viewport.area, verticalZoomExponent, verticalScale);
  return {
    x: ((point.x - viewport.centerX) / world.width + 0.5) * size.width,
    y: (0.5 - (point.y - viewport.centerY) / world.height) * size.height,
  };
}

export function positionWorldPointAtScreen(
  viewport: ViewportState,
  size: Size2D,
  screenPoint: Point2D,
  worldPoint: Point2D,
  verticalZoomExponent = 1,
  verticalScale = 1,
): ViewportState {
  const world = worldDimensions(size, viewport.area, verticalZoomExponent, verticalScale);
  return {
    ...viewport,
    centerX: worldPoint.x - (screenPoint.x / size.width - 0.5) * world.width,
    centerY: worldPoint.y - (0.5 - screenPoint.y / size.height) * world.height,
  };
}

export function zoomAround(
  viewport: ViewportState,
  size: Size2D,
  anchorScreen: Point2D,
  areaFactor: number,
  verticalZoomExponent = 1,
  verticalScale = 1,
): ViewportState {
  const anchor = screenToWorld(
    anchorScreen,
    size,
    viewport,
    verticalZoomExponent,
    verticalScale,
  );
  const requestedArea = viewport.area * areaFactor;
  const area = constrainViewport(
    { ...viewport, area: requestedArea },
    size,
    verticalZoomExponent,
    verticalScale,
  ).area;
  if (area === viewport.area && requestedArea !== viewport.area)
    return viewport;
  const world = worldDimensions(size, area, verticalZoomExponent, verticalScale);
  return constrainViewport(
    {
      area,
      centerX: anchor.x - (anchorScreen.x / size.width - 0.5) * world.width,
      centerY: anchor.y - (0.5 - anchorScreen.y / size.height) * world.height,
    },
    size,
    verticalZoomExponent,
    verticalScale,
  );
}

function validateVerticalZoomExponent(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Vertical zoom exponent must be finite and positive');
  }
}

function validateVerticalScale(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Vertical scale must be finite and positive');
  }
}
