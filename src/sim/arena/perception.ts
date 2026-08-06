import { TileState, tileIndexAt } from './tiles';
import { isUntargetable, type Bot } from './bot';
import type { Match } from './match';
import { isActive } from './activation';
import { cosOf, sinOf } from '../trig';

/** How long after a contact two bots still count as fighting each other, in ticks. */
export const ENGAGE_MEMORY = 90;

/**
 * How far, in tiles, a bot looks for holes to steer away from.
 *
 * At 2 tiles a bot only noticed a pit from 120 units away, by which point its momentum
 * carried it in anyway — measured at 62% of all eliminations being avoidable falls,
 * clustered exactly on the pit tiles. Seeing one tile further gives it time to turn.
 */
const AVOID_RADIUS_TILES = 3;

export interface BotView {
  nearest: Bot | null;
  nearestDistSq: number;
  weakest: Bot | null;
  leader: Bot | null;
  /** Two other bots currently fighting each other, if any. Never includes self. */
  engagedPair: [Bot, Bot] | null;
  /** Repulsion away from nearby holes. Zero in open floor. */
  avoidX: number;
  avoidY: number;
}

/**
 * True when two bots are fighting each other right now.
 *
 * Requires the relationship to be mutual — each must have the other as its most recent
 * contact. One-sided memory means one of them has already moved on, which is exactly the
 * situation a Third Party Predator should not mistake for a locked-up duel.
 */
export function areEngaged(a: Bot, b: Bot, tick: number): boolean {
  if (!a.alive || !b.alive) return false;
  if (a.lastContactId !== b.body.id || b.lastContactId !== a.body.id) return false;
  return tick - a.lastContactTick <= ENGAGE_MEMORY && tick - b.lastContactTick <= ENGAGE_MEMORY;
}

/**
 * Repulsion away from holes within a couple of tiles.
 *
 * A potential field rather than a path search: each nearby hole pushes, weighted by
 * inverse distance, and the sum is blended into whatever the bot wanted to do. That is
 * what lets a bot chase and dodge at the same time, instead of choosing between them.
 */
function holeRepulsion(match: Match, bot: Bot): { x: number; y: number } {
  const grid = match.arena.grid;
  const size = grid.tileSize;
  const col = Math.floor(bot.body.x / size);
  const row = Math.floor(bot.body.y / size);

  let x = 0;
  let y = 0;

  for (let r = row - AVOID_RADIUS_TILES; r <= row + AVOID_RADIUS_TILES; r++) {
    for (let c = col - AVOID_RADIUS_TILES; c <= col + AVOID_RADIUS_TILES; c++) {
      const cx = c * size + size / 2;
      const cy = r * size + size / 2;
      const index = tileIndexAt(grid, cx, cy);
      // Off-grid counts as a hole: the arena edge is as lethal as a pit.
      const isHole = index < 0 || grid.tiles[index] === TileState.Gone;
      if (!isHole) continue;

      const dx = bot.body.x - cx;
      const dy = bot.body.y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq === 0) continue;
      const dist = Math.sqrt(distSq);
      // Inverse-square falloff, scaled by tile size so the units stay comparable to
      // the chase offsets this gets blended with.
      const strength = (size * size) / distSq;
      x += (dx / dist) * strength;
      y += (dy / dist) * strength;
    }
  }

  return { x, y };
}

/**
 * How far beyond a zone's own reach a bot notices it.
 *
 * A zone can be considerably larger than a single tile (a crusher reaches 45 units, a
 * flame jet's cone 110), so measuring "nearby" from its centre needs a wider margin than
 * the hole scan to give a bot the same effective warning distance beyond its edge that a
 * hole gets beyond a tile boundary.
 */
const ZONE_NOTICE_MARGIN = 220;

/**
 * Repulsion away from every currently active zone near the bot.
 *
 * Same inverse-square weighting as holes, scaled the same way, so a saw reads as
 * comparably dangerous to a pit rather than needing a second scale invented for it. A
 * zone that is NOT currently active contributes nothing at all -- that is what makes a
 * flame jet a timing hazard a cornered bot can gamble on, rather than a wall it must
 * always drive around.
 */
function zoneRepulsion(match: Match, bot: Bot): { x: number; y: number } {
  const size = match.arena.grid.tileSize;

  let x = 0;
  let y = 0;

  for (const zone of match.arena.zones) {
    if (!isActive(zone.activation, match.world.tick, match.arena.buttons)) continue;

    const dx = bot.body.x - zone.x;
    const dy = bot.body.y - zone.y;
    const distSq = dx * dx + dy * dy;
    if (distSq === 0) continue;

    // A zone's own reach pushes its "nearby" boundary outward, same as a hole's tile
    // footprint does implicitly by being scanned from its own centre.
    const limit = ZONE_NOTICE_MARGIN + zone.reach;
    if (distSq > limit * limit) continue;

    const dist = Math.sqrt(distSq);
    const strength = (size * size) / distSq;
    x += (dx / dist) * strength;
    y += (dy / dist) * strength;
  }

  return { x, y };
}

/** How far to either side of an emitter's line of fire counts as standing in it. */
const LANE_HALF_WIDTH_TILES = 1;

/**
 * Sideways repulsion out of every emitter's firing lane.
 *
 * A bot standing in front of an emitter is pushed perpendicular to its heading --
 * sidestepping the lane -- never straight back along the axis the shot travels, which
 * would just line the bot up for a shot down a straight retreat instead of clearing it.
 *
 * Unlike zones, an emitter's lane is dangerous regardless of whether it happens to be
 * mid-cycle right now: the shot travels fast and arrives on its own schedule, so a bot
 * has no way to time a crossing safely and should treat the lane as always live.
 */
function emitterRepulsion(match: Match, bot: Bot): { x: number; y: number } {
  const size = match.arena.grid.tileSize;
  const halfWidth = LANE_HALF_WIDTH_TILES * size;
  // Long enough to cover the whole arena along any heading.
  const range = match.arena.grid.width + match.arena.grid.height;

  let x = 0;
  let y = 0;

  for (const emitter of match.arena.emitters) {
    const ax = cosOf(emitter.heading);
    const ay = sinOf(emitter.heading);
    const dx = bot.body.x - emitter.x;
    const dy = bot.body.y - emitter.y;

    // Along the firing axis. Behind the emitter or beyond its useful range is safe.
    const along = dx * ax + dy * ay;
    if (along < 0 || along > range) continue;

    // Across the firing axis: positive to one side, negative to the other.
    const nx = -ay;
    const ny = ax;
    const across = dx * nx + dy * ny;
    if (across > halfWidth || across < -halfWidth) continue;

    const distSq = across * across;
    // Standing exactly on the centreline is the most dangerous spot of all, so it gets
    // the strongest push rather than dividing by zero into nothing. Which side it picks
    // is arbitrary but deterministic, same as the tie-break in `steerToward`.
    const strength = distSq === 0 ? size * size : (size * size) / distSq;
    const sign = across < 0 ? -1 : 1;
    x += nx * sign * strength;
    y += ny * sign * strength;
  }

  return { x, y };
}

export function perceive(match: Match, self: Bot): BotView {
  let nearest: Bot | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  let weakest: Bot | null = null;
  let leader: Bot | null = null;

  const tick = match.world.tick;

  // Smoke Screen removes a bot from every kind of target selection below — it is still a
  // real, collidable body, just invisible to everyone else's targeting for a while.
  for (const other of match.bots) {
    if (other === self || !other.alive || isUntargetable(other, tick)) continue;

    const dx = other.body.x - self.body.x;
    const dy = other.body.y - self.body.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = other;
    }
    if (weakest === null || other.health < weakest.health) weakest = other;
    if (other.kills > 0 && (leader === null || other.kills > leader.kills)) leader = other;
  }

  let engagedPair: [Bot, Bot] | null = null;
  for (let i = 0; i < match.bots.length && engagedPair === null; i++) {
    const a = match.bots[i]!;
    if (a === self || !a.alive || isUntargetable(a, tick)) continue;
    for (let j = i + 1; j < match.bots.length; j++) {
      const b = match.bots[j]!;
      if (b === self || !b.alive || isUntargetable(b, tick)) continue;
      if (areEngaged(a, b, match.world.tick)) {
        engagedPair = [a, b];
        break;
      }
    }
  }

  const hole = holeRepulsion(match, self);
  const zones = zoneRepulsion(match, self);
  const lanes = emitterRepulsion(match, self);

  return {
    nearest,
    nearestDistSq: nearest === null ? Number.POSITIVE_INFINITY : nearestDistSq,
    weakest,
    leader,
    engagedPair,
    avoidX: hole.x + zones.x + lanes.x,
    avoidY: hole.y + zones.y + lanes.y,
  };
}
