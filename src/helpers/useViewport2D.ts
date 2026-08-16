import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type RefObject,
  type WheelEventHandler,
} from 'react';
import type { Point2D } from '../utils/geometry/point2d';
import {
  constrainViewport,
  screenToWorld,
  worldDimensions,
  zoomAround,
  type Size2D,
  type ViewportState,
} from '../utils/geometry/viewport2d';

const KEYBOARD_PAN_RATE = 0.8;
const KEYBOARD_ZOOM_RATE = 1.5;
const WHEEL_ZOOM_RATE = 0.0033;

type Pinch = {
  readonly area: number;
  readonly distance: number;
  readonly anchor: Point2D;
};

export type Viewport2D = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly cursor: Point2D;
  readonly onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerDown: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerEnter: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerUp: PointerEventHandler<HTMLCanvasElement>;
  readonly onWheel: WheelEventHandler<HTMLCanvasElement>;
  readonly prepareContext: () => CanvasRenderingContext2D | null;
  readonly size: Size2D;
  readonly state: ViewportState;
  readonly world: Size2D;
};

export function useViewport2D(initialState: ViewportState): Viewport2D {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(initialState);
  const pointersRef = useRef(new Map<number, Point2D>());
  const pinchRef = useRef<Pinch | undefined>(undefined);
  const pressedKeysRef = useRef(new Set<string>());
  const [size, setSize] = useState<Size2D>({ width: 1, height: 1 });
  const [state, setState] = useState(initialState);
  const [cursorPosition, setCursorPosition] = useState<Point2D>({ x: 0.5, y: 0.5 });

  const commitState = useCallback((next: ViewportState) => {
    const constrained = constrainViewport(next, size);
    stateRef.current = constrained;
    setState(constrained);
  }, [size]);

  const world = worldDimensions(size, state.area);
  const cursor = screenToWorld(
    { x: cursorPosition.x * size.width, y: cursorPosition.y * size.height },
    size,
    state,
  );

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
        previousTime === undefined ? 0 : Math.min((time - previousTime) / 1_000, 0.05);
      previousTime = time;
      const horizontal = Number(keys.has('right')) - Number(keys.has('left'));
      const vertical = Number(keys.has('up')) - Number(keys.has('down'));
      const zoom = Number(keys.has('out')) - Number(keys.has('in'));
      const current = stateRef.current;
      const dimensions = worldDimensions(size, current.area);
      const directionLength = Math.hypot(horizontal, vertical) || 1;

      commitState({
        area: current.area * Math.exp(zoom * KEYBOARD_ZOOM_RATE * elapsed),
        centerX:
          current.centerX +
          (horizontal / directionLength) * dimensions.width * KEYBOARD_PAN_RATE * elapsed,
        centerY:
          current.centerY +
          (vertical / directionLength) * dimensions.height * KEYBOARD_PAN_RATE * elapsed,
      });
      animationFrame = requestAnimationFrame(animate);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = keyboardAction(event.key);
      if (action === undefined) return;
      event.preventDefault();
      pressedKeysRef.current.add(action);
      if (animationFrame === undefined) animationFrame = requestAnimationFrame(animate);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const action = keyboardAction(event.key);
      if (action === undefined) return;
      event.preventDefault();
      pressedKeysRef.current.delete(action);
    };

    const clearKeys = () => pressedKeysRef.current.clear();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearKeys);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      clearKeys();
    };
  }, [commitState, size]);

  function updateCursor(point: Point2D) {
    setCursorPosition({ x: point.x / size.width, y: point.y / size.height });
  }

  const onPointerDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    const point = localPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    updateCursor(point);

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = midpointOf(first, second);
      const current = stateRef.current;
      pinchRef.current = {
        area: current.area,
        distance: distanceBetween(first, second),
        anchor: screenToWorld(midpoint, size, current),
      };
    }
  };

  const onPointerMove: PointerEventHandler<HTMLCanvasElement> = (event) => {
    const point = localPointer(event);
    updateCursor(point);
    const previous = pointersRef.current.get(event.pointerId);
    if (previous === undefined) return;

    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      const current = stateRef.current;
      const dimensions = worldDimensions(size, current.area);
      commitState({
        ...current,
        centerX: current.centerX - ((point.x - previous.x) / size.width) * dimensions.width,
        centerY: current.centerY + ((point.y - previous.y) / size.height) * dimensions.height,
      });
      return;
    }

    const pinch = pinchRef.current;
    if (pointersRef.current.size === 2 && pinch !== undefined) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = midpointOf(first, second);
      const distance = distanceBetween(first, second);
      const requestedArea = pinch.area * (pinch.distance / distance) ** 2;
      const current = stateRef.current;
      const area = constrainViewport({ ...current, area: requestedArea }, size).area;
      if (area === current.area && requestedArea < current.area) return;
      const dimensions = worldDimensions(size, area);
      commitState({
        area,
        centerX: pinch.anchor.x - (midpoint.x / size.width - 0.5) * dimensions.width,
        centerY: pinch.anchor.y - (0.5 - midpoint.y / size.height) * dimensions.height,
      });
    }
  };

  const onPointerEnd: PointerEventHandler<HTMLCanvasElement> = (event) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = undefined;
  };

  const onPointerEnter: PointerEventHandler<HTMLCanvasElement> = (event) => {
    updateCursor(localPointer(event));
  };

  const onWheel: WheelEventHandler<HTMLCanvasElement> = (event) => {
    event.preventDefault();
    const point = localPointer(event);
    updateCursor(point);
    const current = stateRef.current;
    commitState(
      zoomAround(
        current,
        size,
        point,
        Math.exp(wheelDeltaInPixels(event, size.height) * WHEEL_ZOOM_RATE),
      ),
    );
  };

  const prepareContext = () => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext('2d');
    context?.setTransform(scale, 0, 0, scale, 0, 0);
    return context;
  };

  return {
    canvasRef,
    cursor,
    onPointerCancel: onPointerEnd,
    onPointerDown,
    onPointerEnter,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onWheel,
    prepareContext,
    size,
    state,
    world,
  };
}

function localPointer(event: {
  currentTarget: HTMLCanvasElement;
  clientX: number;
  clientY: number;
}): Point2D {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function wheelDeltaInPixels(
  event: { deltaMode: number; deltaY: number },
  pageHeight: number,
): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * pageHeight;
  return event.deltaY;
}

function midpointOf(first: Point2D, second: Point2D): Point2D {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distanceBetween(first: Point2D, second: Point2D): number {
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
): 'up' | 'down' | 'left' | 'right' | 'in' | 'out' | undefined {
  switch (key.toLowerCase()) {
    case 'w':
    case 'arrowup':
      return 'up';
    case 's':
    case 'arrowdown':
      return 'down';
    case 'a':
    case 'arrowleft':
      return 'left';
    case 'd':
    case 'arrowright':
      return 'right';
    case '=':
    case '+':
      return 'in';
    case '-':
      return 'out';
  }
}
