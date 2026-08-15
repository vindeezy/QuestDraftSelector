import { partAt, slotCountFor } from '../sim/parts/tables';
import type { BotBuild } from '../sim/parts/assemble';
import type { Effect } from '../sim/arena/effects';
import type { SoundId } from './palette';

/**
 * Which sound an event deserves.
 *
 * Pure, and the only part of the audio layer that can be properly tested — which is why
 * every differentiation rule lives here rather than being scattered through the player.
 *
 * The whole point is that a battle should not sound like one event kind repeated. A Saw
 * Blade and a Hammer both raise `weaponHit`; a flame jet and a cannonball both raise
 * `hazardHit`. Telling them apart is what makes the sound match the moment.
 *
 * Two different mechanisms do that, and the split is deliberate:
 *
 * - **Weapons and abilities are derived from `botId` plus the builds.** The effect already
 *   says which bot, and any consumer already holds every member's build, so the part is
 *   knowable without the simulation repeating it. Nothing was added to `src/sim/` for this.
 * - **Hazards come from `Effect.source`**, because a `hazardHit` lands at the BOT's position
 *   and nothing about the event otherwise says what struck it. That field is the one
 *   addition SND 1 made, and it carries the zone or emitter's own id.
 */

/** `bot-3` -> 3. Anything else -> null, so a malformed id falls back rather than throwing. */
function botIndexOf(botId: string | null): number | null {
  if (botId === null || !botId.startsWith('bot-')) return null;
  const index = Number(botId.slice('bot-'.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Part id -> sound, for every weapon and every ability.
 *
 * Keyed by the table's own ids rather than by slot number, because slot order is a Forge
 * board layout decision and could be reordered without anyone thinking about audio. Built
 * eagerly from `tables.ts` so a part that gains no entry is caught by `classify.test.ts`'s
 * completeness check at build time, not by a viewer hearing a thud on draft night.
 */
export const WEAPON_SOUNDS = new Map<string, SoundId>([
  ['weapon-hammer', 'crushingBlow'],
  ['weapon-saw-blade', 'sawBuzz'],
  ['weapon-spinning-bar', 'barSmash'],
  ['weapon-vertical-spinner', 'spinnerBite'],
  ['weapon-flamethrower', 'flameWhoosh'],
  ['weapon-ram-plate', 'heavyClang'],
]);

export const ABILITY_SOUNDS = new Map<string, SoundId>([
  ['ability-emp', 'electricZap'],
  ['ability-nitro', 'nitroWhoosh'],
  ['ability-oil-slick', 'oilSplat'],
  ['ability-shockwave', 'shockwaveBoom'],
  ['ability-repair', 'repairChime'],
  ['ability-adrenaline', 'adrenalineRise'],
  ['ability-smoke-screen', 'smokeHiss'],
]);

/**
 * Hazard id prefix -> sound.
 *
 * The arena configs name hazards by type and number — `flame-12`, `cannon-25`, `saw-3`,
 * `crusher` — so the prefix before the first `-` is the family. Reading the prefix rather
 * than the whole id means adding a fourteenth flame jet needs no audio change at all.
 */
export const HAZARD_SOUNDS = new Map<string, SoundId>([
  ['flame', 'flameBillow'],
  ['saw', 'sawGrind'],
  ['cannon', 'shellImpact'],
  ['crusher', 'crusherSlam'],
]);

/**
 * What an unrecognised hazard sounds like.
 *
 * Audible on purpose. A new hazard added later should sound like SOMETHING the first time
 * it fires — silence would read as a bug in the hazard rather than a gap in the sound
 * table, and would be much harder to notice.
 *
 * A generic heavy metallic impact, which is the right thing to hear when something hits a bot
 * and the audio layer does not know what it was. It doubles as the Ram Plate, and that overlap
 * is fine: both are "a bot was struck by something solid".
 */
const UNKNOWN_HAZARD: SoundId = 'heavyClang';

export function hazardSoundFor(source: string | undefined): SoundId {
  if (!source) return UNKNOWN_HAZARD;
  const family = source.split('-')[0] ?? source;
  return HAZARD_SOUNDS.get(family) ?? UNKNOWN_HAZARD;
}

/** The part in `category` that bot `index` is carrying, or null if the index is unknown. */
function partIdFor(
  builds: readonly BotBuild[],
  index: number | null,
  category: 'weapon' | 'ability',
): string | null {
  if (index === null) return null;
  const build = builds[index];
  if (!build) return null;
  const slot = category === 'weapon' ? build.weapon : build.ability;
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCountFor(category)) return null;
  return partAt(category, slot).id;
}

/**
 * The sound for one effect. Never returns nothing — every path ends in a real voice, because
 * a missing sound is indistinguishable from a broken simulation to anyone watching.
 */
export function soundFor(effect: Effect, builds: readonly BotBuild[]): SoundId {
  switch (effect.kind) {
    case 'weaponHit': {
      const id = partIdFor(builds, botIndexOf(effect.botId), 'weapon');
      return (id === null ? undefined : WEAPON_SOUNDS.get(id)) ?? 'metallicTick';
    }
    case 'abilityFire': {
      const id = partIdFor(builds, botIndexOf(effect.botId), 'ability');
      return (id === null ? undefined : ABILITY_SOUNDS.get(id)) ?? 'electricZap';
    }
    case 'hazardHit':
      return hazardSoundFor(effect.source);
    case 'collision':
      return 'dullThud';
    case 'elimination':
      return 'explosion';
    case 'cannonFire':
      return 'deepBoom';
    case 'trapdoor':
      return 'mechanicalClunk';
  }
}
