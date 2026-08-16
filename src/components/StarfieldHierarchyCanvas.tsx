import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  cellContainingPoint,
  dependencyAncestor,
  type HierarchyCell,
  type Point2D,
} from "../models/starfield/hierarchy";
import { Starfield } from "../models/starfield/starfield";

const INITIAL_VIEW_AREA = 64;
const MIN_CELL_PIXELS = 8;
const KEYBOARD_PAN_RATE = 0.8;
const KEYBOARD_ZOOM_RATE = 1.5;
const WHEEL_ZOOM_RATE = 0.0033;
const RENDER_CELL_PIXELS = 16;
const STAR_RADIUS = 0.025;
const DEFAULT_SEED = "polis-demo-1";

type Size = { readonly width: number; readonly height: number };
type ViewportState = {
  readonly centerX: number;
  readonly centerY: number;
  readonly area: number;
};
type ScreenPoint = { readonly x: number; readonly y: number };
type Pinch = {
  readonly area: number;
  readonly distance: number;
  readonly anchor: Point2D;
};

const INITIAL_VIEWPORT: ViewportState = {
  centerX: 0,
  centerY: 0,
  area: INITIAL_VIEW_AREA,
};

export function StarfieldHierarchyCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starfield = useMemo(() => new Starfield(DEFAULT_SEED), []);
  const viewportRef = useRef(INITIAL_VIEWPORT);
  const pointersRef = useRef(new Map<number, ScreenPoint>());
  const pinchRef = useRef<Pinch | undefined>(undefined);
  const pressedKeysRef = useRef(new Set<string>());
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [cursorPosition, setCursorPosition] = useState<ScreenPoint>({
    x: 0.5,
    y: 0.5,
  });
  const [showHierarchy, setShowHierarchy] = useState(true);

  const world = worldDimensions(size, viewport.area);
  const cursorScreen = {
    x: cursorPosition.x * size.width,
    y: cursorPosition.y * size.height,
  };
  const cursor = screenToWorld(cursorScreen, size, world, viewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let animationFrame: number | undefined;
    let previousTime: number | undefined;

    const animate = (time: number) => {
      const keys = pressedKeysRef.current;
      if (keys.size === 0) {
        animationFrame = undefined;
        previousTime = undefined;
        return;
      }

      const elapsed =
        previousTime === undefined
          ? 0
          : Math.min((time - previousTime) / 1_000, 0.05);
      previousTime = time;
      const horizontal = Number(keys.has("right")) - Number(keys.has("left"));
      const vertical = Number(keys.has("up")) - Number(keys.has("down"));
      const zoom = Number(keys.has("out")) - Number(keys.has("in"));
      const current = viewportRef.current;
      const dimensions = worldDimensions(size, current.area);
      const directionLength = Math.hypot(horizontal, vertical) || 1;
      const area = current.area * Math.exp(zoom * KEYBOARD_ZOOM_RATE * elapsed);

      commitViewport({
        area,
        centerX:
          current.centerX +
          (horizontal / directionLength) *
            dimensions.width *
            KEYBOARD_PAN_RATE *
            elapsed,
        centerY:
          current.centerY +
          (vertical / directionLength) *
            dimensions.height *
            KEYBOARD_PAN_RATE *
            elapsed,
      });
      animationFrame = requestAnimationFrame(animate);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const action = keyboardAction(event.key);
      if (action === undefined) return;
      event.preventDefault();
      pressedKeysRef.current.add(action);
      if (animationFrame === undefined)
        animationFrame = requestAnimationFrame(animate);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const action = keyboardAction(event.key);
      if (action === undefined) return;
      event.preventDefault();
      pressedKeysRef.current.delete(action);
    };

    const clearKeys = () => pressedKeysRef.current.clear();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      clearKeys();
    };
  }, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground(context, size, world, viewport);
    drawStarfield(context, size, world, viewport, starfield);
    if (showHierarchy) drawHierarchy(context, size, world, viewport, cursor);
  }, [cursor, showHierarchy, size, starfield, viewport, world]);

  function commitViewport(next: ViewportState) {
    viewportRef.current = next;
    setViewport(next);
  }

  function updateCursor(point: ScreenPoint) {
    setCursorPosition({ x: point.x / size.width, y: point.y / size.height });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = localPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    updateCursor(point);

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = midpointOf(first, second);
      const current = viewportRef.current;
      pinchRef.current = {
        area: current.area,
        distance: distanceBetween(first, second),
        anchor: screenToWorld(
          midpoint,
          size,
          worldDimensions(size, current.area),
          current,
        ),
      };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = localPointer(event);
    updateCursor(point);
    const previous = pointersRef.current.get(event.pointerId);
    if (previous === undefined) return;

    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      const current = viewportRef.current;
      const dimensions = worldDimensions(size, current.area);
      commitViewport({
        ...current,
        centerX:
          current.centerX -
          ((point.x - previous.x) / size.width) * dimensions.width,
        centerY:
          current.centerY +
          ((point.y - previous.y) / size.height) * dimensions.height,
      });
      return;
    }

    const pinch = pinchRef.current;
    if (pointersRef.current.size === 2 && pinch !== undefined) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = midpointOf(first, second);
      const distance = distanceBetween(first, second);
      const area = pinch.area * (pinch.distance / distance) ** 2;
      const dimensions = worldDimensions(size, area);
      commitViewport({
        area,
        centerX:
          pinch.anchor.x - (midpoint.x / size.width - 0.5) * dimensions.width,
        centerY:
          pinch.anchor.y - (0.5 - midpoint.y / size.height) * dimensions.height,
      });
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = undefined;
  }

  function handleWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const point = localPointer(event);
    updateCursor(point);
    const current = viewportRef.current;
    const delta = wheelDeltaInPixels(event, size.height);
    commitViewport(
      zoomAround(current, size, point, Math.exp(delta * WHEEL_ZOOM_RATE)),
    );
  }

  return (
    <section
      className="hierarchy-demo"
      aria-label="Starfield hierarchy explorer"
    >
      <canvas
        aria-label="Pannable and zoomable starfield hierarchy viewport"
        className="hierarchy-canvas"
        ref={canvasRef}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerEnter={(event) => updateCursor(localPointer(event))}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onWheel={handleWheel}
      />
      <div className="hierarchy-readout">
        <span>
          x {formatCoordinate(cursor.x)} · y {formatCoordinate(cursor.y)}
        </span>
        <span>area {formatCoordinate(viewport.area)}</span>
        <label>
          <input
            type="checkbox"
            checked={showHierarchy}
            onChange={(event) => setShowHierarchy(event.target.checked)}
          />{" "}
          Hierarchy
        </label>
      </div>
      <p className="viewport-help">
        Drag or WASD/arrows to pan · Wheel or −/= to zoom
      </p>
    </section>
  );
}

function worldDimensions(size: Size, area: number): Size {
  const aspectRatio = size.width / size.height;
  return {
    width: Math.sqrt(area * aspectRatio),
    height: Math.sqrt(area / aspectRatio),
  };
}

function screenToWorld(
  point: ScreenPoint,
  size: Size,
  world: Size,
  viewport: ViewportState,
): Point2D {
  return {
    x: viewport.centerX + (point.x / size.width - 0.5) * world.width,
    y: viewport.centerY + (0.5 - point.y / size.height) * world.height,
  };
}

function worldToScreen(
  point: Point2D,
  size: Size,
  world: Size,
  viewport: ViewportState,
): Point2D {
  return {
    x: ((point.x - viewport.centerX) / world.width + 0.5) * size.width,
    y: (0.5 - (point.y - viewport.centerY) / world.height) * size.height,
  };
}

function zoomAround(
  viewport: ViewportState,
  size: Size,
  anchorScreen: ScreenPoint,
  areaFactor: number,
): ViewportState {
  const oldWorld = worldDimensions(size, viewport.area);
  const anchor = screenToWorld(anchorScreen, size, oldWorld, viewport);
  const area = viewport.area * areaFactor;
  const newWorld = worldDimensions(size, area);
  return {
    area,
    centerX: anchor.x - (anchorScreen.x / size.width - 0.5) * newWorld.width,
    centerY: anchor.y - (0.5 - anchorScreen.y / size.height) * newWorld.height,
  };
}

function drawBackground(
  context: CanvasRenderingContext2D,
  size: Size,
  world: Size,
  viewport: ViewportState,
) {
  context.fillStyle = "#0b0e14";
  context.fillRect(0, 0, size.width, size.height);

  const origin = worldToScreen({ x: 0, y: 0 }, size, world, viewport);
  context.strokeStyle = "#2d3749";
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
  size: Size,
  world: Size,
  viewport: ViewportState,
  cursor: Point2D,
) {
  const worldPerPixel = world.width / size.width;
  const minimumEdge =
    2 ** Math.ceil(Math.log2(worldPerPixel * MIN_CELL_PIXELS));
  const cells = dependencyChain(cellContainingPoint(cursor, minimumEdge));

  [...cells].reverse().forEach((cell, index) => {
    drawCell(context, size, world, viewport, cell, index, cells.length);
  });

  const pointer = worldToScreen(cursor, size, world, viewport);
  context.fillStyle = "#f3f7ff";
  context.beginPath();
  context.arc(pointer.x, pointer.y, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawStarfield(
  context: CanvasRenderingContext2D,
  size: Size,
  world: Size,
  viewport: ViewportState,
  starfield: Starfield,
) {
  const worldPerPixel = world.width / size.width;
  const edgeLength =
    2 ** Math.ceil(Math.log2(worldPerPixel * RENDER_CELL_PIXELS));
  const maxX = viewport.centerX + world.width / 2;
  const maxY = viewport.centerY + world.height / 2;
  const startX =
    Math.floor((viewport.centerX - world.width / 2) / edgeLength) * edgeLength;
  const startY =
    Math.floor((viewport.centerY - world.height / 2) / edgeLength) * edgeLength;

  for (let cellX = startX; cellX < maxX; cellX += edgeLength) {
    for (let cellY = startY; cellY < maxY; cellY += edgeLength) {
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
  size: Size,
  world: Size,
  viewport: ViewportState,
  positions: readonly Point2D[],
) {
  const radiusPixels = (STAR_RADIUS / world.width) * size.width;
  const areaPixels = Math.PI * radiusPixels ** 2;

  if (areaPixels <= 1) {
    context.fillStyle = `rgb(245 248 255 / ${areaPixels})`;
    for (const position of positions) {
      const screen = worldToScreen(position, size, world, viewport);
      context.fillRect(Math.floor(screen.x), Math.floor(screen.y), 1, 1);
    }
    return;
  }

  context.fillStyle = "#f5f8ff";
  context.beginPath();
  for (const position of positions) {
    const screen = worldToScreen(position, size, world, viewport);
    context.moveTo(screen.x + radiusPixels, screen.y);
    context.arc(screen.x, screen.y, radiusPixels, 0, Math.PI * 2);
  }
  context.fill();
}

function drawAggregateCell(
  context: CanvasRenderingContext2D,
  size: Size,
  world: Size,
  viewport: ViewportState,
  cell: HierarchyCell,
  count: number,
) {
  const northwest = worldToScreen(
    { x: cell.minX, y: cell.minY + cell.edgeLength },
    size,
    world,
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
  size: Size,
  world: Size,
  viewport: ViewportState,
  cell: HierarchyCell,
  index: number,
  count: number,
) {
  const northwest = worldToScreen(
    { x: cell.minX, y: cell.minY + cell.edgeLength },
    size,
    world,
    viewport,
  );
  const southeast = worldToScreen(
    { x: cell.minX + cell.edgeLength, y: cell.minY },
    size,
    world,
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

function localPointer(event: {
  currentTarget: HTMLCanvasElement;
  clientX: number;
  clientY: number;
}): ScreenPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function wheelDeltaInPixels(
  event: { deltaMode: number; deltaY: number },
  pageHeight: number,
): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
    return event.deltaY * pageHeight;
  return event.deltaY;
}

function midpointOf(first: ScreenPoint, second: ScreenPoint): ScreenPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distanceBetween(first: ScreenPoint, second: ScreenPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function keyboardAction(
  key: string,
): "up" | "down" | "left" | "right" | "in" | "out" | undefined {
  switch (key.toLowerCase()) {
    case "w":
    case "arrowup":
      return "up";
    case "s":
    case "arrowdown":
      return "down";
    case "a":
    case "arrowleft":
      return "left";
    case "d":
    case "arrowright":
      return "right";
    case "=":
    case "+":
      return "in";
    case "-":
      return "out";
  }
}

function formatCoordinate(value: number): string {
  return value.toFixed(3).replace("-0.000", "0.000");
}
