import { describe, it, expect } from 'vitest';
import { ANGLE_STEPS, cosOf, sinOf } from '../trig';
import { createBot, steerToward, applyThrust, applyGrip, DEFAULT_BOT, type Bot } from './bot';

const bot = (over: Partial<Bot> = {}): Bot => {
  const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 });
  return Object.assign(b, over);
};

describe('createBot', () => {
  it('starts alive at full health', () => {
    const b = bot();
    expect(b.alive).toBe(true);
    expect(b.health).toBe(b.maxHealth);
  });

  it('wraps its starting heading into range', () => {
    expect(createBot({ id: 'b', x: 0, y: 0, heading: ANGLE_STEPS + 5 }).heading).toBe(5);
  });
});

describe('steerToward', () => {
  it('turns toward a target to its right', () => {
    // Index 0 points along +x. +y is DOWN, so a target below is a positive turn.
    const b = bot({ heading: 0 });
    steerToward(b, 0, 1);
    expect(b.heading).toBe(b.turnRate);
  });

  it('turns toward a target to its left', () => {
    const b = bot({ heading: 0 });
    steerToward(b, 0, -1);
    expect(b.heading).toBe(ANGLE_STEPS - b.turnRate);
  });

  it('does not turn when already facing the target', () => {
    const b = bot({ heading: 0 });
    steerToward(b, 1, 0);
    expect(b.heading).toBe(0);
  });

  it('turns at full rate toward a target directly behind it', () => {
    // The small-angle approximation would read a near-zero cross product here. The
    // dot-product check must override it, or the bot would sit facing backwards.
    const b = bot({ heading: 0 });
    steerToward(b, -1, 0);
    expect(b.heading).toBe(b.turnRate);
  });

  it('converges on the target heading without oscillating', () => {
    const b = bot({ heading: 0 });
    const tx = cosOf(700);
    const ty = sinOf(700);
    for (let i = 0; i < 200; i++) steerToward(b, tx, ty);
    const off = Math.min(
      (b.heading - 700 + ANGLE_STEPS) % ANGLE_STEPS,
      (700 - b.heading + ANGLE_STEPS) % ANGLE_STEPS,
    );
    expect(off).toBeLessThanOrEqual(1);
  });

  it('ignores a zero-length direction', () => {
    const b = bot({ heading: 123 });
    steerToward(b, 0, 0);
    expect(b.heading).toBe(123);
  });
});

describe('applyThrust', () => {
  it('accelerates along the heading, not toward the target', () => {
    const b = bot({ heading: 0 });
    applyThrust(b, 1);
    expect(b.body.vx).toBeCloseTo(b.thrust, 10);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });

  it('scales with throttle', () => {
    const b = bot({ heading: 0 });
    applyThrust(b, 0.5);
    expect(b.body.vx).toBeCloseTo(b.thrust * 0.5, 10);
  });

  it('pushes along a rotated heading', () => {
    const b = bot({ heading: 1024 });
    applyThrust(b, 1);
    expect(b.body.vy).toBeCloseTo(b.thrust, 8);
    expect(b.body.vx).toBeCloseTo(0, 8);
  });
});

describe('applyGrip', () => {
  it('leaves velocity aligned with the heading untouched', () => {
    const b = bot({ heading: 0 });
    b.body.vx = 5;
    applyGrip(b);
    expect(b.body.vx).toBeCloseTo(5, 10);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });

  it('damps velocity perpendicular to the heading', () => {
    const b = bot({ heading: 0, grip: 0.25 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(3, 10);
  });

  it('with grip 0 lets a bot slide freely, like ice', () => {
    const b = bot({ heading: 0, grip: 0 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(4, 10);
  });

  it('with grip 1 removes all sideways drift instantly', () => {
    const b = bot({ heading: 0, grip: 1 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });
});

describe('DEFAULT_BOT', () => {
  it('keeps max speed below the bot radius so it cannot tunnel', () => {
    expect(DEFAULT_BOT.maxSpeed).toBeLessThan(DEFAULT_BOT.radius);
  });
});
