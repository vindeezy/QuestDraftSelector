/**
 * Compares candidate master seeds so the owner can choose the official one on evidence,
 * with the result still unspoiled.
 *
 * Usage:
 *   npm run seeds -- <seed> [<seed> ...]
 *
 * EVERY MEMBER IS ANONYMISED. Entrants are labelled A..J under a per-seed permutation
 * derived from the seed itself, so:
 *
 *   - within one seed you can follow entrant C through all three battles and the final
 *     order, which is what makes the stats readable;
 *   - across seeds the same letter is a different person, so comparing ten seeds leaks
 *     nothing about who does well in general;
 *   - the mapping is deterministic, so the real names can be recovered later (`--reveal`)
 *     once a seed is chosen, without re-running anything.
 *
 * This tool NEVER writes `data/official-event.json`. Saving stays with
 * `npm run record -- --save <seed>`, deliberately: choosing and committing are separate
 * decisions and the committing one should be explicit.
 */
import { runEvent, type EventResult } from '../src/sim/event/event';
import { createRng } from '../src/sim/rng';
import { CATEGORIES, type CategoryName } from '../src/sim/parts/tables';
import { ARENA_VARIANT_NAMES } from '../src/sim/event/arenas';
import { toEventMembers, ROSTER } from '../src/config/roster';

const TICKS_PER_SECOND = 60;
const MEMBER_COUNT = 10;
/** A category this concentrated makes the Forge look broken rather than random. */
const CONCENTRATION_FLAG = 5;

function secs(ticks: number): string {
  return `${(ticks / TICKS_PER_SECOND).toFixed(0)}s`;
}

function pct(n: number, d: number): string {
  return d === 0 ? '  0%' : `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

/**
 * A permutation of 0..9 derived from `seed`, mapping member index -> anonymous letter.
 *
 * Keyed off a value derived from the seed rather than the seed itself, so this draw can
 * never accidentally mirror the event's own `deriveSubSeeds` stream and correlate a
 * letter with anything the simulation did.
 */
function anonymiseFor(seed: number): string[] {
  const rng = createRng(seed * 2 + 1);
  const order = Array.from({ length: MEMBER_COUNT }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const labels = new Array<string>(MEMBER_COUNT);
  order.forEach((memberIndex, position) => {
    labels[memberIndex] = String.fromCharCode(65 + position);
  });
  return labels;
}

interface SeedReport {
  seed: number;
  battleTicks: number[];
  combatKills: number;
  hazardKills: number;
  fallKills: number;
  /** Per category: the part labels in play, most common first. */
  spread: Record<CategoryName, { label: string; count: number }[]>;
  worstConcentration: { category: CategoryName; label: string; count: number };
  /** Anonymous label of whoever led after battle 1, after battle 2, and overall. */
  leaders: string[];
  leadChanges: number;
  topTwoGap: number;
  /** Anonymous label of the battle-3 winner, to spot a late surge. */
  battle3Winner: string;
  result: EventResult;
  labels: string[];
}

/** Cumulative points per member through battle `upTo` (inclusive), using the same
 *  placement + kill arithmetic the site's scoreboards use. */
function cumulativePoints(result: EventResult, upTo: number): number[] {
  return result.members.map((member) => {
    const standing = result.standings.find((s) => s.memberId === member.id)!;
    return standing.battles.slice(0, upTo + 1).reduce((sum, b) => sum + b.total, 0);
  });
}

function leaderAfter(result: EventResult, labels: string[], upTo: number): string {
  const points = cumulativePoints(result, upTo);
  let best = 0;
  for (let i = 1; i < points.length; i++) if (points[i]! > points[best]!) best = i;
  return labels[best]!;
}

function analyse(seed: number): SeedReport {
  const result = runEvent({ masterSeed: seed, members: toEventMembers() });
  const labels = anonymiseFor(seed);

  let combatKills = 0;
  let hazardKills = 0;
  let fallKills = 0;
  for (const battle of result.battles) {
    for (const elimination of battle.eliminations) {
      if (elimination.byId !== null) combatKills++;
      else if (elimination.cause === 'fell') fallKills++;
      else hazardKills++;
    }
  }

  const spread = {} as Record<CategoryName, { label: string; count: number }[]>;
  let worstConcentration: { category: CategoryName; label: string; count: number } = {
    category: CATEGORIES[0]!,
    label: '',
    count: 0,
  };
  for (const category of CATEGORIES) {
    const counts = new Map<string, number>();
    for (const labelsForMember of result.partLabels) {
      const part = labelsForMember[category];
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
    const sorted = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
    spread[category] = sorted;
    if (sorted[0]!.count > worstConcentration.count) {
      worstConcentration = { category, label: sorted[0]!.label, count: sorted[0]!.count };
    }
  }

  const leaders = [0, 1, 2].map((i) => leaderAfter(result, labels, i));
  const leadChanges = leaders.filter((leader, i) => i > 0 && leader !== leaders[i - 1]).length;

  const battle3WinnerIndex = result.battles[2]!.places.indexOf(1);
  const topTwoGap = result.standings[0]!.points - result.standings[1]!.points;

  return {
    seed,
    battleTicks: result.battles.map((b) => b.ticks),
    combatKills,
    hazardKills,
    fallKills,
    spread,
    worstConcentration,
    leaders,
    leadChanges,
    topTwoGap,
    battle3Winner: labels[battle3WinnerIndex]!,
    result,
    labels,
  };
}

/** The draft-order board, anonymised — the same columns the site's final screen shows. */
function printBoard(report: SeedReport): void {
  const { result, labels } = report;
  const head =
    '    RANK  WHO   ' + ARENA_VARIANT_NAMES.map((name) => name.padEnd(22)).join('') + 'TOTAL';
  console.log(head);

  for (const standing of result.standings) {
    const memberIndex = result.members.findIndex((m) => m.id === standing.memberId);
    const tally = result.tallies[memberIndex]!;
    const cells = standing.battles
      .map((battle, b) => {
        const place = tally.places[b]!;
        const kills = battle.eliminations;
        const killPart = kills === 0 ? '' : ` +${battle.killPoints}(${kills}k)`;
        return `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} ${battle.placementPoints}pt${killPart}`.padEnd(
          22,
        );
      })
      .join('');
    const tie = standing.tiebreak === null ? '' : `  <- tiebreak: ${standing.tiebreak}`;
    console.log(
      `    ${String(standing.draftPosition).padStart(4)}  ${labels[memberIndex]!.padEnd(5)} ${cells}${String(standing.points).padStart(5)}${tie}`,
    );
  }
}

function printReport(report: SeedReport): void {
  const totalKills = report.combatKills + report.hazardKills + report.fallKills;

  console.log(`\n${'='.repeat(96)}`);
  console.log(`  SEED ${report.seed}`);
  console.log('='.repeat(96));

  console.log(
    `\n  battle lengths   ${report.battleTicks.map((t, i) => `${ARENA_VARIANT_NAMES[i]} ${secs(t)}`).join('   ')}` +
      `   (total ${secs(report.battleTicks.reduce((a, b) => a + b, 0))} of combat)`,
  );

  console.log(
    `  eliminations     ${totalKills} total   ` +
      `credited to a bot ${report.combatKills} (${pct(report.combatKills, totalKills).trim()})   ` +
      `hazards ${report.hazardKills} (${pct(report.hazardKills, totalKills).trim()})   ` +
      `falls ${report.fallKills} (${pct(report.fallKills, totalKills).trim()})`,
  );

  console.log(
    `  lead             after B1: ${report.leaders[0]}   after B2: ${report.leaders[1]}   final: ${report.leaders[2]}` +
      `   (${report.leadChanges} lead change${report.leadChanges === 1 ? '' : 's'})`,
  );
  console.log(
    `  finish           won by ${report.topTwoGap} pt${report.topTwoGap === 1 ? '' : 's'}` +
      `   |   battle 3 winner: ${report.battle3Winner}` +
      `${report.battle3Winner === report.leaders[2] ? '' : '  (did NOT win overall)'}`,
  );

  console.log('\n  KILLS BY ENTRANT  (credited eliminations, per battle)');
  const killRows = report.result.tallies
    .map((tally, i) => ({
      who: report.labels[i]!,
      per: tally.eliminationsPerBattle,
      total: tally.eliminationsPerBattle.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.total - a.total || (a.who < b.who ? -1 : 1));
  for (const row of killRows) {
    const bar = '#'.repeat(row.total);
    console.log(`    ${row.who}   B1 ${row.per[0]}   B2 ${row.per[1]}   B3 ${row.per[2]}   total ${row.total}  ${bar}`);
  }

  console.log('\n  BUILD SPREAD  (how many entrants got each part)');
  for (const category of CATEGORIES) {
    const parts = report.spread[category];
    const summary = parts.map((p) => `${p.label} x${p.count}`).join(', ');
    const flag = parts[0]!.count >= CONCENTRATION_FLAG ? '   <- CLUMPED' : '';
    console.log(`    ${category.padEnd(12)} ${parts.length} distinct   ${summary}${flag}`);
  }

  console.log('\n  DRAFT ORDER  (anonymised)');
  printBoard(report);
}

function printSummary(reports: readonly SeedReport[]): void {
  console.log(`\n${'='.repeat(96)}`);
  console.log('  SIDE BY SIDE');
  console.log('='.repeat(96));
  console.log(
    '\n  SEED          LENGTHS (B1/B2/B3)     KILLS  CREDITED  LEAD CHG  WON BY  MOST-CLUMPED PART',
  );
  for (const r of reports) {
    const total = r.combatKills + r.hazardKills + r.fallKills;
    const lengths = r.battleTicks.map((t) => secs(t).padStart(4)).join(' /');
    console.log(
      `  ${String(r.seed).padEnd(12)}${lengths}      ` +
        `${String(total).padStart(3)}   ${pct(r.combatKills, total)}      ` +
        `${String(r.leadChanges).padStart(3)}    ${String(r.topTwoGap).padStart(4)}pt   ` +
        `${r.worstConcentration.label} x${r.worstConcentration.count} (${r.worstConcentration.category})` +
        `${r.worstConcentration.count >= CONCENTRATION_FLAG ? '  <- CLUMPED' : ''}`,
    );
  }
  console.log('\n  Nothing here is a score. Longer is not better, more kills is not better —');
  console.log('  read them against what you want the night to feel like.');
}

// --- CLI ---------------------------------------------------------------------------------

const args = process.argv.slice(2);
const reveal = args.includes('--reveal');
const seeds = args.filter((a) => !a.startsWith('--')).map(Number);

if (seeds.length === 0 || seeds.some((s) => !Number.isInteger(s) || s < 1)) {
  console.error('Usage: npm run seeds -- <seed> [<seed> ...] [--reveal]');
  console.error('  --reveal  print the letter -> member mapping (spoils the draft order)');
  process.exit(1);
}

const reports = seeds.map(analyse);
for (const report of reports) printReport(report);
if (reports.length > 1) printSummary(reports);

if (reveal) {
  console.log(`\n${'='.repeat(96)}`);
  console.log('  REVEAL  --  who each letter was');
  console.log('='.repeat(96));
  for (const report of reports) {
    const pairs = report.labels
      .map((label, i) => ({ label, name: ROSTER[i]!.name }))
      .sort((a, b) => (a.label < b.label ? -1 : 1))
      .map((p) => `${p.label}=${p.name}`)
      .join('   ');
    console.log(`\n  seed ${report.seed}\n    ${pairs}`);
  }
}

console.log('\n  Save the one you want with:  npm run record -- --save <seed>\n');
