import { TileState, tileIndexAt } from './tiles';
import type { Bot } from './bot';
import type { Match } from './match';

/** How long after a contact two bots still count as fighting each other, in ticks. */
export const ENGAGE_MEMORY = 90;

/** How far, in tiles, a bot looks for holes to steer away from. */
const AVOID_RADIUS_TILES = 2;

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

export function perceive(match: Match, self: Bot): BotView {
  let nearest: Bot | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  let weakest: Bot | null = null;
  let leader: Bot | null = null;

  for (const other of match.bots) {
    if (other === self || !other.alive) continue;

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
    if (a === self || !a.alive) continue;
    for (let j = i + 1; j < match.bots.length; j++) {
      const b = match.bots[j]!;
      if (b === self || !b.alive) continue;
      if (areEngaged(a, b, match.world.tick)) {
        engagedPair = [a, b];
        break;
      }
    }
  }

  const avoid = holeRepulsion(match, self);

  return {
    nearest,
    nearestDistSq: nearest === null ? Number.POSITIVE_INFINITY : nearestDistSq,
    weakest,
    leader,
    engagedPair,
    avoidX: avoid.x,
    avoidY: avoid.y,
  };
}
