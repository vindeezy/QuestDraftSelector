import { TileState, setTileState, type TileGrid } from './tiles';
import type { Match } from './match';

/** 2:30 at 60 ticks per second. Nothing happens before this. */
export const COLLAPSE_START_TICK = 9000;
/** 5:00. Every tile is gone by here, which is the hard ceiling on match length. */
export const COLLAPSE_END_TICK = 18000;
/** How long a tile flashes before it drops. */
export const WARNING_TICKS = 90;

/**
 * Tile indices in outside-in spiral order.
 *
 * Removing them in this order shrinks the playable floor from the perimeter toward the
 * middle, squeezing bots together. A ring-at-a-time order would drop whole sides at once;
 * a spiral reads as a continuous wave chasing bots inward.
 */
export function buildSpiralOrder(grid: TileGrid): number[] {
  const order: number[] = [];
  let top = 0;
  let bottom = grid.rows - 1;
  let left = 0;
  let right = grid.cols - 1;

  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) order.push(top * grid.cols + c);
    top++;
    for (let r = top; r <= bottom; r++) order.push(r * grid.cols + right);
    right--;
    if (top <= bottom) {
      for (let c = right; c >= left; c--) order.push(bottom * grid.cols + c);
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) order.push(r * grid.cols + left);
      left++;
    }
  }

  return order;
}

/**
 * Advances the collapse to match the current tick.
 *
 * Written as a function of absolute tick rather than an incremental step, so it is
 * idempotent and cannot drift: calling it twice on the same tick changes nothing, and
 * the schedule is identical regardless of how the match was stepped.
 */
export function updateCollapse(match: Match): void {
  const tick = match.world.tick;
  if (tick < COLLAPSE_START_TICK) return;

  const order = match.collapseOrder;
  const span = COLLAPSE_END_TICK - COLLAPSE_START_TICK;
  const progress = (tick - COLLAPSE_START_TICK) / span;

  const goneCount = Math.min(order.length, Math.floor(progress * order.length));
  const warningCount = Math.min(
    order.length,
    Math.floor(((tick - COLLAPSE_START_TICK + WARNING_TICKS) / span) * order.length),
  );

  for (let i = 0; i < goneCount; i++) {
    setTileState(match.arena.grid, order[i]!, TileState.Gone);
  }
  for (let i = goneCount; i < warningCount; i++) {
    if (match.arena.grid.tiles[order[i]!] !== TileState.Gone) {
      setTileState(match.arena.grid, order[i]!, TileState.Warning);
    }
  }
}
