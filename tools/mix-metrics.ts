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
import { EXEMPT, GLOBAL_CAP, admit, emptyState, type VoiceRequest, type VoiceState } from '../src/audio/voices';
import { PARTICLE_CAPACITY, burstCount, createParticleField } from '../src/render/vfx/particles';
// The shipped record, so this measures the fight the league will actually watch rather than
// whichever seed happened to be typed here.
import officialRecord from '../data/official-event.json';

const MS_PER_TICK = 1000 / 60;

/** Running totals for one screen's worth of sound. */
interface Mix {
  /** Most particles alive at once, if every effect threw a burst. */
  peakParticles: number;
  /** How many spawns the pool had to refuse a fresh slot for. */
  recycled: number;
  raw: number;
  played: number;
  /** Every voice ringing at once, exempt sounds included. */
  peak: number;
  /** Only the voices the global cap governs. */
  peakCapped: number;
  worstRawSecond: number;
  requested: Map<string, number>;
  kept: Map<string, number>;
}

function newMix(): Mix {
  return {
    raw: 0, played: 0, peak: 0, peakCapped: 0, worstRawSecond: 0, peakParticles: 0, recycled: 0,
    requested: new Map(), kept: new Map(),
  };
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

  // Counted WITHOUT the exempt sounds, because the global cap deliberately does not govern
  // them: an elimination always plays. Counting them here reported a cap breach that was not
  // one, which is worse than reporting nothing -- a metric that cries wolf gets ignored.
  let capped = 0;
  let ringing = 0;
  for (const [id, times] of out.state.live) {
    ringing += times.length;
    if (!EXEMPT.has(id)) capped += times.length;
  }
  mix.peak = Math.max(mix.peak, ringing);
  mix.peakCapped = Math.max(mix.peakCapped, capped);
  return out.state;
}

function report(label: string, mix: Mix, ticks: number): void {
  const seconds = ticks / 60;
  const over = mix.peakCapped > GLOBAL_CAP ? '  <-- ABOVE THE GLOBAL CAP' : '';
  console.log(`\n=== ${label}  (${seconds.toFixed(1)}s) ===`);
  console.log(`requested     ${mix.raw}  (${(mix.raw / seconds).toFixed(1)}/s, worst second ${mix.worstRawSecond})`);
  console.log(`played        ${mix.played}  (${(mix.played / seconds).toFixed(1)}/s)`);
  console.log(`thinned to    ${((mix.played / mix.raw) * 100).toFixed(1)}%`);
  console.log(
    `peak overlap  ${mix.peak} voices ringing at once ` +
    `(${mix.peakCapped} of them capped, limit ${GLOBAL_CAP})${over}`,
  );
  const full = mix.recycled > 0 ? `  <-- pool ran out ${mix.recycled} times` : '';
  console.log(
    `peak particles ${mix.peakParticles} alive at once of ${PARTICLE_CAPACITY}` +
    ` (${Math.round((100 * mix.peakParticles) / PARTICLE_CAPACITY)}% of the pool)${full}`,
  );

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

  // Every effect throws a burst, which is the worst case FX 2 could possibly ask for -- it
  // will send some events to the cheaper puff and ring instead. Sizing against the ceiling
  // means the pool cannot be the thing that breaks when the mapping changes.
  const particles = createParticleField();

  while (!match.done) {
    advanceMatch(match);
    const requests = match.effects.map((effect) => ({
      id: soundFor(effect, result.builds),
      intensity: effect.intensity,
    }));
    rawThisSecond += requests.length;
    state = tally(mix, state, requests, tick * MS_PER_TICK);

    for (const effect of match.effects) {
      const wanted = burstCount(effect.intensity);
      const free = particles.particles.filter((p) => !p.active).length;
      if (wanted > free) mix.recycled++;
      particles.burst({ x: effect.x, y: effect.y, intensity: effect.intensity, tint: 0xffffff });
    }
    particles.advance(MS_PER_TICK / 1000);
    mix.peakParticles = Math.max(
      mix.peakParticles,
      particles.particles.reduce((n, p) => n + (p.active ? 1 : 0), 0),
    );

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
