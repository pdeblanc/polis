import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

describe('App routing', () => {
  afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
  it('renders the Birds 2a controls and shares edited origin parameters', () => {
    window.history.replaceState({}, '', '/birds2a');
    render(<MemoryRouter initialEntries={['/birds2a']}><App /></MemoryRouter>);
    expect(document.title).toBe('Birds 2a (Polis 4)');
    expect(screen.getByRole('heading', { name: 'Birds 2a: single origin' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cursor t coordinate')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Population density' })).toHaveValue('32');
    const flows = screen.getByRole('checkbox', { name: 'Flows' });
    expect(flows).toBeChecked();
    fireEvent.click(flows);
    expect(flows).not.toBeChecked();
    const support = screen.getByRole('checkbox', { name: 'Support bound' });
    expect(support).toBeChecked();
    fireEvent.click(support);
    expect(support).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Reset view to origin' })).toBeInTheDocument();
    const origin = screen.getByRole('group', { name: 'Origin interval' });
    expect(origin).toHaveTextContent('[0, 1)');
    for (const interval of ['[1, 2)', '[2, 4)', '[4, 8)']) {
      fireEvent.click(screen.getByRole('button', { name: 'Next origin interval' }));
      expect(origin).toHaveTextContent(interval);
    }
    expect(new URLSearchParams(window.location.search).get('origin')).toBe('4');
    expect(new URLSearchParams(window.location.search).get('originWidth')).toBe('4');
    for (const interval of ['[2, 4)', '[1, 2)', '[0, 1)', '[-1, 0)', '[-2, -1)', '[-4, -2)']) {
      fireEvent.click(screen.getByRole('button', { name: 'Previous origin interval' }));
      expect(origin).toHaveTextContent(interval);
    }
    expect(new URLSearchParams(window.location.search).get('origin')).toBe('-4');
    expect(new URLSearchParams(window.location.search).get('originWidth')).toBe('2');
    for (const interval of ['[-2, -1)', '[-1, 0)', '[0, 1)']) {
      fireEvent.click(screen.getByRole('button', { name: 'Next origin interval' }));
      expect(origin).toHaveTextContent(interval);
    }
    expect(new URLSearchParams(window.location.search).has('origin')).toBe(false);
    expect(new URLSearchParams(window.location.search).has('originWidth')).toBe(false);
    expect(screen.getByRole('button', { name: 'Reset cache' })).toBeInTheDocument();
    window.history.replaceState({}, '', '/');
  });
  it('renders the experiment index', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(document.title).toBe('Polis');
    expect(screen.getByRole('heading', { level: 1, name: 'Polis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bounded Poisson-like starfield/ })).toHaveAttribute(
      'href',
      '/starfield',
    );
    expect(screen.getByRole('link', { name: /Diffusing birds/ })).toHaveAttribute(
      'href',
      '/birds',
    );
  });

  it('renders a model page', () => {
    render(
      <MemoryRouter initialEntries={['/terrain']}>
        <App />
      </MemoryRouter>,
    );

    expect(document.title).toBe('Terrain (Polis 2)');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Diamond-square terrain' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset view to origin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset cache' })).toBeInTheDocument();
  });

  it('renders the Birds spacetime page with its time axis identified', () => {
    window.history.replaceState({}, '', '/birds');
    render(
      <MemoryRouter initialEntries={['/birds']}>
        <App />
      </MemoryRouter>,
    );

    expect(document.title).toBe('Birds (Polis 3)');
    expect(screen.getByRole('heading', { level: 1, name: 'Diffusing birds' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cursor t coordinate')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Pannable spacetime population view with future upward'),
    ).toBeInTheDocument();
    const density = screen.getByRole('textbox', { name: 'Population density' });
    const diffusion = screen.getByRole('textbox', { name: 'Diffusion rate' });
    expect(density).toHaveValue('2');
    expect(diffusion).toHaveValue('0.5');
    fireEvent.change(density, { target: { value: '3' } });
    fireEvent.blur(density);
    expect(density).toHaveValue('3');
    expect(new URLSearchParams(window.location.search).get('density')).toBe('3');
  });
});
