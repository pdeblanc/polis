import { describe, expect, it } from 'vitest';
import {
  constrainViewport,
  screenToWorld,
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
});
