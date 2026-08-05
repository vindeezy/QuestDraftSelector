/**
 * The arena floor as a grid of tiles.
 *
 * One rule drives three features: a bot whose centre is over a missing tile is
 * eliminated. Death pits are tiles that start missing, wall gaps are missing wall
 * segments with missing tiles beyond them, and the endgame collapse is tiles going
 * missing over time. Building a new arena means writing a different tile pattern, not
 * new code.
 *
 * Support is tested at the bot's centre rather than its footprint. That is deliberate:
 * it is simple and exactly deterministic, and with 60-unit tiles against 40-unit bots
 * the visual overhang is small.
 */

export const TileState = {
  Solid: 0,
  /** About to collapse. Still supports a bot. */
  Warning: 1,
  Gone: 2,
} as const;

export type TileStateValue = (typeof TileState)[keyof typeof TileState];

export interface TileGrid {
  cols: number;
  rows: number;
  tileSize: number;
  width: number;
  height: number;
  /** Row-major. One TileState per tile. */
  tiles: Uint8Array;
}

export function createTileGrid(cols: number, rows: number, tileSize: number): TileGrid {
  return {
    cols,
    rows,
    tileSize,
    width: cols * tileSize,
    height: rows * tileSize,
    tiles: new Uint8Array(cols * rows).fill(TileState.Solid),
  };
}

/** Row-major tile index containing a position, or -1 if outside the grid. */
export function tileIndexAt(grid: TileGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  const col = Math.floor(x / grid.tileSize);
  const row = Math.floor(y / grid.tileSize);
  return row * grid.cols + col;
}

export function tileStateAt(grid: TileGrid, x: number, y: number): TileStateValue {
  const index = tileIndexAt(grid, x, y);
  if (index < 0) return TileState.Gone;
  return grid.tiles[index] as TileStateValue;
}

export function setTileState(grid: TileGrid, index: number, state: TileStateValue): void {
  grid.tiles[index] = state;
}

/**
 * True when a body at this position has nothing under it.
 *
 * Outside the grid counts as a hole, so being shoved through a wall gap and leaving the
 * arena is the same code path as falling into a pit.
 */
export function isOverHole(grid: TileGrid, x: number, y: number): boolean {
  return tileStateAt(grid, x, y) === TileState.Gone;
}

/** Tiles that would still support a bot. WARNING tiles count — they have not dropped. */
export function solidTileCount(grid: TileGrid): number {
  let count = 0;
  for (let i = 0; i < grid.tiles.length; i++) {
    if (grid.tiles[i] !== TileState.Gone) count++;
  }
  return count;
}
