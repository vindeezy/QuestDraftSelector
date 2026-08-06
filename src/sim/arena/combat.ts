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

/**
 * How exposed a bot is to a hit coming from a given direction.
 *
 * Reads `target.frontVulnerability`, `target.sideVulnerability` and
 * `target.rearVulnerability` — chassis shape owns where a bot's armour is, so this is no
 * longer a fixed 0.7 / 1.25 / 1.8 for every bot.
 *
 * Interpolated in two segments rather than one straight line from front to rear. A
 * single lerp from front to rear would pass through the side value only momentarily (at
 * facing exactly 0) rather than using it as a real point on the curve, and worse, a
 * chassis with a side value that is not the midpoint of front and rear (a Diamond's
 * paper-thin 1.7 flank against a 0.75 front and 1.0 rear, for instance) would have that
 * shape entirely erased by the straight line. Facing above 0 blends front↔side; facing
 * below 0 blends side↔rear, so the side value is always what a pure-flank hit reads.
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

  if (facing >= 0) {
    // Front (facing 1) down to side (facing 0).
    return target.sideVulnerability + (target.frontVulnerability - target.sideVulnerability) * facing;
  }
  // Side (facing 0) down to rear (facing -1). `-facing` runs 0..1 across this segment.
  return target.sideVulnerability + (target.rearVulnerability - target.sideVulnerability) * -facing;
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
  attacker.damageDealt += dealt;
  attacker.nextAttackTick = tick + attacker.attackCooldown;

  // Reflect. Spiked Composite is the only thing that changes the ATTACKER's maths.
  // Deliberately not counted in either bot's `damageDealt` — that stat is the event's
  // second tiebreaker and measures damage a bot went out and inflicted, not damage that
  // bounced off it.
  if (target.damageReflect > 0) {
    const back = dealt * target.damageReflect;
    attacker.health -= back > attacker.health ? attacker.health : back;
    if (attacker.health < 0) attacker.health = 0;
  }

  return dealt;
}
