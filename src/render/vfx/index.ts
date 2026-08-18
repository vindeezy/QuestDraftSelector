import { partIdFor } from '../../sim/parts/from-effect';
import type { BotBuild } from '../../sim/parts/assemble';
import type { Effect } from '../../sim/arena/effects';

/**
 * What an event should LOOK like.
 *
 * The visual twin of `audio/classify.ts`, and deliberately built the same way: a Saw Blade and
 * a Hammer both raise `weaponHit`, a flame jet and a cannonball both raise `hazardHit`, so the
 * differentiation lives in one pure table rather than being scattered through the renderer.
 * Both layers ask `sim/parts/from-effect` the same question about which part fired.
 *
 * Pure. No PixiJS, no canvas — this decides shape, colour and force, and something else draws
 * it. That is what makes "every ability looks different" a test rather than an intention.
 *
 * ONE RULE OUTRANKS EVERYTHING HERE. If effects hide bots, effects lose. Ten people are
 * watching to find their own machine in the scrum, and a viewer who cannot see their bot is
 * not having a better time because the sparks were pretty. Every count and lifetime below is
 * chosen to read at a glance and get out of the way, and the shake cap exists for the same
 * reason.
 */

export type VisualKind = 'burst' | 'puff' | 'ring' | 'shroud' | 'wave';

export interface VisualLayer {
  kind: VisualKind;
  tint: number;
  /** Multiplies the effect's intensity when spawning. Below 1 for the quiet, constant events. */
  scale: number;
}

export interface Visual {
  /** Usually one. Two when an event is genuinely two things at once, like a death. */
  layers: VisualLayer[];
  /** 0-1. Only an elimination shakes the arena; see `SHAKE_CEILING` for the cap. */
  shake: number;
  /** Whether the struck bot flashes white, which is how a hit reads as landing ON someone. */
  flash: boolean;
}

// --- the palette ----------------------------------------------------------------------------
//
// Warm for damage, cold for systems, grey for dust and debris. Kept few and kept apart: a
// viewer should be able to tell "something hit someone" from "someone used an ability" from
// "the arena did that" without reading anything.

const SPARK_HOT = 0xffd27a;
const SPARK_WHITE = 0xfff4e0;
const SPARK_COLD = 0xbfe4ff;
const FLAME = 0xff9a3c;
const DUST = 0x8c96a8;
const DEBRIS = 0xd8dee9;
const ELECTRIC = 0x7fd4ff;
const OIL = 0x2f3542;
const SMOKE = 0x9aa4b2;
const HEAL = 0x7dffb0;
const RAGE = 0xff6b6b;
const NITRO = 0x6bd5ff;

/**
 * Per weapon, because "which weapon just hit me" is the single most useful thing the visuals
 * can say during a scrum — it is how a viewer works out who is fighting whom.
 */
const WEAPON_VISUALS = new Map<string, VisualLayer>([
  ['weapon-hammer', { kind: 'burst', tint: SPARK_WHITE, scale: 1.15 }],
  ['weapon-saw-blade', { kind: 'burst', tint: SPARK_HOT, scale: 1 }],
  ['weapon-spinning-bar', { kind: 'burst', tint: SPARK_WHITE, scale: 1.1 }],
  ['weapon-vertical-spinner', { kind: 'burst', tint: SPARK_COLD, scale: 1 }],
  ['weapon-flamethrower', { kind: 'puff', tint: FLAME, scale: 1 }],
  ['weapon-ram-plate', { kind: 'puff', tint: DUST, scale: 0.9 }],
]);

/** Per ability. Cold and pretty rather than hot: an ability is a system firing, not damage. */
const ABILITY_VISUALS = new Map<string, VisualLayer>([
  // EMP keeps the particle ring — discrete, electric, scattering. Shockwave used to be the
  // same emitter in a different tint, which is why the two were indistinguishable in play:
  // what a viewer reads first is MOTION, not hue. They are now separated by medium, and the
  // pair below is the one place in this table where that matters more than colour.
  ['ability-emp', { kind: 'ring', tint: ELECTRIC, scale: 1 }],
  ['ability-nitro', { kind: 'burst', tint: NITRO, scale: 0.8 }],
  ['ability-oil-slick', { kind: 'puff', tint: OIL, scale: 1 }],
  // One continuous expanding front, drawn rather than spawned — see `vfx/waves.ts`.
  ['ability-shockwave', { kind: 'wave', tint: SPARK_WHITE, scale: 1.2 }],
  ['ability-repair', { kind: 'ring', tint: HEAL, scale: 0.7 }],
  ['ability-adrenaline', { kind: 'ring', tint: RAGE, scale: 0.7 }],
  // A cloud that sits ON the caster and clears fast, not a puff thrown outward — the ability
  // hides the bot, so the effect has to cover it rather than radiate from it.
  ['ability-smoke-screen', { kind: 'shroud', tint: SMOKE, scale: 1.3 }],
]);

/** Per hazard family, read off the id prefix exactly as the sound layer does. */
const HAZARD_VISUALS = new Map<string, VisualLayer>([
  ['flame', { kind: 'puff', tint: FLAME, scale: 1 }],
  ['saw', { kind: 'burst', tint: SPARK_HOT, scale: 1.1 }],
  ['cannon', { kind: 'burst', tint: DEBRIS, scale: 1.1 }],
  ['crusher', { kind: 'puff', tint: DUST, scale: 1.2 }],
]);

/** Visible on purpose, for the same reason the audio fallback is audible: a new hazard should
 *  show SOMETHING the first time it fires rather than looking broken. */
const UNKNOWN_HAZARD: VisualLayer = { kind: 'burst', tint: DEBRIS, scale: 1 };

/**
 * How hard an elimination is allowed to shake the arena.
 *
 * Small, and it is the number most likely to be wrong in the direction that matters. Shake
 * reads as impact right up until it makes the arena unreadable, and the moment a bot dies is
 * exactly when everyone is hunting the screen for whose it was.
 */
export const SHAKE_CEILING = 0.55;

export function hazardVisualFor(source: string | undefined): VisualLayer {
  if (!source) return UNKNOWN_HAZARD;
  const family = source.split('-')[0] ?? source;
  return HAZARD_VISUALS.get(family) ?? UNKNOWN_HAZARD;
}

/**
 * The visual for one effect. Never returns nothing, for the same reason `soundFor` never
 * does: an event that produces no reaction is indistinguishable from a broken simulation.
 */
export function visualFor(effect: Effect, builds: readonly BotBuild[]): Visual {
  switch (effect.kind) {
    case 'weaponHit': {
      const id = partIdFor(builds, effect.botId, 'weapon');
      const layer = (id === null ? undefined : WEAPON_VISUALS.get(id))
        ?? { kind: 'burst' as const, tint: SPARK_WHITE, scale: 0.9 };
      // The flash matters more than the sparks. Sparks say "a hit happened somewhere"; a bot
      // flashing white says "it happened to THAT one", which is the thing a viewer hunting
      // their own machine actually needs.
      return { layers: [layer], shake: 0, flash: true };
    }

    case 'abilityFire': {
      const id = partIdFor(builds, effect.botId, 'ability');
      const layer = (id === null ? undefined : ABILITY_VISUALS.get(id))
        ?? { kind: 'ring' as const, tint: ELECTRIC, scale: 0.8 };
      return { layers: [layer], shake: 0, flash: false };
    }

    case 'hazardHit':
      return { layers: [hazardVisualFor(effect.source)], shake: 0, flash: true };

    case 'collision':
      // The most frequent event in a battle by a wide margin -- roughly 800 a fight. Kept
      // small and dull on purpose: at full strength this alone would fill the arena with dust
      // and bury everything else, exactly the way `dullThud` would have buried the mix.
      return { layers: [{ kind: 'puff', tint: DUST, scale: 0.45 }], shake: 0, flash: false };

    case 'elimination':
      // The only event that gets two layers and the only one that shakes. A ring reads as the
      // blast, the burst is the machine coming apart -- the same two-part shape the sound has.
      return {
        layers: [
          { kind: 'ring', tint: SPARK_WHITE, scale: 1.2 },
          { kind: 'burst', tint: DEBRIS, scale: 1.4 },
        ],
        shake: SHAKE_CEILING,
        flash: false,
      };

    case 'cannonFire':
      // At the muzzle, not on a bot: nothing has been hit yet, so nothing flashes.
      return { layers: [{ kind: 'burst', tint: SPARK_HOT, scale: 0.8 }], shake: 0, flash: false };

    case 'trapdoor':
      return { layers: [{ kind: 'puff', tint: DUST, scale: 1.1 }], shake: 0.2, flash: false };
  }
}
