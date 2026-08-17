import { describe, it, expect } from 'vitest';
import {
  BUTTON_FADE_TICKS,
  CRUSHER_DROP_TICKS,
  CRUSHER_RAISE_TICKS,
  FLASH_TICKS,
  RECOIL_TICKS,
  buttonGlow,
  crusherHeight,
  crusherScale,
  muzzleFlash,
  recoilOffset,
} from './hazard-motion';

describe('the crusher', () => {
  it('is up when idle and down when live, which is what the damage zone means', () => {
    // The one assertion that has to hold. The zone hurts bots exactly while `active`, so a
    // plate shown hovering while it is killing someone is not a style choice, it is a lie.
    expect(crusherHeight(false, CRUSHER_RAISE_TICKS)).toBeCloseTo(1, 2);
    expect(crusherHeight(true, CRUSHER_DROP_TICKS)).toBeCloseTo(0, 2);
  });

  it('drops far faster than it rises', () => {
    // A slam and a winch. Matching the two turns the whole thing into a hover.
    expect(CRUSHER_DROP_TICKS).toBeLessThan(CRUSHER_RAISE_TICKS / 5);
  });

  it('accelerates downward and decelerates upward', () => {
    // Falling under gravity covers more ground in its second half than its first.
    const fallFirst = crusherHeight(true, 0) - crusherHeight(true, CRUSHER_DROP_TICKS / 2);
    const fallSecond = crusherHeight(true, CRUSHER_DROP_TICKS / 2) - crusherHeight(true, CRUSHER_DROP_TICKS);
    expect(fallSecond).toBeGreaterThan(fallFirst);

    // A winch takes up the load and then labours: more ground early than late.
    const riseFirst = crusherHeight(false, CRUSHER_RAISE_TICKS / 2) - crusherHeight(false, 0);
    const riseSecond = crusherHeight(false, CRUSHER_RAISE_TICKS) - crusherHeight(false, CRUSHER_RAISE_TICKS / 2);
    expect(riseFirst).toBeGreaterThan(riseSecond);
  });

  it('never inverts the plate or shrinks it below its floor size', () => {
    for (const active of [true, false]) {
      for (const t of [-5, 0, 1, 9, 500, Number.NaN]) {
        const scale = crusherScale(active, t);
        expect(scale, `${String(active)} @ ${t}`).toBeGreaterThanOrEqual(1);
        expect(scale, `${String(active)} @ ${t}`).toBeLessThan(2);
      }
    }
  });

  it('holds still once it has arrived, rather than drifting', () => {
    // Both ends are clamped, so a crusher left alone for a whole battle is not slowly growing.
    expect(crusherScale(true, 3)).toBeCloseTo(crusherScale(true, 300), 6);
    expect(crusherScale(false, CRUSHER_RAISE_TICKS)).toBeCloseTo(crusherScale(false, 9000), 6);
  });
});

describe('cannon recoil', () => {
  it('kicks hardest at the shot and returns home', () => {
    expect(recoilOffset(0)).toBeGreaterThan(5);
    expect(recoilOffset(RECOIL_TICKS)).toBe(0);
  });

  it('only ever drives the barrel BACK', () => {
    // A positive offset would push the muzzle forward on firing, which reads as the gun
    // spitting the barrel out rather than absorbing a shot.
    for (let t = -3; t < 60; t++) expect(recoilOffset(t), `tick ${t}`).toBeGreaterThanOrEqual(0);
  });

  it('recovers monotonically — no bounce', () => {
    let previous = Infinity;
    for (let t = 0; t <= RECOIL_TICKS; t++) {
      const now = recoilOffset(t);
      expect(now, `tick ${t}`).toBeLessThanOrEqual(previous);
      previous = now;
    }
  });

  it('rests when handed nonsense rather than jamming the barrel open', () => {
    expect(recoilOffset(Number.NaN)).toBe(0);
    expect(recoilOffset(-1)).toBe(0);
  });
});

describe('the muzzle flash', () => {
  it('is brightest on the firing frame and gone within a few', () => {
    expect(muzzleFlash(0)).toBe(1);
    expect(muzzleFlash(FLASH_TICKS)).toBe(0);
    expect(muzzleFlash(FLASH_TICKS + 40)).toBe(0);
  });

  it('stays a flash, not a lamp', () => {
    // Long enough and it stops reading as an event and starts reading as a light that is on.
    expect(FLASH_TICKS).toBeLessThanOrEqual(6);
  });
});

describe('the armed plate rim', () => {
  it('is full brightness the instant it arms', () => {
    // Arming is an event -- a bot has just triggered something. An event that ramps up reads as
    // a dial being turned rather than a trigger being hit.
    expect(buttonGlow(true, 0)).toBe(1);
    expect(buttonGlow(true, 999)).toBe(1);
  });

  it('fades out once the window closes rather than cutting', () => {
    // A hard cut-off looks like a rendering glitch. The fade is what says the trap window has
    // expired, which is information the viewer needs and nothing else on screen carries.
    expect(buttonGlow(false, 0)).toBeCloseTo(1, 2);
    expect(buttonGlow(false, BUTTON_FADE_TICKS / 2)).toBeCloseTo(0.5, 2);
    expect(buttonGlow(false, BUTTON_FADE_TICKS)).toBe(0);
  });

  it('never goes negative or lingers forever', () => {
    for (const t of [-5, 0, 30, 5000, Number.NaN]) {
      const glow = buttonGlow(false, t);
      expect(glow, String(t)).toBeGreaterThanOrEqual(0);
      expect(glow, String(t)).toBeLessThanOrEqual(1);
    }
    expect(buttonGlow(false, BUTTON_FADE_TICKS * 10)).toBe(0);
  });

  it('fades fast enough to track a rapid sequence of triggers', () => {
    // The Crossfire fires plates constantly. A glow outlasting its own trap would leave the
    // floor permanently lit and say nothing.
    expect(BUTTON_FADE_TICKS).toBeLessThanOrEqual(30);
  });
});
