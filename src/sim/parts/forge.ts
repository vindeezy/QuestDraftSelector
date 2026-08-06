import { createRng } from '../rng';
import { runPlinko, DEFAULT_PLINKO } from '../plinko/plinko';
import { DEFAULT_BOARD } from '../plinko/board';
import { assemble, type AssembledBot, type BotBuild } from './assemble';
import { CATEGORIES, slotCountFor, type CategoryName } from './tables';

/**
 * Runs all six Forge boards for one seed and assembles a bot per bot index — the same
 * derivation the metrics harness (`tools/arena-metrics.ts`) and the dev shell's Arena view
 * both need, so it lives here once instead of being copied. Mirrors `deriveSubSeeds` /
 * `runForgeBoard` in `src/sim/event/event.ts`, which is the real event's version of the
 * same idea.
 */

/** Upper bound for a drawn sub-seed. `createRng` treats seeds as 32-bit integers. Matches
 *  `MAX_SUB_SEED` in `src/sim/event/event.ts` — this derives sub-seeds the same way the
 *  real event does, so builds are drawn from the same Plinko machinery, not a shortcut. */
const MAX_SUB_SEED = 2147483647;

/**
 * `DEFAULT_PLINKO.settleGraceTicks` (400) exists so the *visible* board looks calm before
 * the UI reads a result — see `board.ts`'s `finish()` comment: once every ball's topmost
 * point is below `slotTopY`, it is physically enclosed by that slot's dividers and its
 * slot index cannot change again no matter how long it keeps jostling. A caller that never
 * renders the board — the metrics harness, hundreds of matches in a row — gets nothing but
 * wall-clock time out of waiting through that cosmetic settle time on every one of six
 * boards per match. Cutting grace to 60 ticks (still a full second of margin past "all
 * balls in slots") changes only how long the run keeps simulating after the answer is
 * already fixed, never the answer. This is `buildsForSeed`'s default; a caller that does
 * render the board (the shell, one day) can pass the real grace period instead.
 */
export const FAST_SETTLE_GRACE_TICKS = 60;

/**
 * Draws one sub-seed per Forge board (six, in `CATEGORIES` order) plus one match seed,
 * from a single top-level seed — mirroring `deriveSubSeeds` in `event.ts`. Using the raw
 * loop seed directly for both the Plinko boards and the match would let the two systems'
 * randomness correlate; drawing children the same way the real event does avoids that.
 */
function deriveSeeds(seed: number): { forgeSeeds: number[]; matchSeed: number } {
  const rng = createRng(seed);
  const forgeSeeds: number[] = [];
  for (let i = 0; i < CATEGORIES.length; i++) forgeSeeds.push(Math.floor(rng.next() * MAX_SUB_SEED));
  const matchSeed = Math.floor(rng.next() * MAX_SUB_SEED);
  return { forgeSeeds, matchSeed };
}

/**
 * Runs all six Forge boards for `botCount` bots and assembles one `AssembledBot` per bot
 * index, exactly the way `runEvent` does for a real event. Also hands back the match seed
 * derived alongside the Forge seeds, so a caller never has to choose a seed itself.
 *
 * `settleGraceTicks` defaults to `FAST_SETTLE_GRACE_TICKS` — see its comment above for why
 * that is safe when nothing renders the board. Pass `DEFAULT_PLINKO.settleGraceTicks`
 * explicitly for a caller that does.
 */
export function buildsForSeed(
  seed: number,
  botCount: number,
  settleGraceTicks: number = FAST_SETTLE_GRACE_TICKS,
): { builds: AssembledBot[]; matchSeed: number } {
  const { forgeSeeds, matchSeed } = deriveSeeds(seed);

  const slotsByCategory = {} as Record<CategoryName, number[]>;
  CATEGORIES.forEach((category, i) => {
    const result = runPlinko({
      ...DEFAULT_PLINKO,
      settleGraceTicks,
      board: { ...DEFAULT_BOARD, slotCount: slotCountFor(category) },
      ballCount: botCount,
      seed: forgeSeeds[i]!,
    });
    const slots = new Array<number>(botCount);
    for (const landing of result.landings) slots[landing.ballIndex] = landing.slot;
    slotsByCategory[category] = slots;
  });

  const builds: AssembledBot[] = [];
  for (let i = 0; i < botCount; i++) {
    const build = {} as BotBuild;
    for (const category of CATEGORIES) build[category] = slotsByCategory[category]![i]!;
    builds.push(assemble(build));
  }

  return { builds, matchSeed };
}
