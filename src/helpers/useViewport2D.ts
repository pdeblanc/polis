import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type RefObject,
} from "react";
import type { Point2D } from "../utils/geometry/point2d";
import {
  constrainViewport,
  createResetFlight,
  screenToWorld,
  positionWorldPointAtScreen,
  worldDimensions,
  zoomAround,
  type Size2D,
  type ViewportState,
} from "../utils/geometry/viewport2d";
import { replaceUrlParameters, viewportStateFromSearch } from "./urlState";

const KEYBOARD_PAN_RATE = 1.2;
const KEYBOARD_ZOOM_RATE = 1.5;
const MAX_MOMENTUM_APPARENT_SPEED = 3;
const MIN_MOMENTUM_APPARENT_SPEED = 0.01;
const MOMENTUM_TIME_CONSTANT = 0.2;
const PAN_VELOCITY_SMOOTHING_TIME = 0.05;
const URL_UPDATE_DELAY_MS = 250;
const WHEEL_ZOOM_RATE = 0.0033;
const ZOOM_VELOCITY_GAP_SECONDS = 0.2;
const ZOOM_VELOCITY_SMOOTHING_SECONDS = 0.08;

type Pinch = {
  readonly area: number;
  readonly distance: number;
  readonly anchor: Point2D;
};

type PanVelocity = {
  x: number;
  y: number;
  time: number;
};

export type Viewport2D = {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly cursor: Point2D;
  readonly onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerDown: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerEnter: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  readonly onPointerUp: PointerEventHandler<HTMLCanvasElement>;
  readonly prepareContext: () => CanvasRenderingContext2D | null;
  readonly resetView: () => void;
  readonly setCursorWorldPosition: (point: Point2D, onComplete?: () => void) => void;
  readonly size: Size2D;
  readonly state: ViewportState;
  readonly world: Size2D;
  /** Smoothed derivative of log(viewport area), in inverse seconds. */
  readonly zoomVelocity: number;
};

export function useViewport2D(
  initialState: ViewportState,
  options: {
    readonly verticalScale?: number;
    readonly verticalZoomExponent?: number;
  } = {},
): Viewport2D {
  const verticalScale = options.verticalScale ?? 1;
  const verticalZoomExponent = options.verticalZoomExponent ?? 1;
  const [defaultState] = useState(initialState);
  const [initialUrlState] = useState(() =>
    viewportStateFromSearch(window.location.search, defaultState),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(initialUrlState);
  const zoomSampleRef = useRef({ area: initialUrlState.area, time: 0, velocity: 0 });
  const pointersRef = useRef(new Map<number, Point2D>());
  const pinchRef = useRef<Pinch | undefined>(undefined);
  const pressedKeysRef = useRef(new Set<string>());
  const momentumAnimationRef = useRef<number | undefined>(undefined);
  const panVelocityRef = useRef<PanVelocity | undefined>(undefined);
  const resetAnimationRef = useRef<number | undefined>(undefined);
  const flightCompletionRef = useRef<(() => void) | undefined>(undefined);
  const [size, setSize] = useState<Size2D>({ width: 1, height: 1 });
  const [state, setState] = useState(initialUrlState);
  const [zoomVelocity, setZoomVelocity] = useState(0);
  const [cursorPosition, setCursorPosition] = useState<Point2D>({
    x: 0.5,
    y: 0.5,
  });

  const cancelResetAnimation = useCallback(() => {
    if (resetAnimationRef.current !== undefined) {
      cancelAnimationFrame(resetAnimationRef.current);
      resetAnimationRef.current = undefined;
    }
    const complete = flightCompletionRef.current;
    flightCompletionRef.current = undefined;
    complete?.();
  }, []);
  const cancelMomentum = useCallback(() => {
    if (momentumAnimationRef.current === undefined) return;
    cancelAnimationFrame(momentumAnimationRef.current);
    momentumAnimationRef.current = undefined;
  }, []);
  const applyState = useCallback(
    (next: ViewportState) => {
      const constrained = constrainViewport(
        next,
        size,
        verticalZoomExponent,
        verticalScale,
      );
      const now = performance.now();
      const previous = zoomSampleRef.current;
      const gap = Math.max(0, (now - previous.time) / 1_000);
      let velocity = previous.velocity;
      if (constrained.area !== previous.area) {
        const elapsed = Math.max(0.001, Math.min(gap, 0.05));
        const instantaneous = Math.log(constrained.area / previous.area) / elapsed;
        const blend =
          gap > ZOOM_VELOCITY_GAP_SECONDS
            ? 1
            : 1 - Math.exp(-elapsed / ZOOM_VELOCITY_SMOOTHING_SECONDS);
        velocity += (instantaneous - velocity) * blend;
      } else if (gap > 0) {
        velocity *= Math.exp(-gap / ZOOM_VELOCITY_SMOOTHING_SECONDS);
      }
      zoomSampleRef.current = { area: constrained.area, time: now, velocity };
      stateRef.current = constrained;
      setState(constrained);
      setZoomVelocity(velocity);
    },
    [size, verticalScale, verticalZoomExponent],
  );
  const commitState = useCallback(
    (next: ViewportState) => {
      cancelResetAnimation();
      cancelMomentum();
      applyState(next);
    },
    [applyState, cancelMomentum, cancelResetAnimation],
  );
  const animateTo = useCallback((requestedTarget: ViewportState, onComplete?: () => void) => {
    cancelResetAnimation();
    cancelMomentum();
    pressedKeysRef.current.clear();
    const target = constrainViewport(
      requestedTarget,
      size,
      verticalZoomExponent,
      verticalScale,
    );
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      applyState(target);
      onComplete?.();
      return;
    }

    const flight = createResetFlight(
      stateRef.current,
      target,
      size,
      verticalZoomExponent,
      verticalScale,
    );
    flightCompletionRef.current = onComplete;
    let startTime: number | undefined;
    const animate = (time: number) => {
      startTime ??= time;
      const elapsed = time - startTime;
      applyState(flight.stateAt(elapsed));
      if (elapsed < flight.duration) {
        resetAnimationRef.current = requestAnimationFrame(animate);
      } else {
        resetAnimationRef.current = undefined;
        const complete = flightCompletionRef.current;
        flightCompletionRef.current = undefined;
        complete?.();
      }
    };
    resetAnimationRef.current = requestAnimationFrame(animate);
  }, [applyState, cancelMomentum, cancelResetAnimation, size, verticalScale, verticalZoomExponent]);
  const resetView = useCallback(() => {
    animateTo(defaultState);
  }, [animateTo, defaultState]);

  const world = useMemo(
    () => worldDimensions(size, state.area, verticalZoomExponent, verticalScale),
    [size, state.area, verticalScale, verticalZoomExponent],
  );
  const cursor = useMemo(
    () =>
      screenToWorld(
        { x: cursorPosition.x * size.width, y: cursorPosition.y * size.height },
        size,
        state,
        verticalZoomExponent,
        verticalScale,
      ),
    [cursorPosition, size, state, verticalScale, verticalZoomExponent],
  );
  const setCursorWorldPosition = useCallback(
    (point: Point2D, onComplete?: () => void) => {
      animateTo(
        positionWorldPointAtScreen(
          stateRef.current,
          size,
          {
            x: cursorPosition.x * size.width,
            y: cursorPosition.y * size.height,
          },
          point,
          verticalZoomExponent,
          verticalScale,
        ),
        onComplete,
      );
    },
    [animateTo, cursorPosition, size, verticalScale, verticalZoomExponent],
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

  useEffect(
    () => () => {
      cancelResetAnimation();
      cancelMomentum();
    },
    [cancelMomentum, cancelResetAnimation],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      replaceUrlParameters({
        area:
          state.area === defaultState.area ? undefined : state.area.toString(),
        x:
          state.centerX === defaultState.centerX
            ? undefined
            : state.centerX.toString(),
        y:
          state.centerY === defaultState.centerY
            ? undefined
            : state.centerY.toString(),
      });
    }, URL_UPDATE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [defaultState, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPointer({
        currentTarget: canvas,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      setCursorPosition({ x: point.x / size.width, y: point.y / size.height });
      const current = stateRef.current;
      commitState(
        zoomAround(
          current,
          size,
          point,
          Math.exp(wheelDeltaInPixels(event, size.height) * WHEEL_ZOOM_RATE),
          verticalZoomExponent,
          verticalScale,
        ),
      );
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [commitState, size, verticalScale, verticalZoomExponent]);

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
      const current = stateRef.current;
      const directionLength = Math.hypot(horizontal, vertical) || 1;
      const dimensions = worldDimensions(
        size,
        current.area,
        verticalZoomExponent,
        verticalScale,
      );
      const pixelDistance =
        Math.sqrt(size.width * size.height) * KEYBOARD_PAN_RATE * elapsed;

      commitState({
        area: current.area * Math.exp(zoom * KEYBOARD_ZOOM_RATE * elapsed),
        centerX:
          current.centerX +
          (horizontal / directionLength) * pixelDistance * (dimensions.width / size.width),
        centerY:
          current.centerY +
          (vertical / directionLength) * pixelDistance * (dimensions.height / size.height),
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
      cancelResetAnimation();
      cancelMomentum();
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
    const handleVisibilityChange = () => {
      if (document.hidden) clearKeys();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearKeys);
    window.addEventListener("contextmenu", clearKeys);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
      window.removeEventListener("contextmenu", clearKeys);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      clearKeys();
    };
  }, [
    cancelMomentum,
    cancelResetAnimation,
    commitState,
    size,
    verticalScale,
    verticalZoomExponent,
  ]);

  function updateCursor(point: Point2D) {
    setCursorPosition({ x: point.x / size.width, y: point.y / size.height });
  }

  const onPointerDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (event.button !== 0) return;
    cancelResetAnimation();
    cancelMomentum();
    const point = localPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    panVelocityRef.current = { x: 0, y: 0, time: event.timeStamp };
    updateCursor(point);

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = midpointOf(first, second);
      const current = stateRef.current;
      pinchRef.current = {
        area: current.area,
        distance: distanceBetween(first, second),
        anchor: screenToWorld(
          midpoint,
          size,
          current,
          verticalZoomExponent,
          verticalScale,
        ),
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
      const dimensions = worldDimensions(
        size,
        current.area,
        verticalZoomExponent,
        verticalScale,
      );
      const centerDeltaX =
        -((point.x - previous.x) / size.width) * dimensions.width;
      const centerDeltaY =
        ((point.y - previous.y) / size.height) * dimensions.height;
      const velocity = panVelocityRef.current;
      const elapsed = Math.max(
        0.001,
        (event.timeStamp - (velocity?.time ?? event.timeStamp)) / 1_000,
      );
      const smoothing = 1 - Math.exp(-elapsed / PAN_VELOCITY_SMOOTHING_TIME);
      panVelocityRef.current = {
        x: lerp(velocity?.x ?? 0, centerDeltaX / elapsed, smoothing),
        y: lerp(velocity?.y ?? 0, centerDeltaY / elapsed, smoothing),
        time: event.timeStamp,
      };
      commitState({
        ...current,
        centerX: current.centerX + centerDeltaX,
        centerY: current.centerY + centerDeltaY,
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
      const area = constrainViewport(
        { ...current, area: requestedArea },
        size,
        verticalZoomExponent,
        verticalScale,
      ).area;
      if (area === current.area && requestedArea < current.area) return;
      const dimensions = worldDimensions(size, area, verticalZoomExponent, verticalScale);
      commitState({
        area,
        centerX:
          pinch.anchor.x - (midpoint.x / size.width - 0.5) * dimensions.width,
        centerY:
          pinch.anchor.y - (0.5 - midpoint.y / size.height) * dimensions.height,
      });
    }
  };

  const onPointerUp: PointerEventHandler<HTMLCanvasElement> = (event) => {
    const wasSinglePointer = pointersRef.current.size === 1;
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = undefined;
    if (wasSinglePointer) startMomentum(event.timeStamp);
    else panVelocityRef.current = undefined;
  };

  const onPointerCancel: PointerEventHandler<HTMLCanvasElement> = (event) => {
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = undefined;
    panVelocityRef.current = undefined;
  };

  const onPointerEnter: PointerEventHandler<HTMLCanvasElement> = (event) => {
    updateCursor(localPointer(event));
  };

  const prepareContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return null;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext("2d");
    context?.setTransform(scale, 0, 0, scale, 0, 0);
    return context;
  }, [size]);

  function startMomentum(releaseTime: number) {
    const velocity = panVelocityRef.current;
    panVelocityRef.current = undefined;
    if (velocity === undefined) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const current = stateRef.current;
    const scale = Math.sqrt(current.area);
    const ageDecay = Math.exp(-Math.max(0, releaseTime - velocity.time) / 80);
    const apparentSpeed = Math.hypot(velocity.x, velocity.y) / scale;
    if (apparentSpeed * ageDecay < MIN_MOMENTUM_APPARENT_SPEED) return;
    const speedLimit = MAX_MOMENTUM_APPARENT_SPEED * scale;
    const speedScale = Math.min(
      1,
      speedLimit / Math.hypot(velocity.x, velocity.y),
    );
    let velocityX = velocity.x * speedScale * ageDecay;
    let velocityY = velocity.y * speedScale * ageDecay;
    let previousTime: number | undefined;

    const animate = (time: number) => {
      const elapsed =
        previousTime === undefined
          ? 0
          : Math.min((time - previousTime) / 1_000, 0.05);
      previousTime = time;
      const decay = Math.exp(-elapsed / MOMENTUM_TIME_CONSTANT);
      const distanceFactor = MOMENTUM_TIME_CONSTANT * (1 - decay);
      const state = stateRef.current;
      applyState({
        ...state,
        centerX: state.centerX + velocityX * distanceFactor,
        centerY: state.centerY + velocityY * distanceFactor,
      });
      velocityX *= decay;
      velocityY *= decay;

      if (
        Math.hypot(velocityX, velocityY) / Math.sqrt(state.area) >=
        MIN_MOMENTUM_APPARENT_SPEED
      ) {
        momentumAnimationRef.current = requestAnimationFrame(animate);
      } else {
        momentumAnimationRef.current = undefined;
      }
    };
    momentumAnimationRef.current = requestAnimationFrame(animate);
  }

  return {
    canvasRef,
    cursor,
    onPointerCancel,
    onPointerDown,
    onPointerEnter,
    onPointerMove,
    onPointerUp,
    prepareContext,
    resetView,
    setCursorWorldPosition,
    size,
    state,
    world,
    zoomVelocity,
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
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
    return event.deltaY * pageHeight;
  return event.deltaY;
}

function midpointOf(first: Point2D, second: Point2D): Point2D {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distanceBetween(first: Point2D, second: Point2D): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
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
