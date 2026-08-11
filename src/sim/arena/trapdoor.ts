import { isActive, type ActivationSpec, type Button } from './activation';
import { TileState, setTileState, type TileGrid } from './tiles';
import { pushEffect, type Effect } from './effects';

/**
 * A patch of floor that opens and closes on cue, driven by the shared `ActivationSpec` /
 * `isActive` mechanism (see `activation.ts`) rather than any trapdoor-specific logic —
 * the same button that can drive a flame jet or a cannon can drive a hidden pit.
 */
export interface Trapdoor {
  id: string;
  /** Tiles that open, as [col, row]. */
  tiles: ReadonlyArray<readonly [number, number]>;
  activation: ActivationSpec;
  /** Runtime: is it open right now. */
  open: boolean;
}

export function createTrapdoor(
  id: string,
  tiles: ReadonlyArray<readonly [number, number]>,
  activation: ActivationSpec,
): Trapdoor {
  return { id, tiles, activation, open: false };
}

/**
 * Recomputes every trapdoor's open state for this tick and writes it into the grid:
 * `TileState.Gone` while active, `TileState.Solid` while not.
 *
 * Must run before `updateCollapse` in `advanceMatch`. `updateCollapse` is a pure,
 * idempotent function of the current tick that re-asserts `Gone` for every tile it owns
 * on every tick it runs, so calling this first means a trapdoor that wrongly tries to
 * restore a tile the collapse has already claimed gets overwritten back to `Gone` in the
 * same tick, before anything reads the grid. No bookkeeping of which tiles the collapse
 * owns is needed — the ordering alone makes the resurrection impossible.
 */
export function updateTrapdoors(
  trapdoors: readonly Trapdoor[],
  grid: TileGrid,
  tick: number,
  buttons: Map<string, Button>,
  effects?: Effect[],
): void {
  for (const trapdoor of trapdoors) {
    const wasOpen = trapdoor.open;
    trapdoor.open = isActive(trapdoor.activation, tick, buttons);
    const state = trapdoor.open ? TileState.Gone : TileState.Solid;
    for (const [col, row] of trapdoor.tiles) {
      setTileState(grid, row * grid.cols + col, state);
    }

    // trapdoor: 1.0 always, fired once on the rising edge (closed -> open), the same
    // "fire on activation, not on every active tick" rule `fireEmitters` follows for
    // cannons. Positioned at the centroid of the tiles it opens.
    if (effects && trapdoor.open && !wasOpen) {
      let sumX = 0;
      let sumY = 0;
      for (const [col, row] of trapdoor.tiles) {
        sumX += col * grid.tileSize + grid.tileSize / 2;
        sumY += row * grid.tileSize + grid.tileSize / 2;
      }
      const count = trapdoor.tiles.length;
      pushEffect(effects, 'trapdoor', count > 0 ? sumX / count : 0, count > 0 ? sumY / count : 0, 1, null);
    }
  }
}
