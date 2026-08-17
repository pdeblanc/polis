import type { PropsWithChildren } from 'react';
import type { Viewport2D } from '../helpers/useViewport2D';

type ViewportFrameProps = PropsWithChildren<{
  readonly canvasLabel: string;
  readonly viewport: Viewport2D;
}>;

export function ViewportFrame({ canvasLabel, children, viewport }: ViewportFrameProps) {
  const {
    canvasRef,
    cursor,
    onPointerCancel,
    onPointerDown,
    onPointerEnter,
    onPointerMove,
    onPointerUp,
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
      <div className="hierarchy-readout">
        <span>
          x {formatCoordinateAtScale(cursor.x, world.width)} · y{' '}
          {formatCoordinateAtScale(cursor.y, world.height)}
        </span>
        <span>
          width {formatSpan(world.width)} · height {formatSpan(world.height)}
        </span>
        {children}
      </div>
      <p className="viewport-help">Drag or WASD/arrows to pan · Wheel or −/= to zoom</p>
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
