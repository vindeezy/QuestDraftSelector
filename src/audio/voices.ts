import { VOICE_SECONDS, type SoundId } from './palette';
import { MAX_DECAY_S } from './synth';

/**
 * Mix discipline: what actually gets played out of what the simulation asked for.
 *
 * A ten-bot scrum produces several weapon hits and collisions every single frame. Played
 * literally that is hundreds of overlapping voices a second, which is not a loud fight — it
 * is white noise with no fight audible inside it. Two rules fix that, and both live here so
 * they are testable rather than tangled into the playback loop:
 *
 * 1. **Coalescing** — several of the same sound in one frame become one, at the loudest
 *    intensity. Four simultaneous hits are one hit that reads as heavy.
 * 2. **Caps** — at most N of any one sound may be ringing at once, so a sustained brawl is
 *    bounded by the mix rather than by the fight.
 *
 * Both are per SOUND, not per event. That is what makes them safe: capping metallicTicks
 * cannot silence an explosion, because they are different voices with different budgets.
 *
 * Pure and time-explicit. Nothing here touches an `AudioContext`, so the whole mix can be
 * measured in a test rather than argued about after listening once.
 */

export interface VoiceRequest {
  id: SoundId;
  intensity: number;
  /** -1 hard left, 1 hard right. */
  pan?: number;
  pitch?: number;
  delay?: number;
}

/**
 * When each still-ringing voice started, per sound.
 *
 * Web Audio cannot be asked "how many of these are playing", so it is modelled: a voice
 * occupies a slot from when it starts until its tail can no longer be sounding. Expired
 * entries are pruned on every call, so this stays bounded across a three-minute battle.
 */
export interface VoiceState {
  readonly live: ReadonlyMap<SoundId, readonly number[]>;
}

/**
 * How many of one sound may ring at once.
 *
 * Four, which is enough for a hit to feel layered and not enough to smear. This is the number
 * most likely to change at the sound lab's watch gate, which is exactly why it is one named
 * constant rather than a rule spread across the playback loop.
 */
export const DEFAULT_CAP = 4;

/**
 * How many voices may ring at once across ALL sounds.
 *
 * The spec asked only for per-sound caps. Measuring the real recorded event showed those are
 * not enough on their own: a battle uses about eight distinct sounds, so per-sound caps of
 * four bound the total at thirty-two, and the peak of a real scrum was 26-31 voices at once.
 * That is the mush this module exists to prevent, arrived at from the other direction.
 *
 * Twelve is busy but still legible — you can hear individual blows inside it. When the budget
 * is short the QUIETEST requests are dropped first, so a scrum loses glancing taps rather
 * than the heavy hit that caused it.
 */
export const GLOBAL_CAP = 12;

/** Per-sound overrides. Only sounds whose density differs from a weapon hit's need one. */
const CAPS: Partial<Record<SoundId, number>> = {
  // Peg strikes are the densest events in the show — ten balls across dozens of rows. The
  // note is a tenth as long as a hit, so more may overlap without turning to mush, and a
  // cascade needs to overlap a little to read as a run of notes rather than a metronome.
  pegPing: 6,
};

export function capFor(id: SoundId): number {
  return CAPS[id] ?? DEFAULT_CAP;
}

/**
 * Sounds that always play, however saturated the mix is.
 *
 * These are moments rather than textures. An elimination is the loudest thing that happens in
 * a battle and the whole room reacts to it; dropping one because the scrum that caused it had
 * already filled the budget would be exactly backwards. There are at most nine eliminations
 * in a battle, so exempting them costs nothing.
 */
export const EXEMPT: ReadonlySet<SoundId> = new Set<SoundId>(['explosion', 'mechanicalClunk']);

/**
 * How long a voice occupies a slot.
 *
 * Tied to the synthesis layer's own lengths rather than picked, so retuning a voice cannot
 * silently change how dense the mix is allowed to get.
 *
 * `MAX_DECAY_S` covers every voice built out of the standard intensity curves; the nine that
 * are sustained events rather than impacts declare their own length in `VOICE_SECONDS`, next
 * to the voices themselves where they cannot drift. Getting one wrong means the cap counts a
 * voice as finished while it is still audible, which is the failure that produces mush.
 */
export function lifetimeMs(id: SoundId): number {
  return (VOICE_SECONDS[id] ?? MAX_DECAY_S) * 1000;
}

export function emptyState(): VoiceState {
  return { live: new Map() };
}

/** Every start time for `id` that could still be ringing at `now`. */
function stillRinging(state: VoiceState, id: SoundId, now: number): number[] {
  const started = state.live.get(id);
  if (!started) return [];
  const cutoff = now - lifetimeMs(id);
  return started.filter((t) => t > cutoff);
}

/** Records a voice as having started, without asking whether it should have. Exported so a
 *  test can build a saturated mix directly; `admit` does this itself for what it keeps. */
export function remember(state: VoiceState, id: SoundId, now: number): VoiceState {
  const live = new Map(state.live);
  live.set(id, [...stillRinging(state, id, now), now]);
  return { live };
}

function intensityOf(request: VoiceRequest): number {
  return Number.isFinite(request.intensity) ? request.intensity : 0;
}

/**
 * Decides what one frame's worth of requests actually plays.
 *
 * Returns the next state alongside what was kept, rather than leaving the caller to record
 * the admissions separately. A caller that forgot that second call would see every frame
 * start from an empty mix, the caps would never engage, and the only symptom would be a
 * battle that sounds like static — a silent failure in the one place whose entire job is to
 * prevent that.
 */
export function admit(
  requests: readonly VoiceRequest[],
  state: VoiceState,
  now: number,
): { kept: VoiceRequest[]; state: VoiceState } {
  // Coalesce first, so a frame with forty hits costs one cap check rather than forty, and so
  // the request that survives is the loudest one WITH its own pan and pitch — the blow that
  // mattered, not whichever happened to be first in the array.
  const loudest = new Map<SoundId, VoiceRequest>();
  for (const request of requests) {
    const held = loudest.get(request.id);
    if (!held || intensityOf(request) > intensityOf(held)) {
      loudest.set(request.id, { ...request, intensity: intensityOf(request) });
    }
  }

  // Prune every sound up front, so the global count below is of voices that can actually
  // still be heard rather than of everything that ever played.
  const live = new Map<SoundId, number[]>();
  let ringingTotal = 0;
  for (const id of state.live.keys()) {
    const ringing = stillRinging(state, id, now);
    if (ringing.length > 0) {
      live.set(id, ringing);
      ringingTotal += ringing.length;
    }
  }

  // Loudest first, exempt sounds ahead of everything, so a frame that cannot fit keeps the
  // blows that carry information and drops the taps that carry none. Without this the survivors
  // would be whichever effects the simulation happened to push first.
  const candidates = [...loudest.values()].sort((a, b) => {
    const exempt = Number(EXEMPT.has(b.id)) - Number(EXEMPT.has(a.id));
    return exempt !== 0 ? exempt : intensityOf(b) - intensityOf(a);
  });

  const kept: VoiceRequest[] = [];
  for (const request of candidates) {
    const ringing = live.get(request.id) ?? [];
    if (!EXEMPT.has(request.id)) {
      if (ringing.length >= capFor(request.id)) continue;
      if (ringingTotal >= GLOBAL_CAP) continue;
    }
    kept.push(request);
    live.set(request.id, [...ringing, now]);
    ringingTotal++;
  }

  return { kept, state: { live } };
}
