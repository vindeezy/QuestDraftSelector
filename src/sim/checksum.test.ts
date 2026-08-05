import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { createWorld, step } from './world';
import { hashWorld, hashNumbers } from './checksum';

describe('hashNumbers', () => {
  it('is stable for the same input', () => {
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
  });

  it('differs for different input', () => {
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 4]));
  });

  it('detects a tiny floating point difference', () => {
    expect(hashNumbers([0.1])).not.toBe(hashNumbers([0.1 + Number.EPSILON]));
  });

  it('returns an 8-character hex string', () => {
    expect(hashNumbers([42])).toMatch(/^[0-9a-f]{8}$/);
  });

  it('matches the locked reference hashes', () => {
    // These pin the hash function itself. Recorded events carry a checksum produced
    // by this exact function, so changing it invalidates every stored record.
    // If this fails, the hash changed. Revert it. DO NOT paste in new values.
    expect(hashNumbers([1, 2, 3])).toBe('3d41ab30');
    expect(hashNumbers([0.5])).toBe('0c927168');
  });
});

describe('hashWorld', () => {
  it('matches for two identically-stepped worlds', () => {
    const build = () => {
      const w = createWorld({ gravity: 0.4 });
      w.bodies.push(createBody({ id: 'peg', x: 0, y: 60, radius: 6, mass: 0 }));
      w.bodies.push(createBody({ id: 'ball', x: 1, y: 0, radius: 9, mass: 1 }));
      for (let i = 0; i < 400; i++) step(w);
      return w;
    };
    expect(hashWorld(build())).toBe(hashWorld(build()));
  });

  it('differs when a body starts in a different place', () => {
    const build = (startX: number) => {
      const w = createWorld({ gravity: 0.4 });
      w.bodies.push(createBody({ id: 'peg', x: 0, y: 60, radius: 6, mass: 0 }));
      w.bodies.push(createBody({ id: 'ball', x: startX, y: 0, radius: 9, mass: 1 }));
      for (let i = 0; i < 400; i++) step(w);
      return w;
    };
    expect(hashWorld(build(1))).not.toBe(hashWorld(build(1.0001)));
  });
});
