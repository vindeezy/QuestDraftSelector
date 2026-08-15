import { partAt, slotCountFor } from './tables';
import type { BotBuild } from './assemble';

/**
 * Which part a bot was carrying, given only its id.
 *
 * The effect bus says which bot an event came from, and every consumer already holds the
 * roster's builds, so the part is knowable without the simulation ever repeating it. Both the
 * sound layer and the visual layer need exactly this, and for the same reason: a Saw Blade and
 * a Hammer both raise `weaponHit`, so telling them apart is what makes the reaction match the
 * moment.
 *
 * Extracted here rather than left in `audio/classify.ts` so the render layer can reach it
 * without importing from audio — two sibling presentation layers should not have to know about
 * each other to ask the same question about the simulation.
 *
 * Takes a bot id rather than an `Effect` so it stays clear of `sim/arena` entirely.
 */

/** `bot-3` -> 3. Anything else -> null, so a malformed id falls back rather than throwing. */
export function botIndexOf(botId: string | null): number | null {
  if (botId === null || !botId.startsWith('bot-')) return null;
  const index = Number(botId.slice('bot-'.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** The part in `category` that `botId` is carrying, or null if anything about it is unknown. */
export function partIdFor(
  builds: readonly BotBuild[],
  botId: string | null,
  category: 'weapon' | 'ability',
): string | null {
  const index = botIndexOf(botId);
  if (index === null) return null;

  const build = builds[index];
  if (!build) return null;

  const slot = category === 'weapon' ? build.weapon : build.ability;
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCountFor(category)) return null;
  return partAt(category, slot).id;
}
