/**
 * Searches master seeds for one whose event matches a list of criteria.
 *
 * Usage:
 *   npm run search -- [--from=1] [--count=20000] [--stop-after=3]
 *
 * TWO-PHASE, and the split is what makes this finishable. Ten of the criteria are
 * properties of the BUILDS, which `runForgeOnly` settles from six ball drops. The rest
 * need the three battles, which cost several hundred times more. So every seed is checked
 * against the build criteria first, and battles run only for the few that survive.
 *
 * The report is deliberately not just "here are the matches". It prints the hit rate of
 * every criterion individually, because when nothing matches — which is the likely outcome
 * for a demanding list — the useful output is knowing WHICH criterion is doing the killing
 * and which one to relax. A scan that only says "no results" wastes the time it took.
 */
import { runEvent, runForgeOnly } from '../src/sim/event/event';
import { CATEGORIES, type CategoryName } from '../src/sim/parts/tables';
import { toEventMembers } from '../src/config/roster';

const MEMBER_COUNT = 10;
const TICKS_PER_SECOND = 60;

// --- The criteria ------------------------------------------------------------------------
//
// Split by what they need, not by importance: `BUILD_MUSTS` are decided by the Forge alone,
// `EVENT_MUSTS` need the battles. Every entry is a hard filter; `NICE` entries only rank
// the survivors.

interface BuildFacts {
  /** Distinct parts in play, per category. */
  distinct: Record<CategoryName, number>;
  /** How many members share the most common part in each category. */
  maxShare: Record<CategoryName, number>;
  /** Every part label in play, per category. */
  present: Record<CategoryName, Set<string>>;
}

function buildFacts(partLabels: Record<CategoryName, string>[]): BuildFacts {
  const distinct = {} as Record<CategoryName, number>;
  const maxShare = {} as Record<CategoryName, number>;
  const present = {} as Record<CategoryName, Set<string>>;
  for (const category of CATEGORIES) {
    const counts = new Map<string, number>();
    for (const member of partLabels) counts.set(member[category], (counts.get(member[category]) ?? 0) + 1);
    distinct[category] = counts.size;
    maxShare[category] = Math.max(...counts.values());
    present[category] = new Set(counts.keys());
  }
  return { distinct, maxShare, present };
}

const has = (f: BuildFacts, category: CategoryName, ...labels: string[]): boolean =>
  labels.every((label) => f.present[category].has(label));

/**
 * "Every part in the game appears in someone's build."
 *
 * Reachable in principle — ten members against boards of 6, 6, 6, 7, 7 and 7 slots — but
 * the Plinko distribution is bell-shaped, so the outermost slot of a board is by far the
 * hardest to land, and this asks for every one of them at once.
 *
 * Worth having as a criterion of its own because it SUBSUMES several others: if all 39
 * appear then every category trivially has 5+ distinct, and every named part is present.
 */
const EVERY_PART: { name: string; test: (f: BuildFacts) => boolean }[] = [
  { name: 'chassis: all 6', test: (f) => f.distinct.chassis === 6 },
  { name: 'drive: all 6', test: (f) => f.distinct.drive === 6 },
  { name: 'weapon: all 6', test: (f) => f.distinct.weapon === 6 },
  { name: 'armour: all 7', test: (f) => f.distinct.armour === 7 },
  { name: 'ability: all 7', test: (f) => f.distinct.ability === 7 },
  { name: 'personality: all 7', test: (f) => f.distinct.personality === 7 },
];

const FULL_CRITERIA: { name: string; test: (f: BuildFacts) => boolean }[] = [
  { name: 'chassis: 5+ distinct', test: (f) => f.distinct.chassis >= 5 },
  { name: 'drive: has Omni, Hover and Tank Tracks', test: (f) => has(f, 'drive', 'Omni Wheels', 'Hover', 'Tank Tracks') },
  { name: 'weapon: 5+ distinct', test: (f) => f.distinct.weapon >= 5 },
  {
    name: 'weapon: has Flamethrower, Vertical Spinner, Hammer',
    test: (f) => has(f, 'weapon', 'Flamethrower', 'Vertical Spinner', 'Hammer'),
  },
  { name: 'armour: 5+ distinct', test: (f) => f.distinct.armour >= 5 },
  {
    name: 'armour: has Depleted Uranium and Hardened Steel',
    test: (f) => has(f, 'armour', 'Depleted Uranium', 'Hardened Steel'),
  },
  { name: 'ability: 5+ distinct', test: (f) => f.distinct.ability >= 5 },
  {
    name: 'ability: has EMP, Shockwave, Repair, Smoke Screen',
    test: (f) => has(f, 'ability', 'EMP Pulse', 'Shockwave', 'Repair System', 'Smoke Screen'),
  },
  { name: 'personality: 5+ distinct', test: (f) => f.distinct.personality >= 5 },
  {
    name: 'personality: has Instigator, Showman, Hit-and-Run',
    test: (f) => has(f, 'personality', 'Instigator', 'Showman', 'Hit-and-Run'),
  },
];

interface EventFacts {
  seconds: number[];
  combat: number;
  hazard: number;
  fall: number;
  leadChanges: number;
  margin: number;
  scorers: number;
  firstPlaceTiebreak: boolean;
  /**
   * Seconds each battle spent as a one-on-one: from the eighth elimination, when two bots
   * are left, to the finish.
   *
   * This is the dead-air measure, and it is free — `runEvent` already returns every
   * elimination's tick, so no replay is needed. It earns its place because screening seed
   * 9000240 showed the failure mode directly: its Grinder ran 3:11 with the last 93 seconds
   * a two-bot stalemate that ended when one fell in a pit. Contacts per ten seconds over
   * that stretch read 9, 10, 4, 3, 16, 8, 0, 2, 1, 0. Total battle length cannot see that;
   * this can.
   */
  duelTails: number[];
  /** How many of the three battles ended with a credited kill rather than a hazard or a
   *  fall. A final decided by an accident is a weak finish however long the battle ran. */
  combatFinishes: number;
}

const MAX_DUEL_TAIL = Number(
  process.argv.find((a) => a.startsWith('--max-tail='))?.slice('--max-tail='.length) ?? 45,
);

const EVENT_MUSTS: { name: string; test: (e: EventFacts) => boolean }[] = [
  { name: '3+ non-combat deaths, 1+ a fall', test: (e) => e.hazard + e.fall >= 3 && e.fall >= 1 },
  { name: '2 lead changes', test: (e) => e.leadChanges >= 2 },
  {
    name: `no battle ends in a duel longer than ${MAX_DUEL_TAIL}s`,
    test: (e) => Math.max(...e.duelTails) <= MAX_DUEL_TAIL,
  },
];

const NICE: { name: string; test: (e: EventFacts) => boolean }[] = [
  { name: '2 battles 2:00 or longer', test: (e) => e.seconds.filter((s) => s >= 120).length >= 2 },
  { name: 'all three battles end by a kill', test: (e) => e.combatFinishes === 3 },
  { name: 'won by under 15 pts', test: (e) => e.margin < 15 },
  { name: '8+ members with a kill', test: (e) => e.scorers >= 8 },
  { name: 'first place needs no tiebreak', test: (e) => !e.firstPlaceTiebreak },
];

// --- Analysis ----------------------------------------------------------------------------

function eventFacts(masterSeed: number): EventFacts {
  const r = runEvent({ masterSeed, members: toEventMembers() });

  let combat = 0, hazard = 0, fall = 0;
  for (const battle of r.battles) {
    for (const e of battle.eliminations) {
      if (e.byId !== null) combat++;
      else if (e.cause === 'fell') fall++;
      else hazard++;
    }
  }

  const cumulative = (upTo: number): number[] =>
    r.members.map((m) => {
      const s = r.standings.find((x) => x.memberId === m.id)!;
      return s.battles.slice(0, upTo + 1).reduce((sum, b) => sum + b.total, 0);
    });
  const leaderAt = (upTo: number): number => {
    const pts = cumulative(upTo);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i]! > pts[best]!) best = i;
    return best;
  };
  const leaders = [leaderAt(0), leaderAt(1), leaderAt(2)];
  const leadChanges = leaders.filter((l, i) => i > 0 && l !== leaders[i - 1]).length;

  // Two bots remain once eight of the ten are out; that elimination starts the duel.
  const duelTails = r.battles.map((b) => {
    const startsDuel = b.eliminations[b.eliminations.length - 2];
    return startsDuel === undefined ? 0 : Math.round((b.ticks - startsDuel.tick) / TICKS_PER_SECOND);
  });
  const combatFinishes = r.battles.filter(
    (b) => (b.eliminations[b.eliminations.length - 1]?.byId ?? null) !== null,
  ).length;

  return {
    seconds: r.battles.map((b) => Math.round(b.ticks / TICKS_PER_SECOND)),
    duelTails,
    combatFinishes,
    combat,
    hazard,
    fall,
    leadChanges,
    margin: r.standings[0]!.points - r.standings[1]!.points,
    scorers: r.tallies.filter((t) => t.eliminationsPerBattle.some((n) => n > 0)).length,
    firstPlaceTiebreak: r.standings[0]!.tiebreak !== null,
  };
}

// --- CLI ---------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.slice(name.length + 3)) : fallback;
};
const coverageOnly = args.includes('--coverage');
const BUILD_MUSTS = coverageOnly ? EVERY_PART : FULL_CRITERIA;

const from = flag('from', 1);
const count = flag('count', 20000);
const stopAfter = flag('stop-after', 3);

const buildHits = BUILD_MUSTS.map(() => 0);
const eventHits = EVENT_MUSTS.map(() => 0);
let buildPassed = 0;
let eventChecked = 0;
const matches: { seed: number; facts: EventFacts; nice: boolean[] }[] = [];

const started = from;
let scanned = 0;

for (let seed = from; seed < from + count; seed++) {
  scanned++;
  const facts = buildFacts(runForgeOnly(seed, MEMBER_COUNT).partLabels);

  let allBuild = true;
  BUILD_MUSTS.forEach((criterion, i) => {
    if (criterion.test(facts)) buildHits[i]!++;
    else allBuild = false;
  });
  if (!allBuild) continue;
  buildPassed++;

  // Only now is it worth three battles.
  const ev = eventFacts(seed);
  eventChecked++;
  let allEvent = true;
  EVENT_MUSTS.forEach((criterion, i) => {
    if (criterion.test(ev)) eventHits[i]!++;
    else allEvent = false;
  });
  // In coverage mode the build criterion IS the whole question, so the battle criteria are
  // measured and reported but never used to reject.
  if (!allEvent && !coverageOnly) continue;

  matches.push({ seed, facts: ev, nice: NICE.map((n) => n.test(ev)) });
  console.log(`  MATCH  seed ${seed}  (${matches.length}/${stopAfter})`);
  if (matches.length >= stopAfter) break;
}

const pct = (n: number, d: number): string => (d === 0 ? '   n/a' : `${((100 * n) / d).toFixed(2).padStart(6)}%`);

console.log(`\n${'='.repeat(88)}`);
console.log(`  SCANNED ${scanned} seeds from ${started}`);
console.log('='.repeat(88));

console.log('\n  BUILD CRITERIA  (checked on every seed — Forge only, no battles)');
BUILD_MUSTS.forEach((c, i) => {
  console.log(`    ${pct(buildHits[i]!, scanned)}   ${c.name}`);
});
console.log(`    ${pct(buildPassed, scanned)}   >>> ALL BUILD CRITERIA TOGETHER  (${buildPassed} seeds)`);

console.log('\n  EVENT CRITERIA  (checked only on the seeds above — battles run)');
if (eventChecked === 0) {
  console.log('    nothing reached this stage.');
} else {
  EVENT_MUSTS.forEach((c, i) => {
    console.log(`    ${pct(eventHits[i]!, eventChecked)}   ${c.name}`);
  });
  console.log(`    ${pct(matches.length, eventChecked)}   >>> ALL EVENT CRITERIA TOGETHER  (${matches.length} seeds)`);
}

if (matches.length > 0) {
  console.log('\n  MATCHES');
  for (const m of matches) {
    const e = m.facts;
    console.log(
      `\n    seed ${m.seed}` +
        `\n      battles      ${e.seconds.map((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`).join('  ')}` +
        `\n      deaths       ${e.combat} credited, ${e.hazard} hazard, ${e.fall} fall` +
        `\n      lead changes ${e.leadChanges}   won by ${e.margin} pt   ${e.scorers} members scored a kill` +
        `\n      final duels  ${e.duelTails.map((t) => `${t}s`).join('  ')}   ` +
        `(${e.combatFinishes}/3 ended by a kill)` +
        `\n      nice-to-have ${m.nice.filter(Boolean).length}/${NICE.length}`,
    );
    NICE.forEach((n, i) => console.log(`         ${m.nice[i] ? '[x]' : '[ ]'} ${n.name}`));
  }
  console.log('\n  Inspect one in full with:  npm run seeds -- <seed>');
} else {
  console.log('\n  No seed matched. The lowest build-criterion rate above is the bottleneck —');
  console.log('  relaxing that one buys more than relaxing anything else.');
}
console.log();
