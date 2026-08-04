import { createBody, type Body } from '../body';
import type { Segment } from '../collision';

export interface BoardConfig {
  width: number;
  height: number;
  /** Number of staggered peg rows. The primary dial for how rare the outer slots are. */
  rows: number;
  pegSpacingX: number;
  pegSpacingY: number;
  pegRadius: number;
  /** Y of the first peg row. Balls fall freely above this. */
  pegTopY: number;
  /** Y where the slot dividers begin. */
  slotTopY: number;
  slotCount: number;
  pegRestitution: number;
}

export interface Slot {
  index: number;
  minX: number;
  maxX: number;
}

export interface Board {
  config: BoardConfig;
  pegs: Body[];
  segments: Segment[];
  slots: Slot[];
}

/**
 * Starting values, tuned for a 10-ball drop into 9 slots.
 *
 * `rows` is the dial that controls rarity: more rows sharpen the binomial distribution
 * and make the outer jackpot slots rarer. A later task tunes this against measured data
 * from `npm run distribution` — do not guess at it here.
 */
export const DEFAULT_BOARD: BoardConfig = {
  width: 760,
  height: 760,
  rows: 14,
  pegSpacingX: 60,
  pegSpacingY: 34,
  pegRadius: 6,
  pegTopY: 140,
  slotTopY: 640,
  slotCount: 9,
  pegRestitution: 0.32,
};

export function buildBoard(config: BoardConfig): Board {
  const pegs: Body[] = [];

  for (let row = 0; row < config.rows; row++) {
    const y = config.pegTopY + row * config.pegSpacingY;
    // Alternate rows shift right by half a spacing, which is what makes a ball
    // deflect left or right at each row and produces the binomial distribution.
    const offset = (row % 2) * (config.pegSpacingX / 2);
    const count = Math.floor((config.width - offset) / config.pegSpacingX) + 1;

    for (let col = 0; col < count; col++) {
      const x = offset + col * config.pegSpacingX;
      if (x < 0 || x > config.width) continue;
      pegs.push(
        createBody({
          id: `peg-${row}-${col}`,
          x,
          y,
          radius: config.pegRadius,
          mass: 0,
          restitution: config.pegRestitution,
        }),
      );
    }
  }

  const slotWidth = config.width / config.slotCount;
  const slots: Slot[] = [];
  for (let i = 0; i < config.slotCount; i++) {
    slots.push({ index: i, minX: i * slotWidth, maxX: (i + 1) * slotWidth });
  }

  const segments: Segment[] = [];

  // Outer walls, running the full height.
  segments.push({ x1: 0, y1: 0, x2: 0, y2: config.height });
  segments.push({ x1: config.width, y1: 0, x2: config.width, y2: config.height });

  // Slot dividers. The outer two boundaries are already covered by the walls above,
  // so only the interior boundaries need one.
  for (let i = 1; i < config.slotCount; i++) {
    const x = i * slotWidth;
    segments.push({ x1: x, y1: config.slotTopY, x2: x, y2: config.height });
  }

  // Floor.
  segments.push({ x1: 0, y1: config.height, x2: config.width, y2: config.height });

  return { config, pegs, segments, slots };
}

/** Returns the slot index containing `x`, clamped to the board. */
export function slotForX(board: Board, x: number): number {
  const slotWidth = board.config.width / board.config.slotCount;
  let index = Math.floor(x / slotWidth);
  if (index < 0) index = 0;
  if (index > board.config.slotCount - 1) index = board.config.slotCount - 1;
  return index;
}
