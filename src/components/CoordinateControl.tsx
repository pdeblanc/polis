import { useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { Point2D } from '../utils/geometry/point2d';

type CoordinateControlProps = {
  readonly formattedX: string;
  readonly formattedY: string;
  readonly setCoordinates: (point: Point2D, onComplete?: () => void) => void;
};

type CoordinateDraft = {
  readonly originalX: string;
  readonly originalY: string;
  readonly x: string;
  readonly y: string;
};

export function CoordinateControl({
  formattedX,
  formattedY,
  setCoordinates,
}: CoordinateControlProps) {
  const [draft, setDraft] = useState<CoordinateDraft>();
  const [applying, setApplying] = useState(false);
  const ignoreNextBlur = useRef(false);
  const displayedX = draft?.x ?? formattedX;
  const displayedY = draft?.y ?? formattedY;
  const dirty =
    draft !== undefined && (draft.x !== draft.originalX || draft.y !== draft.originalY);

  const apply = () => {
    const x = parseCoordinate(displayedX);
    const y = parseCoordinate(displayedY);
    if (x !== undefined && y !== undefined) {
      if (!dirty) {
        setDraft(undefined);
        return;
      }
      setApplying(true);
      setCoordinates({ x, y }, () => {
        setApplying(false);
        setDraft(undefined);
      });
      return;
    }
    setDraft(undefined);
  };
  const onBlur = (event: FocusEvent<HTMLFormElement>) => {
    if (ignoreNextBlur.current) {
      ignoreNextBlur.current = false;
      return;
    }
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    apply();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply();
    if (document.activeElement instanceof HTMLElement) {
      ignoreNextBlur.current = true;
      document.activeElement.blur();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
    if (document.activeElement === event.currentTarget) ignoreNextBlur.current = true;
    event.currentTarget.blur();
  };

  return (
    <form
      className="coordinate-control"
      data-dirty={dirty || undefined}
      onBlur={onBlur}
      onFocus={() =>
        setDraft(
          (current) =>
            current ?? {
              originalX: formattedX,
              originalY: formattedY,
              x: formattedX,
              y: formattedY,
            },
        )
      }
      onSubmit={onSubmit}
    >
      <label>
        x ={' '}
        <input
          aria-label="Cursor x coordinate"
          inputMode="decimal"
          readOnly={applying}
          value={displayedX}
          onKeyDown={onKeyDown}
          onChange={(event) =>
            setDraft((current) => ({
              originalX: current?.originalX ?? formattedX,
              originalY: current?.originalY ?? formattedY,
              x: event.target.value,
              y: current?.y ?? formattedY,
            }))
          }
        />
      </label>
      <label>
        y ={' '}
        <input
          aria-label="Cursor y coordinate"
          inputMode="decimal"
          readOnly={applying}
          value={displayedY}
          onKeyDown={onKeyDown}
          onChange={(event) =>
            setDraft((current) => ({
              originalX: current?.originalX ?? formattedX,
              originalY: current?.originalY ?? formattedY,
              x: current?.x ?? formattedX,
              y: event.target.value,
            }))
          }
        />
      </label>
    </form>
  );
}

function parseCoordinate(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
