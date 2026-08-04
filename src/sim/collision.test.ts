import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { resolveCircleCircle, resolveCircleSegment, type Segment } from './collision';

describe('resolveCircleCircle', () => {
  it('returns 0 and does nothing when bodies do not overlap', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 100, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleCircle(a, b)).toBe(0);
    expect(a.x).toBe(0);
  });

  it('separates overlapping bodies', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 6, y: 0, radius: 5, mass: 1 });
    resolveCircleCircle(a, b);
    // Overlap is 4. SEPARATION_BIAS (0.8) corrects 3.2 of it, split evenly by
    // inverse mass, leaving them 9.2 apart rather than a full 10. The remaining
    // overlap is corrected over subsequent ticks, which keeps resting stacks stable
    // instead of making them explode apart.
    expect(b.x - a.x).toBeCloseTo(9.2, 8);
  });

  it('pushes only the dynamic body when the other is static', () => {
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 5, mass: 1 });
    const peg = createBody({ id: 'peg', x: 6, y: 0, radius: 5, mass: 0 });
    resolveCircleCircle(ball, peg);
    expect(peg.x).toBe(6);
    // The ball absorbs the whole 3.2 correction because the peg cannot move.
    expect(ball.x).toBeCloseTo(-3.2, 8);
  });

  it('transfers velocity on a perfectly elastic head-on impact', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: 0, restitution: 1 });
    resolveCircleCircle(a, b);
    // Equal masses, fully elastic: the velocities swap.
    expect(a.vx).toBeCloseTo(0, 8);
    expect(b.vx).toBeCloseTo(4, 8);
  });

  it('bounces a ball back off a static peg', () => {
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 1 });
    const peg = createBody({ id: 'peg', x: 9, y: 0, radius: 5, mass: 0, restitution: 1 });
    resolveCircleCircle(ball, peg);
    expect(ball.vx).toBeCloseTo(-4, 8);
    expect(peg.vx).toBe(0);
  });

  it('reports impact speed', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleCircle(a, b)).toBeCloseTo(4, 8);
  });

  it('conserves momentum between two equal dynamic bodies', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 6, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: -2, restitution: 1 });
    const before = a.vx + b.vx;
    resolveCircleCircle(a, b);
    expect(a.vx + b.vx).toBeCloseTo(before, 8);
  });

  it('separates bodies resting at exactly the same point', () => {
    const a = createBody({ id: 'a', x: 10, y: 10, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 10, y: 10, radius: 5, mass: 1 });
    resolveCircleCircle(a, b);
    const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    expect(dist).toBeGreaterThan(0);
    expect(Number.isNaN(dist)).toBe(false);
  });
});

describe('resolveCircleSegment', () => {
  const floor: Segment = { x1: -100, y1: 50, x2: 100, y2: 50 };

  it('does nothing when the body is clear of the segment', () => {
    const b = createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.y).toBe(0);
  });

  it('pushes a body out of a segment it has sunk into', () => {
    const b = createBody({ id: 'b', x: 0, y: 48, radius: 5, mass: 1, vy: 3 });
    resolveCircleSegment(b, floor);
    expect(b.y).toBeCloseTo(45, 8);
  });

  it('reflects velocity off the segment', () => {
    const b = createBody({ id: 'b', x: 0, y: 48, radius: 5, mass: 1, vy: 3, restitution: 0.5 });
    resolveCircleSegment(b, floor);
    expect(b.vy).toBeCloseTo(-1.5, 8);
  });

  it('collides against a segment endpoint', () => {
    const wall: Segment = { x1: 0, y1: 0, x2: 0, y2: 20 };
    const b = createBody({ id: 'b', x: 2, y: 22, radius: 5, mass: 1 });
    expect(resolveCircleSegment(b, wall)).toBeGreaterThanOrEqual(0);
    const dist = Math.sqrt((b.x - 0) ** 2 + (b.y - 20) ** 2);
    expect(dist).toBeGreaterThanOrEqual(4.999);
  });

  it('ignores static bodies', () => {
    const b = createBody({ id: 'peg', x: 0, y: 48, radius: 5, mass: 0 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.y).toBe(48);
  });
});
