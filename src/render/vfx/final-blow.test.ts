import { describe, it, expect } from 'vitest';
import {
  CLOSEST,
  HOLD_MS,
  LEAD_TICKS,
  RELEASE_MS,
  SLOWEST,
  cameraShot,
  easeOutShot,
  leadProgress,
  playbackSpeed,
  releaseDone,
  releaseWeight,
} from './final-blow';

const FINAL = 9000;
const FOCUS = { x: 700, y: 200 };
const CENTRE = { x: 480, y: 360 };

describe('the run-up', () => {
  it('does nothing until the blow is in sight', () => {
    // The overwhelming majority of a battle must be untouched. A camera that is always
    // easing somewhere turns every exchange into a highlight and none of them into one.
    expect(leadProgress(0, FINAL)).toBe(0);
    expect(leadProgress(FINAL - LEAD_TICKS - 1, FINAL)).toBe(0);
    expect(playbackSpeed(1000, FINAL)).toBe(1);
  });

  it('reaches full intensity exactly at the blow', () => {
    expect(leadProgress(FINAL, FINAL)).toBe(1);
    expect(playbackSpeed(FINAL, FINAL)).toBeCloseTo(SLOWEST, 5);
    expect(cameraShot(FINAL, FINAL, FOCUS, CENTRE).scale).toBeCloseTo(CLOSEST, 5);
  });

  it('holds at full intensity past the blow rather than overshooting', () => {
    // The loop can overrun by a tick at fractional speed. Extrapolating would push the
    // camera past the framing that was chosen, on the one frame everybody is looking at.
    expect(leadProgress(FINAL + 5, FINAL)).toBe(1);
    expect(playbackSpeed(FINAL + 30, FINAL)).toBeCloseTo(SLOWEST, 5);
  });

  it('never stops the simulation, however far in it gets', () => {
    // A frozen sim during the run-up would halt the fight BEFORE the blow, so the blow
    // would never arrive and the battle would hang on a held breath.
    for (let tick = FINAL - LEAD_TICKS; tick <= FINAL; tick++) {
      expect(playbackSpeed(tick, FINAL), `tick ${tick}`).toBeGreaterThan(0);
    }
  });

  it('slows down monotonically', () => {
    let last = Infinity;
    for (let tick = FINAL - LEAD_TICKS; tick <= FINAL; tick++) {
      const speed = playbackSpeed(tick, FINAL);
      expect(speed, `tick ${tick}`).toBeLessThanOrEqual(last + 1e-9);
      last = speed;
    }
  });

  it('eases rather than ramping linearly', () => {
    // The push has to start and finish gently or it reads as a mechanism rather than a
    // camera. The signature of ease-in-out is that it LAGS a linear ramp through the first
    // half and LEADS it through the second — asserted at both ends, because checking only
    // one would also pass for a curve that is simply slow or simply fast throughout.
    const scaleAt = (p: number) =>
      cameraShot(FINAL - LEAD_TICKS + LEAD_TICKS * p, FINAL, FOCUS, CENTRE).scale;
    const linearAt = (p: number) => 1 + (CLOSEST - 1) * p;

    expect(scaleAt(0.25)).toBeLessThan(linearAt(0.25));
    expect(scaleAt(0.75)).toBeGreaterThan(linearAt(0.75));
    // And it crosses in the middle, which is what makes it symmetric rather than skewed.
    expect(scaleAt(0.5)).toBeCloseTo(linearAt(0.5), 5);
  });
});

describe('where it looks', () => {
  it('starts on the whole arena and arrives on the doomed bot', () => {
    const before = cameraShot(FINAL - LEAD_TICKS, FINAL, FOCUS, CENTRE);
    expect(before).toMatchObject({ x: CENTRE.x, y: CENTRE.y, scale: 1 });

    const at = cameraShot(FINAL, FINAL, FOCUS, CENTRE);
    expect(at.x).toBeCloseTo(FOCUS.x, 5);
    expect(at.y).toBeCloseTo(FOCUS.y, 5);
  });

  it('moves and zooms as one gesture, not a cut then a zoom', () => {
    // At every point in the run-up the framing is somewhere between the two, never snapped.
    for (const p of [0.25, 0.5, 0.75]) {
      const shot = cameraShot(FINAL - LEAD_TICKS + LEAD_TICKS * p, FINAL, FOCUS, CENTRE);
      const between = (a: number, b: number, v: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
      expect(between(CENTRE.x, FOCUS.x, shot.x), `x at ${p}`).toBe(true);
      expect(between(CENTRE.y, FOCUS.y, shot.y), `y at ${p}`).toBe(true);
      expect(shot.scale).toBeGreaterThan(1);
      expect(shot.scale).toBeLessThan(CLOSEST);
    }
  });
});

describe('letting go', () => {
  it('holds first, then releases', () => {
    expect(releaseWeight(0)).toBe(1);
    expect(releaseWeight(HOLD_MS)).toBe(1);
    expect(releaseWeight(HOLD_MS + RELEASE_MS / 2)).toBeLessThan(1);
    expect(releaseWeight(HOLD_MS + RELEASE_MS)).toBeCloseTo(0, 5);
  });

  it('gives the whole arena back, because the result is read from it', () => {
    const shot = cameraShot(FINAL, FINAL, FOCUS, CENTRE);
    const released = easeOutShot(shot, CENTRE, releaseWeight(HOLD_MS + RELEASE_MS));
    expect(released.scale).toBeCloseTo(1, 5);
    expect(released.x).toBeCloseTo(CENTRE.x, 5);
    expect(released.y).toBeCloseTo(CENTRE.y, 5);
  });

  it('knows when it is finished so the screen can move on', () => {
    expect(releaseDone(0)).toBe(false);
    expect(releaseDone(HOLD_MS)).toBe(false);
    expect(releaseDone(HOLD_MS + RELEASE_MS)).toBe(true);
  });

  it('survives nonsense instead of leaving the camera somewhere impossible', () => {
    for (const ms of [Number.NaN, -1000, Infinity]) {
      const w = releaseWeight(ms);
      expect(w, String(ms)).toBeGreaterThanOrEqual(0);
      expect(w, String(ms)).toBeLessThanOrEqual(1);
    }
    const shot = easeOutShot({ x: 1, y: 2, scale: 3 }, CENTRE, Number.NaN);
    expect(shot).toMatchObject({ x: CENTRE.x, y: CENTRE.y, scale: 1 });
  });
});

describe('determinism', () => {
  it('gives identical framing for identical input', () => {
    // The site has a Replay button, and this is the most-watched second of the whole event.
    for (let tick = FINAL - LEAD_TICKS; tick <= FINAL; tick++) {
      expect(playbackSpeed(tick, FINAL)).toBe(playbackSpeed(tick, FINAL));
      expect(cameraShot(tick, FINAL, FOCUS, CENTRE)).toEqual(cameraShot(tick, FINAL, FOCUS, CENTRE));
    }
  });
});
