import { describe, it, expect } from 'vitest';
import {
  SHAPE_HIGH,
  SHAPE_LOW,
  SMOKE_RAMP,
  fbm,
  shape,
  smokeColour,
  smokeDensity,
} from './smoke-field';

describe('the noise underneath', () => {
  it('stays inside 0 and 1 across a wide sweep of the field', () => {
    for (let i = 0; i < 4000; i++) {
      const x = (i % 200) * 0.37 - 37;
      const y = Math.floor(i / 200) * 0.53 - 5;
      const v = fbm(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — no visible seams where the lattice cells meet', () => {
    // A straight lerp between lattice corners leaves a crease on every cell boundary, because
    // the slope jumps there. Walk across several boundaries and check no step is an outlier.
    let biggest = 0;
    for (let i = 0; i < 900; i++) {
      const x = 3 + i * 0.01;
      biggest = Math.max(biggest, Math.abs(fbm(x + 0.01, 7.5) - fbm(x, 7.5)));
    }
    expect(biggest).toBeLessThan(0.05);
  });

  it('actually varies rather than sitting at one value', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(Math.round(fbm(i * 1.7, i * 0.9) * 100));
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('the smoke moving', () => {
  it('has changed a few seconds later', () => {
    expect(smokeDensity(2, 2, 0)).not.toBeCloseTo(smokeDensity(2, 2, 6), 3);
  });

  it('is identical for the same moment, every time it is asked', () => {
    // The landing is the first thing anyone sees and the site has a Replay button. A
    // background that differed between two viewings would be the one moving thing on the page
    // nobody could account for.
    for (const t of [0, 4.4, 88.1]) {
      expect(smokeDensity(1.5, 0.7, t)).toBe(smokeDensity(1.5, 0.7, t));
    }
  });

  it('stays inside 0 and 1 everywhere, at every time tried', () => {
    for (const t of [0, 3, 17, 120, 900]) {
      for (let i = 0; i < 600; i++) {
        const d = smokeDensity((i % 30) * 0.4, Math.floor(i / 30) * 0.4, t);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('curls rather than sliding rigidly in one direction', () => {
    // The point of warping the domain. If the field merely translated, then every point would
    // find its neighbour's old value after the right delay, and this difference would collapse
    // to nothing somewhere. Rigid drift is the failure mode that makes noise read as wallpaper.
    let matches = 0;
    for (let i = 0; i < 200; i++) {
      const x = 2 + i * 0.11;
      const before = smokeDensity(x, 3, 0);
      const after = smokeDensity(x + 0.05 * 4, 3, 4);
      if (Math.abs(before - after) < 0.002) matches++;
    }
    expect(matches).toBeLessThan(20);
  });

  it('does not repeat within a long sit on the screen', () => {
    // Somebody waiting for the rest of the league could be here for minutes.
    const reference = smokeDensity(4, 4, 0);
    let repeats = 0;
    for (let t = 2; t <= 300; t += 0.5) {
      if (Math.abs(smokeDensity(4, 4, t) - reference) < 1e-6) repeats++;
    }
    expect(repeats).toBe(0);
  });

  it('returns empty rather than NaN when handed nonsense', () => {
    expect(smokeDensity(Number.NaN, 1, 1)).toBe(0);
    expect(smokeDensity(1, Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(smokeDensity(1, 1, Number.NaN)).toBe(0);
  });
});

describe('pushing the density apart', () => {
  it('opens out the band the noise actually occupies', () => {
    expect(shape(SHAPE_LOW)).toBeCloseTo(0, 6);
    expect(shape(SHAPE_HIGH)).toBeCloseTo(1, 6);
  });

  it('clamps outside that band instead of running away', () => {
    expect(shape(0.05)).toBe(0);
    expect(shape(0.99)).toBe(1);
    expect(shape(Number.NaN)).toBe(0);
  });

  it('never goes backwards', () => {
    let previous = -Infinity;
    for (let d = 0; d <= 1; d += 0.01) {
      const v = shape(d);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  it('keeps the midtones dark rather than distributing them evenly', () => {
    // The gamma's whole job. Without it the window spreads values evenly across the range and
    // the screen becomes a marble texture — evenly-lit smoke is not smoke.
    const middle = (SHAPE_LOW + SHAPE_HIGH) / 2;
    expect(shape(middle)).toBeLessThan(0.3);
  });

  it('is mostly empty, with lit edges that are genuinely rare', () => {
    // This is the test that would have caught the landing being a slab of orange, and it is
    // asserted against a real patch of field rather than against the curve in theory. The
    // first version of `shape` put 19% of pixels past 0.8 and clamped a tenth of the screen
    // to solid 1.0.
    const values: number[] = [];
    for (let row = 0; row < 90; row++) {
      for (let col = 0; col < 160; col++) {
        values.push(shape(smokeDensity(col * (2.6 / 160), row * (2.6 / 160), 5)));
      }
    }
    const share = (predicate: (v: number) => boolean) =>
      (values.filter(predicate).length / values.length) * 100;

    expect(share((v) => v < 0.1)).toBeGreaterThan(30);
    expect(share((v) => v > 0.5)).toBeLessThan(25);
    expect(share((v) => v > 0.8)).toBeLessThan(8);
    // ...but it must not be empty either. A field with no lit edge is fog, not smoke.
    expect(share((v) => v > 0.8)).toBeGreaterThan(0.5);
  });
});

describe('the colour ramp', () => {
  it('runs dark to light, in order, with no step backwards', () => {
    let previous = -1;
    for (const stop of SMOKE_RAMP) {
      const sum = stop.rgb[0] + stop.rgb[1] + stop.rgb[2];
      expect(sum).toBeGreaterThan(previous);
      previous = sum;
    }
  });

  it('hits its end stops exactly', () => {
    const first = SMOKE_RAMP.at(0);
    const last = SMOKE_RAMP.at(-1);
    expect(smokeColour(0)).toEqual(first ? [...first.rgb] : null);
    expect(smokeColour(1)).toEqual(last ? [...last.rgb] : null);
  });

  it('never emits a channel outside a byte', () => {
    for (let d = -0.5; d <= 1.5; d += 0.01) {
      for (const channel of smokeColour(d)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
        expect(Number.isInteger(channel)).toBe(true);
      }
    }
  });

  it('stops well short of white at the top', () => {
    // The brightest stop is the only part of the field with the power to hurt the title's
    // contrast. It is meant to be a hot edge, not a light source.
    const [r, g, b] = smokeColour(1);
    expect(Math.max(r, g, b)).toBeLessThan(232);
  });

  it('is warm at the top and neutral at the bottom', () => {
    // Ember over charcoal, the site's own lighting — not the reference's blues.
    const hot = smokeColour(1);
    expect(hot[0]).toBeGreaterThan(hot[2] * 2);
    const void_ = smokeColour(0);
    expect(Math.abs(void_[0] - void_[2])).toBeLessThan(12);
  });
});
