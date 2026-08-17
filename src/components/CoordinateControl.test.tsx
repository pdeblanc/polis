import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinateControl } from './CoordinateControl';

afterEach(cleanup);

describe('CoordinateControl', () => {
  it('applies both edited coordinates together', () => {
    const setCoordinates = vi.fn();
    const view = render(
      <CoordinateControl formattedX="1.25" formattedY="-2.5" setCoordinates={setCoordinates} />,
    );
    const x = view.getByRole('textbox', { name: 'Cursor x coordinate' });
    const y = view.getByRole('textbox', { name: 'Cursor y coordinate' });

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '10' } });
    fireEvent.change(y, { target: { value: '-20' } });
    fireEvent.keyDown(x, { key: 'Enter' });

    expect(setCoordinates).toHaveBeenCalledWith({ x: 10, y: -20 }, expect.any(Function));
    expect(x).not.toHaveFocus();
    expect(x).toHaveAttribute('readonly');
    expect(y).toHaveAttribute('readonly');

    act(() => setCoordinates.mock.calls[0][1]());
    expect(x).not.toHaveAttribute('readonly');
    expect(x).toHaveValue('1.25');
  });

  it('discards incomplete coordinates', () => {
    const setCoordinates = vi.fn();
    const view = render(
      <CoordinateControl formattedX="1.25" formattedY="-2.5" setCoordinates={setCoordinates} />,
    );
    const x = view.getByRole('textbox', { name: 'Cursor x coordinate' });

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '' } });
    fireEvent.submit(x.closest('form')!);

    expect(setCoordinates).not.toHaveBeenCalled();
    expect(x).toHaveValue('1.25');
  });

  it('marks only a changed draft as dirty', () => {
    const view = render(
      <CoordinateControl formattedX="1.25" formattedY="-2.5" setCoordinates={vi.fn()} />,
    );
    const form = view.container.querySelector('form')!;
    const x = view.getByRole('textbox', { name: 'Cursor x coordinate' });

    fireEvent.focus(x);
    expect(form).not.toHaveAttribute('data-dirty');
    fireEvent.change(x, { target: { value: '2' } });
    expect(form).toHaveAttribute('data-dirty');
    fireEvent.change(x, { target: { value: '1.25' } });
    expect(form).not.toHaveAttribute('data-dirty');
  });
});
