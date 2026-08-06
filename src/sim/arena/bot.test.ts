import { describe, it, expect } from 'vitest';
import { ANGLE_STEPS, cosOf, sinOf } from '../trig';
import { integrate } from '../body';
import {
  createBot,
  steerToward,
  applyThrust,
  applyGrip,
  DEFAULT_BOT,
  type Bot,
  type BotStats,
} from './bot';

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

  it('with no stats produces exactly today\'s values', () => {
    const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 });
    expect(b.turnRate).toBe(DEFAULT_BOT.turnRate);
    expect(b.thrust).toBe(DEFAULT_BOT.thrust);
    expect(b.grip).toBe(DEFAULT_BOT.grip);
    expect(b.maxHealth).toBe(DEFAULT_BOT.maxHealth);
    expect(b.health).toBe(DEFAULT_BOT.maxHealth);
    expect(b.weaponArc).toBe(DEFAULT_BOT.weaponArc);
    expect(b.weaponDamage).toBe(DEFAULT_BOT.weaponDamage);
    expect(b.weaponKnockback).toBe(DEFAULT_BOT.weaponKnockback);
    expect(b.armour).toBe(DEFAULT_BOT.armour);
    expect(b.attackCooldown).toBe(DEFAULT_BOT.attackCooldown);
    expect(b.frontVulnerability).toBe(DEFAULT_BOT.frontVulnerability);
    expect(b.sideVulnerability).toBe(DEFAULT_BOT.sideVulnerability);
    expect(b.rearVulnerability).toBe(DEFAULT_BOT.rearVulnerability);
    expect(b.damageReflect).toBe(DEFAULT_BOT.damageReflect);
    expect(b.stunnedUntil).toBe(0);
    expect(b.body.radius).toBe(DEFAULT_BOT.radius);
    expect(b.body.invMass).toBe(1 / DEFAULT_BOT.mass);
    expect(b.body.restitution).toBe(DEFAULT_BOT.restitution);
  });

  it('with custom stats reflects every field', () => {
    const stats: BotStats = {
      radius: 30,
      mass: 2,
      maxSpeed: 6,
      thrust: 0.5,
      turnRate: 60,
      grip: 0.4,
      maxHealth: 150,
      armour: 1.2,
      restitution: 0.6,
      weaponArc: 700,
      weaponDamage: 1.5,
      weaponKnockback: 3,
      attackCooldown: 20,
      frontVulnerability: 0.4,
      sideVulnerability: 1.7,
      rearVulnerability: 2.2,
      damageReflect: 0.35,
    };
    const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 }, stats);
    expect(b.turnRate).toBe(stats.turnRate);
    expect(b.thrust).toBe(stats.thrust);
    expect(b.grip).toBe(stats.grip);
    expect(b.maxHealth).toBe(stats.maxHealth);
    expect(b.health).toBe(stats.maxHealth);
    expect(b.weaponArc).toBe(stats.weaponArc);
    expect(b.weaponDamage).toBe(stats.weaponDamage);
    expect(b.weaponKnockback).toBe(stats.weaponKnockback);
    expect(b.armour).toBe(stats.armour);
    expect(b.attackCooldown).toBe(stats.attackCooldown);
    expect(b.frontVulnerability).toBe(stats.frontVulnerability);
    expect(b.sideVulnerability).toBe(stats.sideVulnerability);
    expect(b.rearVulnerability).toBe(stats.rearVulnerability);
    expect(b.damageReflect).toBe(stats.damageReflect);
    expect(b.stunnedUntil).toBe(0);
    expect(b.body.radius).toBe(stats.radius);
    expect(b.body.invMass).toBe(1 / stats.mass);
    expect(b.body.restitution).toBe(stats.restitution);
  });

  it('builds two bots from different stats that share no state', () => {
    const statsA: BotStats = { ...DEFAULT_BOT, maxHealth: 80, damageReflect: 0.2 };
    const statsB: BotStats = { ...DEFAULT_BOT, maxHealth: 200, damageReflect: 0 };
    const a = createBot({ id: 'a', x: 0, y: 0, heading: 0 }, statsA);
    const b = createBot({ id: 'b', x: 10, y: 10, heading: 0 }, statsB);

    expect(a.maxHealth).toBe(80);
    expect(b.maxHealth).toBe(200);
    expect(a.damageReflect).toBe(0.2);
    expect(b.damageReflect).toBe(0);

    // Mutating one bot must not leak into the other, and must not mutate the shared
    // stats objects either.
    a.health -= 10;
    a.kills = 3;
    a.body.x = 999;
    expect(b.health).toBe(200);
    expect(b.kills).toBe(0);
    expect(b.body.x).toBe(10);
    expect(statsA.maxHealth).toBe(80);
    expect(statsB.maxHealth).toBe(200);
  });

  it('starts health at maxHealth, whatever that is', () => {
    const stats: BotStats = { ...DEFAULT_BOT, maxHealth: 42 };
    const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 }, stats);
    expect(b.health).toBe(42);
    expect(b.maxHealth).toBe(42);
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

describe('per-bot maxSpeed', () => {
  it('createBot copies maxSpeed onto both the bot and its body', () => {
    const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 }, { ...DEFAULT_BOT, maxSpeed: 6 });
    expect(b.maxSpeed).toBe(6);
    expect(b.body.maxSpeed).toBe(6);
  });

  it('two bots built with different maxSpeed stats reach different top speeds under identical thrust', () => {
    // Same thrust and no drag for both — the only thing that can make them differ is
    // each bot's own speed cap, exercised through createBot -> body.maxSpeed -> integrate.
    const slow = createBot({ id: 's', x: 0, y: 0, heading: 0 }, { ...DEFAULT_BOT, maxSpeed: 3, thrust: 0.5 });
    const fast = createBot({ id: 'f', x: 0, y: 0, heading: 0 }, { ...DEFAULT_BOT, maxSpeed: 6, thrust: 0.5 });

    for (let i = 0; i < 100; i++) {
      applyThrust(slow, 1);
      applyThrust(fast, 1);
      integrate(slow.body, 0, slow.maxSpeed, 1);
      integrate(fast.body, 0, fast.maxSpeed, 1);
    }

    const slowSpeed = Math.sqrt(slow.body.vx * slow.body.vx + slow.body.vy * slow.body.vy);
    const fastSpeed = Math.sqrt(fast.body.vx * fast.body.vx + fast.body.vy * fast.body.vy);
    expect(slowSpeed).toBeCloseTo(3, 6);
    expect(fastSpeed).toBeCloseTo(6, 6);
    expect(fastSpeed).toBeGreaterThan(slowSpeed);
  });
});
