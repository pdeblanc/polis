import { describe, expect, it } from 'vitest';
import { frameRateForDuration } from './useFramePerformance';

describe('frameRateForDuration', () => {
  it('caps inexpensive frames at the display refresh target', () => {
    expect(frameRateForDuration(1)).toBe(60);
  });

  it('reports the sustainable rate for slower frames', () => {
    expect(frameRateForDuration(25)).toBe(40);
  });
});
