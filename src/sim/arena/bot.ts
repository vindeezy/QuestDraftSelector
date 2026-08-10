import { createBody, type Body } from '../body';
import { ANGLE_MASK, STEPS_PER_RADIAN, cosOf, sinOf, normalizeAngle } from '../trig';

export interface Bot {
  body: Body;
  /** Integer angle index. Index 0 points along +x; increasing turns toward +y (down). */
  heading: number;
  /** Maximum heading change per tick, in angle steps. */
  turnRate: number;
  /** Acceleration per tick applied along the heading. */
  thrust: number;
  /** Fraction of sideways velocity removed per tick. 0 slides freely, 1 never drifts. */
  grip: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Half-width of the damaging front arc, in angle steps. */
  weaponArc: number;
  weaponDamage: number;
  /** Force imparted to a target on a successful hit. Drives the launched state. */
  weaponKnockback: number;
  armour: number;
  /** Ticks a weapon needs to recover between blows. */
  attackCooldown: number;
  /** Earliest tick this bot may deal damage again. */
  nextAttackTick: number;
  /** Tick of this bot's most recent contact with another bot. -1 if never. */
  lastContactTick: number;
  /** Id of the bot it last touched. Null if never. */
  lastContactId: string | null;
  /** Eliminations this bot has caused. Drives the "leader" target. */
  kills: number;
  /** Total damage this bot has dealt to others. The final tiebreaker. */
  damageDealt: number;
  /**
   * Total damage this bot has sustained, from every source that actually reduces its
   * health: a weapon hit landed on it (`resolveHit`), a hazard zone (`applyZone`), a
   * projectile (`stepProjectiles`), and — unlike `damageDealt` — reflect damage bounced
   * back onto an attacker in `resolveHit`. Reflect is real health the receiving bot lost,
   * even though it is not something that bot "dealt", so it belongs here but not there.
   * Diagnostic only: nothing in the simulation reads this field.
   */
  damageTaken: number;
  /**
   * Landed weapon hits this bot has scored on another bot. Incremented in lockstep with
   * `damageDealt` — same call, same guard clauses in `resolveHit` — so it counts only
   * bot-vs-bot blows. Hazard and projectile damage have no attacking bot and so are never
   * a "contact"; a reflect bounce is damage the original attacker receives, not a hit it
   * landed, so it does not increment this either. Diagnostic only: nothing in the
   * simulation reads this field.
   */
  contacts: number;
  /** Damage multiplier for a hit landing on the front. Chassis shape owns this. */
  frontVulnerability: number;
  /** Damage multiplier for a hit landing on the side. Chassis shape owns this. */
  sideVulnerability: number;
  /** Damage multiplier for a hit landing on the rear. Chassis shape owns this. */
  rearVulnerability: number;
  /** Fraction of damage taken that is returned to the attacker. */
  damageReflect: number;
  /** Earliest tick this bot regains control after being stunned. 0 if never stunned. */
  stunnedUntil: number;
  /**
   * Earliest tick this bot can be selected as a target again after Smoke Screen. 0 if
   * never used one. Purely an AI-targeting concept — the bot still exists physically and
   * can still be hit or collided with; see `isUntargetable` and `arena/ability.ts`.
   */
  untargetableUntil: number;
  /**
   * This bot's normal top speed, from its drive stats. Kept here (in addition to
   * `body.maxSpeed`, which `integrate` actually reads) because `body.maxSpeed` is
   * temporarily overwritten while launched — see `arena/launch.ts` — and something has
   * to remember what "normal" is so the effect can decay back to it.
   */
  maxSpeed: number;
  /**
   * While `tick < launchUntil`, this bot is in the launched state: `body.maxSpeed` is
   * held at `launchSpeed` instead of `maxSpeed`, so a knockback impulse can actually
   * throw it rather than being clamped back to normal on the very next tick. Set by
   * `launch()`; 0 means never launched.
   */
  launchUntil: number;
  /** The currently active (and decaying) raised speed cap while launched. */
  launchSpeed: number;
}

export interface BotInit {
  id: string;
  x: number;
  y: number;
  heading: number;
}

/**
 * Everything about a bot's build that does not change during a match: size, mobility,
 * durability and weapon. Six Plinko boards assemble one of these per bot; `createBot`
 * copies it onto the live `Bot` record.
 */
export interface BotStats {
  radius: number;
  mass: number;
  maxSpeed: number;
  thrust: number;
  turnRate: number;
  grip: number;
  maxHealth: number;
  armour: number;
  restitution: number;
  weaponArc: number;
  weaponDamage: number;
  weaponKnockback: number;
  attackCooldown: number;
  /** Damage multipliers by where a hit lands. Chassis shape owns these. */
  frontVulnerability: number;
  sideVulnerability: number;
  rearVulnerability: number;
  /** Fraction of damage taken that is returned to the attacker. */
  damageReflect: number;
}

/**
 * Today's stats, as a `BotStats`. Every bot used this exact block before per-bot builds
 * existed, so it is also the default `createBot` falls back to — nothing changes for
 * existing callers.
 *
 * `maxSpeed` must stay below `radius`: a body that travels further in one tick than the
 * smallest thing it can collide with will pass straight through it. Tar and ice change
 * effective speed, so the clamp must be applied AFTER those modifiers, never before.
 */
export const DEFAULT_BOT: BotStats = {
  radius: 20,
  mass: 1,
  // Lowered from 7. At 7 a bot crossed the arena in a little over two seconds, so it
  // could abandon one fight and reach another across the map almost instantly — the
  // action was too fast to follow. Slowing down also shrinks the turn radius from
  // ~101 units to ~65, which makes a 60-unit pit genuinely avoidable for the first time.
  maxSpeed: 4.5,
  thrust: 0.35,
  /** 45 steps of 4096 is about 4 degrees per tick, or 237 degrees per second. */
  turnRate: 45,
  grip: 0.25,
  maxHealth: 100,
  /** 512 steps is 45 degrees either side of dead ahead. */
  weaponArc: 512,
  // Lowered from 1.6 when rear vulnerability was added. Hits now average about 1.25x
  // their old damage and rear hits 1.8x, which halved match length from 152s to 63s.
  weaponDamage: 1.0,
  weaponKnockback: 0,
  armour: 1,
  /**
   * Half a second between blows.
   *
   * Without this, two bots in contact traded damage on every single tick, so an
   * engagement shredded both in seconds and 89% of all eliminations happened inside the
   * first minute. A recovery window turns a grind into a series of distinct hits, which
   * is both how real machines work and what makes a fight watchable.
   */
  attackCooldown: 30,
  restitution: 0.3,
  // Today's fixed vulnerability constants, now the chassis-shape defaults.
  frontVulnerability: 0.7,
  sideVulnerability: 1.25,
  rearVulnerability: 1.8,
  damageReflect: 0,
};

export function createBot(init: BotInit, stats: BotStats = DEFAULT_BOT): Bot {
  return {
    body: createBody({
      id: init.id,
      x: init.x,
      y: init.y,
      radius: stats.radius,
      mass: stats.mass,
      restitution: stats.restitution,
      maxSpeed: stats.maxSpeed,
    }),
    heading: normalizeAngle(init.heading),
    turnRate: stats.turnRate,
    thrust: stats.thrust,
    grip: stats.grip,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    alive: true,
    weaponArc: stats.weaponArc,
    weaponDamage: stats.weaponDamage,
    weaponKnockback: stats.weaponKnockback,
    armour: stats.armour,
    attackCooldown: stats.attackCooldown,
    nextAttackTick: 0,
    lastContactTick: -1,
    lastContactId: null,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    contacts: 0,
    frontVulnerability: stats.frontVulnerability,
    sideVulnerability: stats.sideVulnerability,
    rearVulnerability: stats.rearVulnerability,
    damageReflect: stats.damageReflect,
    stunnedUntil: 0,
    untargetableUntil: 0,
    maxSpeed: stats.maxSpeed,
    launchUntil: 0,
    launchSpeed: stats.maxSpeed,
  };
}

/**
 * True while a stun (from EMP) holds a bot: it skips steering and thrust, and deals no
 * damage on contact. Momentum and shoveability are deliberately untouched — a stunned
 * bot's `body` is not made static, so it can still be hit into a pit. See `arena/ability.ts`.
 */
export function isStunned(bot: Bot, tick: number): boolean {
  return tick < bot.stunnedUntil;
}

/**
 * True while Smoke Screen hides a bot from other bots' target selection. Purely an
 * AI-targeting concept: the bot still physically exists and can still be hit or
 * collided with, so this must never be consulted by collision code.
 */
export function isUntargetable(bot: Bot, tick: number): boolean {
  return tick < bot.untargetableUntil;
}

/**
 * Turns the bot toward a direction, at most `turnRate` steps.
 *
 * There is deliberately no atan2 here. The cross product of the heading with the desired
 * direction gives both the turn direction (its sign) and, for small offsets, the angle
 * itself — since cross equals sin(theta), and sin(theta) approximates theta near zero.
 * That is exactly the regime where fine control matters, so the approximation is accurate
 * where it counts and irrelevant elsewhere, because larger turns are clamped anyway.
 *
 * The dot product handles the one case the approximation gets wrong: a target directly
 * behind gives a near-zero cross product, which would read as "already aligned". A
 * negative dot means the target is behind, so turn at full rate regardless.
 *
 * `dx, dy` need not be normalised; only the sign and relative magnitude matter.
 */
export function steerToward(bot: Bot, dx: number, dy: number): void {
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;

  const inv = 1 / Math.sqrt(lenSq);
  const nx = dx * inv;
  const ny = dy * inv;

  const hx = cosOf(bot.heading);
  const hy = sinOf(bot.heading);

  const cross = hx * ny - hy * nx;
  const dot = hx * nx + hy * ny;

  let steps: number;
  if (dot < 0) {
    // Behind. Commit to a full-rate turn, picking a consistent side when exactly
    // opposite so the result stays deterministic.
    steps = cross >= 0 ? bot.turnRate : -bot.turnRate;
  } else {
    steps = cross * STEPS_PER_RADIAN;
    if (steps > bot.turnRate) steps = bot.turnRate;
    else if (steps < -bot.turnRate) steps = -bot.turnRate;
  }

  bot.heading = (bot.heading + Math.round(steps)) & ANGLE_MASK;
}

/** Accelerates along the current heading. `throttle` is 0 to 1. */
export function applyThrust(bot: Bot, throttle: number): void {
  const accel = bot.thrust * throttle;
  bot.body.vx += cosOf(bot.heading) * accel;
  bot.body.vy += sinOf(bot.heading) * accel;
}

/**
 * Removes part of the velocity perpendicular to the heading.
 *
 * This is what makes a bot a vehicle rather than a floating puck. A sharp turn at speed
 * leaves residual sideways velocity, which reads as a drift. Ice lowers grip, so bots
 * slide; a high-grip build corners cleanly.
 *
 * `gripScale` lets the floor surface under the bot modify how much grip applies this
 * tick — ice passes something below 1, gravel above 1 — without every caller needing to
 * know surfaces exist.
 */
export function applyGrip(bot: Bot, gripScale = 1): void {
  const hx = cosOf(bot.heading);
  const hy = sinOf(bot.heading);
  const along = bot.body.vx * hx + bot.body.vy * hy;
  const lateralX = bot.body.vx - along * hx;
  const lateralY = bot.body.vy - along * hy;
  bot.body.vx -= lateralX * bot.grip * gripScale;
  bot.body.vy -= lateralY * bot.grip * gripScale;
}
