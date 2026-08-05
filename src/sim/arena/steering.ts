import { cosOf, sinOf } from '../trig';
import { applyGrip, applyThrust, steerToward, type Bot } from './bot';
import type { Vec2 } from '../vec';

/**
 * Throttle floor, so a badly misaligned bot still creeps while it rotates rather than
 * standing still. Zero would let a bot stall permanently facing the wrong way.
 */
export const MIN_THROTTLE = 0.15;

/**
 * Where to aim to intercept a moving target, as an offset from the bot.
 *
 * Steering straight at a target moving at the same speed is a stable mutual orbit that
 * never closes — measured at seed 1, two bots circled 140 units apart at full speed for
 * 15,000 ticks with zero contacts. Aiming at where the target will be collapses that
 * orbit into a converging spiral.
 */
export function interceptOffset(
  bot: Bot,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  speed: number,
): Vec2 {
  const dx = targetX - bot.body.x;
  const dy = targetY - bot.body.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const lead = speed === 0 ? 0 : dist / speed;
  return { x: dx + targetVx * lead, y: dy + targetVy * lead };
}

/**
 * Throttle as a function of how squarely the bot faces where it wants to go.
 *
 * Not a refinement — without it, pursuit does not work. A bot at constant full throttle
 * has a fixed minimum turn radius of speed / angular-velocity, about 101 units at these
 * stats, and cannot tighten it. Backing off when misaligned shrinks that radius, exactly
 * as a real driver brakes into a corner. Adding this cut deaths-by-falling from 45% to
 * 24%, because bots stopped overshooting their turns into pits.
 */
export function throttleFor(bot: Bot, dx: number, dy: number): number {
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return MIN_THROTTLE;
  const inv = 1 / Math.sqrt(lenSq);
  const dot = cosOf(bot.heading) * dx * inv + sinOf(bot.heading) * dy * inv;
  if (dot <= 0) return MIN_THROTTLE;
  return MIN_THROTTLE + (1 - MIN_THROTTLE) * dot;
}

/**
 * Steer toward an offset, throttle for the resulting alignment, thrust, and grip.
 *
 * `throttleCap` exists for hazard braking. Steering away from a pit is not enough on its
 * own: at full speed the turn radius is about 101 units and a pit is 60 across, so a bot
 * that spots one at close range physically cannot turn out of it however hard it tries.
 * Capping the throttle shrinks the turn radius and makes the escape geometrically
 * possible. Raising avoidance strength alone moved falls only from 65% to 60%.
 */
export function driveToward(
  bot: Bot,
  dx: number,
  dy: number,
  throttleCap = 1,
  gripScale = 1,
): void {
  steerToward(bot, dx, dy);
  const throttle = throttleFor(bot, dx, dy);
  applyThrust(bot, throttle < throttleCap ? throttle : throttleCap);
  applyGrip(bot, gripScale);
}

/** Drive directly away from an offset. */
export function driveAway(bot: Bot, dx: number, dy: number): void {
  driveToward(bot, -dx, -dy);
}
