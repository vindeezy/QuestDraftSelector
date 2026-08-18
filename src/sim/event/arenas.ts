import { GRINDER_ARENA, GAUNTLET_ARENA, CROSSFIRE_ARENA, type ArenaConfig } from '../arena/arena';

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
 * Variant 2 — "Fire & Ice."
 *
 * Now `GAUNTLET_ARENA`: ice-soaked concentric bands built specifically to make the
 * `grip` stat matter, plus two crossed-wiring trapdoors. See the comment on
 * `GAUNTLET_ARENA` in `arena.ts` for the full rationale.
 */
const GAUNTLET: ArenaConfig = GAUNTLET_ARENA;

/**
 * Variant 3 — "The Crossfire."
 *
 * Now `CROSSFIRE_ARENA`: every hazard on the perimeter, every trigger in the middle, so
 * fleeing to open ground is what gets a bot killed rather than what keeps it alive. See
 * the comment on `CROSSFIRE_ARENA` in `arena.ts` for the full rationale.
 */
const CROSSFIRE: ArenaConfig = CROSSFIRE_ARENA;

export const ARENA_VARIANTS: readonly ArenaConfig[] = [GRINDER, GAUNTLET, CROSSFIRE];

export const ARENA_VARIANT_NAMES: readonly string[] = [
  'The Grinder',
  'Fire & Ice',
  'The Crossfire',
];
