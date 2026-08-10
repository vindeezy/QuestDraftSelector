import { cosOf, sinOf } from '../trig';
import { isActive, type ActivationSpec, type Button } from './activation';
import type { Bot } from './bot';

export const ZoneShape = {
  /** Omnidirectional, like a spinning blade or a pressure plate. */
  Circle: 0,
  /** Directed, like a flame jet or an air blast. */
  Cone: 1,
} as const;

export type ZoneShapeValue = (typeof ZoneShape)[keyof typeof ZoneShape];

/**
 * A positioned volume that hurts or shoves whatever is inside it.
 *
 * Damage and knockback are independent on purpose. A saw does both; an air blaster does
 * only knockback, which makes it a purely positional hazard whose job is to fling bots
 * into other hazards rather than to wear them down.
 */
export interface Zone {
  id: string;
  shape: ZoneShapeValue;
  x: number;
  y: number;
  /** Angle index the zone points along. Ignored by circles. */
  heading: number;
  /** Radius for a circle; length for a cone. */
  reach: number;
  /** Half-width for a cone. Ignored by circles. */
  halfWidth: number;
  damagePerTick: number;
  knockback: number;
  activation: ActivationSpec;
}

export function createZone(zone: Zone): Zone {
  return { ...zone };
}

/** Whether a bot is inside the zone's volume, accounting for its radius. */
export function zoneHits(zone: Zone, bot: Bot): boolean {
  const dx = bot.body.x - zone.x;
  const dy = bot.body.y - zone.y;

  if (zone.shape === ZoneShape.Circle) {
    const limit = zone.reach + bot.body.radius;
    return dx * dx + dy * dy <= limit * limit;
  }

  const ax = cosOf(zone.heading);
  const ay = sinOf(zone.heading);
  const along = dx * ax + dy * ay;
  if (along < 0 || along > zone.reach + bot.body.radius) return false;
  const across = dx * -ay + dy * ax;
  const width = zone.halfWidth + bot.body.radius;
  return across * across <= width * width;
}

/**
 * Applies one tick of a zone to a bot.
 *
 * The knockback matters as much as the damage: being flung is what turns a saw into a
 * positional threat rather than a slow drain, and what lets one bot shove another into it.
 */
export function applyZone(
  zone: Zone,
  bot: Bot,
  tick: number,
  buttons: Map<string, Button>,
): void {
  if (!bot.alive) return;
  if (!isActive(zone.activation, tick, buttons)) return;
  if (!zoneHits(zone, bot)) return;

  if (zone.damagePerTick > 0) {
    // `damageTaken` counts actual health lost, not the nominal per-tick amount, so it
    // never overcounts a tick that finishes the bot off with less than a full dose —
    // mirrors how `resolveHit` caps `dealt` at the target's remaining health. Zones have
    // no attacking bot, so this is a hazard death for `damageTaken` purposes but never a
    // `contacts` increment for anyone.
    const dealt = zone.damagePerTick > bot.health ? bot.health : zone.damagePerTick;
    bot.health -= dealt;
    if (bot.health < 0) bot.health = 0;
    bot.damageTaken += dealt;
  }

  if (zone.knockback === 0) return;
  const dx = bot.body.x - zone.x;
  const dy = bot.body.y - zone.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;
  const inv = 1 / Math.sqrt(lenSq);
  bot.body.vx += dx * inv * zone.knockback;
  bot.body.vy += dy * inv * zone.knockback;
}
