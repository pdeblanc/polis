import { useState, type PropsWithChildren, type ReactNode } from 'react';
import type { Viewport2D } from '../helpers/useViewport2D';
import { CoordinateControl } from './CoordinateControl';

type ViewportFrameProps = PropsWithChildren<{
  readonly axisLabels?: { readonly x: string; readonly y: string };
  readonly canvasLabel: string;
  readonly coordinateDisplay?: {
    readonly formattedX: string;
    readonly formattedY: string;
    readonly xOperator?: string;
    readonly yOperator?: string;
  };
  readonly coordinateFooter?: ReactNode;
  readonly viewport: Viewport2D;
}>;

export function ViewportFrame({
  axisLabels,
  canvasLabel,
  children,
  coordinateDisplay,
  coordinateFooter,
  viewport,
}: ViewportFrameProps) {
  const [coordinateWidgetHovered, setCoordinateWidgetHovered] = useState(false);
  const {
    canvasRef,
    cursor,
    onPointerCancel,
    onPointerDown,
    onPointerEnter,
    onPointerMove,
    onPointerUp,
    resetView,
    setCursorWorldPosition,
    world,
  } = viewport;

  return (
    <section className="hierarchy-demo">
      <canvas
        aria-label={canvasLabel}
        className="hierarchy-canvas"
        ref={canvasRef}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="viewport-top-widgets">
        <div
          className="hierarchy-readout"
          onMouseEnter={() => setCoordinateWidgetHovered(true)}
          onMouseLeave={() => setCoordinateWidgetHovered(false)}
        >
          <CoordinateControl
            editableX={formatCoordinateAtScale(cursor.x, world.width)}
            editableY={formatCoordinateAtScale(cursor.y, world.height)}
            formattedX={
              coordinateDisplay?.formattedX ?? formatCoordinateAtScale(cursor.x, world.width)
            }
            formattedY={
              coordinateDisplay?.formattedY ?? formatCoordinateAtScale(cursor.y, world.height)
            }
            revealEditable={coordinateWidgetHovered}
            setCoordinates={setCursorWorldPosition}
            xLabel={axisLabels?.x}
            xOperator={coordinateDisplay?.xOperator}
            yLabel={axisLabels?.y}
            yOperator={coordinateDisplay?.yOperator}
          />
          <span className="viewport-area-readout">
            A = {formatSpan(world.width)} × {formatSpan(world.height)}
          </span>
          {coordinateFooter === undefined ? null : (
            <span className="viewport-coordinate-footer">{coordinateFooter}</span>
          )}
        </div>
        <div className="viewport-model-controls">{children}</div>
      </div>
      <p className="viewport-help">Drag or WASD/arrows to pan · Wheel or −/= to zoom</p>
      <button
        aria-label="Reset view to origin"
        className="viewport-home-button"
        onClick={resetView}
        title="Reset view to origin"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    </section>
  );
}

function formatSpan(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(3);
  return value.toFixed(3).replace('-0.000', '0.000');
}

function formatCoordinateAtScale(value: number, span: number): string {
  const decimalPlaces = Math.max(0, Math.ceil(-Math.log10(span)) + 3);
  return value.toFixed(decimalPlaces).replace(/^-0(?:\.0+)?$/, (zero) => zero.slice(1));
}
