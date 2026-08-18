import { describe, it, expect } from 'vitest';
import { DEFAULT_BOT } from '../../sim/arena/bot';
import {
  MAX_MARKS_PER_CALL,
  OIL_CARRY_TICKS,
  TRACK_LIFE_TICKS,
  TRACK_SPACING,
  createTrackField,
  trackAlpha,
} from './tracks';

const live = (f: ReturnType<typeof createTrackField>) => f.marks.filter((m) => m.active);

describe('laying marks', () => {
  it('lays the first one immediately, wherever the bot happens to be', () => {
    const f = createTrackField();
    expect(f.lay(0, 100, 100, 0)).toBe(true);
    expect(live(f)).toHaveLength(1);
  });

  it('refuses a second until the bot has actually travelled', () => {
    // Spacing is by DISTANCE, not time. A stationary bot spinning on the spot must not bury
    // itself in marks.
    const f = createTrackField();
    f.lay(0, 100, 100, 0);
    for (let i = 0; i < 30; i++) f.lay(0, 100, 100, 0);
    expect(live(f)).toHaveLength(1);
  });

  it('lays one once the bot has moved a full spacing', () => {
    const f = createTrackField();
    f.lay(0, 0, 0, 0);
    expect(f.lay(0, TRACK_SPACING - 1, 0, 0)).toBe(false);
    expect(f.lay(0, TRACK_SPACING + 1, 0, 0)).toBe(true);
  });

  it('spaces marks evenly across the real range of bot speeds', () => {
    // The reason spacing is not a tick counter: a trail must encode the PATH, not the speed.
    // A crawling bot and a boosting one should leave the same trail over the same ground.
    //
    // Sampled at 2 and 8 units per tick, which brackets what actually happens -- `DEFAULT_BOT`
    // tops out at 4.5 and Nitro multiplies that by 1.8.
    const slow = createTrackField();
    const fast = createTrackField();
    for (let x = 0; x <= 200; x += 2) slow.lay(0, x, 0, 0);
    for (let x = 0; x <= 200; x += 8) fast.lay(0, x, 0, 0);
    expect(Math.abs(live(slow).length - live(fast).length)).toBeLessThanOrEqual(3);
  });

  it('fills the gap between frames rather than skipping it', () => {
    // The fix for the test above. Laying one mark per call leaves a bot that covered five
    // spacings in a frame with a single mark, so the faster it goes the sparser its trail --
    // exactly backwards for something meant to show speed and travel.
    const f = createTrackField();
    f.lay(0, 0, 0, 0);
    f.lay(0, TRACK_SPACING * 5, 0, 0);
    expect(live(f)).toHaveLength(6);

    const xs = live(f).map((m) => m.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!, `gap ${i}`).toBeCloseTo(TRACK_SPACING, 5);
    }
  });

  it('orients filled marks along the path travelled, not the way the bot faces', () => {
    // A bot sliding across ice points one way and moves another. The marks belong under the
    // wheels, so they follow the travel.
    const f = createTrackField();
    f.lay(0, 0, 0, 0);
    f.lay(0, 0, TRACK_SPACING * 3, 0); // straight down, while still "facing" along +x
    const filled = live(f).filter((m) => m.y > 0);
    for (const m of filled) expect(m.heading).toBeCloseTo(Math.PI / 2, 5);
  });

  it('caps one call, so a teleport cannot stripe a line across the arena', () => {
    // Nothing in the game moves a bot this far in a tick -- top speed is 4.5, or 8.1 under
    // Nitro, against a spacing of 10. The cap is for a respawn, a shockwave launch, or whatever
    // a future arena does, none of which should cost a thousand marks.
    expect(TRACK_SPACING).toBeGreaterThan(DEFAULT_BOT.maxSpeed * 1.8);

    const f = createTrackField({ capacity: 400 });
    f.lay(0, 0, 0, 0);
    f.lay(0, TRACK_SPACING * 300, 0, 0);
    expect(live(f)).toHaveLength(MAX_MARKS_PER_CALL + 1);
  });

  it('tracks each bot separately', () => {
    // One bot moving must not consume another's spacing budget.
    const f = createTrackField();
    f.lay(0, 0, 0, 0);
    f.lay(1, 0, 0, 0);
    expect(live(f)).toHaveLength(2);
  });

  it('records the heading, so a mark lies along the path rather than across it', () => {
    const f = createTrackField();
    f.lay(0, 5, 5, 1.25);
    expect(live(f)[0]?.heading).toBeCloseTo(1.25);
  });

  it('ignores nonsense instead of laying a mark at NaN', () => {
    const f = createTrackField();
    expect(f.lay(0, Number.NaN, 0, 0)).toBe(false);
    expect(f.lay(0, 0, Number.NaN, 0)).toBe(false);
    expect(f.lay(0, 0, 0, Number.NaN)).toBe(false);
    expect(live(f)).toHaveLength(0);
  });
});

describe('the bound', () => {
  it('never exceeds its capacity, however far a bot drives', () => {
    const f = createTrackField({ capacity: 8 });
    for (let x = 0; x < 10_000; x += TRACK_SPACING + 1) f.lay(0, x, 0, 0);
    expect(live(f).length).toBeLessThanOrEqual(8);
  });

  it('recycles the OLDEST mark when full, so the newest trail survives', () => {
    // The freshest part of a trail is the part showing where a bot just went. Dropping new
    // marks to preserve old ones would leave a stale trail and no current one.
    const f = createTrackField({ capacity: 3 });
    for (let i = 0; i < 3; i++) {
      f.lay(0, i * (TRACK_SPACING + 1), 0, 0);
      f.advance();
    }
    f.lay(0, 500, 0, 0);
    const ages = live(f).map((m) => m.age).sort((a, b) => a - b);
    expect(ages[0]).toBe(0);
    expect(Math.max(...ages)).toBeLessThan(3);
  });
});

describe('ageing out', () => {
  it('retires a mark once its life is up', () => {
    const f = createTrackField();
    f.lay(0, 0, 0, 0);
    for (let i = 0; i < TRACK_LIFE_TICKS; i++) f.advance();
    expect(live(f)).toHaveLength(0);
  });

  it('clears everything, including where each bot last marked', () => {
    // Without forgetting the last position, a replay would silently skip the first mark of
    // every trail.
    const f = createTrackField();
    f.lay(0, 100, 100, 0);
    f.clear();
    expect(live(f)).toHaveLength(0);
    expect(f.lay(0, 100, 100, 0)).toBe(true);
  });
});

describe('the fade', () => {
  it('holds full for the first half of its life, then fades out', () => {
    // Oil does not start vanishing the moment it lands. Fading from full immediately makes
    // every trail look like it is already disappearing, which reads as a rendering artefact.
    expect(trackAlpha(0)).toBe(1);
    expect(trackAlpha(TRACK_LIFE_TICKS * 0.5)).toBe(1);
    expect(trackAlpha(TRACK_LIFE_TICKS * 0.75)).toBeCloseTo(0.5, 1);
    expect(trackAlpha(TRACK_LIFE_TICKS)).toBe(0);
  });

  it('stays within range whatever it is handed', () => {
    for (const age of [-10, 0, 40, 5000, Number.NaN]) {
      expect(trackAlpha(age), String(age)).toBeGreaterThanOrEqual(0);
      expect(trackAlpha(age), String(age)).toBeLessThanOrEqual(1);
    }
  });
});

describe('how long oil is carried', () => {
  it('outlasts a slick by long enough to leave the tile', () => {
    // Marks only ON the slick would say nothing the slick does not already say. The trail
    // LEADING AWAY is the whole effect, so the carry has to cover several tiles of driving.
    expect(OIL_CARRY_TICKS).toBeGreaterThan(60);
  });

  it('wears off well inside a battle, so the floor does not end up uniformly marked', () => {
    expect(OIL_CARRY_TICKS).toBeLessThan(240);
  });
});
