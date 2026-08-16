import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  cellContainingPoint,
  dependencyAncestor,
  type HierarchyCell,
  type Point2D,
} from "../models/starfield/hierarchy";

const VIEW_AREA = 64;
const MIN_CELL_PIXELS = 8;
type Size = { readonly width: number; readonly height: number };

export function StarfieldHierarchyCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [cursor, setCursor] = useState<Point2D>({ x: 0, y: 0 });
  const [showHierarchy, setShowHierarchy] = useState(true);

  const world = worldDimensions(size);

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
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground(context, size, world);
    if (showHierarchy) drawHierarchy(context, size, world, cursor);
  }, [cursor, showHierarchy, size, world]);

  function updateCursor(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor(
      screenToWorld(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        size,
        world,
      ),
    );
  }

  return (
    <section
      className="hierarchy-demo"
      aria-label="Starfield hierarchy explorer"
    >
      <canvas
        className="hierarchy-canvas"
        ref={canvasRef}
        onPointerEnter={updateCursor}
        onPointerMove={updateCursor}
      />
      <div className="hierarchy-readout">
        <span>
          x {formatCoordinate(cursor.x)} · y {formatCoordinate(cursor.y)}
        </span>
        <label>
          <input
            type="checkbox"
            checked={showHierarchy}
            onChange={(event) => setShowHierarchy(event.target.checked)}
          />{" "}
          Hierarchy
        </label>
      </div>
    </section>
  );
}

function worldDimensions(size: Size): Size {
  const aspectRatio = size.width / size.height;
  return {
    width: Math.sqrt(VIEW_AREA * aspectRatio),
    height: Math.sqrt(VIEW_AREA / aspectRatio),
  };
}

function screenToWorld(
  screenX: number,
  screenY: number,
  size: Size,
  world: Size,
): Point2D {
  return {
    x: (screenX / size.width - 0.5) * world.width,
    y: (0.5 - screenY / size.height) * world.height,
  };
}

function worldToScreen(point: Point2D, size: Size, world: Size): Point2D {
  return {
    x: (point.x / world.width + 0.5) * size.width,
    y: (0.5 - point.y / world.height) * size.height,
  };
}

function drawBackground(
  context: CanvasRenderingContext2D,
  size: Size,
  world: Size,
) {
  context.fillStyle = "#0b0e14";
  context.fillRect(0, 0, size.width, size.height);

  const origin = worldToScreen({ x: 0, y: 0 }, size, world);
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
  cursor: Point2D,
) {
  const worldPerPixel = world.width / size.width;
  const minimumEdge =
    2 ** Math.ceil(Math.log2(worldPerPixel * MIN_CELL_PIXELS));
  const cells = dependencyChain(cellContainingPoint(cursor, minimumEdge));

  [...cells].reverse().forEach((cell, index) => {
    drawCell(context, size, world, cell, index, cells.length);
  });

  const pointer = worldToScreen(cursor, size, world);
  context.fillStyle = "#f3f7ff";
  context.beginPath();
  context.arc(pointer.x, pointer.y, 2.5, 0, Math.PI * 2);
  context.fill();
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
  cell: HierarchyCell,
  index: number,
  count: number,
) {
  const northwest = worldToScreen(
    { x: cell.minX, y: cell.minY + cell.edgeLength },
    size,
    world,
  );
  const southeast = worldToScreen(
    { x: cell.minX + cell.edgeLength, y: cell.minY },
    size,
    world,
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

function formatCoordinate(value: number): string {
  return value.toFixed(3).replace("-0.000", "0.000");
}
