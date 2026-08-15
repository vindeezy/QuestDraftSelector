import { createAudioBus, type AudioBus, type AudioContextFactory } from '../audio/context';

/**
 * The event's one and only audio bus.
 *
 * Browsers refuse to run Web Audio until a context has been created or resumed from inside a
 * user gesture, and the landing screen's BEGIN button is the one click guaranteed to happen
 * before anything makes a noise. So it is unlocked there, several screens before the Forge or
 * a battle needs it.
 *
 * This module used to own a second, separate `AudioContext` of its own — created here for the
 * gesture, while `src/audio/context.ts` built another one for the sounds. Two contexts means
 * two independent output graphs: the master volume and mute on one would not touch the other,
 * and only one of them would have been unlocked by the gesture. The bug had not bitten yet
 * only because nothing was wired up to make noise. It is one bus now.
 *
 * A module-level singleton rather than something passed down through the router because the
 * gesture happens on beat 1 and the sound happens on beats 4 and 6, and threading a bus
 * through every screen in between would put an audio parameter on screens that make no sound.
 */

let shared: AudioBus | null = null;
let factory: AudioContextFactory | undefined;

/** The shared bus, created on first use. Silent until `unlock()` is called on it. */
export function sharedAudioBus(): AudioBus {
  shared ??= createAudioBus(factory ? { factory } : {});
  return shared;
}

/**
 * Creates and resumes the context, if this browser has one.
 *
 * Must be called synchronously from inside a gesture handler — browsers only honour the
 * gesture if the context is created or resumed within the same task the click ran in, so a
 * `setTimeout` or a `.then()` around this defeats the entire point of calling it here.
 *
 * Never throws. A browser that refuses audio still lets the member watch the whole event; they
 * just do not hear it.
 */
export function ensureAudioResumed(): AudioBus {
  const bus = sharedAudioBus();
  bus.unlock();
  return bus;
}

/** Test seam: drops the singleton and, optionally, supplies a fake context factory. */
export function __resetAudioBusForTests(next?: AudioContextFactory): void {
  shared = null;
  factory = next;
}
