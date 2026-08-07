import { describe, it, expect } from 'vitest';
import { resolveCircleCircle } from '../collision';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch, type Match } from './match';
import { createBot } from './bot';
import { resolveHit } from './combat';
import { createAiState, driveWithAi } from './ai';
import { perceive } from './perception';
import { Surface, surfaceAt } from './surface';
import { createAbilityState, updateAbility, ABILITY_NAMES } from './ability';

const config = { ...DEFAULT_MATCH, arena: DEFAULT_ARENA };

function matchWith(botCount: number, seed: number): Match {
  return createMatch({ ...config, seed, botCount });
}

describe('ABILITY_NAMES', () => {
  it('lists all seven abilities, derived from the parts table', () => {
    expect(ABILITY_NAMES.length).toBe(7);
    expect(new Set(ABILITY_NAMES).size).toBe(7);
    expect(ABILITY_NAMES).toContain('emp');
    expect(ABILITY_NAMES).toContain('adrenaline');
  });
});

describe('the trigger', () => {
  it('fires at exactly six thresholds across a full life, for a 55-health bot', () => {
    const m = matchWith(2, 101);
    const bot = m.bots[0]!;
    bot.maxHealth = 55;
    bot.health = 55;
    const state = createAbilityState('nitro', bot);

    for (let h = 55; h >= 0; h--) {
      bot.health = h;
      m.world.tick++;
      updateAbility(m, bot, state);
    }

    expect(state.fired).toBe(6);
  });

  it('fires at exactly six thresholds across a full life, for a 224-health bot', () => {
    const m = matchWith(2, 102);
    const bot = m.bots[0]!;
    bot.maxHealth = 224;
    bot.health = 224;
    const state = createAbilityState('nitro', bot);

    for (let h = 224; h >= 0; h--) {
      bot.health = h;
      m.world.tick++;
      updateAbility(m, bot, state);
    }

    expect(state.fired).toBe(6);
  });

  it('never fires twice at the same threshold, even when one hit crosses several at once', () => {
    const m = matchWith(2, 103);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    const state = createAbilityState('nitro', bot);

    // One hit for 60% of max health at once crosses four 15% thresholds in a single tick.
    bot.health = 40;
    m.world.tick = 5;
    updateAbility(m, bot, state);
    expect(state.fired).toBe(4);

    // No further damage: must not fire again on a later tick.
    m.world.tick = 6;
    updateAbility(m, bot, state);
    expect(state.fired).toBe(4);
  });

  it('the ratchet holds: healing then re-taking damage does not re-fire a spent threshold', () => {
    const m = matchWith(2, 104);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    const state = createAbilityState('nitro', bot);

    bot.health = 84; // just past the first threshold (85% of max)
    m.world.tick = 1;
    updateAbility(m, bot, state);
    expect(state.fired).toBe(1);
    expect(state.floor).toBe(84);

    bot.health = 100; // fully healed
    m.world.tick = 2;
    updateAbility(m, bot, state);
    expect(state.fired).toBe(1);
    expect(state.floor).toBe(84); // the ratchet: healing never raises the floor back up

    bot.health = 84; // back down to the exact same point, not below the floor
    m.world.tick = 3;
    updateAbility(m, bot, state);
    expect(state.fired).toBe(1); // must not re-fire the threshold it already spent
  });
});

describe('stun', () => {
  it('a stunned bot does not steer or thrust', () => {
    const m = matchWith(3, 110);
    const bot = m.bots[0]!;
    bot.stunnedUntil = 1000;
    const heading = bot.heading;
    const vx = bot.body.vx;
    const vy = bot.body.vy;

    driveWithAi(m, bot, createAiState('aggressive'));

    expect(bot.heading).toBe(heading);
    expect(bot.body.vx).toBe(vx);
    expect(bot.body.vy).toBe(vy);
  });

  it('a stunned bot deals no damage on contact', () => {
    const attacker = createBot({ id: 'a', x: 0, y: 0, heading: 0 });
    const target = createBot({ id: 'b', x: 40, y: 0, heading: 0 });
    attacker.stunnedUntil = 100;

    const dealt = resolveHit(attacker, target, 4, 0);

    expect(dealt).toBe(0);
    expect(target.health).toBe(target.maxHealth);
  });

  it('a stunned bot can still be shoved — the point of stunning rather than freezing', () => {
    const attacker = createBot({ id: 'a', x: 0, y: 0, heading: 0 });
    const stunned = createBot({ id: 'b', x: 30, y: 0, heading: 0 }); // overlapping: radius 20 each, 30 apart
    stunned.stunnedUntil = 1000;
    attacker.body.vx = 3; // closing on the stunned bot

    // This is bare physics, the same collision resolver `world.step` uses. It knows
    // nothing about "stunned" — the only thing that could stop a shove is invMass being
    // zeroed, which stunning must never do.
    expect(stunned.body.invMass).toBeGreaterThan(0);
    const beforeVx = stunned.body.vx;
    const speed = resolveCircleCircle(attacker.body, stunned.body);

    expect(speed).toBeGreaterThan(0);
    expect(stunned.body.vx).toBeGreaterThan(beforeVx);
  });
});

describe('repair', () => {
  it('does not heal within 4s of taking damage, and does heal after', () => {
    const m = matchWith(2, 120);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    const state = createAbilityState('repair', bot);

    m.world.tick = 10;
    bot.health = 50; // a damage event, tracked at tick 10
    updateAbility(m, bot, state);
    expect(state.lastDamageTick).toBe(10);
    expect(bot.health).toBe(50); // no heal the same tick as the hit

    m.world.tick = 10 + 240; // exactly 4s later: still within the window
    updateAbility(m, bot, state);
    expect(bot.health).toBe(50);

    m.world.tick = 10 + 241; // just past it
    updateAbility(m, bot, state);
    expect(bot.health).toBeGreaterThan(50);
  });

  it('never heals past max health', () => {
    const m = matchWith(2, 121);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 99.999;
    const state = createAbilityState('repair', bot);
    state.lastDamageTick = -1000;

    for (let t = 1; t <= 500; t++) {
      m.world.tick = t;
      updateAbility(m, bot, state);
    }

    expect(bot.health).toBe(100);
  });
});

describe('adrenaline', () => {
  it('applies below 30% health and not above', () => {
    const m = matchWith(2, 130);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    const baseDamage = bot.weaponDamage;
    const baseSpeed = bot.maxSpeed;
    const state = createAbilityState('adrenaline', bot);

    bot.health = 40; // above 30%
    m.world.tick = 1;
    updateAbility(m, bot, state);
    expect(bot.weaponDamage).toBeCloseTo(baseDamage, 8);
    expect(bot.maxSpeed).toBeCloseTo(baseSpeed, 8);

    bot.health = 20; // below 30%
    m.world.tick = 2;
    updateAbility(m, bot, state);
    expect(bot.weaponDamage).toBeCloseTo(baseDamage * 1.5, 8);
    expect(bot.maxSpeed).toBeCloseTo(baseSpeed * 1.2, 8);

    bot.health = 40; // back above: the boost must not linger
    m.world.tick = 3;
    updateAbility(m, bot, state);
    expect(bot.weaponDamage).toBeCloseTo(baseDamage, 8);
    expect(bot.maxSpeed).toBeCloseTo(baseSpeed, 8);
  });
});

describe('smoke screen', () => {
  it('removes a bot from target selection and it returns afterwards', () => {
    const m = matchWith(2, 140);
    const a = m.bots[0]!;
    const b = m.bots[1]!;
    b.body.x = a.body.x + 50;
    b.body.y = a.body.y;

    m.world.tick = 0;
    expect(perceive(m, a).nearest).toBe(b);

    b.untargetableUntil = 120;
    m.world.tick = 50;
    expect(perceive(m, a).nearest).toBeNull();

    m.world.tick = 121;
    expect(perceive(m, a).nearest).toBe(b);
  });

  it('sets untargetableUntil on trigger', () => {
    const m = matchWith(2, 141);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    const state = createAbilityState('smokeScreen', bot);

    bot.health = 84;
    m.world.tick = 5;
    updateAbility(m, bot, state);

    expect(bot.untargetableUntil).toBe(5 + 120);
  });
});

describe('oil slick', () => {
  it('writes an ice tile behind the bot on trigger', () => {
    const m = matchWith(2, 150);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    bot.heading = 0; // facing +x, so "behind" is toward -x
    bot.body.x = 300;
    bot.body.y = 300;
    const state = createAbilityState('oilSlick', bot);

    bot.health = 84;
    m.world.tick = 1;
    updateAbility(m, bot, state);

    const behindX = bot.body.x - 60;
    const behindY = bot.body.y;
    expect(surfaceAt(m.arena.grid, m.arena.surfaces, behindX, behindY)).toBe(Surface.Ice);
  });
});

describe('shockwave', () => {
  it('launches nearby bots away and deals no damage', () => {
    const m = matchWith(3, 160);
    const caster = m.bots[0]!;
    const near = m.bots[1]!;
    const far = m.bots[2]!;
    caster.body.x = 300;
    caster.body.y = 300;
    near.body.x = 320;
    near.body.y = 300;
    far.body.x = 900;
    far.body.y = 300;
    caster.maxHealth = 100;
    caster.health = 100;
    const state = createAbilityState('shockwave', caster);
    const nearHealthBefore = near.health;
    const nearVxBefore = near.body.vx;
    const farVxBefore = far.body.vx;

    caster.health = 84;
    m.world.tick = 1;
    updateAbility(m, caster, state);

    expect(near.body.vx).toBeGreaterThan(nearVxBefore); // pushed away, toward +x
    expect(near.health).toBe(nearHealthBefore); // no damage
    expect(far.body.vx).toBe(farVxBefore); // out of range, untouched
  });
});

describe('nitro', () => {
  it('raises top speed while active and returns to normal after', () => {
    const m = matchWith(2, 170);
    const bot = m.bots[0]!;
    bot.maxHealth = 100;
    bot.health = 100;
    const baseSpeed = bot.maxSpeed;
    const state = createAbilityState('nitro', bot);

    bot.health = 84; // triggers at tick 10
    m.world.tick = 10;
    updateAbility(m, bot, state);

    m.world.tick = 50; // still inside the 90-tick window
    updateAbility(m, bot, state);
    expect(bot.maxSpeed).toBeCloseTo(baseSpeed * 1.8, 8);

    m.world.tick = 101; // past it
    updateAbility(m, bot, state);
    expect(bot.maxSpeed).toBeCloseTo(baseSpeed, 8);
  });
});

describe('emp', () => {
  it('stuns nearby bots on trigger, but never the caster', () => {
    const m = matchWith(3, 180);
    const caster = m.bots[0]!;
    const near = m.bots[1]!;
    const far = m.bots[2]!;
    caster.body.x = 300;
    caster.body.y = 300;
    near.body.x = 320;
    near.body.y = 300;
    far.body.x = 900;
    far.body.y = 300;
    caster.maxHealth = 100;
    caster.health = 100;
    const state = createAbilityState('emp', caster);

    caster.health = 84;
    m.world.tick = 7;
    updateAbility(m, caster, state);

    expect(near.stunnedUntil).toBe(7 + 120);
    expect(far.stunnedUntil).toBe(0);
    expect(caster.stunnedUntil).toBe(0);
  });
});
