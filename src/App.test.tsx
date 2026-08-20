import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App routing', () => {
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
