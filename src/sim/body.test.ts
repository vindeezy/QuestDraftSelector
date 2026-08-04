import { describe, it, expect } from 'vitest';
import { createBody, integrate, type Body } from './body';

const ball = (over: Partial<Body> = {}): Body =>
  createBody({ id: 'b', x: 0, y: 0, radius: 10, mass: 1, ...over });

describe('createBody', () => {
  it('computes inverse mass', () => {
    expect(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 4 }).invMass).toBe(0.25);
  });

  it('treats mass 0 as static (infinite mass)', () => {
    expect(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 0 }).invMass).toBe(0);
  });
});

describe('integrate', () => {
  it('applies gravity to velocity', () => {
    const b = ball();
    integrate(b, 0.5, 100, 1);
    expect(b.vy).toBe(0.5);
  });

  it('moves the body by its velocity', () => {
    const b = ball({ vx: 2, vy: 3 });
    integrate(b, 0, 100, 1);
    expect(b.x).toBe(2);
    expect(b.y).toBe(3);
  });

  it('applies drag to velocity', () => {
    const b = ball({ vx: 10 });
    integrate(b, 0, 100, 0.9);
    expect(b.vx).toBeCloseTo(9, 10);
  });

  it('clamps speed to maxSpeed', () => {
    const b = ball({ vx: 100, vy: 0 });
    integrate(b, 0, 7, 1);
    expect(b.vx).toBeCloseTo(7, 10);
  });

  it('never exceeds maxSpeed no matter how long gravity acts', () => {
    const b = ball();
    for (let i = 0; i < 5000; i++) integrate(b, 0.5, 9, 1);
    expect(Math.sqrt(b.vx * b.vx + b.vy * b.vy)).toBeLessThanOrEqual(9.0000001);
  });

  it('does not move static bodies', () => {
    const b = createBody({ id: 'peg', x: 5, y: 5, radius: 4, mass: 0 });
    integrate(b, 0.5, 100, 1);
    expect(b).toMatchObject({ x: 5, y: 5, vx: 0, vy: 0 });
  });
});
