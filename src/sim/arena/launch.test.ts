import { describe, it, expect } from 'vitest';
import { integrate } from '../body';
import { createBot, DEFAULT_BOT, type BotStats } from './bot';
import { launch, updateLaunch, LAUNCH_TICKS } from './launch';

const bot = (over: Partial<BotStats> = {}) =>
  createBot({ id: 'b', x: 0, y: 0, heading: 0 }, { ...DEFAULT_BOT, ...over });

describe('launch', () => {
  it('adds impulse along the given direction', () => {
    const b = bot();
    launch(b, 1, 0, 3, 0);
    expect(b.body.vx).toBeCloseTo(3, 8);
    expect(b.body.vy).toBeCloseTo(0, 8);
  });

  it('normalises the direction, so only its sign and ratio matter', () => {
    const a = bot();
    const b = bot();
    launch(a, 1, 0, 3, 0);
    launch(b, 5, 0, 3, 0); // same direction, larger magnitude
    expect(a.body.vx).toBeCloseTo(b.body.vx, 8);
  });

  it('raises the launch cap above the bot\'s normal max speed', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 3, 0);
    expect(b.launchSpeed).toBeCloseTo(7, 8);
    expect(b.launchSpeed).toBeGreaterThan(b.maxSpeed);
  });

  it('sets launchUntil to about one second (LAUNCH_TICKS) out', () => {
    const b = bot();
    launch(b, 1, 0, 3, 100);
    expect(b.launchUntil).toBe(100 + LAUNCH_TICKS);
  });

  it('does nothing for zero force', () => {
    const b = bot();
    launch(b, 1, 0, 0, 0);
    expect(b.body.vx).toBe(0);
    expect(b.body.vy).toBe(0);
    expect(b.launchUntil).toBe(0);
    expect(b.launchSpeed).toBe(b.maxSpeed);
  });

  it('does nothing for negative force', () => {
    const b = bot();
    launch(b, 1, 0, -5, 0);
    expect(b.body.vx).toBe(0);
    expect(b.launchUntil).toBe(0);
  });

  it('does nothing for a zero-length direction', () => {
    const b = bot();
    launch(b, 0, 0, 5, 0);
    expect(b.body.vx).toBe(0);
    expect(b.body.vy).toBe(0);
    expect(b.launchUntil).toBe(0);
  });

  it('relaunching an already-launched bot takes the higher cap rather than stacking', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 5, 0); // cap 9
    expect(b.launchSpeed).toBeCloseTo(9, 8);

    launch(b, 1, 0, 2, 0); // cap 6 — lower than the current 9, must not replace it
    expect(b.launchSpeed).toBeCloseTo(9, 8);

    launch(b, 1, 0, 8, 0); // cap 12 — higher, must replace it
    expect(b.launchSpeed).toBeCloseTo(12, 8);
  });

  it('relaunching still refreshes the duration even when the cap does not increase', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 5, 0);
    expect(b.launchUntil).toBe(LAUNCH_TICKS);
    launch(b, 1, 0, 1, 30); // weaker hit, later tick
    expect(b.launchUntil).toBe(30 + LAUNCH_TICKS);
  });
});

describe('updateLaunch', () => {
  it('immediately raises body.maxSpeed once launched', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 3, 0);
    updateLaunch(b, 0);
    expect(b.body.maxSpeed).toBeGreaterThan(b.maxSpeed);
  });

  it('decays the cap tick over tick rather than holding it at its peak', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 3, 0);
    updateLaunch(b, 0);
    const peak = b.body.maxSpeed!;
    updateLaunch(b, 1);
    expect(b.body.maxSpeed).toBeLessThan(peak);
    expect(b.body.maxSpeed).toBeGreaterThan(b.maxSpeed);
  });

  it('returns to normal within about a second', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 3, 0);
    for (let t = 0; t <= LAUNCH_TICKS; t++) updateLaunch(b, t);
    expect(b.body.maxSpeed).toBe(b.maxSpeed);
    expect(b.launchSpeed).toBe(b.maxSpeed);
  });

  it('holds the raised cap for the tick right before launchUntil, and resets exactly at it', () => {
    const b = bot({ maxSpeed: 4 });
    launch(b, 1, 0, 3, 0);
    updateLaunch(b, b.launchUntil - 1);
    expect(b.body.maxSpeed).toBeGreaterThan(4);
    updateLaunch(b, b.launchUntil);
    expect(b.body.maxSpeed).toBe(4);
  });

  it('a bot never launched is left at its normal speed', () => {
    const b = bot({ maxSpeed: 4 });
    updateLaunch(b, 0);
    expect(b.body.maxSpeed).toBe(4);
  });
});

describe('the launched state moves a bot further', () => {
  it('a launched bot travels measurably further than an unlaunched one given the same impulse', () => {
    // This is the regression test for the whole feature: without the launch cap,
    // integrate() clamps the impulse away on the very next tick and launching would do
    // nothing observable at all.
    const launched = bot({ maxSpeed: 4 });
    const control = bot({ maxSpeed: 4 });

    launch(launched, 1, 0, 6, 0);
    control.body.vx += 6; // identical impulse, but never goes through launch()'s cap raise

    const ticks = 30;
    for (let t = 0; t < ticks; t++) {
      updateLaunch(launched, t);
      integrate(launched.body, 0, launched.maxSpeed, 1);

      updateLaunch(control, t); // no-op: control was never launched
      integrate(control.body, 0, control.maxSpeed, 1);
    }

    expect(launched.body.x).toBeGreaterThan(control.body.x + 3);
  });
});
