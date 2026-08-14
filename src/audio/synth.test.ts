import { describe, it, expect } from 'vitest';
import { decayFor, gainFor, pitchFor, MIN_DECAY_S, MAX_DECAY_S } from './synth';

/**
 * Only the parameter maths is tested here. Scheduling nodes needs a real `AudioContext`,
 * which jsdom does not have — and a fake would only prove the fake was called, not that a
 * hit sounds like a hit. That judgement belongs at the sound lab (SND 7).
 *
 * What IS worth pinning is the shape of the intensity curves, because they are the whole
 * reason synthesis was chosen over samples: the bus hands over a 0-1 intensity and these
 * three functions are what turn it into a glancing tick or a heavy crunch.
 */

describe('pitchFor', () => {
  it('drops as intensity rises — a heavier hit is a lower sound', () => {
    expect(pitchFor(1, 800)).toBeLessThan(pitchFor(0.5, 800));
    expect(pitchFor(0.5, 800)).toBeLessThan(pitchFor(0, 800));
  });

  it('returns the base pitch at zero intensity', () => {
    expect(pitchFor(0, 800)).toBeCloseTo(800);
  });

  it('never reaches zero or goes negative, which would silence or invert the oscillator', () => {
    expect(pitchFor(1, 800)).toBeGreaterThan(0);
    expect(pitchFor(5, 800)).toBeGreaterThan(0);
  });

  it('clamps out-of-range intensity rather than trusting the caller', () => {
    expect(pitchFor(5, 800)).toBe(pitchFor(1, 800));
    expect(pitchFor(-3, 800)).toBe(pitchFor(0, 800));
  });
});

describe('decayFor', () => {
  it('lengthens as intensity rises — a heavier hit rings longer', () => {
    expect(decayFor(1)).toBeGreaterThan(decayFor(0.5));
    expect(decayFor(0.5)).toBeGreaterThan(decayFor(0));
  });

  it('stays inside the stated bounds at both extremes', () => {
    expect(decayFor(0)).toBeCloseTo(MIN_DECAY_S);
    expect(decayFor(1)).toBeCloseTo(MAX_DECAY_S);
  });

  it('keeps even the heaviest hit short enough not to smear the next one', () => {
    // Ten bots in a scrum land hits far faster than this; a decay much past a quarter
    // second and the individual impacts stop being audible as impacts.
    expect(MAX_DECAY_S).toBeLessThanOrEqual(0.3);
  });

  it('clamps out-of-range intensity', () => {
    expect(decayFor(9)).toBeCloseTo(MAX_DECAY_S);
    expect(decayFor(-9)).toBeCloseTo(MIN_DECAY_S);
  });
});

describe('gainFor', () => {
  it('rises with intensity', () => {
    expect(gainFor(1)).toBeGreaterThan(gainFor(0.5));
    expect(gainFor(0.5)).toBeGreaterThan(gainFor(0));
  });

  it('is audible even at zero intensity — a landed hit is never silent', () => {
    // A hit that dealt almost no damage still happened. Scaling straight from 0 would make
    // glancing blows vanish, and glancing blows are most of a battle.
    expect(gainFor(0)).toBeGreaterThan(0.05);
  });

  it('never exceeds 1, so the limiter is a safety net rather than the mix', () => {
    expect(gainFor(1)).toBeLessThanOrEqual(1);
    expect(gainFor(4)).toBeLessThanOrEqual(1);
  });

  it('is curved, not linear, so mid-intensity hits are not half as loud as heavy ones', () => {
    // Perceived loudness is roughly logarithmic; a linear ramp makes everything below a
    // heavy hit sound like nothing.
    const mid = gainFor(0.5);
    const linear = (gainFor(0) + gainFor(1)) / 2;
    expect(mid).toBeGreaterThan(linear);
  });
});
