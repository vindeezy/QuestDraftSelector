import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { createWorld, step, isSettled } from './world';

describe('createWorld', () => {
  it('starts at tick 0', () => {
    expect(createWorld({ gravity: 0.4 }).tick).toBe(0);
  });
});

describe('step', () => {
  it('advances the tick counter', () => {
    const w = createWorld({ gravity: 0 });
    step(w);
    step(w);
    expect(w.tick).toBe(2);
  });

  it('drops a body under gravity', () => {
    const w = createWorld({ gravity: 0.5 });
    const b = createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1 });
    w.bodies.push(b);
    step(w);
    expect(b.y).toBeGreaterThan(0);
  });

  it('records contacts produced during the tick', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 3 }));
    w.bodies.push(createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 }));
    step(w);
    expect(w.contacts.length).toBe(1);
    expect(w.contacts[0]!.speed).toBeGreaterThan(0);
  });

  it('clears contacts at the start of each tick', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 3 }));
    w.bodies.push(createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 }));
    step(w);
    for (let i = 0; i < 200; i++) step(w);
    expect(w.contacts.length).toBe(0);
  });

  it('never lets a body tunnel through a static peg', () => {
    const w = createWorld({ gravity: 0.6, maxSpeed: 6 });
    w.bodies.push(createBody({ id: 'peg', x: 0, y: 400, radius: 6, mass: 0 }));
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 10, mass: 1 });
    w.bodies.push(ball);
    for (let i = 0; i < 300; i++) {
      step(w);
      // The ball must never end a tick on the far side of the peg.
      if (ball.y > 420) throw new Error(`tunnelled at tick ${w.tick}`);
    }
    expect(ball.y).toBeLessThanOrEqual(420);
  });

  it('produces no NaN values over a long run', () => {
    const w = createWorld({ gravity: 0.4 });
    for (let i = 0; i < 30; i++) {
      w.bodies.push(createBody({ id: `p${i}`, x: i * 7, y: 100, radius: 5, mass: 0 }));
    }
    for (let i = 0; i < 10; i++) {
      w.bodies.push(createBody({ id: `b${i}`, x: 40 + i, y: 0, radius: 8, mass: 1 }));
    }
    w.segments.push({ x1: -200, y1: 300, x2: 400, y2: 300 });
    for (let i = 0; i < 2000; i++) step(w);
    for (const b of w.bodies) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
      expect(Number.isFinite(b.vx)).toBe(true);
      expect(Number.isFinite(b.vy)).toBe(true);
    }
  });
});

describe('isSettled', () => {
  it('is false while bodies are moving', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1, vx: 5 }));
    expect(isSettled(w, 0.05)).toBe(false);
  });

  it('is true when every dynamic body is nearly still', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1, vx: 0.001 }));
    w.bodies.push(createBody({ id: 'peg', x: 50, y: 0, radius: 5, mass: 0 }));
    expect(isSettled(w, 0.05)).toBe(true);
  });
});
