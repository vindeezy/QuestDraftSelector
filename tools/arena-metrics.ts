/**
 * Measures whether the arena is worth watching.
 *
 * Usage:
 *   npm run arena -- [matches]              Full report: match length, elimination
 *                                            pacing, cause of death, and win rate by
 *                                            part (chassis, drive, weapon, armour,
 *                                            ability, personality).
 *   npm run arena -- [matches] --ability-ab  Adrenaline on/off A/B instead of the
 *                                            report above. See `runAbilityAB` below.
 *   ... --arena=proving                     Run against `PROVING_ARENA` instead of the
 *                                            default. Applies to both the standard
 *                                            report and `--ability-ab`. Omit for
 *                                            `DEFAULT_ARENA`. The arena used is always
 *                                            printed in the report header, so a set of
 *                                            numbers is never ambiguous about which
 *                                            arena produced them.
 *   ... --arena=grinder                     Run against `GRINDER_ARENA` instead --
 *                                            the geometry fix for the 50.5% survival-
 *                                            personality win share. Same applicability
 *                                            and header guarantee as `--arena=proving`.
 *
 * Numbers that matter, in this order:
 *
 * 1. Match length. Target is 2-3 minutes, so 7200-10800 ticks.
 * 2. Elimination pacing. Deaths spread through the match, not all at the start.
 * 3. Cause mix, split three ways: combat (a bot's kill credited), hazard (a saw, flame
 *    jet, cannon or crusher — `destroyed` with no killer), and fall. If most deaths are
 *    hazards, the arena is fighting the bots instead of the bots fighting each other.
 * 4. Win rate by part, for every one of the six categories. Reported as wins PER
 *    APPEARANCE, not raw win count — the Plinko distribution is centre-weighted (edge
 *    slots land roughly half as often as centre slots), so a raw count would make every
 *    common part look strong and every rare part look weak. That is an artefact of the
 *    board, not of balance. Wins-per-appearance is the number that means something, and
 *    every category's fair value is the same: 1 in `botCount`, i.e. 10%, since a build's
 *    category doesn't change how many bot-slots are in the match.
 */
import { DEFAULT_ARENA, PROVING_ARENA, GRINDER_ARENA, type ArenaConfig } from '../src/sim/arena/arena';
import { DEFAULT_MATCH, createMatch, advanceMatch, type Match } from '../src/sim/arena/match';
import { ADRENALINE_THRESHOLD } from '../src/sim/arena/ability';
import { createRng } from '../src/sim/rng';
import { runPlinko, DEFAULT_PLINKO } from '../src/sim/plinko/plinko';
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { assemble, type AssembledBot, type BotBuild } from '../src/sim/parts/assemble';
import { CATEGORIES, slotCountFor, type AbilityName, type CategoryName } from '../src/sim/parts/tables';

const BOT_COUNT = 10;

/** Upper bound for a drawn sub-seed. `createRng` treats seeds as 32-bit integers. Copied
 *  from `src/sim/event/event.ts`'s `MAX_SUB_SEED` — this tool derives sub-seeds the same
 *  way the real event does, so its builds are drawn from the same Plinko machinery, not
 *  a shortcut. */
const MAX_SUB_SEED = 2147483647;

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
 * `DEFAULT_PLINKO.settleGraceTicks` (400) exists so the *visible* board looks calm before
 * the UI reads a result — see `board.ts`'s `finish()` comment: once every ball's topmost
 * point is below `slotTopY`, it is physically enclosed by that slot's dividers and its
 * slot index cannot change again no matter how long it keeps jostling. This tool never
 * renders the board, so waiting out that cosmetic settle time on every one of six boards
 * per match, hundreds of matches in a row, buys nothing but wall-clock time. Cutting grace
 * to 60 ticks (still a full second of margin past "all balls in slots") changes only how
 * long the run keeps simulating after the answer is already fixed, never the answer.
 */
const FAST_SETTLE_GRACE_TICKS = 60;

/**
 * Runs all six Forge boards for `botCount` bots and assembles one `AssembledBot` per bot
 * index, exactly the way `runEvent` does for a real event. Also hands back the match seed
 * derived alongside the Forge seeds, so a caller never has to choose a seed itself.
 */
function buildsForSeed(seed: number, botCount: number): { builds: AssembledBot[]; matchSeed: number } {
  const { forgeSeeds, matchSeed } = deriveSeeds(seed);

  const slotsByCategory = {} as Record<CategoryName, number[]>;
  CATEGORIES.forEach((category, i) => {
    const result = runPlinko({
      ...DEFAULT_PLINKO,
      settleGraceTicks: FAST_SETTLE_GRACE_TICKS,
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

/** `bot-3` -> 3. */
function botIndex(botId: string): number {
  return Number(botId.slice('bot-'.length));
}

function pct(n: number, d: number): string {
  return d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`;
}

// --- Part-appearance / part-win tracker, shared by every category. --------------------

interface PartTally {
  appearances: Record<string, number>;
  wins: Record<string, number>;
}

function newTally(): PartTally {
  return { appearances: {}, wins: {} };
}

function recordMatch(tallies: Record<CategoryName, PartTally>, builds: AssembledBot[], winnerIndex: number | null): void {
  builds.forEach((build, i) => {
    for (const category of CATEGORIES) {
      const label = build.partLabels[category];
      const tally = tallies[category];
      tally.appearances[label] = (tally.appearances[label] ?? 0) + 1;
      if (i === winnerIndex) tally.wins[label] = (tally.wins[label] ?? 0) + 1;
    }
  });
}

/** Appearances below this are flagged: too few draws for the win rate to mean anything. */
const LOW_SAMPLE_THRESHOLD = 20;

function printCategory(category: CategoryName, tally: PartTally): void {
  console.log(`\n  ${category.toUpperCase()}   (fair value ~${(100 / BOT_COUNT).toFixed(1)}% regardless of option count)`);
  const rows = Object.keys(tally.appearances)
    .map((label) => {
      const appearances = tally.appearances[label]!;
      const wins = tally.wins[label] ?? 0;
      return { label, appearances, wins, rate: appearances === 0 ? 0 : (wins / appearances) * 100 };
    })
    .sort((a, b) => b.rate - a.rate);
  for (const row of rows) {
    const flag = row.appearances < LOW_SAMPLE_THRESHOLD ? '  <- low sample, noise' : '';
    console.log(
      `     ${row.label.padEnd(20)} ${row.rate.toFixed(1).padStart(5)}%   (${row.wins}/${row.appearances})${flag}`,
    );
  }
}

// --- Standard report --------------------------------------------------------------------

function runReport(runs: number, seedStart: number, arena: ArenaConfig, arenaLabel: string): void {
  const ticks: number[] = [];
  const causes: Record<string, number> = {};
  const quintiles = [0, 0, 0, 0, 0];
  let lateElims = 0;
  let capped = 0;
  let noWinner = 0;

  const tallies = {} as Record<CategoryName, PartTally>;
  for (const category of CATEGORIES) tallies[category] = newTally();

  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const { builds, matchSeed } = buildsForSeed(seed, BOT_COUNT);
    const match = createMatch({ ...DEFAULT_MATCH, arena, seed: matchSeed, botCount: BOT_COUNT, builds });

    while (!match.done) advanceMatch(match);

    ticks.push(match.world.tick);
    if (match.world.tick >= DEFAULT_MATCH.maxTicks) capped++;

    for (const e of match.eliminations) {
      // `destroyed` conflates two very different deaths: a `byId` means another bot
      // landed the killing blow (combat); a null `byId` means a hazard did (a saw, a
      // flame jet, a cannon, a crusher) and nobody gets credit. Counting both as
      // "destroyed" silently overstates combat, which is exactly the number this tool
      // exists to report honestly.
      const label = e.cause === 'destroyed' ? (e.byId !== null ? 'combat' : 'hazard') : e.cause;
      causes[label] = (causes[label] ?? 0) + 1;
      const bucket = Math.min(4, Math.floor((e.tick / Math.max(1, match.world.tick)) * 5));
      quintiles[bucket]!++;
      if (e.tick >= 3600) lateElims++;
    }

    const winner = match.bots.find((b) => b.alive);
    const winnerIndex = winner ? botIndex(winner.body.id) : null;
    if (winnerIndex === null) noWinner++;
    recordMatch(tallies, builds, winnerIndex);
  }

  const elapsed = (Date.now() - started) / 1000;
  ticks.sort((a, b) => a - b);
  const median = ticks[Math.floor(ticks.length / 2)]!;

  const seedRange = `seeds ${seedStart}-${seedStart + runs - 1}`;
  console.log(`\n  arena: ${arenaLabel}`);
  console.log(`  ${runs} matches (${seedRange}) in ${elapsed.toFixed(0)}s\n`);

  console.log('  1. MATCH LENGTH   (target 7200-10800 ticks, 2-3 minutes)');
  console.log(`     min ${ticks[0]}, median ${median} (${(median / 60).toFixed(0)}s), max ${ticks[ticks.length - 1]}`);
  console.log(`     hit the cap: ${capped}`);
  console.log(`     raw ticks: ${ticks.join(',')}\n`);

  const totalElims = Object.values(causes).reduce((a, b) => a + b, 0);
  console.log('  2. ELIMINATION PACING   (most bots should survive past the 1-minute mark)');
  console.log(`     survived past 60s: ${pct(lateElims, totalElims)} (${lateElims}/${totalElims})   <- want a clear majority`);
  console.log(`     ${quintiles.map((q) => `${pct(q, totalElims)} (${q})`).join('  ')}`);
  console.log('     ^early                                    late^\n');

  console.log('  3. CAUSE OF DEATH   (combat should dominate; hazard and fall reported separately)');
  for (const [cause, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cause.padEnd(12)} ${pct(n, totalElims).padStart(6)}  (${n}/${totalElims})`);
  }
  if (noWinner > 0) console.log(`     matches with no surviving winner: ${noWinner}`);

  console.log('\n  4. WIN RATE BY PART   (wins per appearance, not raw win count -- see header comment)');
  for (const category of CATEGORIES) printCategory(category, tallies[category]!);

  // Legacy framing, kept because it is the number the spec's history refers to directly:
  // "Hit-and-Run and Defensive have historically held roughly half of all wins." That is
  // a share of ALL wins (wins / runs), not wins-per-appearance, so it is computed
  // separately from the per-part table above.
  const personalityTally = tallies.personality!;
  const survivalWins = (personalityTally.wins['Hit-and-Run'] ?? 0) + (personalityTally.wins['Defensive'] ?? 0);
  console.log(`\n  5. SURVIVAL PERSONALITY SHARE   (Hit-and-Run + Defensive, historically ~50% of all wins)`);
  console.log(`     ${pct(survivalWins, runs)} of all ${runs} matches (${survivalWins}/${runs})`);
  console.log('');
}

// --- Adrenaline on/off A/B ---------------------------------------------------------------

/**
 * Not a real Forge option -- `AbilityName` only lists the seven the parts table can draw.
 * Cast to that type for the "off" arm below. This works cleanly because every switch in
 * `arena/ability.ts` that dispatches on ability name (`fireTrigger`, `applyConditional`)
 * falls through to a no-op `default` for any name it does not recognise: `'none'` is
 * never triggered and never touched conditionally, so a bot given it behaves exactly as
 * if it had no ability at all, with zero changes to `src/sim`.
 */
const NO_ABILITY = 'none' as AbilityName;

interface ForcedRunResult {
  winnerIndex: number | null;
  /** Lowest health fraction (health / maxHealth) each bot reached during the match. */
  minHealthFrac: number[];
  ticks: number;
  causes: Record<string, number>;
}

function runForced(matchSeed: number, builds: AssembledBot[], arena: ArenaConfig): ForcedRunResult {
  const match: Match = createMatch({
    ...DEFAULT_MATCH,
    arena,
    seed: matchSeed,
    botCount: BOT_COUNT,
    builds,
  });

  const minHealthFrac = match.bots.map((b) => b.health / b.maxHealth);

  while (!match.done) {
    advanceMatch(match);
    match.bots.forEach((b, i) => {
      const frac = b.health / b.maxHealth;
      if (frac < minHealthFrac[i]!) minHealthFrac[i] = frac;
    });
  }

  const causes: Record<string, number> = {};
  for (const e of match.eliminations) {
    const label = e.cause === 'destroyed' ? (e.byId !== null ? 'combat' : 'hazard') : e.cause;
    causes[label] = (causes[label] ?? 0) + 1;
  }

  const winner = match.bots.find((b) => b.alive);
  return {
    winnerIndex: winner ? botIndex(winner.body.id) : null,
    minHealthFrac,
    ticks: match.world.tick,
    causes,
  };
}

/**
 * Adrenaline on/off A/B, per spec §11: "run 500 matches with Adrenaline forced on versus
 * off and read the win-rate delta."
 *
 * Forcing the ability onto (or off of) all ten bots at once means every bot in a given
 * arm shares the same ability, so a per-bot win rate is meaningless within one arm --
 * whoever wins was always going to be ~1-in-10 by symmetry. The number that IS meaningful
 * is a "comeback" win rate: the fraction of matches whose eventual winner dropped below
 * the Adrenaline threshold (30% max health) at some point and still won. Adrenaline's
 * entire mechanism is a bonus while under that threshold, so if the ability does
 * anything, this rate should be higher with it forced on than with it forced off. This is
 * the number reported as the "win-rate delta" below.
 *
 * Same seed drives both arms' Forge boards AND the match itself -- read from one
 * `buildsForSeed` call per seed and reused for both arms -- so both arms differ only in
 * whether the ability is active, never in which builds or which match seed they ran.
 */
function runAbilityAB(runs: number, seedStart: number, arena: ArenaConfig, arenaLabel: string): void {
  let onComeback = 0;
  let offComeback = 0;
  let onWinners = 0;
  let offWinners = 0;
  const onTicks: number[] = [];
  const offTicks: number[] = [];
  const onCauses: Record<string, number> = {};
  const offCauses: Record<string, number> = {};

  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const { builds, matchSeed } = buildsForSeed(seed, BOT_COUNT);

    const onBuilds = builds.map((b) => ({ ...b, ability: 'adrenaline' as AbilityName }));
    const offBuilds = builds.map((b) => ({ ...b, ability: NO_ABILITY }));

    const on = runForced(matchSeed, onBuilds, arena);
    const off = runForced(matchSeed, offBuilds, arena);

    onTicks.push(on.ticks);
    offTicks.push(off.ticks);
    for (const [k, v] of Object.entries(on.causes)) onCauses[k] = (onCauses[k] ?? 0) + v;
    for (const [k, v] of Object.entries(off.causes)) offCauses[k] = (offCauses[k] ?? 0) + v;

    if (on.winnerIndex !== null) {
      onWinners++;
      if (on.minHealthFrac[on.winnerIndex]! < ADRENALINE_THRESHOLD) onComeback++;
    }
    if (off.winnerIndex !== null) {
      offWinners++;
      if (off.minHealthFrac[off.winnerIndex]! < ADRENALINE_THRESHOLD) offComeback++;
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  const onRate = (onComeback / runs) * 100;
  const offRate = (offComeback / runs) * 100;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const seedRange = `seeds ${seedStart}-${seedStart + runs - 1}`;
  console.log(`\n  arena: ${arenaLabel}`);
  console.log(
    `  Adrenaline A/B: ${runs} paired matches (${seedRange}, same seed, same builds, ability forced) in ${elapsed.toFixed(0)}s\n`,
  );
  console.log(`  "Win rate" here = share of matches whose winner dropped below ${(ADRENALINE_THRESHOLD * 100).toFixed(0)}%`);
  console.log(`  max health at some point and still won -- the exact condition Adrenaline reacts to.`);
  console.log(`  With every bot sharing one forced ability, a plain per-bot win rate is ~10% by symmetry`);
  console.log(`  in both arms and tells you nothing; this is the number that isolates the ability's effect.\n`);

  console.log(`     forced ON  (all 10 bots have Adrenaline): ${pct(onComeback, runs)}  (${onComeback}/${runs}, ${onWinners} had a winner)`);
  console.log(`     forced OFF (all 10 bots have no ability):  ${pct(offComeback, runs)}  (${offComeback}/${runs}, ${offWinners} had a winner)`);
  console.log(`     delta: ${(onRate - offRate).toFixed(1)} points\n`);

  console.log('  for context, same paired runs:');
  console.log(`     avg match length   ON ${avg(onTicks).toFixed(0)} ticks   OFF ${avg(offTicks).toFixed(0)} ticks`);
  const onTotal = Object.values(onCauses).reduce((a, b) => a + b, 0);
  const offTotal = Object.values(offCauses).reduce((a, b) => a + b, 0);
  console.log(
    `     combat share        ON ${pct(onCauses.combat ?? 0, onTotal)}   OFF ${pct(offCauses.combat ?? 0, offTotal)}`,
  );
  console.log('');
}

// --- Entry point ---------------------------------------------------------------------

const args = process.argv.slice(2);
const abilityAB = args.includes('--ability-ab');
const positional = args.filter((a) => !a.startsWith('--'));
const runs = Number(positional[0] ?? 100);

// Both reports walk seeds seedStart..seedStart+runs-1. Keeping the start explicit means a
// surprising result can be re-run over the exact same seeds, and means the A/B's two arms
// are provably reading the same ones.
const seedStart = Number(positional[1] ?? 1);

// --arena=proving / --arena=grinder switch both the standard report and --ability-ab to
// `PROVING_ARENA` / `GRINDER_ARENA` respectively, so arenas' numbers can be compared
// directly. Default is `DEFAULT_ARENA`. The arena actually used is always printed in the
// report header -- a set of numbers whose arena is ambiguous is worse than no numbers.
const arenaArg = args.find((a) => a.startsWith('--arena='));
const arenaName = arenaArg ? arenaArg.slice('--arena='.length) : 'default';
const arena =
  arenaName === 'proving' ? PROVING_ARENA : arenaName === 'grinder' ? GRINDER_ARENA : DEFAULT_ARENA;
const arenaLabel =
  arenaName === 'proving'
    ? 'proving (The Proving Ground)'
    : arenaName === 'grinder'
      ? 'grinder (The Grinder)'
      : 'default (The Grinder)';

if (abilityAB) {
  runAbilityAB(runs, seedStart, arena, arenaLabel);
} else {
  runReport(runs, seedStart, arena, arenaLabel);
}
