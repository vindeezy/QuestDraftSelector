/**
 * Measures the draft order an event produces, not who wins a battle.
 *
 * `tools/arena-metrics.ts` reports match win rate by part. That cannot see kill points
 * (`KILL_POINTS` in `src/sim/event/scoring.ts`) at all: a bot can score more points, and
 * move in the draft order, without ever changing who survives last in a single battle.
 * This tool runs full events -- six Forge boards plus three battles, via `runEvent` in
 * `src/sim/event/event.ts` -- and reads off where every part actually lands in the draft.
 *
 * Usage:
 *   npm run draft -- [events]            Run `events` full events (default 100), master
 *                                         seeds 1..events, and print the report below.
 *   npm run draft -- [events] --kill-ab  KILL_POINTS A/B instead of the report above --
 *                                         see `runKillAB` below.
 *
 * Every event plays the same three fixed arenas, one per battle -- `ARENA_VARIANT_NAMES`
 * in `src/sim/event/arenas.ts`: The Grinder, The Gauntlet, The Crossfire. There is no
 * `--arena` switch here the way there is in `arena-metrics.ts`, because an event is
 * defined as playing all three, not a choice of one; the arena list is still printed in
 * the header so a set of numbers is never ambiguous about what produced them.
 *
 * Numbers reported, in this order:
 *
 * 1. Average final draft position by part, for every one of the six categories (chassis,
 *    drive, weapon, armour, ability, personality). 1 is first pick, 10 is last. Fair value
 *    is 5.5 for every part regardless of option count -- a build's category doesn't change
 *    how many draft slots are in the event, the same reasoning `arena-metrics.ts` uses for
 *    its 10% fair-value line on win rate. Appearance count rides alongside every average so
 *    a thin sample can be recognised as noise (same `LOW_SAMPLE_THRESHOLD` idea as
 *    `arena-metrics.ts`), and each category is sorted best (lowest average position, i.e.
 *    picked earliest) to worst.
 *
 * 2. Survival personality share of the top pick: the fraction of events whose draft
 *    position 1 build was Hit-and-Run or Defensive. This is the number Change 1 exists to
 *    move -- placement-only scoring made survival personalities disproportionately likely
 *    to draft first; kill points are meant to close that gap.
 *
 * 3. Eliminations, first pick vs. last pick: average credited eliminations for whoever
 *    drafts first versus whoever drafts last. A direct read on whether killing now pays --
 *    before kill points this had no structural reason to differ; after them, the first
 *    pick should average more eliminations than the last pick, on average, if the change
 *    is doing anything.
 *
 * 4. Tiebreaks: how many of the `events * 10` placements needed a tiebreak to separate
 *    them from a neighbour, and which rule did it.
 *
 * --kill-ab
 *
 * `KILL_POINTS` (`src/sim/event/scoring.ts`) was a first-draft number: 5 points per
 * credited elimination, chosen to be measured rather than proven right. This mode
 * measures 1, 3 and 5 side by side so the project owner can pick with numbers in front
 * of them, not a guess.
 *
 * The key fact that shapes how this runs: kill points affect scoring only. They do not
 * touch the simulation. The same battles, the same eliminations, the same damage happen
 * regardless of what a kill is worth -- only the points arithmetic differs afterward, in
 * `buildStandings`. So each event is simulated exactly ONCE per seed via `runEvent`, and
 * its `tallies` (exposed on `EventResult` for exactly this purpose) are re-scored three
 * times with `buildStandings(tallies, killPoints)`. That gives a perfectly paired
 * comparison -- zero seed variance between arms, since every arm sees the identical
 * builds, battles and eliminations -- for a third of the simulation cost of running each
 * arm separately.
 *
 * Each arm reports the same four numbers as the standard report above (average draft
 * position by part, survival-personality share of the top pick, eliminations first vs.
 * last pick, tiebreak frequency), so any one arm can be read exactly like a normal
 * report. Then a comparison section:
 *
 * A. Spread by category, per arm: for each category, the best (lowest, i.e. earliest-
 *    picked) average draft position minus the worst, under each of the three arms side
 *    by side. A category whose spread grows with kill points is one where the choice of
 *    part inside that category is starting to matter more for draft order; a category
 *    whose spread barely moves is one kill points don't touch much either way.
 *
 * B. Parts that move most, kill points 1 -> 5: every part's average draft position under
 *    all three arms, sorted by the size of the change from 1 to 5 (biggest first). This
 *    is the direct answer to "what does raising the value actually trade" -- the parts
 *    at the top of this list are the ones whose draft stock the choice moves the most.
 *    All parts are listed, not a cherry-picked top N, since the size of a full parts
 *    table is small enough to show in full without hiding anything.
 *
 * C. The three survival-personality-share numbers side by side, against the same 28.6%
 *    fair value (2 of the 7 personalities) as the per-arm report above -- this is the
 *    number Change 1 (adding kill points at all) exists to move, so seeing whether 1, 3
 *    or 5 gets closest to fair is the other half of the decision alongside A and B.
 */
import { runEvent, type EventMember } from '../src/sim/event/event';
import { ARENA_VARIANT_NAMES } from '../src/sim/event/arenas';
import { CATEGORIES, type CategoryName } from '../src/sim/parts/tables';
import { buildStandings, KILL_POINTS, type Tiebreak } from '../src/sim/event/scoring';

const BOT_COUNT = 10;

/** 1 is first pick, `BOT_COUNT` is last; the average of every position is the fair value
 *  for a part that has no effect on draft order at all. */
const FAIR_DRAFT_POSITION = (BOT_COUNT + 1) / 2;

/** Appearances below this are flagged: too few draws for the average position to mean
 *  anything. Same idea and threshold as `LOW_SAMPLE_THRESHOLD` in `arena-metrics.ts`. */
const LOW_SAMPLE_THRESHOLD = 20;

function pct(n: number, d: number): string {
  return d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`;
}

/** A synthetic roster -- `runEvent` only needs id/name/colour to exist and be distinct;
 *  which colours or names does not affect anything the simulation computes. */
function makeMembers(count: number): EventMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    name: `Member ${i}`,
    colour: '#000000',
  }));
}

// --- Part-appearance / draft-position tracker, shared by every category. --------------

interface PartTally {
  appearances: Record<string, number>;
  positionSum: Record<string, number>;
}

function newTally(): PartTally {
  return { appearances: {}, positionSum: {} };
}

function recordPart(tally: PartTally, label: string, draftPosition: number): void {
  tally.appearances[label] = (tally.appearances[label] ?? 0) + 1;
  tally.positionSum[label] = (tally.positionSum[label] ?? 0) + draftPosition;
}

function printCategory(category: CategoryName, tally: PartTally): void {
  console.log(`\n  ${category.toUpperCase()}   (fair value ${FAIR_DRAFT_POSITION.toFixed(1)}, regardless of option count)`);
  const rows = Object.keys(tally.appearances)
    .map((label) => {
      const appearances = tally.appearances[label]!;
      const sum = tally.positionSum[label] ?? 0;
      return { label, appearances, avg: appearances === 0 ? 0 : sum / appearances };
    })
    .sort((a, b) => a.avg - b.avg);
  for (const row of rows) {
    const flag = row.appearances < LOW_SAMPLE_THRESHOLD ? '  <- low sample, noise' : '';
    console.log(
      `     ${row.label.padEnd(20)} ${row.avg.toFixed(2).padStart(5)}   (${row.appearances})${flag}`,
    );
  }
}

// --- Standard report ---------------------------------------------------------------------

function runStandardReport(runs: number): void {
  if (!Number.isFinite(runs) || runs <= 0) {
    console.error('Usage: npm run draft -- [events]');
    process.exitCode = 1;
    return;
  }

  const members = makeMembers(BOT_COUNT);
  const memberIndexById = new Map(members.map((m, i) => [m.id, i]));

  const tallies = {} as Record<CategoryName, PartTally>;
  for (const category of CATEGORIES) tallies[category] = newTally();

  let survivalTopPicks = 0;
  let firstPickEliminationSum = 0;
  let lastPickEliminationSum = 0;
  let totalPlacements = 0;
  const tiebreakCounts: Record<Tiebreak, number> = { eliminations: 0, damage: 0, memberId: 0 };

  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    const seed = i + 1;
    const result = runEvent({ masterSeed: seed, members });

    for (const standing of result.standings) {
      totalPlacements++;
      if (standing.tiebreak !== null) tiebreakCounts[standing.tiebreak]++;

      const memberIndex = memberIndexById.get(standing.memberId)!;
      const labels = result.partLabels[memberIndex]!;
      for (const category of CATEGORIES) {
        recordPart(tallies[category], labels[category], standing.draftPosition);
      }
    }

    // `standings` is already sorted by draft position -- see `buildStandings` in
    // `scoring.ts` -- so the first and last entries are the top and bottom picks.
    const topPick = result.standings[0]!;
    const lastPick = result.standings[result.standings.length - 1]!;

    const topPersonality = result.partLabels[memberIndexById.get(topPick.memberId)!]!.personality;
    if (topPersonality === 'Hit-and-Run' || topPersonality === 'Defensive') survivalTopPicks++;

    firstPickEliminationSum += topPick.eliminations;
    lastPickEliminationSum += lastPick.eliminations;
  }

  const elapsed = (Date.now() - started) / 1000;

  console.log(`\n  arenas: ${ARENA_VARIANT_NAMES.join(', ')}   (fixed, one per battle -- every event plays all three)`);
  console.log(`  ${runs} events (master seeds 1-${runs}) in ${elapsed.toFixed(0)}s\n`);

  console.log('  1. AVERAGE FINAL DRAFT POSITION BY PART   (1 = first pick, 10 = last -- lower is better)');
  for (const category of CATEGORIES) printCategory(category, tallies[category]!);

  console.log(
    `\n  2. SURVIVAL PERSONALITY SHARE OF THE TOP PICK   (Hit-and-Run + Defensive -- the number kill points exist to move)`,
  );
  console.log(`     ${pct(survivalTopPicks, runs)} of all ${runs} events (${survivalTopPicks}/${runs})`);

  console.log(`\n  3. ELIMINATIONS: FIRST PICK VS LAST PICK   (does killing pay?)`);
  console.log(`     first pick (draft position 1):        avg ${(firstPickEliminationSum / runs).toFixed(2)} eliminations`);
  console.log(`     last pick  (draft position ${BOT_COUNT}):       avg ${(lastPickEliminationSum / runs).toFixed(2)} eliminations`);

  const totalTiebreaks = tiebreakCounts.eliminations + tiebreakCounts.damage + tiebreakCounts.memberId;
  console.log(`\n  4. TIEBREAKS   (${totalPlacements} placements across ${runs} events)`);
  console.log(`     needed a tiebreak: ${pct(totalTiebreaks, totalPlacements)} (${totalTiebreaks}/${totalPlacements})`);
  console.log(
    `       eliminations: ${tiebreakCounts.eliminations}   damage: ${tiebreakCounts.damage}   memberId: ${tiebreakCounts.memberId}`,
  );
  console.log('');
}

// --- Kill-points A/B ---------------------------------------------------------------------

/** 1, 3 and 5 -- 5 is `KILL_POINTS`, today's default, included so the A/B always shows
 *  where the status quo sits relative to the other two candidates. */
const KILL_RATES = [1, 3, 5] as const;

/** Everything the standard report accumulates over a run, kept once per arm so the same
 *  `printCategory` / `pct` machinery above can print any arm exactly like a normal
 *  report. */
interface ArmStats {
  tallies: Record<CategoryName, PartTally>;
  survivalTopPicks: number;
  firstPickEliminationSum: number;
  lastPickEliminationSum: number;
  totalPlacements: number;
  tiebreakCounts: Record<Tiebreak, number>;
}

function newArmStats(): ArmStats {
  const tallies = {} as Record<CategoryName, PartTally>;
  for (const category of CATEGORIES) tallies[category] = newTally();
  return {
    tallies,
    survivalTopPicks: 0,
    firstPickEliminationSum: 0,
    lastPickEliminationSum: 0,
    totalPlacements: 0,
    tiebreakCounts: { eliminations: 0, damage: 0, memberId: 0 },
  };
}

function printArmReport(killPoints: number, runs: number, stats: ArmStats): void {
  const isDefault = killPoints === KILL_POINTS ? "  (today's default)" : '';
  console.log(`\n  ----- ARM: kill points = ${killPoints}${isDefault} -----`);

  console.log('\n  1. AVERAGE FINAL DRAFT POSITION BY PART   (1 = first pick, 10 = last -- lower is better)');
  for (const category of CATEGORIES) printCategory(category, stats.tallies[category]!);

  console.log(
    `\n  2. SURVIVAL PERSONALITY SHARE OF THE TOP PICK   (Hit-and-Run + Defensive -- fair value 28.6%, 2 of 7 personalities)`,
  );
  console.log(`     ${pct(stats.survivalTopPicks, runs)} of all ${runs} events (${stats.survivalTopPicks}/${runs})`);

  console.log(`\n  3. ELIMINATIONS: FIRST PICK VS LAST PICK   (does killing pay?)`);
  console.log(
    `     first pick (draft position 1):        avg ${(stats.firstPickEliminationSum / runs).toFixed(2)} eliminations`,
  );
  console.log(
    `     last pick  (draft position ${BOT_COUNT}):       avg ${(stats.lastPickEliminationSum / runs).toFixed(2)} eliminations`,
  );

  const totalTiebreaks = stats.tiebreakCounts.eliminations + stats.tiebreakCounts.damage + stats.tiebreakCounts.memberId;
  console.log(`\n  4. TIEBREAKS   (${stats.totalPlacements} placements across ${runs} events)`);
  console.log(`     needed a tiebreak: ${pct(totalTiebreaks, stats.totalPlacements)} (${totalTiebreaks}/${stats.totalPlacements})`);
  console.log(
    `       eliminations: ${stats.tiebreakCounts.eliminations}   damage: ${stats.tiebreakCounts.damage}   memberId: ${stats.tiebreakCounts.memberId}`,
  );
}

/** Best (lowest) average draft position in the category minus worst, i.e. how far apart
 *  the category's best-placed and worst-placed part are under this one arm. */
function categorySpread(tally: PartTally): number {
  const avgs = Object.keys(tally.appearances).map((label) => {
    const appearances = tally.appearances[label]!;
    const sum = tally.positionSum[label] ?? 0;
    return appearances === 0 ? 0 : sum / appearances;
  });
  if (avgs.length === 0) return 0;
  return Math.max(...avgs) - Math.min(...avgs);
}

function avgPosition(tally: PartTally, label: string): number {
  const appearances = tally.appearances[label]!;
  const sum = tally.positionSum[label] ?? 0;
  return appearances === 0 ? 0 : sum / appearances;
}

interface Mover {
  category: CategoryName;
  label: string;
  avg1: number;
  avg3: number;
  avg5: number;
  /** avg5 - avg1. Negative means kill points 5 draft the part earlier than kill points 1. */
  delta: number;
}

/** Every part's average draft position under all three arms, sorted by the size of the
 *  move from kill points 1 to kill points 5. Builds are identical across arms -- the same
 *  event, scored three ways -- so every part has the exact same appearance count in
 *  every arm; only its average draft position can differ. */
function allPartMovers(arm1: ArmStats, arm3: ArmStats, arm5: ArmStats): Mover[] {
  const movers: Mover[] = [];
  for (const category of CATEGORIES) {
    for (const label of Object.keys(arm1.tallies[category]!.appearances)) {
      const avg1 = avgPosition(arm1.tallies[category]!, label);
      const avg3 = avgPosition(arm3.tallies[category]!, label);
      const avg5 = avgPosition(arm5.tallies[category]!, label);
      movers.push({ category, label, avg1, avg3, avg5, delta: avg5 - avg1 });
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers;
}

function printComparison(runs: number, arms: ReadonlyMap<number, ArmStats>): void {
  console.log('\n\n  ===== COMPARISON =====');

  console.log(
    '\n  A. SPREAD BY CATEGORY, PER ARM   (best avg draft position minus worst, within the category -- how much the choice of part in that category alone can move a build up or down the draft)',
  );
  for (const category of CATEGORIES) {
    const line = KILL_RATES.map((rate) => `kp=${rate}: ${categorySpread(arms.get(rate)!.tallies[category]!).toFixed(2)}`).join(
      '   ',
    );
    console.log(`     ${category.padEnd(12)} ${line}`);
  }

  console.log(
    '\n  B. PARTS THAT MOVE MOST, KILL POINTS 1 -> 5   (every part, sorted by |change| in average draft position -- what raising the value actually trades)',
  );
  const movers = allPartMovers(arms.get(1)!, arms.get(3)!, arms.get(5)!);
  for (const m of movers) {
    const sign = m.delta >= 0 ? '+' : '';
    console.log(
      `     ${m.category.padEnd(12)} ${m.label.padEnd(20)} kp=1: ${m.avg1.toFixed(2).padStart(5)}   kp=3: ${m.avg3.toFixed(2).padStart(5)}   kp=5: ${m.avg5.toFixed(2).padStart(5)}   ${'Δ'}(1->5): ${sign}${m.delta.toFixed(2)}`,
    );
  }

  console.log('\n  C. SURVIVAL-PERSONALITY SHARE OF TOP PICK, SIDE BY SIDE   (fair value 28.6%)');
  for (const rate of KILL_RATES) {
    const stats = arms.get(rate)!;
    console.log(`     kill points = ${rate}:  ${pct(stats.survivalTopPicks, runs)}   (${stats.survivalTopPicks}/${runs})`);
  }
  console.log('');
}

/**
 * Runs `runs` events -- each simulated exactly once, via `runEvent` -- then re-scores
 * every one of them at kill points 1, 3 and `KILL_POINTS` (5) using the `tallies`
 * `runEvent` exposes on `EventResult`. See the header comment for why this is safe:
 * kill points affect scoring only, never the simulation, so one `runEvent` call per seed
 * is enough for all three arms.
 */
function runKillAB(runs: number): void {
  if (!Number.isFinite(runs) || runs <= 0) {
    console.error('Usage: npm run draft -- [events] --kill-ab');
    process.exitCode = 1;
    return;
  }

  const members = makeMembers(BOT_COUNT);
  const memberIndexById = new Map(members.map((m, i) => [m.id, i]));

  const arms = new Map<number, ArmStats>(KILL_RATES.map((rate) => [rate, newArmStats()]));

  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    const seed = i + 1;
    const result = runEvent({ masterSeed: seed, members });

    for (const rate of KILL_RATES) {
      const stats = arms.get(rate)!;
      const standings = buildStandings(result.tallies, rate);

      for (const standing of standings) {
        stats.totalPlacements++;
        if (standing.tiebreak !== null) stats.tiebreakCounts[standing.tiebreak]++;

        const memberIndex = memberIndexById.get(standing.memberId)!;
        const labels = result.partLabels[memberIndex]!;
        for (const category of CATEGORIES) {
          recordPart(stats.tallies[category], labels[category], standing.draftPosition);
        }
      }

      // `standings` is already sorted by draft position -- see `buildStandings` in
      // `scoring.ts` -- so the first and last entries are the top and bottom picks.
      const topPick = standings[0]!;
      const lastPick = standings[standings.length - 1]!;

      const topPersonality = result.partLabels[memberIndexById.get(topPick.memberId)!]!.personality;
      if (topPersonality === 'Hit-and-Run' || topPersonality === 'Defensive') stats.survivalTopPicks++;

      stats.firstPickEliminationSum += topPick.eliminations;
      stats.lastPickEliminationSum += lastPick.eliminations;
    }
  }

  const elapsed = (Date.now() - started) / 1000;

  console.log(`\n  arenas: ${ARENA_VARIANT_NAMES.join(', ')}   (fixed, one per battle -- every event plays all three)`);
  console.log(
    `  KILL-POINTS A/B: ${runs} events (master seeds 1-${runs}), each simulated ONCE and re-scored at kill points 1, 3 and 5 in ${elapsed.toFixed(0)}s`,
  );
  console.log(
    '  Same battles, same eliminations, same damage in every arm -- only the points arithmetic differs (buildStandings, scoring.ts).',
  );

  for (const rate of KILL_RATES) printArmReport(rate, runs, arms.get(rate)!);

  printComparison(runs, arms);
}

// --- Entry point -------------------------------------------------------------------------

const args = process.argv.slice(2);
const killAB = args.includes('--kill-ab');
const positional = args.filter((a) => !a.startsWith('--'));
const runs = Number(positional[0] ?? 100);

if (killAB) {
  runKillAB(runs);
} else {
  runStandardReport(runs);
}
