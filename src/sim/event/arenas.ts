import { GRINDER_ARENA, GAUNTLET_ARENA, type ArenaConfig } from '../arena/arena';
import { Surface } from '../arena/surface';
import { hazardPreset } from '../arena/hazards';
import { createEmitter } from '../arena/projectile';

/**
 * Three layout variants of the same 16 x 12 arena, one per battle.
 *
 * Playing all three battles of an event on one layout would make battle three feel like a
 * rerun of battle one. Arenas are pure configuration data, so a variant costs almost
 * nothing: different pits, surfaces and hazard placement, same grid and the same physics.
 */

/**
 * Variant 1 — "The Grinder."
 *
 * Was `DEFAULT_ARENA` unmodified; now points at `GRINDER_ARENA`, the geometry built to
 * push bots into the middle and punish retreating to the edges. See the comment on
 * `GRINDER_ARENA` in `arena.ts` for the full rationale.
 */
const GRINDER: ArenaConfig = GRINDER_ARENA;

/**
 * Variant 2 — "The Gauntlet."
 *
 * Now `GAUNTLET_ARENA`: ice-soaked concentric bands built specifically to make the
 * `grip` stat matter, plus two crossed-wiring trapdoors. See the comment on
 * `GAUNTLET_ARENA` in `arena.ts` for the full rationale.
 */
const GAUNTLET: ArenaConfig = GAUNTLET_ARENA;

/**
 * Variant 3 — "The Crossfire."
 *
 * Firing lanes and a slippery middle, so bots slide through them rather than choosing to
 * cross. The two cannons fire along different rows (240 and 480) so their lanes do not
 * overlap into one corridor of death, and the two lasers cross those lanes perpendicular.
 */
const CROSSFIRE: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  pits: [
    [3, 2],
    [12, 9],
  ],
  wallGaps: [
    { side: 'top', from: 3, to: 5 },
    { side: 'bottom', from: 11, to: 13 },
  ],
  surfaces: [
    // Slippery centre.
    [6, 5, Surface.Ice],
    [7, 5, Surface.Ice],
    [8, 5, Surface.Ice],
    [9, 5, Surface.Ice],
    [6, 6, Surface.Ice],
    [7, 6, Surface.Ice],
    [8, 6, Surface.Ice],
    [9, 6, Surface.Ice],
    // Sticky at the ends, where the ice would otherwise fling a bot straight into a wall.
    [2, 5, Surface.Tar],
    [2, 6, Surface.Tar],
    [13, 5, Surface.Tar],
    [13, 6, Surface.Tar],
  ],
  zones: [
    { ...hazardPreset('flameJet').zone!, id: 'c-flame-l', x: 0, y: 660, heading: 0 },
    { ...hazardPreset('flameJet').zone!, id: 'c-flame-r', x: 960, y: 60, heading: 2048 },
  ],
  emitters: [
    createEmitter({ ...hazardPreset('cannon').emitter!, id: 'c-cannon-w', x: 0, y: 240, heading: 0 }),
    createEmitter({
      ...hazardPreset('cannon').emitter!,
      id: 'c-cannon-e',
      x: 960,
      y: 480,
      heading: 2048,
    }),
    createEmitter({ ...hazardPreset('laser').emitter!, id: 'c-laser-n', x: 300, y: 0, heading: 1024 }),
    createEmitter({
      ...hazardPreset('laser').emitter!,
      id: 'c-laser-s',
      x: 660,
      y: 720,
      heading: 3072,
    }),
  ],
  buttons: [],
  trapdoors: [],
};

export const ARENA_VARIANTS: readonly ArenaConfig[] = [GRINDER, GAUNTLET, CROSSFIRE];

export const ARENA_VARIANT_NAMES: readonly string[] = [
  'The Grinder',
  'The Gauntlet',
  'The Crossfire',
];
