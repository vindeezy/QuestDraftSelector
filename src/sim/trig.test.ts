import { describe, it, expect } from 'vitest';
import {
  ANGLE_STEPS,
  ANGLE_MASK,
  STEPS_PER_RADIAN,
  cosOf,
  sinOf,
  normalizeAngle,
} from './trig';

const TAU = 6.283185307179586;

describe('angle indices', () => {
  it('uses 4096 steps', () => {
    expect(ANGLE_STEPS).toBe(4096);
    expect(ANGLE_MASK).toBe(4095);
  });

  it('normalizes out-of-range indices by wrapping', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(4096)).toBe(0);
    expect(normalizeAngle(4097)).toBe(1);
    expect(normalizeAngle(-1)).toBe(4095);
    expect(normalizeAngle(-4096)).toBe(0);
    expect(normalizeAngle(99999)).toBeGreaterThanOrEqual(0);
    expect(normalizeAngle(99999)).toBeLessThan(4096);
  });

  it('wraps indices passed to cosOf and sinOf', () => {
    expect(cosOf(4096)).toBe(cosOf(0));
    expect(sinOf(-1)).toBe(sinOf(4095));
  });
});

describe('direction table', () => {
  it('gives the four cardinal directions exactly enough', () => {
    // Index 0 is +x. Index increases toward +y, which is DOWN in screen space.
    expect(cosOf(0)).toBeCloseTo(1, 12);
    expect(sinOf(0)).toBeCloseTo(0, 12);
    expect(cosOf(1024)).toBeCloseTo(0, 9);
    expect(sinOf(1024)).toBeCloseTo(1, 12);
    expect(cosOf(2048)).toBeCloseTo(-1, 12);
    expect(sinOf(2048)).toBeCloseTo(0, 9);
    expect(cosOf(3072)).toBeCloseTo(0, 9);
    expect(sinOf(3072)).toBeCloseTo(-1, 12);
  });

  it('produces unit vectors at every index', () => {
    for (let i = 0; i < ANGLE_STEPS; i++) {
      const len = Math.sqrt(cosOf(i) * cosOf(i) + sinOf(i) * sinOf(i));
      expect(len).toBeCloseTo(1, 9);
    }
  });

  it('matches the platform trig closely enough for gameplay', () => {
    // Math.sin is banned in src/sim, but a TEST may use it as an oracle. This
    // confirms the polynomial is actually correct rather than merely consistent.
    for (let i = 0; i < ANGLE_STEPS; i += 7) {
      const angle = (i * TAU) / ANGLE_STEPS;
      expect(cosOf(i)).toBeCloseTo(Math.cos(angle), 8);
      expect(sinOf(i)).toBeCloseTo(Math.sin(angle), 8);
    }
  });

  it('is symmetric about the axes', () => {
    for (let i = 0; i < ANGLE_STEPS; i += 13) {
      expect(sinOf(-i)).toBeCloseTo(-sinOf(i), 12);
      expect(cosOf(-i)).toBeCloseTo(cosOf(i), 12);
    }
  });

  it('exposes a steps-per-radian conversion', () => {
    expect(STEPS_PER_RADIAN).toBeCloseTo(ANGLE_STEPS / TAU, 9);
  });

  it('matches the locked reference table', () => {
    // These pin the polynomial. Recorded events replay through this exact table, so
    // changing these numbers invalidates every recording.
    // If this fails, the table changed. Revert it. DO NOT paste in new values.
    for (const [index, cos, sin] of [
      [1, 0.9999988234517019, 0.0015339801862847655],
      [137, 0.9779985149345571, 0.2086118519782635],
      [1023, 0.0015339801862814806, 0.9999988234517018],
      [1025, -0.0015339801862847655, 0.9999988234517019],
      [3000, -0.11022220729388232, -0.993906970002356],
    ] as const) {
      expect(cosOf(index)).toBe(cos);
      expect(sinOf(index)).toBe(sin);
    }
  });
});
