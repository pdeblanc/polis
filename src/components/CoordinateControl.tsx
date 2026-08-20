import { useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { Point2D } from '../utils/geometry/point2d';

type CoordinateControlProps = {
  readonly editableX?: string;
  readonly editableY?: string;
  readonly formattedX: string;
  readonly formattedY: string;
  readonly revealEditable?: boolean;
  readonly setCoordinates: (point: Point2D, onComplete?: () => void) => void;
  readonly xLabel?: string;
  readonly xOperator?: string;
  readonly yLabel?: string;
  readonly yOperator?: string;
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
  editableX = formattedX,
  editableY = formattedY,
  revealEditable = false,
  setCoordinates,
  xLabel = 'x',
  xOperator = '=',
  yLabel = 'y',
  yOperator = '=',
}: CoordinateControlProps) {
  const [draft, setDraft] = useState<CoordinateDraft>();
  const [applying, setApplying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ignoreNextBlur = useRef(false);
  const displayedX = draft?.x ?? (hovered || revealEditable ? editableX : formattedX);
  const displayedY = draft?.y ?? (hovered || revealEditable ? editableY : formattedY);
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
              originalX: editableX,
              originalY: editableY,
              x: editableX,
              y: editableY,
            },
        )
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onSubmit={onSubmit}
    >
      <label>
        {xLabel} {xOperator}{' '}
        <input
          aria-label={`Cursor ${xLabel} coordinate`}
          inputMode="decimal"
          readOnly={applying}
          value={displayedX}
          onKeyDown={onKeyDown}
          onChange={(event) =>
            setDraft((current) => ({
              originalX: current?.originalX ?? editableX,
              originalY: current?.originalY ?? editableY,
              x: event.target.value,
              y: current?.y ?? editableY,
            }))
          }
        />
      </label>
      <label>
        {yLabel} {yOperator}{' '}
        <input
          aria-label={`Cursor ${yLabel} coordinate`}
          inputMode="decimal"
          readOnly={applying}
          value={displayedY}
          onKeyDown={onKeyDown}
          onChange={(event) =>
            setDraft((current) => ({
              originalX: current?.originalX ?? editableX,
              originalY: current?.originalY ?? editableY,
              x: current?.x ?? editableX,
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
