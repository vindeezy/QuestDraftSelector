import { cosOf, sinOf } from '../trig';
import type { Bot } from './bot';

/**
 * How squarely a bot is facing a point, from 0 to 1.
 *
 * 1 is dead ahead. It falls to 0 at the edge of the weapon arc and stays there beyond it,
 * so a bot caught side-on or from behind takes nothing. The falloff is smooth rather than
 * a hard cutoff, which keeps glancing blows meaningful and avoids a discontinuity that
 * the AI would otherwise learn to sit exactly on.
 */
export function arcAlignment(bot: Bot, targetX: number, targetY: number): number {
  const dx = targetX - bot.body.x;
  const dy = targetY - bot.body.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 1;

  const inv = 1 / Math.sqrt(lenSq);
  const dot = cosOf(bot.heading) * dx * inv + sinOf(bot.heading) * dy * inv;
  if (dot <= 0) return 0;

  // cos of the arc half-width. Inside the arc, rescale dot to run 0..1 across it.
  const arcCos = cosOf(bot.weaponArc);
  if (dot <= arcCos) return 0;
  return (dot - arcCos) / (1 - arcCos);
}

/** Damage multiplier for a hit landing on the front. Armour is thickest here. */
const FRONT_VULNERABILITY = 0.7;
/** Damage multiplier for a hit landing on the rear. Thin plating, exposed drive. */
const REAR_VULNERABILITY = 1.8;

/**
 * How exposed a bot is to a hit coming from a given direction.
 *
 * Front 0.7, side 1.25, rear 1.8, interpolated linearly between.
 *
 * This exists to make retreating cost something. In a last-bot-standing format not dying
 * is winning, so with damage depending only on the attacker's facing, fleeing was close
 * to free: every bot has the same top speed, so a runner simply could not be caught.
 * Survival personalities took 73% of wins between them. Turning your back now hands the
 * chaser more than double the damage a frontal engagement would.
 */
export function vulnerability(target: Bot, fromX: number, fromY: number): number {
  const dx = fromX - target.body.x;
  const dy = fromY - target.body.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 1;

  const inv = 1 / Math.sqrt(lenSq);
  // +1 when the attacker is dead ahead of the target, -1 when directly behind it.
  const facing = cosOf(target.heading) * dx * inv + sinOf(target.heading) * dy * inv;
  const t = (facing + 1) / 2;
  return REAR_VULNERABILITY + (FRONT_VULNERABILITY - REAR_VULNERABILITY) * t;
}

/** Damage for one hit. Kept separate from `resolveHit` so it can be tested directly. */
export function damageFrom(
  attacker: Bot,
  impactSpeed: number,
  alignment: number,
  targetArmour = 1,
): number {
  return (impactSpeed * attacker.weaponDamage * alignment) / targetArmour;
}

/**
 * Applies one bot's hit on another and returns the damage dealt.
 *
 * Callers invoke this once per direction, so a head-on collision hurts both bots and a
 * flank attack is one-sided. That asymmetry is what makes positioning matter.
 */
export function resolveHit(
  attacker: Bot,
  target: Bot,
  impactSpeed: number,
  tick: number,
): number {
  if (!attacker.alive || !target.alive) return 0;
  // A weapon needs time to recover between blows. Without this, two bots in contact
  // traded damage on every single tick and shredded each other in seconds — 89% of all
  // eliminations happened inside the first minute.
  if (tick < attacker.nextAttackTick) return 0;

  const alignment = arcAlignment(attacker, target.body.x, target.body.y);
  if (alignment === 0) return 0;

  const exposure = vulnerability(target, attacker.body.x, attacker.body.y);
  const damage = damageFrom(attacker, impactSpeed, alignment, target.armour) * exposure;
  const dealt = damage > target.health ? target.health : damage;
  target.health -= dealt;
  if (target.health < 0) target.health = 0;
  attacker.nextAttackTick = tick + attacker.attackCooldown;
  return dealt;
}
