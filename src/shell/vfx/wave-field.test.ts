import { describe, it, expect } from 'vitest';
import {
  WAVE_AMPLITUDE,
  WAVE_LINES,
  lineAlpha,
  lineBase,
  waveOffset,
} from './wave-field';

describe('the field moving', () => {
  it('is somewhere different a second later', () => {
    expect(waveOffset(0.5, 10, 0)).not.toBeCloseTo(waveOffset(0.5, 10, 1), 4);
  });

  it('is identical for the same moment, every time it is asked', () => {
    // The landing screen is the first thing anyone sees and the site has a Replay button.
    // A background that differed between two viewings would be the one moving thing on the
    // page nobody could account for.
    for (const t of [0, 3.7, 91.2]) {
      expect(waveOffset(0.3, 7, t)).toBe(waveOffset(0.3, 7, t));
    }
  });

  it('stays inside its stated amplitude everywhere', () => {
    for (let line = 0; line < WAVE_LINES; line++) {
      for (let step = 0; step <= 60; step++) {
        const x = step / 60;
        for (const t of [0, 1.3, 6.6, 20.9, 137.4]) {
          expect(Math.abs(waveOffset(x, line, t))).toBeLessThanOrEqual(WAVE_AMPLITUDE + 1e-9);
        }
      }
    }
  });

  it('flattens against both edges so the field has no visible rectangle', () => {
    for (const t of [0, 2.5, 11.1]) {
      expect(Math.abs(waveOffset(0, 5, t))).toBeLessThan(1e-9);
      expect(Math.abs(waveOffset(1, 5, t))).toBeLessThan(1e-9);
    }
  });

  it('does not have every line swinging in lockstep', () => {
    // Lines in phase read as a barcode sliding sideways, not as a field.
    const a = waveOffset(0.5, 0, 2);
    const b = waveOffset(0.5, 1, 2);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-3);
  });

  it('has not found a common period within a long sit on the screen', () => {
    // Somebody waiting for the rest of the league could be on this screen for minutes. Sample
    // one line across five minutes and check it never returns to where it started.
    const reference = waveOffset(0.5, 12, 0);
    let repeats = 0;
    for (let t = 1; t <= 300; t += 0.25) {
      if (Math.abs(waveOffset(0.5, 12, t) - reference) < 1e-6) repeats++;
    }
    expect(repeats).toBe(0);
  });

  it('returns flat rather than NaN when handed nonsense', () => {
    expect(waveOffset(Number.NaN, 4, 1)).toBe(0);
    expect(waveOffset(0.5, Number.NaN, 1)).toBe(0);
    expect(waveOffset(0.5, 4, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('how bright each line is', () => {
  it('is brightest through the middle and dimmest at the extremes', () => {
    const middle = lineAlpha(Math.floor((WAVE_LINES - 1) / 2));
    expect(middle).toBeGreaterThan(lineAlpha(0));
    expect(middle).toBeGreaterThan(lineAlpha(WAVE_LINES - 1));
  });

  it('goes to nothing at the top and bottom rather than cutting off', () => {
    expect(lineAlpha(0)).toBeCloseTo(0, 6);
    expect(lineAlpha(WAVE_LINES - 1)).toBeCloseTo(0, 6);
  });

  it('stays within 0 and 1 for every line', () => {
    for (let line = 0; line < WAVE_LINES; line++) {
      const a = lineAlpha(line);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('is symmetric about the middle', () => {
    for (let line = 0; line < WAVE_LINES; line++) {
      expect(lineAlpha(line)).toBeCloseTo(lineAlpha(WAVE_LINES - 1 - line), 9);
    }
  });

  it('survives a degenerate field of one line', () => {
    expect(lineAlpha(0, 1)).toBe(1);
    expect(lineBase(0, 1)).toBe(0.5);
  });
});

describe('where the lines sit', () => {
  it('runs top to bottom in order', () => {
    let previous = -Infinity;
    for (let line = 0; line < WAVE_LINES; line++) {
      const y = lineBase(line);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
  });

  it('leaves a margin at both ends, even once fully displaced', () => {
    // The outermost line plus a full swing must still be on screen; a line drawn off the
    // viewport is cost with nothing to show for it.
    expect(lineBase(0) - WAVE_AMPLITUDE).toBeGreaterThan(0);
    expect(lineBase(WAVE_LINES - 1) + WAVE_AMPLITUDE).toBeLessThan(1);
  });

  it('keeps the swing close enough to the spacing that lines barely pile up', () => {
    // This is a CONTRAST guard wearing a geometry costume, and it is the one test here worth
    // reading before changing anything.
    //
    // The canvas composites with `lighter`, so crossings ADD alpha. The first version ran 44
    // lines with a swing three times the gap between them, six lines could land on the same
    // pixel, and the field measured 0.71 alpha under the tagline against a 0.22 stroke —
    // dragging it to 4.57:1, which passes AA by 0.07. Holding the swing near the spacing keeps
    // the measured peak under the type at 0.22: one line, never a pile.
    //
    // So: raising WAVE_LINES or WAVE_AMPLITUDE without re-measuring the landing's contrast is
    // exactly the mistake this exists to stop.
    const spacing = lineBase(1) - lineBase(0);
    expect(WAVE_AMPLITUDE / spacing).toBeLessThan(1.5);
  });
});
