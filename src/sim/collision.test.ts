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

  it('resolves an elastic impact between bodies of unequal mass', () => {
    // Deliberately NOT a momentum-conservation assertion. Momentum is conserved for
    // ANY impulse value here, because the impulse is applied as +/- j * invMass, so
    // mass * deltaV is +/- j whatever j is. Asserting conservation would pass even
    // with the impulse calculation replaced by a constant. These exact velocities
    // pin j itself: approach speed 8, restitution 1, invMassSum 4/3, so j = 12.
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 3, vx: 6, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: -2, restitution: 1 });
    resolveCircleCircle(a, b);
    expect(a.vx).toBeCloseTo(2, 8);
    expect(b.vx).toBeCloseTo(10, 8);
    // Fully elastic: separation speed equals approach speed.
    expect(b.vx - a.vx).toBeCloseTo(8, 8);
  });

  it('uses the LOWER of the two restitutions', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: 0, restitution: 0.2 });
    resolveCircleCircle(a, b);
    // Taking the higher restitution instead would give 0 and 4.
    expect(a.vx).toBeCloseTo(1.6, 8);
    expect(b.vx).toBeCloseTo(2.4, 8);
  });

  it('pushes a heavy body less than a light one', () => {
    const heavy = createBody({ id: 'h', x: 0, y: 0, radius: 5, mass: 10 });
    const light = createBody({ id: 'l', x: 6, y: 0, radius: 5, mass: 1 });
    resolveCircleCircle(heavy, light);
    // 10:1 mass ratio means the light body absorbs ten times the correction.
    expect(heavy.x).toBeCloseTo(-0.29090909090909, 8);
    expect(light.x).toBeCloseTo(8.90909090909091, 8);
  });

  it('leaves bodies moving together at restitution 0', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 0 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, restitution: 0 });
    resolveCircleCircle(a, b);
    expect(a.vx).toBeCloseTo(2, 8);
    expect(b.vx).toBeCloseTo(2, 8);
  });

  it('does not apply impulse to overlapping bodies already separating', () => {
    // Without this guard an overlapping pair moving apart receives a negative
    // impulse that injects energy — the classic cause of jittering stacks.
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: -3, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: 3, restitution: 1 });
    expect(resolveCircleCircle(a, b)).toBe(0);
    expect(a.vx).toBe(-3);
    expect(b.vx).toBe(3);
  });

  it('ignores two static bodies without producing NaN', () => {
    // Without the guard, invMassSum is 0 and the positional split becomes 0/0.
    // With ~180 generated pegs, one overlapping pair would silently NaN the world.
    const p = createBody({ id: 'p', x: 0, y: 0, radius: 5, mass: 0 });
    const q = createBody({ id: 'q', x: 6, y: 0, radius: 5, mass: 0 });
    expect(resolveCircleCircle(p, q)).toBe(0);
    expect(p.x).toBe(0);
    expect(q.x).toBe(6);
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

  it('clamps t: a body past the endpoint hits the endpoint, not the infinite line', () => {
    // The previous version of this test asserted only `>= 0` on a return value that
    // is non-negative by construction, and a distance bound satisfied by both the
    // clamped and unclamped results. Removing the t clamp passed it.
    const wall: Segment = { x1: 0, y1: 0, x2: 0, y2: 20 };
    const b = createBody({ id: 'b', x: 2, y: 22, radius: 5, mass: 1, vx: -1, vy: -1 });
    const speed = resolveCircleSegment(b, wall);
    expect(b.x).toBeCloseTo(3.53553390593274, 8); // unclamped: 5
    expect(b.y).toBeCloseTo(23.53553390593274, 8); // unclamped: 22
    expect(b.vy).toBeCloseTo(0.4, 8); // unclamped: -1
    expect(speed).toBeCloseTo(1.41421356237309, 8); // unclamped: 1
  });

  it('does not apply impulse to a body already leaving a segment', () => {
    const b = createBody({ id: 'b', x: 0, y: 48, radius: 5, mass: 1, vy: -3 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.vy).toBe(-3);
  });

  it('ignores static bodies', () => {
    const b = createBody({ id: 'peg', x: 0, y: 48, radius: 5, mass: 0 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.y).toBe(48);
  });
});
