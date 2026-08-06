import { isActive, type ActivationSpec, type Button } from './activation';
import { TileState, setTileState, type TileGrid } from './tiles';

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
): void {
  for (const trapdoor of trapdoors) {
    trapdoor.open = isActive(trapdoor.activation, tick, buttons);
    const state = trapdoor.open ? TileState.Gone : TileState.Solid;
    for (const [col, row] of trapdoor.tiles) {
      setTileState(grid, row * grid.cols + col, state);
    }
  }
}
