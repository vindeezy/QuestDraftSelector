import { soundFor } from './classify';
import type { AudioBus } from './context';
import { playSound } from './palette';
import { admit, emptyState, type VoiceRequest, type VoiceState } from './voices';
import type { Effect } from '../sim/arena/effects';
import type { PlinkoEffect } from '../sim/plinko/plinko';
import type { BotBuild } from '../sim/parts/assemble';

/**
 * One frame of effects turned into one frame of sound.
 *
 * The join between four layers that have deliberately never met: `classify` decides what an
 * event should sound like, `voices` decides how much of it may actually play, `palette` makes
 * the noise, and the simulation supplies the events. Everything above stayed testable by
 * knowing nothing about the others; this is the only place that knows all four, and it is
 * kept small for exactly that reason.
 *
 * It carries the mixer state in and out rather than holding it in a module variable. A battle
 * and a Forge board must not share a voice budget — they never play at once, and a screen
 * that inherited the previous screen's ringing voices would start its first second already
 * capped.
 */

/** How many milliseconds one simulation tick represents. */
const MS_PER_TICK = 1000 / 60;

/**
 * The mixer's clock, taken from the SIMULATION rather than the wall.
 *
 * A battle steps a fixed number of ticks per rendered frame, so tick count is a monotonic
 * clock that advances at exactly the rate the sounds were designed against. Wall-clock time
 * would drift against it on a slow machine — the fight would slow down and the voice caps
 * would not, so a struggling laptop would also get a thinner mix.
 */
export function tickToMs(tick: number): number {
  return tick * MS_PER_TICK;
}

/** Event x across the arena mapped to -1..1, so a fight on the left is heard on the left. */
export function panFor(x: number, width: number): number {
  if (!Number.isFinite(x) || !(width > 0)) return 0;
  return Math.max(-1, Math.min(1, (x / width) * 2 - 1));
}

export interface FrameOptions {
  bus: AudioBus;
  /** This frame's effects, from `match.effects` accumulated across its ticks. */
  effects: readonly Effect[];
  /** Every member's build, so a weapon hit knows which weapon landed it. */
  builds: readonly BotBuild[];
  /** The mixer state from the previous frame. */
  state: VoiceState;
  /** `tickToMs(match.world.tick)`. */
  nowMs: number;
  /** Arena width in world units, for panning. */
  width: number;
}

/**
 * Plays one frame of a battle and returns the mixer state to pass to the next.
 *
 * Returning the state rather than mutating a hidden one is the same choice `admit` makes, for
 * the same reason: a caller that drops it gets a mix with no memory, the caps never engage,
 * and the only symptom is a battle that sounds like static.
 */
export function playFrame(options: FrameOptions): VoiceState {
  const { bus, effects, builds, state, nowMs, width } = options;
  if (effects.length === 0) return state;

  const requests: VoiceRequest[] = effects.map((effect) => ({
    id: soundFor(effect, builds),
    intensity: effect.intensity,
    pan: panFor(effect.x, width),
  }));

  const result = admit(requests, state, nowMs);
  for (const request of result.kept) playSound(bus, request.id, request);
  return result.state;
}

export interface PlinkoFrameOptions {
  bus: AudioBus;
  effects: readonly PlinkoEffect[];
  state: VoiceState;
  nowMs: number;
  /** Board width in world units, for pitch and pan. */
  width: number;
}

/**
 * Plays one frame of a Forge board.
 *
 * Separate from `playFrame` because a peg strike is not an `Effect` and carries no bot — it is
 * a different event type from a different simulation, and forcing them through one function
 * would mean inventing a fake bot id for every peg.
 *
 * The one thing that makes this more than a rattle: pitch follows the ball ACROSS the board,
 * so a cascade reads as a run of notes. It costs nothing over playing the same note every
 * time, and it is the only place in the show where the sound is allowed to be pretty.
 */
export function playPlinkoFrame(options: PlinkoFrameOptions): VoiceState {
  const { bus, effects, state, nowMs, width } = options;
  if (effects.length === 0) return state;

  const requests: VoiceRequest[] = effects.map((effect) => {
    const across = width > 0 ? Math.max(0, Math.min(1, effect.x / width)) : 0.5;
    return {
      id: 'pegPing',
      intensity: effect.intensity,
      pan: panFor(effect.x, width),
      pitch: across,
    };
  });

  const result = admit(requests, state, nowMs);
  for (const request of result.kept) playSound(bus, request.id, request);
  return result.state;
}

/** A fresh mixer state. Re-exported so a screen needs only this module. */
export { emptyState };
