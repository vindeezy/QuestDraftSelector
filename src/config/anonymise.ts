import { createRng } from '../sim/rng';

/**
 * Anonymous entrant labels for a candidate seed: member index -> "A".."J".
 *
 * Used while CHOOSING the official seed, so a candidate's statistics — and now its battles,
 * via the preview route — can be examined without learning who finishes where. Three
 * properties make that work:
 *
 * - within one seed the mapping is fixed, so entrant C is the same machine across all three
 *   battles and the final board, which is what makes any of it readable;
 * - across seeds the same letter is a different member, so comparing candidates reveals
 *   nothing about who tends to do well;
 * - it is deterministic, so the letters in a written report and the letters on screen agree,
 *   and the real names can be recovered afterwards.
 *
 * Shared by `tools/seed-lab.ts` and `src/shell/screens/preview.ts` deliberately: if the two
 * drifted, the entrant you watched would not be the entrant you read about, which is worse
 * than having no letters at all.
 *
 * Keyed off `seed * 2 + 1` rather than the seed itself, so this draw can never accidentally
 * mirror `deriveSubSeeds`'s stream and correlate a letter with something the simulation did.
 */
export function anonymiseFor(seed: number, memberCount: number): string[] {
  const rng = createRng(seed * 2 + 1);
  const order = Array.from({ length: memberCount }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const labels = new Array<string>(memberCount);
  order.forEach((memberIndex, position) => {
    labels[memberIndex] = String.fromCharCode(65 + position);
  });
  return labels;
}

/**
 * A neutral palette for anonymous entrants, indexed by LABEL position rather than by member.
 *
 * Deliberately not the roster colours. Several are recognisable on sight — one member is
 * white and another near-black — so drawing a preview in real colours would name half the
 * field in the first second.
 */
export const ANON_COLOURS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
] as const;

/** The colour for an anonymous label, so "C" is the same colour everywhere it appears. */
export function anonColourFor(label: string): number {
  const index = label.charCodeAt(0) - 65;
  return ANON_COLOURS[index % ANON_COLOURS.length]!;
}
