import { DEFAULT_ARENA, type ArenaConfig } from '../arena/arena';
import { Surface } from '../arena/surface';
import { hazardPreset } from '../arena/hazards';
import { createEmitter } from '../arena/projectile';
import { createButton, triggered } from '../arena/activation';

/**
 * Three layout variants of the same 16 x 12 arena, one per battle.
 *
 * Playing all three battles of an event on one layout would make battle three feel like a
 * rerun of battle one. Arenas are pure configuration data, so a variant costs almost
 * nothing: different pits, surfaces and hazard placement, same grid and the same physics.
 */

/** Variant 1 — "The Grinder." The original arena, unmodified. */
const GRINDER: ArenaConfig = DEFAULT_ARENA;

/**
 * Variant 2 — "The Gauntlet."
 *
 * Positional rather than attritional. Conveyors on the long axis herd bots toward a
 * central pair of pits instead of relying on damage to thin the field.
 */
const GAUNTLET: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  pits: [
    [7, 5],
    [8, 6],
  ],
  // Gaps on the long sides rather than the ends, so knockback along the conveyors'
  // axis is what ejects a bot, not knockback across it.
  wallGaps: [
    { side: 'left', from: 5, to: 7 },
    { side: 'right', from: 5, to: 7 },
  ],
  surfaces: [
    // Feeds east into the pit at [7, 5].
    [3, 5, Surface.ConveyorE],
    [4, 5, Surface.ConveyorE],
    [5, 5, Surface.ConveyorE],
    [6, 5, Surface.ConveyorE],
    // Feeds west into the pit at [8, 6].
    [9, 6, Surface.ConveyorW],
    [10, 6, Surface.ConveyorW],
    [11, 6, Surface.ConveyorW],
    [12, 6, Surface.ConveyorW],
    // Slow ground top and bottom centre, where a bot fleeing a conveyor is forced to cross.
    [7, 2, Surface.Tar],
    [8, 2, Surface.Tar],
    [7, 9, Surface.Tar],
    [8, 9, Surface.Tar],
    [2, 8, Surface.Gravel],
    [3, 8, Surface.Gravel],
    [12, 3, Surface.Gravel],
    [13, 3, Surface.Gravel],
  ],
  zones: [
    { ...hazardPreset('saw').zone!, id: 'g-saw-tl', x: 0, y: 180, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'g-saw-bl', x: 0, y: 540, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'g-saw-tr', x: 960, y: 180, heading: 0 },
    { ...hazardPreset('saw').zone!, id: 'g-saw-br', x: 960, y: 540, heading: 0 },
    // Button-triggered rather than cycling, wired to the plate at arena centre.
    {
      ...hazardPreset('crusher').zone!,
      id: 'g-crusher',
      x: 480,
      y: 360,
      heading: 0,
      activation: triggered('g-plate'),
    },
  ],
  emitters: [],
  buttons: [createButton('g-plate', 180, 360, 30, 90, 240)],
};

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
};

export const ARENA_VARIANTS: readonly ArenaConfig[] = [GRINDER, GAUNTLET, CROSSFIRE];

export const ARENA_VARIANT_NAMES: readonly string[] = [
  'The Grinder',
  'The Gauntlet',
  'The Crossfire',
];
