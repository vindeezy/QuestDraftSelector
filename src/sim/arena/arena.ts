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
    // Different period from the top jet (220 vs the preset's 180), so two jets sharing a
    // cycle don't fire in lockstep and read as uniformly safe or uniformly dangerous the
    // whole match. Different periods drift them in and out of sync instead. `cycle()` now
    // takes a phase offset too (see `activation.ts`), which is the more direct way to
    // desync two hazards on the same period — GAUNTLET_ARENA's flame jets use it — but
    // this arena is left on the mismatched-period trick it shipped with.
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
 * Concentric ice bands for GAUNTLET_ARENA, two tiles wide, generated rather than
 * hand-typed for the same reason as `tarRing` above.
 *
 * A tile's ring index is `min(col, row, cols-1-col, rows-1-row)` -- 0 at the outer wall,
 * increasing toward the centre. Rings 0-1 and 4-5 are ice; rings 2-3 sit between them as
 * plain (unlisted) floor.
 *
 * Two tiles wide is deliberate, not decorative: a bot is 40 units across against a
 * 60-unit tile, so a one-tile-wide band would leave a bot permanently straddling two
 * surfaces, its grip flickering on and off as its centre crossed the tile boundary. Two
 * tiles lets a bot actually settle onto a surface and commit to it.
 */
function iceBands(cols: number, rows: number): Array<readonly [number, number, SurfaceValue]> {
  const tiles: Array<readonly [number, number, SurfaceValue]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ring = Math.min(col, row, cols - 1 - col, rows - 1 - row);
      if (ring === 0 || ring === 1 || ring === 4 || ring === 5) {
        tiles.push([col, row, Surface.Ice]);
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

/**
 * Arena 2 (event slot 2): The Gauntlet.
 *
 * Design axis: speed and grip. Grip was measured as worth close to nothing -- Aluminium
 * was given +0.12 grip with its durability held constant and got WORSE. Tank Tracks,
 * built around 0.60 grip, is the weakest part in the game at 6.72 average draft
 * position. Neither can pay off on ground that is mostly plain floor, where grip barely
 * changes how a bot handles. This arena is deliberately soaked in ice -- see `iceBands`
 * -- so that grip stops being a stat nobody feels.
 *
 * No static pits: falls are gated behind the two trapdoors, in keeping with the project
 * owner's direction starting at PROVING_ARENA. No wall gaps either -- ejection is not
 * part of this arena's design, so knockback into a wall just means knockback into a
 * wall.
 */
export const GAUNTLET_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  pits: [],
  wallGaps: [],
  // Rings 0-1 and 4-5 are ice, ring 2-3 is a plain (unlisted) band between them. See
  // `iceBands` for why the bands are two tiles wide.
  surfaces: iceBands(16, 12),
  emitters: [],
  // Two saws, near top and bottom. `saw-t` at (480,120) sits on ring 2 (the plain
  // band); `saw-b` at (480,600) — the exact coordinates given for this layout — actually
  // falls on ring 1 (ice), one ring further out than its counterpart. Coordinates are
  // implemented exactly as specified; this asymmetry is flagged, not corrected.
  //
  // Eight flame jets, two per wall, in two alternating groups (A/B) that travel around
  // the perimeter. Each points into the arena (see the heading comment on each).
  //
  // The pacing is a four-beat rhythm on a shared 360-tick (6s) period: quiet, group A
  // (60 ticks), quiet, group B (60 ticks) -- each quiet stretch twice the length of a
  // burst. `cycle`'s new phase parameter is what makes this possible: both groups share
  // one period and one activeTicks, and only their phase differs (240 vs 60), so they
  // are provably never on at the same time instead of merely unlikely to be.
  zones: [
    // Tile CENTRES on rows 2 and 9, not y=120/600 as first specified. Two things were
    // wrong with those: 120 and 600 are tile edges, so each saw straddled two rows; and
    // with rows numbered 0-11 the mirror of row 2 is row 9, not row 10, so y=600 put the
    // bottom saw one ring further out than the top one — on ice rather than normal floor.
    // Both now sit on ring 2, the normal band, symmetric about the centre.
    { ...hazardPreset('saw').zone!, id: 'saw-t', x: 480, y: 150, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'saw-b', x: 480, y: 570, heading: 0 },
    // Top wall, pointing down (+y).
    { ...hazardPreset('flameJet').zone!, id: 'flame-t1', x: 320, y: 0, heading: 1024, activation: cycle(360, 60, 240) },
    { ...hazardPreset('flameJet').zone!, id: 'flame-t2', x: 640, y: 0, heading: 1024, activation: cycle(360, 60, 60) },
    // Right wall, pointing left (-x).
    { ...hazardPreset('flameJet').zone!, id: 'flame-r1', x: 960, y: 240, heading: 2048, activation: cycle(360, 60, 240) },
    { ...hazardPreset('flameJet').zone!, id: 'flame-r2', x: 960, y: 480, heading: 2048, activation: cycle(360, 60, 60) },
    // Bottom wall, pointing up (-y).
    { ...hazardPreset('flameJet').zone!, id: 'flame-b1', x: 640, y: 720, heading: 3072, activation: cycle(360, 60, 240) },
    { ...hazardPreset('flameJet').zone!, id: 'flame-b2', x: 320, y: 720, heading: 3072, activation: cycle(360, 60, 60) },
    // Left wall, pointing right (+x).
    { ...hazardPreset('flameJet').zone!, id: 'flame-l1', x: 0, y: 480, heading: 0, activation: cycle(360, 60, 240) },
    { ...hazardPreset('flameJet').zone!, id: 'flame-l2', x: 0, y: 240, heading: 0, activation: cycle(360, 60, 60) },
  ],
  // Crossed wiring: each button opens the trapdoor on the OPPOSITE side of the arena, so
  // the bot that opens a pit is never standing near it. Both plates sit on ring 2 (plain
  // floor), reachable regardless of which ice band a bot is currently committed to.
  buttons: [
    createButton('trap-left-plate', 810, 330, 30, 240, 480),
    createButton('trap-right-plate', 150, 330, 30, 240, 480),
  ],
  trapdoors: [
    createTrapdoor('trap-left', [[3, 5], [4, 5], [3, 6], [4, 6]], triggered('trap-left-plate')),
    createTrapdoor('trap-right', [[11, 5], [12, 5], [11, 6], [12, 6]], triggered('trap-right-plate')),
  ],
};

/**
 * The 20 tar tiles for CROSSFIRE_ARENA: the four tar corners, one tile in from each
 * corner along the top/bottom rows, plus the mid-height runs against the left and right
 * walls. Generated from four small coordinate lists rather than 20 literal triples, so
 * the (deliberate) asymmetry between the row set and the column set stays visible in the
 * source instead of being hidden inside a single uniform loop.
 */
function crossfireTarTiles(): Array<readonly [number, number, SurfaceValue]> {
  const tiles: Array<readonly [number, number, SurfaceValue]> = [];
  // Row 1 and row 10: six tar tiles apiece, including the four trapdoor tiles.
  for (const col of [1, 3, 5, 10, 12, 14]) {
    tiles.push([col, 1, Surface.Tar]);
    tiles.push([col, 10, Surface.Tar]);
  }
  // Col 0 and col 15: the four rows flanking the middle of the arena.
  for (const row of [4, 5, 6, 7]) {
    tiles.push([0, row, Surface.Tar]);
    tiles.push([15, row, Surface.Tar]);
  }
  return tiles;
}

/**
 * The 28 ice tiles for CROSSFIRE_ARENA: cols 1-2 and cols 13-14, rows 2-9 -- 32 tiles by
 * that rule alone -- with the four saw tiles ([1,4], [1,7], [14,4], [14,7]) explicitly
 * excluded so they stay normal floor. The exclusion is a live check inside the loop, not
 * a trimmed row range, so it stays visible rather than folded away as an implementation
 * detail.
 */
function crossfireIceTiles(): Array<readonly [number, number, SurfaceValue]> {
  const tiles: Array<readonly [number, number, SurfaceValue]> = [];
  for (const col of [1, 2, 13, 14]) {
    for (let row = 2; row <= 9; row++) {
      const isSawTile = (col === 1 || col === 14) && (row === 4 || row === 7);
      if (isSawTile) continue;
      tiles.push([col, row, Surface.Ice]);
    }
  }
  return tiles;
}

/**
 * Arena 3 (event slot 3): The Crossfire.
 *
 * Measurement across the first two arenas found speed acting as a DEFENSIVE stat: a fast
 * bot can break contact before a hit lands on its rear, where chassis vulnerability runs
 * 1.7-2.2, so the Hover drive keeps winning regardless of what GRINDER_ARENA and
 * GAUNTLET_ARENA otherwise punish. This arena is the direct counter to that. Every
 * hazard here sits on the perimeter -- the four trapdoors, four saw zones, sixteen flame
 * jets and four cannons are all wall- or corner-mounted -- and every trigger sits in the
 * middle, on the 28-button circuit that rings the fighting area one tile in from the
 * centre. Fleeing to open ground does not put a bot somewhere safe; it puts the whole
 * perimeter one press away from being lethal, aimed at whoever is standing out there. The
 * bots left brawling in the middle are the ones pressing the buttons -- involuntarily,
 * just by being there -- so the safest place to stand is also the one most likely to
 * trigger something. Running is what gets punished; nobody can simply out-drive it.
 *
 * The 28 buttons are wired one-to-one to the 28 hazards (button N always drives hazard N)
 * and form a clockwise circuit around the centre: b1-b8 across row 4, b9-b12 down column
 * L, b13-b20 back along row 9, b21-b24 up column E, and b25-b28 on the dead-centre 2x2.
 * That ordering is deliberate -- it is what makes "brawling in the centre" and "pressing
 * buttons" the same behaviour, rather than something a bot has to detour for.
 *
 * No static pits and no wall gaps: the four trapdoors are the only way to fall, in
 * keeping with the project owner's direction starting at PROVING_ARENA.
 */
export const CROSSFIRE_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  pits: [],
  wallGaps: [],
  surfaces: [...crossfireTarTiles(), ...crossfireIceTiles()],
  zones: [
    // --- Saws: the four tar corners' opposite numbers, on the ice flanks. -------------
    { ...hazardPreset('saw').zone!, id: 'saw-10', x: 90, y: 450, heading: 0, activation: triggered('b10') },
    { ...hazardPreset('saw').zone!, id: 'saw-11', x: 90, y: 270, heading: 0, activation: triggered('b11') },
    { ...hazardPreset('saw').zone!, id: 'saw-22', x: 870, y: 270, heading: 0, activation: triggered('b22') },
    { ...hazardPreset('saw').zone!, id: 'saw-23', x: 870, y: 450, heading: 0, activation: triggered('b23') },

    // --- Flame jets: 16 wall-mounted, pointing inward. --------------------------------
    // Top wall, y = 0, pointing down (+y).
    { ...hazardPreset('flameJet').zone!, id: 'flame-14', x: 150, y: 0, heading: 1024, activation: triggered('b14') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-15', x: 270, y: 0, heading: 1024, activation: triggered('b15') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-16', x: 390, y: 0, heading: 1024, activation: triggered('b16') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-17', x: 570, y: 0, heading: 1024, activation: triggered('b17') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-18', x: 690, y: 0, heading: 1024, activation: triggered('b18') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-19', x: 810, y: 0, heading: 1024, activation: triggered('b19') },
    // Bottom wall, y = 720, pointing up (-y).
    { ...hazardPreset('flameJet').zone!, id: 'flame-7', x: 150, y: 720, heading: 3072, activation: triggered('b7') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-6', x: 270, y: 720, heading: 3072, activation: triggered('b6') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-5', x: 390, y: 720, heading: 3072, activation: triggered('b5') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-4', x: 570, y: 720, heading: 3072, activation: triggered('b4') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-3', x: 690, y: 720, heading: 3072, activation: triggered('b3') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-2', x: 810, y: 720, heading: 3072, activation: triggered('b2') },
    // Left wall, x = 0, pointing right (+x).
    { ...hazardPreset('flameJet').zone!, id: 'flame-12', x: 0, y: 150, heading: 0, activation: triggered('b12') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-9', x: 0, y: 570, heading: 0, activation: triggered('b9') },
    // Right wall, x = 960, pointing left (-x).
    { ...hazardPreset('flameJet').zone!, id: 'flame-21', x: 960, y: 150, heading: 2048, activation: triggered('b21') },
    { ...hazardPreset('flameJet').zone!, id: 'flame-24', x: 960, y: 570, heading: 2048, activation: triggered('b24') },
  ],
  // Four cannons sweeping the perimeter clockwise: top L->R, right edge down, bottom
  // R->L, left edge up. See the class comment for how that pairs with the button circuit.
  emitters: [
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'cannon-28', x: 0, y: 30, heading: 0, activation: triggered('b28') }),
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'cannon-27', x: 930, y: 0, heading: 1024, activation: triggered('b27') }),
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'cannon-25', x: 960, y: 690, heading: 2048, activation: triggered('b25') }),
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'cannon-26', x: 30, y: 720, heading: 3072, activation: triggered('b26') }),
  ],
  // The 28-button circuit. See the class comment for the clockwise ordering.
  buttons: [
    createButton('b1', 270, 210, 30, 150, 240),
    createButton('b2', 330, 210, 30, 90, 150),
    createButton('b3', 390, 210, 30, 90, 150),
    createButton('b4', 450, 210, 30, 90, 150),
    createButton('b5', 510, 210, 30, 90, 150),
    createButton('b6', 570, 210, 30, 90, 150),
    createButton('b7', 630, 210, 30, 90, 150),
    createButton('b8', 690, 210, 30, 150, 240),
    createButton('b9', 690, 270, 30, 90, 150),
    createButton('b10', 690, 330, 30, 90, 240),
    createButton('b11', 690, 390, 30, 90, 240),
    createButton('b12', 690, 450, 30, 90, 150),
    createButton('b13', 690, 510, 30, 150, 240),
    createButton('b14', 630, 510, 30, 90, 150),
    createButton('b15', 570, 510, 30, 90, 150),
    createButton('b16', 510, 510, 30, 90, 150),
    createButton('b17', 450, 510, 30, 90, 150),
    createButton('b18', 390, 510, 30, 90, 150),
    createButton('b19', 330, 510, 30, 90, 150),
    createButton('b20', 270, 510, 30, 150, 240),
    createButton('b21', 270, 450, 30, 90, 150),
    createButton('b22', 270, 390, 30, 90, 240),
    createButton('b23', 270, 330, 30, 90, 240),
    createButton('b24', 270, 270, 30, 90, 150),
    createButton('b25', 450, 330, 30, 90, 150),
    createButton('b26', 510, 330, 30, 90, 150),
    createButton('b27', 450, 390, 30, 90, 150),
    createButton('b28', 510, 390, 30, 90, 150),
  ],
  // Four trapdoors, one tile each, on the tar corners.
  trapdoors: [
    createTrapdoor('pit-1', [[14, 10]], triggered('b1')),
    createTrapdoor('pit-8', [[1, 10]], triggered('b8')),
    createTrapdoor('pit-13', [[1, 1]], triggered('b13')),
    createTrapdoor('pit-20', [[14, 1]], triggered('b20')),
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

  const surfaces = createSurfaceMap(grid);
  for (const [col, row, surface] of config.surfaces) {
    setSurface(surfaces, row * config.cols + col, surface);
  }

  // A tile cannot be both a floor surface and a hole. Surfaces are stamped from the
  // config, which does not know which tiles the pits and wall gaps carve out, so an arena
  // that generates its surfaces in bulk — GRINDER_ARENA's tar ring covers the whole outer
  // border, and all four of its gaps sit on that border — legitimately ends up stamping
  // tar onto tiles that are then removed. Clearing them here keeps the two maps agreeing
  // by construction, rather than asking every arena author to hand-subtract their gaps.
  //
  // Nothing reads a removed tile's surface today (a bot over a hole is falling, not
  // driving), so this changes no behaviour. It exists so the invariant stays true, and
  // so a genuine authoring mistake — ice deliberately painted onto a pit — is not hidden
  // among noise the generator produced.
  for (let i = 0; i < grid.tiles.length; i++) {
    if (grid.tiles[i] === TileState.Gone) setSurface(surfaces, i, Surface.Plain);
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
