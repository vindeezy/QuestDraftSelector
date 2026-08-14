/**
 * What the recorded event actually asks the mixer to play.
 *
 * `voices.ts` decides how dense the sound is allowed to get, and every number in it is a
 * judgement that cannot be made by reasoning — "does a ten-bot scrum turn to mush" is a
 * question about a specific fight, not about audio in general. This runs all three battles of
 * the official seed plus a Forge board through the real classifier and the real mixer, and
 * reports what comes out the far side.
 *
 * Run it after changing any cap. The number that matters is **peak overlap** — how many
 * voices are ringing at the same instant. Per-second totals look reassuring and hide the
 * problem, which is exactly how the first version of these caps passed its own tests while
 * allowing 31 simultaneous voices.
 *
 *   npm run mix
 */
import { runEvent } from '../src/sim/event/event';
import { ARENA_VARIANTS } from '../src/sim/event/arenas';
import { assemble } from '../src/sim/parts/assemble';
import { DEFAULT_MATCH, createMatch, advanceMatch } from '../src/sim/arena/match';
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { DEFAULT_PLINKO, createPlinkoRun, advance } from '../src/sim/plinko/plinko';
import { toEventMembers } from '../src/config/roster';
import { soundFor } from '../src/audio/classify';
import { GLOBAL_CAP, admit, emptyState, type VoiceRequest, type VoiceState } from '../src/audio/voices';
// The shipped record, so this measures the fight the league will actually watch rather than
// whichever seed happened to be typed here.
import officialRecord from '../data/official-event.json';

const MS_PER_TICK = 1000 / 60;

/** Running totals for one screen's worth of sound. */
interface Mix {
  raw: number;
  played: number;
  peak: number;
  worstRawSecond: number;
  requested: Map<string, number>;
  kept: Map<string, number>;
}

function newMix(): Mix {
  return { raw: 0, played: 0, peak: 0, worstRawSecond: 0, requested: new Map(), kept: new Map() };
}

function bump(counts: Map<string, number>, id: string): void {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

/** Feeds one tick's requests through the mixer and folds the result into `mix`. */
function tally(mix: Mix, state: VoiceState, requests: VoiceRequest[], now: number): VoiceState {
  mix.raw += requests.length;
  for (const r of requests) bump(mix.requested, r.id);

  const out = admit(requests, state, now);
  mix.played += out.kept.length;
  for (const k of out.kept) bump(mix.kept, k.id);

  const ringing = [...out.state.live.values()].reduce((n, times) => n + times.length, 0);
  mix.peak = Math.max(mix.peak, ringing);
  return out.state;
}

function report(label: string, mix: Mix, ticks: number): void {
  const seconds = ticks / 60;
  const over = mix.peak > GLOBAL_CAP ? '  <-- ABOVE THE GLOBAL CAP' : '';
  console.log(`\n=== ${label}  (${seconds.toFixed(1)}s) ===`);
  console.log(`requested     ${mix.raw}  (${(mix.raw / seconds).toFixed(1)}/s, worst second ${mix.worstRawSecond})`);
  console.log(`played        ${mix.played}  (${(mix.played / seconds).toFixed(1)}/s)`);
  console.log(`thinned to    ${((mix.played / mix.raw) * 100).toFixed(1)}%`);
  console.log(`peak overlap  ${mix.peak} voices ringing at once${over}`);

  const top = [...mix.requested.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length > 0) {
    console.log('per sound, played / requested:');
    for (const [id, n] of top) {
      console.log(`  ${id.padEnd(16)} ${String(mix.kept.get(id) ?? 0).padStart(5)} / ${n}`);
    }
  }
}

// --- the three battles ----------------------------------------------------------------------

const masterSeed = officialRecord.masterSeed;
const result = runEvent({ masterSeed, members: toEventMembers() });
const assembled = result.builds.map((build) => assemble(build));

console.log(`official seed ${masterSeed}`);

for (let index = 0; index < result.battles.length; index++) {
  const recorded = result.battles[index]!;
  const match = createMatch({
    ...DEFAULT_MATCH,
    arena: ARENA_VARIANTS[index]!,
    seed: recorded.seed,
    botCount: result.members.length,
    builds: assembled,
  });

  const mix = newMix();
  let state = emptyState();
  let rawThisSecond = 0;
  let tick = 0;

  while (!match.done) {
    advanceMatch(match);
    const requests = match.effects.map((effect) => ({
      id: soundFor(effect, result.builds),
      intensity: effect.intensity,
    }));
    rawThisSecond += requests.length;
    state = tally(mix, state, requests, tick * MS_PER_TICK);

    if (tick % 60 === 59) {
      mix.worstRawSecond = Math.max(mix.worstRawSecond, rawThisSecond);
      rawThisSecond = 0;
    }
    tick++;
  }

  report(`battle ${index + 1} — ${recorded.arenaName}`, mix, tick);
}

// --- the Forge board ------------------------------------------------------------------------
//
// Peg strikes are the densest events in the whole show by a wide margin, and unlike a battle
// they arrive in one continuous burst rather than in flurries.

{
  const run = createPlinkoRun({ ...DEFAULT_PLINKO, board: DEFAULT_BOARD, seed: masterSeed });
  const mix = newMix();
  let state = emptyState();
  let rawThisSecond = 0;
  let tick = 0;

  while (!run.done && tick < DEFAULT_PLINKO.maxTicks) {
    advance(run);
    const requests: VoiceRequest[] = run.effects.map((effect) => ({
      id: 'pegPing',
      intensity: effect.intensity,
    }));
    rawThisSecond += requests.length;
    state = tally(mix, state, requests, tick * MS_PER_TICK);

    if (tick % 60 === 59) {
      mix.worstRawSecond = Math.max(mix.worstRawSecond, rawThisSecond);
      rawThisSecond = 0;
    }
    tick++;
  }

  report('Forge board', mix, tick);
}
