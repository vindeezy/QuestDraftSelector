import { CATEGORIES, type CategoryName } from '../sim/parts/tables';

/**
 * The nineteen beats of the viewing experience, in the fixed order the spec lays out
 * (`docs/superpowers/specs/2026-08-11-website-design.md` §2). This is the backbone that
 * `progress.ts` walks a member along, and that the screens (not built here) render one of
 * at a time.
 *
 * The six Forge beat ids are `forge-1`..`forge-6`, not category-named — the category each
 * one shows is derived below, from `CATEGORIES`, rather than baked into the id. That keeps
 * one fact ("which category is board 4?") in one place: `CATEGORIES` itself.
 */
const FORGE_BEAT_IDS = ['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6'] as const;

export const BEAT_IDS = [
  'landing',
  'name-select',
  'what-to-expect',
  ...FORGE_BEAT_IDS,
  'build-reveal',
  'battle-1',
  'standings-1',
  'battle-2',
  'battle-2-result',
  'standings-2',
  'battle-3',
  'battle-3-result',
  'draft-order',
  'complete',
] as const;

export type BeatId = (typeof BEAT_IDS)[number];

/** The ordered beat list. Prefer this (or the helpers below) over `BEAT_IDS` at call
 *  sites — it exists mainly to give `BeatId` its literal union type. */
export const BEATS: readonly BeatId[] = BEAT_IDS;

export const FIRST_BEAT: BeatId = BEAT_IDS[0]!;
export const LAST_BEAT: BeatId = BEAT_IDS[BEAT_IDS.length - 1]!;

const INDEX_BY_BEAT: ReadonlyMap<BeatId, number> = new Map(BEAT_IDS.map((id, index) => [id, index]));

/** True for any string that is a real beat id. The one place `progress.ts` should ask
 *  "is this thing I read out of storage actually a beat?" before trusting it. */
export function isBeatId(value: unknown): value is BeatId {
  return typeof value === 'string' && INDEX_BY_BEAT.has(value as BeatId);
}

/** A beat's fixed position in the walkthrough. Callers should derive ordering from this
 *  rather than hardcoding beat positions themselves. */
export function beatIndex(id: BeatId): number {
  const index = INDEX_BY_BEAT.get(id);
  if (index === undefined) throw new Error(`beatIndex: "${id}" is not a known beat id.`);
  return index;
}

/** The beat one step later, or `null` at `complete`. */
export function nextBeat(id: BeatId): BeatId | null {
  const index = beatIndex(id);
  return index + 1 < BEAT_IDS.length ? BEAT_IDS[index + 1]! : null;
}

/** The beat one step earlier, or `null` at `landing`. */
export function previousBeat(id: BeatId): BeatId | null {
  const index = beatIndex(id);
  return index > 0 ? BEAT_IDS[index - 1]! : null;
}

/** True when `a` comes strictly before `b` in the walkthrough. */
export function isBeforeBeat(a: BeatId, b: BeatId): boolean {
  return beatIndex(a) < beatIndex(b);
}

/**
 * Maps each Forge beat to the category it shows, built by zipping `FORGE_BEAT_IDS` against
 * `CATEGORIES` positionally. If `CATEGORIES` is ever reordered, this mapping — and every
 * beat's on-screen content — follows automatically; nothing here hardcodes "board 4 is
 * armour".
 */
export const FORGE_BEAT_CATEGORY: ReadonlyMap<BeatId, CategoryName> = new Map(
  FORGE_BEAT_IDS.map((id, index) => [id, CATEGORIES[index]!]),
);

/** The category a Forge beat shows, or `null` for any non-Forge beat. */
export function categoryForBeat(id: BeatId): CategoryName | null {
  return FORGE_BEAT_CATEGORY.get(id) ?? null;
}
