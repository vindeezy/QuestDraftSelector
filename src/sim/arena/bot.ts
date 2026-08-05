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
}

export interface BotInit {
  id: string;
  x: number;
  y: number;
  heading: number;
}

/**
 * Placeholder stats for the greybox. A later phase replaces these with values derived
 * from the seven bot categories — nothing here is tuned yet.
 *
 * `maxSpeed` must stay below `radius`: a body that travels further in one tick than the
 * smallest thing it can collide with will pass straight through it. Tar and ice change
 * effective speed, so the clamp must be applied AFTER those modifiers, never before.
 */
export const DEFAULT_BOT = {
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
} as const;

export function createBot(init: BotInit): Bot {
  return {
    body: createBody({
      id: init.id,
      x: init.x,
      y: init.y,
      radius: DEFAULT_BOT.radius,
      mass: DEFAULT_BOT.mass,
      restitution: DEFAULT_BOT.restitution,
    }),
    heading: normalizeAngle(init.heading),
    turnRate: DEFAULT_BOT.turnRate,
    thrust: DEFAULT_BOT.thrust,
    grip: DEFAULT_BOT.grip,
    health: DEFAULT_BOT.maxHealth,
    maxHealth: DEFAULT_BOT.maxHealth,
    alive: true,
    weaponArc: DEFAULT_BOT.weaponArc,
    weaponDamage: DEFAULT_BOT.weaponDamage,
    armour: DEFAULT_BOT.armour,
    attackCooldown: DEFAULT_BOT.attackCooldown,
    nextAttackTick: 0,
    lastContactTick: -1,
    lastContactId: null,
    kills: 0,
  };
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
