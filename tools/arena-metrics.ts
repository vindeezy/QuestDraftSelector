/**
 * Measures whether the arena is worth watching.
 *
 * Usage: npm run arena -- [matches]
 *
 * Four numbers matter, in this order:
 *
 * 1. Match length. Target is 2-3 minutes, so 7200-10800 ticks.
 * 2. Elimination pacing. Deaths spread through the match, not all at the start.
 * 3. Cause mix. If most deaths are hazards, the arena is fighting the bots instead of
 *    the bots fighting each other.
 * 4. Win rate by personality. If one wins 60% of matches, the model is broken before a
 *    single bot category exists. This is the number the next phase consumes.
 */
import { DEFAULT_ARENA } from '../src/sim/arena/arena';
import { DEFAULT_MATCH, createMatch, advanceMatch } from '../src/sim/arena/match';
import { PERSONALITY_NAMES } from '../src/sim/arena/personality';

const RUNS = Number(process.argv[2] ?? 100);

const ticks: number[] = [];
const causes: Record<string, number> = {};
const wins: Record<string, number> = {};
const appearances: Record<string, number> = {};
/** Elimination ticks bucketed into fifths of the match, to see pacing. */
const quintiles = [0, 0, 0, 0, 0];
let capped = 0;

for (const name of PERSONALITY_NAMES) {
  wins[name] = 0;
  appearances[name] = 0;
}

const started = Date.now();

for (let seed = 1; seed <= RUNS; seed++) {
  const match = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed, botCount: 10 });
  for (const bot of match.bots) {
    appearances[match.aiStates.get(bot.body.id)!.personality]!++;
  }

  while (!match.done) advanceMatch(match);

  ticks.push(match.world.tick);
  if (match.world.tick >= DEFAULT_MATCH.maxTicks) capped++;

  for (const e of match.eliminations) {
    causes[e.cause] = (causes[e.cause] ?? 0) + 1;
    const bucket = Math.min(4, Math.floor((e.tick / Math.max(1, match.world.tick)) * 5));
    quintiles[bucket]!++;
  }

  const winner = match.bots.find((b) => b.alive);
  if (winner) wins[match.aiStates.get(winner.body.id)!.personality]!++;
}

const elapsed = (Date.now() - started) / 1000;
ticks.sort((a, b) => a - b);
const median = ticks[Math.floor(ticks.length / 2)]!;
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;

console.log(`\n  ${RUNS} matches in ${elapsed.toFixed(0)}s\n`);

console.log('  1. MATCH LENGTH   (target 7200-10800 ticks, 2-3 minutes)');
console.log(`     min ${ticks[0]}, median ${median} (${(median / 60).toFixed(0)}s), max ${ticks[ticks.length - 1]}`);
console.log(`     hit the cap: ${capped}\n`);

const totalElims = Object.values(causes).reduce((a, b) => a + b, 0);
console.log('  2. ELIMINATION PACING   (even spread is healthy)');
console.log(`     ${quintiles.map((q) => pct(q, totalElims)).join('  ')}`);
console.log('     ^early                                    late^\n');

console.log('  3. CAUSE OF DEATH   (combat should dominate)');
for (const [cause, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${cause.padEnd(12)} ${pct(n, totalElims).padStart(6)}`);
}

console.log('\n  4. WIN RATE BY PERSONALITY   (even is ~14.3%)');
const rows = PERSONALITY_NAMES.map((name) => ({
  name,
  rate: (wins[name]! / RUNS) * 100,
})).sort((a, b) => b.rate - a.rate);
for (const row of rows) {
  const bar = '#'.repeat(Math.round(row.rate));
  console.log(`     ${row.name.padEnd(12)} ${row.rate.toFixed(1).padStart(5)}%  ${bar}`);
}
const spread = rows[0]!.rate - rows[rows.length - 1]!.rate;
console.log(`\n     spread: ${spread.toFixed(1)} points between best and worst`);
if (spread > 20) console.log('     WARNING: personalities are badly unbalanced');
console.log('');
