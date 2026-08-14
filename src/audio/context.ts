/**
 * The audio bus: one `AudioContext`, one master gain, one limiter, and the mute switch.
 *
 * Everything the site plays goes through here. That is the point — a single gain node is
 * what makes mute actually mute, and a single limiter is what stops ten bots landing hits
 * in the same frame from clipping. A voice that connected straight to `destination` would
 * be immune to both.
 *
 * Nothing in this layer may be imported by `src/sim/` — the lint guard enforces it. The
 * effect bus flows one way, out of the simulation; sound is a reaction to the event, never
 * an input to it.
 */

/** How the bus obtains a context. Injected so tests can run without Web Audio, which jsdom
 *  does not provide, and so a browser that refuses to construct one degrades to silence. */
export type AudioContextFactory = () => AudioContext;

export interface AudioBus {
  /** True once a context exists and the graph is wired. */
  readonly ready: boolean;
  readonly ctx: AudioContext | null;
  /**
   * Where every voice connects. Null until `unlock`.
   *
   * Exposed rather than hidden behind a `play()` because the synth layer schedules its own
   * nodes and needs somewhere to send them; wrapping that would mean re-exporting most of
   * the Web Audio API through this module.
   */
  readonly masterGain: GainNode | null;
  readonly muted: boolean;
  readonly volume: number;
  /**
   * Creates and resumes the context. Idempotent, because the gesture that triggers it is a
   * button a viewer can press twice, and because both the Forge and the battles unlock on
   * their own start control.
   */
  unlock(): void;
  setMuted(muted: boolean): void;
  /** Clamped to 0..1. Remembered while muted, so unmuting restores it rather than jumping
   *  to full. */
  setVolume(volume: number): void;
  /** The context's clock, or 0 before unlock, so a caller never reads a null context. */
  now(): number;
}

export interface AudioBusOptions {
  factory?: AudioContextFactory;
}

/**
 * A limiter, not a compressor doing limiter-ish work: a high ratio and a low threshold with
 * a fast attack, so peaks are caught and nothing below the threshold is touched. It exists
 * for one specific moment — a scrum where several weapon hits, a collision and an
 * elimination all land within a few milliseconds.
 */
const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 };

/** The real thing, resolved lazily so importing this module in Node does not throw. */
function browserAudioContext(): AudioContext {
  const w = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available in this environment.');
  return new Ctor();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

export function createAudioBus(options: AudioBusOptions = {}): AudioBus {
  const factory = options.factory ?? browserAudioContext;

  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let muted = false;
  let volume = 1;

  const applyGain = (): void => {
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  };

  return {
    get ready() {
      return ctx !== null;
    },
    get ctx() {
      return ctx;
    },
    get masterGain() {
      return masterGain;
    },
    get muted() {
      return muted;
    },
    get volume() {
      return volume;
    },

    unlock() {
      if (ctx !== null) return;
      try {
        const created = factory();
        const gain = created.createGain();
        const limiter = created.createDynamicsCompressor();
        limiter.threshold.value = LIMITER.threshold;
        limiter.knee.value = LIMITER.knee;
        limiter.ratio.value = LIMITER.ratio;
        limiter.attack.value = LIMITER.attack;
        limiter.release.value = LIMITER.release;

        gain.connect(limiter);
        limiter.connect(created.destination);

        ctx = created;
        masterGain = gain;
        applyGain();

        // A context created before a user gesture starts suspended and makes no sound.
        // The rejection is swallowed for the same reason the whole call is guarded: sound
        // is decoration and must never take the walkthrough down with it.
        void created.resume?.()?.catch?.(() => {});
      } catch {
        // Some browsers refuse to construct a context at all. Leave the site silent.
        ctx = null;
        masterGain = null;
      }
    },

    setMuted(next: boolean) {
      muted = next;
      applyGain();
    },

    setVolume(next: number) {
      volume = clamp01(next);
      applyGain();
    },

    now() {
      return ctx?.currentTime ?? 0;
    },
  };
}
