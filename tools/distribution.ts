/**
 * Reports the measured behaviour of the Plinko board.
 *
 * Usage: npm run distribution -- [runs]
 *
 * This is how board tuning decisions get made. Do not guess at row counts or
 * spacing — change the config, run this, and read the numbers.
 *
 * Two things are measured, and the second matters more:
 *
 * 1. The slot distribution, which sets how rare the outer jackpot slots are.
 *    Target for the rarest slot is 0.2%–1.5% per ball.
 *
 * 2. The per-ball mean slot, which is a FAIRNESS check. Every ball index must have
 *    the same expected outcome, because ball index maps to a league member. A real
 *    3.9-slot bias was found here once, caused by assigning release positions by
 *    ball index; a symmetric random walk preserves the expected value of its
 *    starting position, so no amount of board height washes that out. If the spread
 *    reported at the bottom drifts above roughly 0.5 slots, something has
 *    reintroduced a systematic bias and the board is not fair.
 */
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../src/sim/plinko/plinko';

const runs = Number(process.argv[2] ?? 500);
const config = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };

const counts = new Array<number>(DEFAULT_BOARD.slotCount).fill(0);
const perBallSum = new Array<number>(config.ballCount).fill(0);
const perBallCount = new Array<number>(config.ballCount).fill(0);

let totalBalls = 0;
let unsettled = 0;
let tickTotal = 0;
let tickMax = 0;
const started = Date.now();

for (let seed = 1; seed <= runs; seed++) {
  const result = runPlinko({ ...config, seed });
  if (!result.settled) unsettled++;
  tickTotal += result.ticks;
  if (result.ticks > tickMax) tickMax = result.ticks;
  for (const landing of result.landings) {
    counts[landing.slot]!++;
    perBallSum[landing.ballIndex]! += landing.slot;
    perBallCount[landing.ballIndex]!++;
    totalBalls++;
  }
}

const elapsed = (Date.now() - started) / 1000;

console.log(`\n  ${runs} drops, ${totalBalls} balls, ${elapsed.toFixed(1)}s`);
console.log(`  ticks: mean ${(tickTotal / runs).toFixed(0)}, max ${tickMax}\n`);

console.log('  SLOT DISTRIBUTION');
const peak = Math.max(...counts);
counts.forEach((count, index) => {
  const pct = (count / totalBalls) * 100;
  const bar = '#'.repeat(Math.round((count / peak) * 44));
  console.log(`  slot ${String(index).padStart(2)}  ${pct.toFixed(2).padStart(6)}%  ${bar}`);
});
const rarest = (Math.min(...counts) / totalBalls) * 100;
console.log(`\n  rarest slot: ${rarest.toFixed(3)}%   (target band 0.2% - 1.5%)`);

console.log('\n  PER-BALL MEAN SLOT   (fairness check — all must be equal)');
let min = Number.POSITIVE_INFINITY;
let max = Number.NEGATIVE_INFINITY;
for (let i = 0; i < config.ballCount; i++) {
  const mean = perBallSum[i]! / perBallCount[i]!;
  if (mean < min) min = mean;
  if (mean > max) max = mean;
  console.log(`  ball ${String(i).padStart(2)}  ${mean.toFixed(3).padStart(6)}`);
}
const spread = max - min;
console.log(`\n  per-ball spread: ${spread.toFixed(3)} slots   (must stay near 0)`);
if (spread > 0.5) {
  console.log('  FAIL: systematic per-ball bias detected. The board is not fair.');
}
if (unsettled > 0) {
  console.log(`  WARNING: ${unsettled} run(s) hit the tick limit without settling`);
}
console.log('');
