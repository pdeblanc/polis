import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PerformanceControl } from './PerformanceControl';

describe('PerformanceControl', () => {
  it('formats the latest frame measurements', () => {
    render(
      <PerformanceControl
        performance={{ framesPerSecond: 59.6, queriesPerFrame: 12_345 }}
      />,
    );

    expect(screen.getByText('FPS 60')).toBeInTheDocument();
    expect(screen.getByText('Queries/frame 12,345')).toBeInTheDocument();
  });
});
