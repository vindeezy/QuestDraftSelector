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
 *   npm run draft -- [events]   Run `events` full events (default 100), master seeds
 *                                1..events, and print the report below.
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
 */
import { runEvent, type EventMember } from '../src/sim/event/event';
import { ARENA_VARIANT_NAMES } from '../src/sim/event/arenas';
import { CATEGORIES, type CategoryName } from '../src/sim/parts/tables';
import type { Tiebreak } from '../src/sim/event/scoring';

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

// --- Entry point -------------------------------------------------------------------------

function main(): void {
  const runs = Number(process.argv[2] ?? 100);
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

main();
