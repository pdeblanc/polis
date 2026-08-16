import { render, screen } from '@testing-library/react';
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

    expect(screen.getByRole('heading', { level: 1, name: 'Polis' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bounded Poisson-like starfield/ })).toHaveAttribute(
      'href',
      '/starfield',
    );
  });

  it('renders a model page', () => {
    render(
      <MemoryRouter initialEntries={['/terrain']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Diamond-square terrain' }),
    ).toBeInTheDocument();
  });
});
