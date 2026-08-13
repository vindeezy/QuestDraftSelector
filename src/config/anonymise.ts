import { createRng } from '../sim/rng';

/**
 * Anonymous entrant labels for a candidate seed: member index -> "A".."J".
 *
 * Used by `tools/seed-lab.ts` while CHOOSING a seed to record, so a candidate's statistics
 * can be examined without learning who finishes where. Three properties make that work:
 *
 * - within one seed the mapping is fixed, so entrant C is the same machine across all three
 *   battles and the final board, which is what makes any of it readable;
 * - across seeds the same letter is a different member, so comparing candidates reveals
 *   nothing about who tends to do well;
 * - it is deterministic, so the letters in a written report can be resolved back to real
 *   names afterwards (`npm run seeds -- <seed> --reveal`).
 *
 * Lives in `src/config/` rather than in `tools/` because it is roster-shaped configuration
 * that a tool consumes, in the same way `roster.ts` is. Nothing in the shipped site imports
 * it: the site shows real names, and anonymity is only ever a pre-recording concern.
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
