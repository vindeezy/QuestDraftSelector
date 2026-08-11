/**
 * Explains ONE match, tick by tick — the single-match companion to arena-metrics.ts's
 * 200-match aggregates. Built because a 200-match summary cannot say why bots 8 and 5
 * spent a specific match pinned against a wall, or why bots 9 and 10 stopped fighting
 * each other near the end.
 *
 * Usage:
 *   npm run replay -- <seed> [--arena=grinder|gauntlet|crossfire]   Defaults to grinder.
 *
 * Read-only: this file never touches src/sim's behaviour. It derives builds with
 * `buildsForSeed`, exactly as `tools/arena-metrics.ts` does, then drives the match with
 * only `createMatch` / `advanceMatch` and reads back public `Match` fields — the same
 * match the owner watched in the browser, replayed identically.
 *
 * One diagnostic field was added to `src/sim/arena/ai.ts` to make this tool possible:
 * `AiState.lastAction`, a mirror of `chooseAction`'s return value written every tick and
 * never read by any decision logic. See its doc comment in ai.ts for why that is safe —
 * summarised again in this tool's header output.
 */
import { GRINDER_ARENA, GAUNTLET_ARENA, CROSSFIRE_ARENA, type ArenaConfig } from '../src/sim/arena/arena';
import { DEFAULT_MATCH, createMatch, advanceMatch, type Match } from '../src/sim/arena/match';
import { buildsForSeed } from '../src/sim/parts/forge';

const BOT_COUNT = 10;
const TICKS_PER_SECOND = 60;
const STALL_WINDOW_TICKS = 300; // 5 seconds
const STALL_THRESHOLD_UNITS = 60;
const WALL_PROXIMITY_UNITS = 60;
const COMBAT_BUCKET_TICKS = 600; // 10 seconds
const ENDGAME_SAMPLE_TICKS = 300; // 5 seconds

function botIndex(botId: string): number {
  return Number(botId.slice('bot-'.length));
}

function secs(tick: number): string {
  return (tick / TICKS_PER_SECOND).toFixed(1);
}

function pct(n: number, d: number): string {
  return d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`;
}

// --- CLI ---------------------------------------------------------------------------------

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const seedArg = positional[0];
if (seedArg === undefined || !/^-?\d+$/.test(seedArg)) {
  console.error('Usage: npm run replay -- <seed> [--arena=grinder|gauntlet|crossfire]');
  process.exit(1);
}
const seed = Number(seedArg);

const arenaArg = args.find((a) => a.startsWith('--arena='));
const arenaName = arenaArg ? arenaArg.slice('--arena='.length) : 'grinder';
const ARENAS: Record<string, { config: ArenaConfig; label: string }> = {
  grinder: { config: GRINDER_ARENA, label: 'grinder (The Grinder)' },
  gauntlet: { config: GAUNTLET_ARENA, label: 'gauntlet (The Gauntlet)' },
  crossfire: { config: CROSSFIRE_ARENA, label: 'crossfire (The Crossfire)' },
};
const selected = ARENAS[arenaName];
if (!selected) {
  console.error(`Unknown --arena=${arenaName}. Valid: grinder, gauntlet, crossfire.`);
  process.exit(1);
}
const { config: arenaConfig, label: arenaLabel } = selected;

// --- Derive builds, exactly as arena-metrics.ts does --------------------------------------

const { builds, matchSeed } = buildsForSeed(seed, BOT_COUNT);
const match: Match = createMatch({
  ...DEFAULT_MATCH,
  arena: arenaConfig,
  seed: matchSeed,
  botCount: BOT_COUNT,
  builds,
});

// --- Per-tick recording ---------------------------------------------------------------
//
// Everything below reads ONLY public fields on `match` / `match.bots` / `match.aiStates`.
// Nothing here calls back into src/sim in a way that could alter the simulation; it is a
// passive observer that happens to run between `advanceMatch` calls.

interface Sample {
  tick: number;
  x: number;
  y: number;
  alive: boolean;
  target: string | null;
  action: string | null;
}

const samples: Sample[][] = Array.from({ length: BOT_COUNT }, () => []);
/** contactsPerTick[tick] = landed weapon hits (bot.contacts deltas summed) that tick. */
const contactsPerTick: number[] = [0]; // index 0 unused; tick is 1-based after advanceMatch.
const prevContacts = new Array<number>(BOT_COUNT).fill(0);

while (!match.done) {
  for (let i = 0; i < BOT_COUNT; i++) prevContacts[i] = match.bots[i]!.contacts;

  advanceMatch(match);

  let landedThisTick = 0;
  for (let i = 0; i < BOT_COUNT; i++) landedThisTick += match.bots[i]!.contacts - prevContacts[i]!;
  contactsPerTick.push(landedThisTick);

  const tick = match.world.tick;
  for (let i = 0; i < BOT_COUNT; i++) {
    const bot = match.bots[i]!;
    const aiState = match.aiStates.get(bot.body.id)!;
    samples[i]!.push({
      tick,
      x: bot.body.x,
      y: bot.body.y,
      alive: bot.alive,
      target: aiState.target,
      action: aiState.lastAction,
    });
  }
}

const finalTick = match.world.tick;
const gridWidth = match.arena.grid.width;
const gridHeight = match.arena.grid.height;

const eliminationTick = new Map<string, number>();
for (const e of match.eliminations) eliminationTick.set(e.botId, e.tick);

function distToWall(x: number, y: number): number {
  return Math.min(x, gridWidth - x, y, gridHeight - y);
}

function targetLabel(id: string | null): string {
  return id === null ? 'none' : `bot ${botIndex(id)}`;
}

// ============================================================================================
// 1. HEADER
// ============================================================================================

console.log(`\n  REPLAY  --  seed ${seed}  (match seed ${matchSeed})  --  arena: ${arenaLabel}`);
console.log(`  ${finalTick} ticks (${secs(finalTick)}s)${finalTick >= DEFAULT_MATCH.maxTicks ? '  <- hit the tick cap' : ''}`);

const survivors = match.bots.filter((b) => b.alive);
if (survivors.length === 1) {
  const winner = survivors[0]!;
  const wIdx = botIndex(winner.body.id);
  const wBuild = builds[wIdx]!;
  console.log(`  winner: bot ${wIdx}`);
  console.log(
    `    chassis=${wBuild.partLabels.chassis}  drive=${wBuild.partLabels.drive}  weapon=${wBuild.partLabels.weapon}` +
      `  armour=${wBuild.partLabels.armour}  ability=${wBuild.partLabels.ability}  personality=${wBuild.partLabels.personality}`,
  );
} else if (survivors.length === 0) {
  console.log('  winner: none -- every bot was eliminated');
} else {
  console.log(`  winner: no clean winner -- ${survivors.length} bots survived to the tick cap:`);
  for (const b of survivors) {
    console.log(`    bot ${botIndex(b.body.id)}  health ${b.health.toFixed(1)}/${b.maxHealth}`);
  }
}

console.log(
  `\n  NOTE on AI action visibility: AiState carried no field recording the action ` +
    `\`chooseAction\` had just picked -- \`driveWithAi\` computed it into a local variable ` +
    `and discarded it once steering ran. \`AiState.lastAction\` was added (src/sim/arena/ai.ts) ` +
    `to expose it: written every tick chooseAction runs, read by nothing else in src/sim, so it ` +
    `changes no behaviour and no match checksum. See that file's doc comment on the field, and ` +
    `this tool's own header comment. One caveat: while a bot is stunned, driveWithAi returns ` +
    `before calling chooseAction at all, so lastAction/target below are the last values computed ` +
    `before the stun began, not "none".`,
);

// ============================================================================================
// 2. ELIMINATION LOG
// ============================================================================================

console.log(`\n  ELIMINATIONS  (${match.eliminations.length} total)`);
if (match.eliminations.length === 0) {
  console.log('    none -- every bot survived to the tick cap');
}
for (const e of match.eliminations) {
  const victim = botIndex(e.botId);
  const cause = e.cause === 'destroyed' ? (e.byId !== null ? 'combat' : 'hazard') : 'fall';
  const killer = e.byId !== null ? `  killer: bot ${botIndex(e.byId)}` : '';
  console.log(`    tick ${String(e.tick).padStart(6)}  (${secs(e.tick).padStart(7)}s)  bot ${victim} eliminated -- ${cause}${killer}`);
}

// ============================================================================================
// 3. PER-BOT TABLE
// ============================================================================================

console.log('\n  PER-BOT SUMMARY');
console.log(
  '    bot  chassis          drive            personality      alive(t)  alive(s)  dist      contacts  dmgDealt  dmgTaken  wall%',
);
for (let i = 0; i < BOT_COUNT; i++) {
  const bot = match.bots[i]!;
  const build = builds[i]!;
  const botSamples = samples[i]!;
  const ticksAlive = eliminationTick.get(bot.body.id) ?? finalTick;

  let distance = 0;
  let aliveCount = 0;
  let nearWallCount = 0;
  let prev: Sample | null = null;
  for (const s of botSamples) {
    if (!s.alive) {
      prev = null;
      continue;
    }
    aliveCount++;
    if (distToWall(s.x, s.y) < WALL_PROXIMITY_UNITS) nearWallCount++;
    if (prev !== null) {
      const dx = s.x - prev.x;
      const dy = s.y - prev.y;
      distance += Math.sqrt(dx * dx + dy * dy);
    }
    prev = s;
  }

  console.log(
    `    ${String(i).padStart(3)}  ${build.partLabels.chassis.padEnd(16)} ${build.partLabels.drive.padEnd(16)} ` +
      `${build.partLabels.personality.padEnd(16)} ${String(ticksAlive).padStart(8)}  ${secs(ticksAlive).padStart(8)}  ` +
      `${distance.toFixed(0).padStart(8)}  ${String(bot.contacts).padStart(8)}  ${bot.damageDealt.toFixed(1).padStart(8)}  ` +
      `${bot.damageTaken.toFixed(1).padStart(8)}  ${pct(nearWallCount, aliveCount).padStart(6)}`,
  );
}

// ============================================================================================
// 4. STALL EVENTS
// ============================================================================================

interface StallEvent {
  botIndex: number;
  startTick: number;
  endTick: number;
  meanX: number;
  meanY: number;
  meanSpeedPerTick: number;
  target: string | null;
  action: string | null;
  actionsSeen: Set<string | null>;
}

function findStalls(idx: number, botSamples: Sample[]): StallEvent[] {
  const alive = botSamples.filter((s) => s.alive);
  const n = alive.length;
  const flagged = new Array<boolean>(n).fill(false);

  for (let s = 0; s + STALL_WINDOW_TICKS < n; s++) {
    const a = alive[s]!;
    const b = alive[s + STALL_WINDOW_TICKS]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const disp = Math.sqrt(dx * dx + dy * dy);
    if (disp < STALL_THRESHOLD_UNITS) {
      for (let k = s; k <= s + STALL_WINDOW_TICKS; k++) flagged[k] = true;
    }
  }

  const events: StallEvent[] = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && flagged[i]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runEnd = i - 1;
      events.push(buildStallEvent(idx, alive, runStart, runEnd));
      runStart = -1;
    }
  }
  return events;
}

function buildStallEvent(idx: number, alive: Sample[], startIdx: number, endIdx: number): StallEvent {
  let sumX = 0;
  let sumY = 0;
  let pathLen = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    sumX += alive[i]!.x;
    sumY += alive[i]!.y;
  }
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const dx = alive[i]!.x - alive[i - 1]!.x;
    const dy = alive[i]!.y - alive[i - 1]!.y;
    pathLen += Math.sqrt(dx * dx + dy * dy);
  }
  const count = endIdx - startIdx + 1;
  const durationTicks = alive[endIdx]!.tick - alive[startIdx]!.tick;
  const last = alive[endIdx]!;
  const actionsSeen = new Set<string | null>();
  for (let i = startIdx; i <= endIdx; i++) actionsSeen.add(alive[i]!.action);

  return {
    botIndex: idx,
    startTick: alive[startIdx]!.tick,
    endTick: alive[endIdx]!.tick,
    meanX: sumX / count,
    meanY: sumY / count,
    meanSpeedPerTick: durationTicks > 0 ? pathLen / durationTicks : 0,
    target: last.target,
    action: last.action,
    actionsSeen,
  };
}

const allStalls: StallEvent[] = [];
for (let i = 0; i < BOT_COUNT; i++) allStalls.push(...findStalls(i, samples[i]!));
allStalls.sort((a, b) => a.startTick - b.startTick || a.botIndex - b.botIndex);

console.log(
  `\n  STALL EVENTS  (net displacement < ${STALL_THRESHOLD_UNITS} units over any ${STALL_WINDOW_TICKS}-tick / ` +
    `${STALL_WINDOW_TICKS / TICKS_PER_SECOND}s window; overlapping windows per bot merged into one event)`,
);
if (allStalls.length === 0) {
  console.log('    none -- no bot ever net-displaced under the threshold for a full 5-second window');
}
for (const e of allStalls) {
  const durationTicks = e.endTick - e.startTick;
  const actionNote = e.actionsSeen.size > 1 ? `  (varied: ${[...e.actionsSeen].map((a) => a ?? 'none').join(', ')})` : '';
  console.log(
    `    bot ${e.botIndex}  ticks ${String(e.startTick).padStart(6)}-${String(e.endTick).padStart(6)} ` +
      `(${secs(e.startTick)}s-${secs(e.endTick)}s, ${(durationTicks / TICKS_PER_SECOND).toFixed(1)}s)  ` +
      `mean pos (${e.meanX.toFixed(0)}, ${e.meanY.toFixed(0)})  mean speed ${e.meanSpeedPerTick.toFixed(3)} u/tick ` +
      `(${(e.meanSpeedPerTick * TICKS_PER_SECOND).toFixed(1)} u/s)  target: ${targetLabel(e.target)}  ` +
      `action: ${e.action ?? 'none'}${actionNote}`,
  );
}

// ============================================================================================
// 5. COMBAT TIMELINE
// ============================================================================================

const numBuckets = Math.max(1, Math.ceil(finalTick / COMBAT_BUCKET_TICKS));
const buckets = new Array<number>(numBuckets).fill(0);
for (let tick = 1; tick <= finalTick; tick++) {
  const bucket = Math.floor((tick - 1) / COMBAT_BUCKET_TICKS);
  buckets[bucket]! += contactsPerTick[tick] ?? 0;
}
const peak = Math.max(1, ...buckets);

console.log(`\n  COMBAT TIMELINE  (contacts landed per ${COMBAT_BUCKET_TICKS / TICKS_PER_SECOND}s bucket)`);
buckets.forEach((count, i) => {
  const startS = (i * COMBAT_BUCKET_TICKS) / TICKS_PER_SECOND;
  const endS = Math.min(finalTick, (i + 1) * COMBAT_BUCKET_TICKS) / TICKS_PER_SECOND;
  const bar = '#'.repeat(Math.round((count / peak) * 40));
  console.log(`    ${startS.toFixed(0).padStart(4)}-${endS.toFixed(0).padStart(4)}s  ${String(count).padStart(3)}  ${bar}`);
});

// ============================================================================================
// 6. ENDGAME
// ============================================================================================

console.log('\n  ENDGAME  (from the tick exactly two bots remain)');

// Walk eliminations in order, tracking living count, to find the tick living first hits 2.
let living = BOT_COUNT;
let twoRemainTick: number | null = null;
const eliminated = new Set<string>();
for (const e of match.eliminations) {
  eliminated.add(e.botId);
  living--;
  if (living === 2) {
    twoRemainTick = e.tick;
    break;
  }
  if (living < 2) break; // skipped past 2 (simultaneous eliminations) -- handled below.
}

if (twoRemainTick === null) {
  console.log(
    '    no tick had exactly two bots remaining -- either the match ended with >2 survivors ' +
      'at the tick cap, or living count dropped past 2 in a single tick (simultaneous eliminations).',
  );
} else {
  const remainingIds = match.bots.filter((b) => !eliminated.has(b.body.id)).map((b) => b.body.id);
  if (remainingIds.length !== 2) {
    console.log(`    unexpected: ${remainingIds.length} bots left after the tick-2 elimination, expected 2.`);
  } else {
    const [idA, idB] = remainingIds as [string, string];
    const iA = botIndex(idA);
    const iB = botIndex(idB);
    console.log(`    two-survivor phase: bot ${iA} vs bot ${iB}, starting tick ${twoRemainTick} (${secs(twoRemainTick)}s)`);
    console.log('    tick      time     distance apart   contacts in this window');

    const samplesA = samples[iA]!;
    const samplesB = samples[iB]!;
    const byTickA = new Map(samplesA.map((s) => [s.tick, s]));
    const byTickB = new Map(samplesB.map((s) => [s.tick, s]));

    let windowStart = twoRemainTick;
    for (let tick = twoRemainTick; tick <= finalTick; tick += ENDGAME_SAMPLE_TICKS) {
      const sa = byTickA.get(tick);
      const sb = byTickB.get(tick);
      // A sample exists for every bot at every tick up to `finalTick` regardless of
      // `alive` (a dead bot's body freezes but is still sampled), so this only guards
      // against a tick genuinely outside the recorded range.
      if (!sa || !sb) break;
      const dx = sa.x - sb.x;
      const dy = sa.y - sb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let windowContacts = 0;
      for (let t = windowStart + 1; t <= tick; t++) windowContacts += contactsPerTick[t] ?? 0;
      console.log(
        `    ${String(tick).padStart(6)}  ${secs(tick).padStart(6)}s  ${dist.toFixed(0).padStart(14)}   ${windowContacts}`,
      );
      windowStart = tick;
    }
    // The loop above steps in fixed 300-tick strides from `twoRemainTick`, so it lands on
    // `finalTick` only when `(finalTick - twoRemainTick)` happens to be an exact multiple
    // of 300 -- not implied by `finalTick % 300 === 0` alone, since `twoRemainTick` is
    // itself an arbitrary tick. Comparing directly against `windowStart` (the last tick
    // the loop actually printed) is what correctly catches every case, including a
    // trailing partial window shorter than 300 ticks.
    if (windowStart !== finalTick) {
      const sa = byTickA.get(finalTick);
      const sb = byTickB.get(finalTick);
      if (sa && sb) {
        const dx = sa.x - sb.x;
        const dy = sa.y - sb.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let windowContacts = 0;
        for (let t = windowStart + 1; t <= finalTick; t++) windowContacts += contactsPerTick[t] ?? 0;
        console.log(
          `    ${String(finalTick).padStart(6)}  ${secs(finalTick).padStart(6)}s  ${dist.toFixed(0).padStart(14)}   ${windowContacts}  (final tick)`,
        );
      }
    }
  }
}

console.log('');
