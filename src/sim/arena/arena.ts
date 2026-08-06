import type { Segment } from '../collision';
import { TileState, createTileGrid, setTileState, type TileGrid } from './tiles';
import { createSurfaceMap, setSurface, Surface, type SurfaceValue } from './surface';
import { createZone, type Zone } from './zone';
import { createEmitter, type Emitter } from './projectile';
import { createButton, cycle, triggered, type Button } from './activation';
import { createTrapdoor, type Trapdoor } from './trapdoor';
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
  trapdoors: ReadonlyArray<Trapdoor>;
}

export interface Arena {
  config: ArenaConfig;
  grid: TileGrid;
  segments: Segment[];
  surfaces: Uint8Array;
  zones: Zone[];
  emitters: Emitter[];
  buttons: Map<string, Button>;
  trapdoors: Trapdoor[];
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
  trapdoors: [],
};

/**
 * Arena 2: The Proving Ground.
 *
 * Falls were 54.2% of all deaths against 30.9% combat in a 200-match measurement of
 * `DEFAULT_ARENA` — the arena was killing bots faster than they were killing each other.
 * This arena removes every static pit from the fighting area, leaving only the outside
 * wall gaps and one button-activated trapdoor as ways to fall, to test whether that moves
 * the combat/fall split. It is also how the project owner intends to build the real
 * arenas going forward: no open pits, falls gated behind a mechanism a bot has to trigger
 * (or be shoved into).
 */
export const PROVING_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  // The whole point: no static pits.
  pits: [],
  // One gap per side, so a shove in any direction can eject a bot.
  wallGaps: [
    { side: 'top', from: 7, to: 9 },
    { side: 'bottom', from: 7, to: 9 },
    { side: 'left', from: 5, to: 7 },
    { side: 'right', from: 5, to: 7 },
  ],
  surfaces: [
    // The tar that sat dead centre in DEFAULT_ARENA now flanks the trapdoor instead,
    // since the trapdoor itself occupies the centre.
    [5, 5, Surface.Tar],
    [5, 6, Surface.Tar],
    [10, 5, Surface.Tar],
    [10, 6, Surface.Tar],
    // Ice patches unchanged from DEFAULT_ARENA.
    [2, 2, Surface.Ice],
    [3, 2, Surface.Ice],
    [2, 3, Surface.Ice],
    [3, 3, Surface.Ice],
    [12, 8, Surface.Ice],
    [13, 8, Surface.Ice],
    [12, 9, Surface.Ice],
    [13, 9, Surface.Ice],
  ],
  // Same hazards as DEFAULT_ARENA, unchanged: only static pits are being removed, not
  // hazards generally.
  zones: [
    { ...hazardPreset('saw').zone!, id: 'saw-l', x: 0, y: 300, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'saw-r', x: 960, y: 420, heading: 0 },
    { ...hazardPreset('flameJet').zone!, id: 'flame-t', x: 300, y: 0, heading: 1024 },
    {
      ...hazardPreset('flameJet').zone!,
      id: 'flame-b',
      x: 660,
      y: 720,
      heading: 3072,
      activation: cycle(220, 70),
    },
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
  // 'plate-1' kept exactly as DEFAULT_ARENA has it, for the crusher. 'trap-plate' is new,
  // driving the trapdoor below.
  buttons: [
    createButton('plate-1', 480, 200, 30, 90, 240),
    createButton('trap-plate', 180, 600, 30, 240, 480),
  ],
  // One trapdoor, dead centre, driven by 'trap-plate'.
  trapdoors: [createTrapdoor('trap-1', [[7, 5], [8, 5], [7, 6], [8, 6]], triggered('trap-plate'))],
};

/**
 * Every tile in the two outermost rings of a `cols` x `rows` grid, as `[col, row, Tar]`
 * triples. Generated rather than hand-typed: for 16 x 12 that is 96 literals, and a loop
 * is the only way to be sure the ring really is uniform on all four sides.
 */
function tarRing(cols: number, rows: number): Array<readonly [number, number, SurfaceValue]> {
  const tiles: Array<readonly [number, number, SurfaceValue]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (col < 2 || col >= cols - 2 || row < 2 || row >= rows - 2) {
        tiles.push([col, row, Surface.Tar]);
      }
    }
  }
  return tiles;
}

/**
 * Arena 3 (event slot 1): The Grinder.
 *
 * Why this exists: a 200-match measurement of `DEFAULT_ARENA` found Hit-and-Run and
 * Defensive — the two survival personalities — combining for 50.5% of all wins. In
 * last-bot-standing, not dying IS winning, so a bot that avoids the fight outperforms one
 * that seeks it. Three separate attempts to correct this by tuning AI weights (stronger
 * aggression bias, penalising distance from the nearest bot, etc.) all failed to move that
 * number. This arena does not touch the AI at all; it changes the geometry so that
 * fighting in the middle is the safer choice and running to the edges is the dangerous
 * one — pure spatial pressure, no behavioural tuning.
 *
 * Two interactions here are not obvious from the coordinates alone:
 *
 * 1. The two cannons fire along row 0 and row 11 respectively — the outermost rows,
 *    which sit INSIDE the tar ring (rows < 2 and > 9 are tar; see `tarRing`). Retreating
 *    to the edge does not just cost a bot speed, it walks that bot into the two lanes a
 *    triggered cannon sweeps. Slow AND exposed, at once.
 * 2. `buildArena` removes the floor tile behind every wall gap (see the comment on
 *    `WallGap`), and all four gaps here sit on the outer ring, so the tar ring ends up
 *    with four holes in it — the tile directly behind each gap is stamped Tar and then
 *    immediately carved out to Gone. That is expected: a bot shoved through a gap falls
 *    exactly as it would anywhere else, it just happens to fall out of a tile that also
 *    has a (moot) surface on it.
 */
export const GRINDER_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  // No static pits and no trapdoors: every way to die here is either combat or a hazard
  // a bot chose to be exposed to (tar ring, saws, cannons), not a hole in the floor.
  pits: [],
  // One gap per side, so a shove in any direction can eject a bot -- same reasoning as
  // PROVING_ARENA.
  wallGaps: [
    { side: 'top', from: 7, to: 9 },
    { side: 'bottom', from: 7, to: 9 },
    { side: 'left', from: 5, to: 7 },
    { side: 'right', from: 5, to: 7 },
  ],
  // The two outermost rings, generated by `tarRing`. The clean core is cols 2-13, rows
  // 2-9 (x 120-840, y 120-600) -- fight there and the ground never slows you down.
  surfaces: tarRing(16, 12),
  zones: [
    // Just above the left gap (which spans y 300-420).
    { ...hazardPreset('saw').zone!, id: 'saw-l', x: 0, y: 270, heading: 0 },
    // Just below the right gap (same span).
    { ...hazardPreset('saw').zone!, id: 'saw-r', x: 960, y: 450, heading: 0 },
    // Dead centre, always active (the preset's own activation) -- the one hazard a bot
    // fighting in the middle has to play around, on purpose.
    { ...hazardPreset('saw').zone!, id: 'saw-c', x: 480, y: 360, heading: 0 },
  ],
  // Two button-triggered cannons that sweep the outermost rows -- see the class comment
  // for why that matters. Both default to the preset's own speed/damage/radius; only
  // position, heading and activation are overridden per placement.
  emitters: [
    createEmitter({
      ...hazardPreset('cannon').emitter!,
      id: 'cannon-top',
      x: 0,
      y: 30,
      heading: 0, // fires left -> right along row 0
      activation: triggered('cannon-top-plate'),
    }),
    createEmitter({
      ...hazardPreset('cannon').emitter!,
      id: 'cannon-bot',
      x: 960,
      y: 690,
      heading: 2048, // fires right -> left along row 11
      activation: triggered('cannon-bot-plate'),
    }),
  ],
  // Both inside the clean core, diagonally opposite their cannon: you trigger the cannon
  // that sweeps the FAR side, hitting whoever retreated there rather than yourself.
  buttons: [
    createButton('cannon-top-plate', 300, 480, 30, 90, 240),
    createButton('cannon-bot-plate', 660, 240, 30, 90, 240),
  ],
  trapdoors: [],
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

  // Same reasoning as buttons/emitters above: fresh runtime objects per arena, not
  // shared config objects, so two matches built from one config don't share `open`.
  const trapdoors = config.trapdoors.map((trapdoor) =>
    createTrapdoor(trapdoor.id, trapdoor.tiles, { ...trapdoor.activation }),
  );

  return { config, grid, segments, surfaces, zones, emitters, buttons, trapdoors };
}
