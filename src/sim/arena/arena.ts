import type { Segment } from '../collision';
import { TileState, createTileGrid, setTileState, type TileGrid } from './tiles';

export type WallSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * A missing run of wall. `from` and `to` are tile indices along that side, treated as a
 * half-open range. The floor behind a gap is removed too, so a bot shoved through it
 * falls rather than hovering outside the arena.
 */
export interface WallGap {
  side: WallSide;
  from: number;
  to: number;
}

export interface ArenaConfig {
  cols: number;
  rows: number;
  tileSize: number;
  /** Tiles that start missing, as [col, row]. */
  pits: ReadonlyArray<readonly [number, number]>;
  wallGaps: ReadonlyArray<WallGap>;
}

export interface Arena {
  config: ArenaConfig;
  grid: TileGrid;
  segments: Segment[];
}

/**
 * Arena 1. Moderate size — room to manoeuvre without dead air.
 *
 * 16 x 12 tiles of 60 units is 960 x 720. A bot is 40 across, so it sits comfortably on
 * one tile. Crossing the arena at full speed takes a little over two seconds.
 */
export const DEFAULT_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  // Four pits, offset from the centre so no single safe spot exists.
  pits: [
    [4, 3],
    [11, 3],
    [4, 8],
    [11, 8],
  ],
  // Two gaps on opposite sides, so knockback in either direction can eject a bot.
  wallGaps: [
    { side: 'top', from: 7, to: 9 },
    { side: 'bottom', from: 7, to: 9 },
  ],
};

/** Builds the wall segments for one side, split around its gaps. */
function buildSide(
  side: WallSide,
  config: ArenaConfig,
  gaps: ReadonlyArray<WallGap>,
): Segment[] {
  const size = config.tileSize;
  const count = side === 'top' || side === 'bottom' ? config.cols : config.rows;
  const blocked = new Set<number>();
  for (const gap of gaps) {
    if (gap.side !== side) continue;
    for (let i = gap.from; i < gap.to; i++) blocked.add(i);
  }

  const segments: Segment[] = [];
  let runStart: number | null = null;

  const emit = (from: number, to: number): void => {
    const a = from * size;
    const b = to * size;
    if (side === 'top') segments.push({ x1: a, y1: 0, x2: b, y2: 0 });
    else if (side === 'bottom') {
      segments.push({ x1: a, y1: config.rows * size, x2: b, y2: config.rows * size });
    } else if (side === 'left') segments.push({ x1: 0, y1: a, x2: 0, y2: b });
    else segments.push({ x1: config.cols * size, y1: a, x2: config.cols * size, y2: b });
  };

  for (let i = 0; i <= count; i++) {
    const open = i < count && !blocked.has(i);
    if (open && runStart === null) runStart = i;
    if (!open && runStart !== null) {
      emit(runStart, i);
      runStart = null;
    }
  }

  return segments;
}

export function buildArena(config: ArenaConfig): Arena {
  const grid = createTileGrid(config.cols, config.rows, config.tileSize);

  for (const [col, row] of config.pits) {
    setTileState(grid, row * config.cols + col, TileState.Gone);
  }

  // Remove the floor behind each gap, so being shoved out is the same code path as
  // falling into a pit.
  for (const gap of config.wallGaps) {
    for (let i = gap.from; i < gap.to; i++) {
      const isVertical = gap.side === 'left' || gap.side === 'right';
      const col = isVertical ? (gap.side === 'left' ? 0 : config.cols - 1) : i;
      const row = isVertical ? i : gap.side === 'top' ? 0 : config.rows - 1;
      setTileState(grid, row * config.cols + col, TileState.Gone);
    }
  }

  const segments: Segment[] = [];
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    segments.push(...buildSide(side, config, config.wallGaps));
  }

  return { config, grid, segments };
}
