import { describe, it, expect } from 'vitest';
import { clampLength } from '../vec';
import { createBot, DEFAULT_BOT, type Bot } from './bot';
import { MIN_THROTTLE, interceptOffset, throttleFor, driveToward, driveAway } from './steering';

const at = (x: number, y: number, heading: number): Bot =>
  createBot({ id: `${x}_${y}`, x, y, heading });

describe('interceptOffset', () => {
  it('aims straight at a stationary target', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 100, 0, 0, 0, 7);
    expect(o.x).toBeCloseTo(100, 6);
    expect(o.y).toBeCloseTo(0, 6);
  });

  it('leads a target moving across its path', () => {
    // Target 70 away, so lead time is 10 ticks at speed 7. Moving +y at 2 per tick
    // means it will be 20 further down by the time we arrive.
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 70, 0, 0, 2, 7);
    expect(o.x).toBeCloseTo(70, 6);
    expect(o.y).toBeCloseTo(20, 6);
  });

  it('does not lead a target closing head-on', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 70, 0, -2, 0, 7);
    expect(o.y).toBeCloseTo(0, 6);
    expect(o.x).toBeLessThan(70);
  });

  it('handles a target on top of the bot without dividing by zero', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 0, 0, 3, 3, 7);
    expect(Number.isFinite(o.x)).toBe(true);
    expect(Number.isFinite(o.y)).toBe(true);
  });
});

describe('throttleFor', () => {
  it('is full when facing the target', () => {
    expect(throttleFor(at(0, 0, 0), 1, 0)).toBeCloseTo(1, 8);
  });

  it('is the minimum when the target is behind', () => {
    expect(throttleFor(at(0, 0, 0), -1, 0)).toBe(MIN_THROTTLE);
  });

  it('is the minimum when the target is exactly to the side', () => {
    expect(throttleFor(at(0, 0, 0), 0, 1)).toBeCloseTo(MIN_THROTTLE, 8);
  });

  it('falls off smoothly between', () => {
    const straight = throttleFor(at(0, 0, 0), 1, 0);
    const angled = throttleFor(at(0, 0, 0), 1, 1);
    expect(angled).toBeLessThan(straight);
    expect(angled).toBeGreaterThan(MIN_THROTTLE);
  });

  it('never returns zero, so a bot always creeps while rotating', () => {
    for (let h = 0; h < 4096; h += 53) {
      expect(throttleFor(at(0, 0, h), 1, 0)).toBeGreaterThanOrEqual(MIN_THROTTLE);
    }
  });
});

describe('driveToward', () => {
  it('turns and accelerates in one call', () => {
    const bot = at(0, 0, 0);
    driveToward(bot, 0, 1);
    expect(bot.heading).toBe(bot.turnRate);
    expect(bot.body.vx * bot.body.vx + bot.body.vy * bot.body.vy).toBeGreaterThan(0);
  });

  it('closes to striking range instead of orbiting out of reach', () => {
    // The regression test for the bug this module exists to fix. A bot repeatedly
    // driving at a stationary point must actually reach it.
    // This loop must mirror what the real world does, including the speed clamp that
    // lives in `integrate()`. The clamp is not incidental: the ~101-unit turn radius
    // that makes this test meaningful is speed / angular-velocity, and it assumes the
    // bot is at maxSpeed. Without the clamp, `applyThrust` compounds velocity past 13
    // and the bot simply overshoots the target rather than spiralling in.
    // A vehicle with a minimum turn radius can never come to rest on a point — at
    // minimum throttle the steady-state speed is about 3.5 and the turn radius about
    // 50, so it always circles. Asserting a small FINAL distance would be asserting
    // something physically impossible.
    //
    // What the bug actually looked like was a 140-unit orbit that never closed at all,
    // so the property worth testing is whether the bot ever reaches striking range.
    const bot = at(0, 0, 0);
    let closest = Number.POSITIVE_INFINITY;

    for (let i = 0; i < 400; i++) {
      driveToward(bot, 400 - bot.body.x, 300 - bot.body.y);
      const clamped = clampLength(bot.body.vx, bot.body.vy, DEFAULT_BOT.maxSpeed);
      bot.body.vx = clamped.x * 0.985;
      bot.body.vy = clamped.y * 0.985;
      bot.body.x += bot.body.vx;
      bot.body.y += bot.body.vy;

      const dx = bot.body.x - 400;
      const dy = bot.body.y - 300;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closest) closest = dist;
    }

    // Two bot radii is 40, so this is genuine contact range.
    expect(closest).toBeLessThan(45);
  });

  it('closes on a target moving at its own top speed', () => {
    // Honest scope note. This verifies the chaser can close on a MOVING target, which
    // a stationary target cannot show — a stationary target is reached in a straight
    // line on the first pass regardless of steering quality.
    //
    // It does NOT isolate intercept steering. Measured: this test still passes with the
    // lead term zeroed, because a target circling a fixed centre can be cut off by
    // simply heading inward. The orbit bug required two MUTUALLY pursuing bots, and
    // that symmetry cannot be reproduced with a scripted target.
    //
    // Intercept is verified two ways instead: the interceptOffset unit tests above pin
    // the lead maths directly (both fail if the lead is removed), and the system-level
    // benefit shows up in the metrics harness, where it took matches resolving before
    // the time cap from 40% to 60%.
    const bot = at(0, 0, 0);
    const cx = 400;
    const cy = 300;
    const radius = 150;
    const speed = DEFAULT_BOT.maxSpeed;
    const omega = speed / radius;
    let closest = Number.POSITIVE_INFINITY;

    for (let i = 0; i < 700; i++) {
      const angle = i * omega;
      // Math.cos is banned in src/sim but permitted here — a test may use it to
      // describe a scenario, it just cannot appear in simulation code.
      const tx = cx + Math.cos(angle) * radius;
      const ty = cy + Math.sin(angle) * radius;
      const tvx = -Math.sin(angle) * speed;
      const tvy = Math.cos(angle) * speed;

      const aim = interceptOffset(bot, tx, ty, tvx, tvy, speed);
      driveToward(bot, aim.x, aim.y);

      const clamped = clampLength(bot.body.vx, bot.body.vy, speed);
      bot.body.vx = clamped.x * 0.985;
      bot.body.vy = clamped.y * 0.985;
      bot.body.x += bot.body.vx;
      bot.body.y += bot.body.vy;

      const dx = bot.body.x - tx;
      const dy = bot.body.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closest) closest = dist;
    }

    expect(closest).toBeLessThan(45);
  });
});

describe('driveAway', () => {
  it('accelerates in the opposite direction to the threat', () => {
    const bot = at(0, 0, 2048); // facing -x
    driveAway(bot, 1, 0); // threat is at +x
    expect(bot.body.vx).toBeLessThan(0);
  });
});
