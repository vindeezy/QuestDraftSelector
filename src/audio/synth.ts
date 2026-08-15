import type { AudioBus } from './context';

/**
 * Synthesis primitives. These know nothing about the game — no effects, no bots, no
 * hazards. `palette.ts` builds recognisable sounds out of them; `classify.ts` decides which
 * one an event deserves.
 *
 * Everything here is generated at runtime. No files ship, which means nothing to download,
 * nothing to fail on draft night, and a battle that works offline. It also means intensity
 * is a real parameter rather than a volume knob: the bus hands over 0-1, and the three
 * curves below turn that into pitch, length and loudness, so a glancing blow and a heavy
 * one are genuinely different sounds rather than the same recording played twice.
 *
 * `Math.random` is fine in this file. It is presentation, downstream of the effect bus, and
 * cannot reach the simulation — the lint guard makes sure of the reverse direction too.
 */

// --- the intensity curves ---------------------------------------------------------------

/** Shortest a hit can ring. Below this it stops reading as an impact and starts reading as
 *  a click. */
export const MIN_DECAY_S = 0.045;

/**
 * Longest a hit can ring.
 *
 * Deliberately short. Ten bots in a scrum land hits far faster than a quarter second apart,
 * and a longer tail means each impact smears into the next until the fight sounds like
 * static rather than like blows. Explosions are the exception and set their own length.
 */
export const MAX_DECAY_S = 0.22;

const MIN_GAIN = 0.18;
const MAX_GAIN = 1;

export function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

/**
 * Pitch for a given intensity, dropping as intensity rises: a heavy blow is a lower, fuller
 * sound than a glancing one, which is how impacts behave in the world.
 *
 * Bottoms out at 40% of the base rather than approaching zero — an oscillator at a few Hz
 * is not a low sound, it is silence with a click at each end.
 */
export function pitchFor(intensity: number, base: number): number {
  return base * (1 - 0.6 * clamp01(intensity));
}

/** How long the sound rings, between `MIN_DECAY_S` and `MAX_DECAY_S`. */
export function decayFor(intensity: number): number {
  return MIN_DECAY_S + (MAX_DECAY_S - MIN_DECAY_S) * clamp01(intensity);
}

/**
 * Loudness for a given intensity.
 *
 * Two deliberate choices. It never reaches zero, because a hit that dealt almost no damage
 * still happened and glancing blows are most of a battle — scaling straight from silence
 * would delete the majority of the combat. And it is curved rather than linear, because
 * perceived loudness is roughly logarithmic: a linear ramp makes everything short of a
 * heavy hit sound like nothing at all.
 */
export function gainFor(intensity: number): number {
  const t = clamp01(intensity);
  return MIN_GAIN + (MAX_GAIN - MIN_GAIN) * Math.sqrt(t);
}

// --- shared resources ---------------------------------------------------------------------

/**
 * One noise buffer per context, generated once and reused by every burst.
 *
 * Allocating a fresh buffer per hit would mean tens of thousands of short-lived
 * `AudioBuffer`s across a battle, and the garbage collector arriving mid-fight is exactly
 * the kind of hitch that ruins a frame.
 */
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();
const NOISE_SECONDS = 1;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const existing = noiseBuffers.get(ctx);
  if (existing) return existing;

  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** Where a voice connects: through its own panner so position is audible, into the master
 *  gain so mute and the limiter both apply. */
function output(bus: AudioBus, pan: number): AudioNode | null {
  const ctx = bus.ctx;
  const master = bus.masterGain;
  if (!ctx || !master) return null;
  if (!ctx.createStereoPanner) return master;

  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(master);
  return panner;
}

// --- primitives ---------------------------------------------------------------------------

export interface VoiceOptions {
  /** Seconds from now. 0 plays immediately. */
  delay?: number;
  /** -1 hard left, 1 hard right. */
  pan?: number;
  gain?: number;
}

export interface NoiseBurstOptions extends VoiceOptions {
  duration: number;
  type?: BiquadFilterType;
  frequency: number;
  /** Filter resonance. Higher is more metallic and more pitched. */
  q?: number;
  /** Sweep the filter to this frequency over the burst — how an explosion is made. */
  frequencyTo?: number;
}

/**
 * Filtered noise with an exponential fall to silence. This is every impact in the game:
 * clangs, thuds, grinds, explosions. What separates them is the filter and the length.
 */
export function noiseBurst(bus: AudioBus, options: NoiseBurstOptions): void {
  const ctx = bus.ctx;
  const target = output(bus, options.pan ?? 0);
  if (!ctx || !target) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  // A random window into the shared buffer, so repeated hits are not the same slice of
  // noise over and over — the thing that makes a sample library sound like a sample library.
  source.loop = true;
  source.loopStart = Math.random() * (NOISE_SECONDS * 0.5);
  source.loopEnd = NOISE_SECONDS;

  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'bandpass';
  filter.frequency.setValueAtTime(options.frequency, at);
  if (options.frequencyTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.frequencyTo), at + options.duration);
  }
  filter.Q.value = options.q ?? 1;

  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(0.0001, options.gain ?? 0.5), at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);

  source.connect(filter);
  filter.connect(env);
  env.connect(target);
  source.start(at);
  source.stop(at + options.duration + 0.02);
}

export interface ToneOptions extends VoiceOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
}

/** A plain oscillator with an envelope. Bodies, hums and the low half of a thud. */
export function tone(bus: AudioBus, options: ToneOptions): void {
  const ctx = bus.ctx;
  const target = output(bus, options.pan ?? 0);
  if (!ctx || !target) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.frequency, at);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.4), at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);

  osc.connect(env);
  env.connect(target);
  osc.start(at);
  osc.stop(at + options.duration + 0.02);
}

export interface SweepOptions extends VoiceOptions {
  from: number;
  to: number;
  duration: number;
  type?: OscillatorType;
}

/** An oscillator whose pitch slides. Down for booms and explosions, up for charges. */
export function sweep(bus: AudioBus, options: SweepOptions): void {
  const ctx = bus.ctx;
  const target = output(bus, options.pan ?? 0);
  if (!ctx || !target) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, options.from), at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), at + options.duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(0.0001, options.gain ?? 0.5), at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);

  osc.connect(env);
  env.connect(target);
  osc.start(at);
  osc.stop(at + options.duration + 0.02);
}

export interface ChimeOptions extends VoiceOptions {
  frequency: number;
  duration: number;
}

/** A soft triangle with a gentle attack — the only thing here that is not an impact. Repair,
 *  and anything the UI wants to say pleasantly. */
export function chime(bus: AudioBus, options: ChimeOptions): void {
  const ctx = bus.ctx;
  const target = output(bus, options.pan ?? 0);
  if (!ctx || !target) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(options.frequency, at);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.3), at + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);

  osc.connect(env);
  env.connect(target);
  osc.start(at);
  osc.stop(at + options.duration + 0.02);
}

// --- sustained textures --------------------------------------------------------------------

export interface GrindOptions extends VoiceOptions {
  duration: number;
  /** `'noise'` for filtered noise, or an oscillator type for a pitched rasp. */
  source?: 'noise' | OscillatorType;
  /** Noise: the band-pass centre. Oscillator: its pitch. */
  frequency: number;
  /** Slides there across the burst — loading up, or spinning free. */
  frequencyTo?: number;
  /** Noise only. Keep this LOW: a high Q on noise is a ringing bell, not a scrape. */
  q?: number;
  /**
   * Roll everything above this away.
   *
   * The difference between abrasive and painful. Human hearing peaks in sensitivity around
   * 2-5kHz, so a texture with unchecked energy up there reads as harsh and tiring however
   * quiet it is — and a raw sawtooth has harmonics running all the way up. Anything meant to
   * be heard hundreds of times across a battle needs a ceiling.
   */
  lowpass?: number;
  /**
   * Shape of the chop LFO. Triangle by default.
   *
   * A sawtooth LFO jumps instantaneously once per cycle, and a step in a gain envelope is a
   * click — a broadband spike of exactly the kind that makes a sound fatiguing. It buys a
   * harder-edged strike and costs grit, which is a bad trade for anything sustained.
   */
  chopShape?: OscillatorType;
  /** Seconds to full volume. Tiny for anything abrasive. */
  attack?: number;
  /** Seconds of fall at the end. */
  release?: number;
  /** Amplitude modulation rate. Below ~30Hz it is chatter; above it, a metallic rasp. */
  chopHz?: number;
  /** 0-1, how deep the chop cuts. */
  chopDepth?: number;
  /**
   * Irregular amplitude movement, in average events per second.
   *
   * Different from `chop`, and the difference is the point. A chop is one LFO: perfectly
   * periodic, which the ear hears as a machine. This schedules random gain breakpoints at
   * random intervals, so the texture folds and separates unevenly — the difference between a
   * motor and a thick liquid spreading.
   */
  wanderHz?: number;
  /** 0-1. How far the wander pulls the level down at its deepest. */
  wanderDepth?: number;
  /** Frequency wobble rate — something fighting resistance rather than running free. */
  wobbleHz?: number;
  /** 0-1, as a fraction of `frequency`. */
  wobbleDepth?: number;
}

/**
 * A sustained, abrasive texture: a source that holds at full volume for most of its length
 * instead of decaying from the first millisecond.
 *
 * Everything else in this file is an impact — struck, then fading. That envelope is why a
 * scraping, cutting or burning sound cannot be built from `noiseBurst`: those are events with
 * duration, and an exponential decay makes any of them read as a single hit no matter how the
 * filter is set. This holds a plateau instead, and adds the two modulations that separate a
 * machine from a hiss:
 *
 * - **chop** — amplitude modulation. Slow, it is teeth catching and skipping; fast, it is the
 *   metallic rasp of many teeth striking per second.
 * - **wobble** — frequency modulation. A blade under load does not hold a steady note, and a
 *   perfectly steady one sounds synthetic in a way listeners notice without being able to
 *   name.
 */
export function grind(bus: AudioBus, options: GrindOptions): void {
  const ctx = bus.ctx;
  const target = output(bus, options.pan ?? 0);
  if (!ctx || !target) return;

  const at = ctx.currentTime + (options.delay ?? 0);
  const duration = Math.max(0.02, options.duration);
  const end = at + duration;
  const kind = options.source ?? 'noise';
  const frequency = Math.max(20, options.frequency);

  // Everything that has to be started and stopped, collected so the two source shapes share
  // one lifecycle rather than each remembering to clean up after itself.
  const scheduled: Array<AudioScheduledSourceNode> = [];

  let head: AudioNode;
  let freqParam: AudioParam;

  if (kind === 'noise') {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;
    source.loopStart = Math.random() * (NOISE_SECONDS * 0.5);
    source.loopEnd = NOISE_SECONDS;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = options.q ?? 1;
    source.connect(filter);

    head = filter;
    freqParam = filter.frequency;
    scheduled.push(source);
  } else {
    const osc = ctx.createOscillator();
    osc.type = kind;
    head = osc;
    freqParam = osc.frequency;
    scheduled.push(osc);
  }

  freqParam.setValueAtTime(frequency, at);
  if (options.frequencyTo !== undefined) {
    freqParam.exponentialRampToValueAtTime(Math.max(20, options.frequencyTo), end);
  }

  if (options.wobbleHz && options.wobbleDepth) {
    const wobble = ctx.createOscillator();
    wobble.frequency.value = options.wobbleHz;
    const depth = ctx.createGain();
    depth.gain.value = frequency * clamp01(options.wobbleDepth);
    wobble.connect(depth);
    depth.connect(freqParam);
    scheduled.push(wobble);
  }

  let chain = head;
  if (options.chopHz && options.chopDepth) {
    // Standard amplitude modulation: the gain rests at 1 - depth and the LFO swings it up to
    // 1. Triangle by default -- see `chopShape`. A sawtooth reads as a harder strike and was
    // the first choice here, but its once-per-cycle jump is a click, and a click repeated
    // fifty times a second is grit.
    const amount = clamp01(options.chopDepth);
    const chop = ctx.createGain();
    chop.gain.value = 1 - amount;

    const lfo = ctx.createOscillator();
    lfo.type = options.chopShape ?? 'triangle';
    lfo.frequency.value = options.chopHz;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = amount;
    lfo.connect(lfoDepth);
    lfoDepth.connect(chop.gain);

    chain.connect(chop);
    chain = chop;
    scheduled.push(lfo);
  }

  if (options.lowpass !== undefined) {
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.max(200, options.lowpass);
    tone.Q.value = 0.7; // no resonant peak at the corner -- that would add the very edge this removes
    chain.connect(tone);
    chain = tone;
  }

  if (options.wanderHz && options.wanderDepth) {
    const depth = clamp01(options.wanderDepth);
    const wander = ctx.createGain();
    const period = 1 / Math.max(1, options.wanderHz);

    let t = at;
    wander.gain.setValueAtTime(1 - depth * Math.random(), t);
    // Both the spacing and the depth are random, so nothing about the pattern repeats. A
    // random depth on an even grid still reads as a pulse; it is the uneven spacing that
    // makes it liquid.
    while (t < end) {
      t += period * (0.45 + Math.random() * 1.1);
      wander.gain.linearRampToValueAtTime(1 - depth * Math.random(), Math.min(t, end));
    }

    chain.connect(wander);
    chain = wander;
  }

  const peak = Math.max(0.0001, options.gain ?? 0.5);
  const attack = Math.min(Math.max(options.attack ?? 0.004, 0.001), duration * 0.4);
  const release = Math.min(Math.max(options.release ?? 0.03, 0.001), duration - attack);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + attack);
  env.gain.setValueAtTime(peak, end - release);
  env.gain.exponentialRampToValueAtTime(0.0001, end);

  chain.connect(env);
  env.connect(target);

  for (const node of scheduled) {
    node.start(at);
    node.stop(end + 0.02);
  }
}
