import { describe, it, expect } from 'vitest';
import { lengthSq, length, clampLength } from './vec';

describe('vec', () => {
  it('lengthSq avoids sqrt', () => {
    expect(lengthSq(3, 4)).toBe(25);
  });

  it('length computes magnitude', () => {
    expect(length(3, 4)).toBe(5);
  });

  it('clampLength leaves short vectors untouched', () => {
    expect(clampLength(3, 4, 10)).toEqual({ x: 3, y: 4 });
  });

  it('clampLength scales long vectors down to the maximum', () => {
    const r = clampLength(30, 40, 5);
    expect(r.x).toBeCloseTo(3, 10);
    expect(r.y).toBeCloseTo(4, 10);
    expect(length(r.x, r.y)).toBeCloseTo(5, 10);
  });

  it('clampLength handles the zero vector without dividing by zero', () => {
    expect(clampLength(0, 0, 5)).toEqual({ x: 0, y: 0 });
  });
});
