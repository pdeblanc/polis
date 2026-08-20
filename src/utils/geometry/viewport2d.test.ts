import { describe, expect, it } from 'vitest';
import {
  constrainViewport,
  createResetFlight,
  screenToWorld,
  positionWorldPointAtScreen,
  worldDimensions,
  worldToScreen,
  zoomAround,
} from './viewport2d';

const size = { width: 800, height: 200 };
const viewport = { centerX: 3, centerY: -2, area: 64 };

describe('viewport2d geometry', () => {
  it('preserves world area while matching the screen aspect ratio', () => {
    const world = worldDimensions(size, viewport.area);
    expect(world.width * world.height).toBeCloseTo(64);
    expect(world.width / world.height).toBeCloseTo(4);
  });

  it('round-trips between screen and world coordinates', () => {
    const screen = { x: 173, y: 91 };
    const world = screenToWorld(screen, size, viewport);
    expect(worldToScreen(world, size, viewport)).toEqual(screen);
  });

  it('keeps the anchor fixed while zooming', () => {
    const anchorScreen = { x: 200, y: 50 };
    const anchorWorld = screenToWorld(anchorScreen, size, viewport);
    const zoomed = zoomAround(viewport, size, anchorScreen, 0.25);

    expect(zoomed.area).toBe(16);
    expect(screenToWorld(anchorScreen, size, zoomed).x).toBeCloseTo(anchorWorld.x);
    expect(screenToWorld(anchorScreen, size, zoomed).y).toBeCloseTo(anchorWorld.y);
  });

  it('supports parabolic zoom with the vertical factor squared', () => {
    const exponent = 2;
    const before = worldDimensions(size, viewport.area, exponent);
    const after = worldDimensions(size, viewport.area * 8, exponent);
    const anchorScreen = { x: 200, y: 50 };
    const anchorWorld = screenToWorld(anchorScreen, size, viewport, exponent);
    const zoomed = zoomAround(viewport, size, anchorScreen, 8, exponent);

    expect(after.width / before.width).toBeCloseTo(2);
    expect(after.height / before.height).toBeCloseTo(4);
    expect(after.height / before.height).toBeCloseTo((after.width / before.width) ** 2);
    expect(screenToWorld(anchorScreen, size, zoomed, exponent).x).toBeCloseTo(anchorWorld.x);
    expect(screenToWorld(anchorScreen, size, zoomed, exponent).y).toBeCloseTo(anchorWorld.y);
  });

  it('prevents zooming below floating-point resolution at the center', () => {
    const constrained = constrainViewport({ centerX: 100, centerY: -20, area: 0 }, size);
    const world = worldDimensions(size, constrained.area);

    expect(constrained.area).toBeGreaterThan(0);
    expect(world.width / size.width).toBeGreaterThanOrEqual(Number.EPSILON * 100);
    expect(world.height / size.height).toBeGreaterThanOrEqual(Number.EPSILON * 100);
  });

  it('keeps an overflowing zoom finite', () => {
    const constrained = constrainViewport(
      { centerX: 0, centerY: 0, area: Number.POSITIVE_INFINITY },
      size,
    );

    expect(constrained.area).toBeGreaterThan(0);
    expect(constrained.area).toBeLessThanOrEqual(Number.MAX_VALUE);
    expect(worldDimensions(size, constrained.area).width).toBeLessThanOrEqual(Number.MAX_VALUE);
  });

  it('does not pan when zooming farther past the minimum area', () => {
    const minimum = constrainViewport({ centerX: 100, centerY: -20, area: 0 }, size);
    const attempted = zoomAround(minimum, size, { x: 700, y: 25 }, 0.5);

    expect(attempted).toEqual(minimum);
  });

  it('flies through a wider overview when resetting a displaced view', () => {
    const start = { centerX: 12, centerY: -5, area: 16 };
    const target = { centerX: 0, centerY: 0, area: 16 };
    const flight = createResetFlight(start, target, size);
    const quarter = flight.stateAt(flight.duration / 4);
    const midpoint = flight.stateAt(flight.duration / 2);

    expect(flight.stateAt(0)).toEqual(start);
    expect(quarter.area).toBeGreaterThan(start.area);
    expect(quarter.centerX).toBeLessThan(start.centerX);
    expect(quarter.centerX).toBeGreaterThan(target.centerX);
    expect(midpoint.area).toBeGreaterThan(start.area);
    expect(midpoint.centerX).toBeLessThan(start.centerX);
    expect(flight.stateAt(flight.duration)).toEqual(target);
  });

  it('uses a smooth zoom flight when only the area differs', () => {
    const start = { centerX: 0, centerY: 0, area: 64 };
    const target = { centerX: 0, centerY: 0, area: 16 };
    const flight = createResetFlight(start, target, size);

    expect(flight.duration).toBeGreaterThan(0);
    expect(flight.stateAt(flight.duration / 2).centerX).toBe(0);
    expect(flight.stateAt(flight.duration)).toEqual(target);
  });

  it('has one apparent lateral-speed maximum', () => {
    const start = { centerX: 12, centerY: -5, area: 16 };
    const target = { centerX: 0, centerY: 0, area: 16 };
    const flight = createResetFlight(start, target, size);
    const intervals = 100;
    const interval = flight.duration / intervals;
    const speeds = Array.from({ length: intervals }, (_, index) => {
      const before = flight.stateAt(index * interval);
      const after = flight.stateAt((index + 1) * interval);
      const middle = flight.stateAt((index + 0.5) * interval);
      return Math.hypot(
        after.centerX - before.centerX,
        after.centerY - before.centerY,
      ) / Math.sqrt(middle.area);
    });
    const peak = speeds.indexOf(Math.max(...speeds));

    for (let index = 1; index <= peak; index += 1) {
      expect(speeds[index]).toBeGreaterThanOrEqual(speeds[index - 1] - 1e-10);
    }
    for (let index = peak + 1; index < speeds.length; index += 1) {
      expect(speeds[index]).toBeLessThanOrEqual(speeds[index - 1] + 1e-10);
    }
  });
});

it('positions an edited world coordinate at its original screen anchor', () => {
  const size = { width: 800, height: 400 };
  const viewport = { centerX: 3, centerY: -2, area: 8 };
  const screen = { x: 120, y: 310 };
  const requested = { x: 25, y: -40 };
  const moved = positionWorldPointAtScreen(viewport, size, screen, requested);

  expect(screenToWorld(screen, size, moved).x).toBeCloseTo(requested.x);
  expect(screenToWorld(screen, size, moved).y).toBeCloseTo(requested.y);
  expect(moved.area).toBe(viewport.area);
});
