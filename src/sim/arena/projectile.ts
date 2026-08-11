import { cosOf, sinOf } from '../trig';
import { isActive, type ActivationSpec, type Button } from './activation';
import type { Bot } from './bot';
import { pushEffect, hazardHitIntensity, type Effect } from './effects';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  alive: boolean;
}

/** A wall-mounted gun. Fires one shot per activation, not one per active tick. */
export interface Emitter {
  id: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  damage: number;
  radius: number;
  activation: ActivationSpec;
  /** Runtime: whether it was active last tick, so it fires on the rising edge only. */
  wasActive: boolean;
}

export function createEmitter(init: Omit<Emitter, 'wasActive'>): Emitter {
  return { ...init, wasActive: false };
}

/**
 * Spawns a shot from each emitter that has just become active.
 *
 * Rising edge, not level: an always-on emitter should fire once, not empty a magazine
 * every tick. That also makes a button-triggered cannon fire one shot per press.
 */
export function fireEmitters(
  emitters: Emitter[],
  tick: number,
  buttons: Map<string, Button>,
  out: Projectile[],
  effects?: Effect[],
): Projectile[] {
  for (const emitter of emitters) {
    const active = isActive(emitter.activation, tick, buttons);
    if (active && !emitter.wasActive) {
      out.push({
        x: emitter.x,
        y: emitter.y,
        vx: cosOf(emitter.heading) * emitter.speed,
        vy: sinOf(emitter.heading) * emitter.speed,
        damage: emitter.damage,
        radius: emitter.radius,
        alive: true,
      });
      // cannonFire: 1.0 always. This marks the muzzle flash moment, not a hit -- there
      // is no damage yet to normalise against, the shot has not travelled anywhere.
      if (effects) pushEffect(effects, 'cannonFire', emitter.x, emitter.y, 1, null);
    }
    emitter.wasActive = active;
  }
  return out;
}

/**
 * Whether the segment from (ax, ay) to (bx, by) passes within `radius` of (cx, cy).
 *
 * This is why projectiles need sweeping rather than endpoint tests. A cannonball moving
 * 20 units per tick against a 20-unit bot can start in front of it and end behind it,
 * having passed straight through without ever overlapping at a sampled position.
 */
export function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const ex = bx - ax;
  const ey = by - ay;
  const lenSq = ex * ex + ey * ey;

  let t = lenSq === 0 ? 0 : ((cx - ax) * ex + (cy - ay) * ey) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const px = ax + ex * t - cx;
  const py = ay + ey * t - cy;
  return px * px + py * py <= radius * radius;
}

/**
 * Advances every projectile one tick, resolving hits and culling the dead.
 *
 * A projectile hits at most one bot and is destroyed by it — it does not continue
 * through. When several bots lie along the path, the nearest to the start is hit.
 */
export function stepProjectiles(
  projectiles: Projectile[],
  bots: readonly Bot[],
  arenaWidth: number,
  arenaHeight: number,
  effects?: Effect[],
): void {
  for (const shot of projectiles) {
    if (!shot.alive) continue;

    const fromX = shot.x;
    const fromY = shot.y;
    shot.x += shot.vx;
    shot.y += shot.vy;

    let hit: Bot | null = null;
    let hitDistSq = Number.POSITIVE_INFINITY;

    for (const bot of bots) {
      if (!bot.alive) continue;
      const reach = bot.body.radius + shot.radius;
      if (!segmentHitsCircle(fromX, fromY, shot.x, shot.y, bot.body.x, bot.body.y, reach)) {
        continue;
      }
      const dx = bot.body.x - fromX;
      const dy = bot.body.y - fromY;
      const distSq = dx * dx + dy * dy;
      if (distSq < hitDistSq) {
        hitDistSq = distSq;
        hit = bot;
      }
    }

    if (hit !== null) {
      // Same "actual health lost, not nominal damage" rule as `zone.ts` — caps at what
      // the bot had left, so a killing shot never overcounts `damageTaken`. Emitters have
      // no attacking bot, so this never increments anyone's `contacts`.
      const dealt = shot.damage > hit.health ? hit.health : shot.damage;
      hit.health -= dealt;
      if (hit.health < 0) hit.health = 0;
      hit.damageTaken += dealt;
      if (effects) {
        pushEffect(effects, 'hazardHit', hit.body.x, hit.body.y, hazardHitIntensity(dealt), hit.body.id);
      }
      shot.alive = false;
      continue;
    }

    if (shot.x < 0 || shot.y < 0 || shot.x > arenaWidth || shot.y > arenaHeight) {
      shot.alive = false;
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (!projectiles[i]!.alive) projectiles.splice(i, 1);
  }
}
