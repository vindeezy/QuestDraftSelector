import type { Segment } from '../collision';
import { TileState, createTileGrid, setTileState, type TileGrid } from './tiles';
import { createSurfaceMap, setSurface, Surface, type SurfaceValue } from './surface';
import { createZone, type Zone } from './zone';
import { createEmitter, type Emitter } from './projectile';
import { createButton, cycle, triggered, type Button } from './activation';
import { hazardPreset } from './hazards';

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
  /** Floor surfaces, as [col, row, surface]. */
  surfaces: ReadonlyArray<readonly [number, number, SurfaceValue]>;
  zones: ReadonlyArray<Zone>;
  emitters: ReadonlyArray<Emitter>;
  buttons: ReadonlyArray<Button>;
}

export interface Arena {
  config: ArenaConfig;
  grid: TileGrid;
  segments: Segment[];
  surfaces: Uint8Array;
  zones: Zone[];
  emitters: Emitter[];
  buttons: Map<string, Button>;
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
  // Two pits on a diagonal, offset from the centre so no single safe spot exists.
  //
  // Four was too many. Bots have a ~101-unit turn radius against a 60-unit pit, so
  // avoiding one at speed is close to geometrically impossible, and with four of them
  // in the fighting area 46% of ALL eliminations were bots driving in unassisted. That
  // made the match a contest of hazard-avoidance rather than combat, which is why the
  // most cautious personality was winning 40-65% of the time. Three separate AI fixes
  // (stronger repulsion, hazard braking, tangential steering) failed to move it; the
  // number of pits was the real lever.
  pits: [
    [4, 3],
    [11, 8],
  ],
  // Two gaps on opposite sides, so knockback in either direction can eject a bot.
  wallGaps: [
    { side: 'top', from: 7, to: 9 },
    { side: 'bottom', from: 7, to: 9 },
  ],
  surfaces: [
    // Tar sits dead centre, where retreating bots are forced to cross it.
    [7, 5, Surface.Tar],
    [8, 5, Surface.Tar],
    [7, 6, Surface.Tar],
    [8, 6, Surface.Tar],
    // Ice patches top-left and bottom-right, away from the pits and the tar.
    [2, 2, Surface.Ice],
    [3, 2, Surface.Ice],
    [2, 3, Surface.Ice],
    [3, 3, Surface.Ice],
    [12, 8, Surface.Ice],
    [13, 8, Surface.Ice],
    [12, 9, Surface.Ice],
    [13, 9, Surface.Ice],
  ],
  zones: [
    { ...hazardPreset('saw').zone!, id: 'saw-l', x: 0, y: 300, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'saw-r', x: 960, y: 420, heading: 0 },
    // Points down, into the arena.
    { ...hazardPreset('flameJet').zone!, id: 'flame-t', x: 300, y: 0, heading: 1024 },
    // Different period from the top jet (220 vs the preset's 180). `cycle()` has no
    // phase offset, so two jets sharing a period fire in lockstep and the arena reads
    // as uniformly safe or uniformly dangerous the whole match. Different periods drift
    // them in and out of sync instead. A phase parameter would be the better long-term
    // fix; it belongs with the Arena Builder, not here.
    {
      ...hazardPreset('flameJet').zone!,
      id: 'flame-b',
      x: 660,
      y: 720,
      heading: 3072,
      activation: cycle(220, 70),
    },
    // Button-triggered rather than cycling — the one demonstration that buttons drive a
    // hazard end to end. Leave it wired to 'plate-1'.
    {
      ...hazardPreset('crusher').zone!,
      id: 'crusher',
      x: 480,
      y: 500,
      heading: 0,
      activation: triggered('plate-1'),
    },
  ],
  emitters: [
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'cannon-l', x: 0, y: 600, heading: 0 }),
  ],
  buttons: [createButton('plate-1', 480, 200, 30, 90, 240)],
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

  const surfaces = createSurfaceMap(grid);
  for (const [col, row, surface] of config.surfaces) {
    setSurface(surfaces, row * config.cols + col, surface);
  }

  // Copy every zone, emitter and button rather than sharing the config's objects.
  // Emitters carry runtime state (`wasActive`) and buttons carry `pressed` /
  // `armedUntil` / `nextArmTick`; two matches built from the same config must not
  // share that state, or match 2 would inherit match 1's buttons mid-press.
  const zones = config.zones.map((zone) => createZone(zone));
  const emitters = config.emitters.map((emitter) =>
    createEmitter({
      id: emitter.id,
      x: emitter.x,
      y: emitter.y,
      heading: emitter.heading,
      speed: emitter.speed,
      damage: emitter.damage,
      radius: emitter.radius,
      activation: { ...emitter.activation },
    }),
  );
  const buttons = new Map<string, Button>();
  for (const button of config.buttons) {
    buttons.set(button.id, createButton(button.id, button.x, button.y, button.radius, button.latchTicks, button.cooldown));
  }

  return { config, grid, segments, surfaces, zones, emitters, buttons };
}
