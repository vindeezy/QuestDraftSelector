import type { AudioBus } from './context';
import { chime, clamp01, decayFor, gainFor, grind, noiseBurst, pitchFor, sweep, tone } from './synth';

/**
 * The palette: every sound the site can make, named for WHAT IT IS rather than for what
 * triggers it.
 *
 * That naming is deliberate. `classify.ts` owns the mapping from a simulation event to a
 * sound, and keeping the two apart means the question "what should a Saw Blade sound like"
 * is answered in one file and "which sound does a Saw Blade get" in another. It also lets
 * the sound lab enumerate and audition sounds without knowing a thing about the event bus.
 *
 * Nothing here knows about bots, hazards or effects.
 */

export interface PlayOptions {
  /** 0-1 from the effect bus. Drives pitch, length and loudness — see `synth.ts`. */
  intensity?: number;
  /** -1 hard left, 1 hard right. Usually the event's x across the arena. */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /**
   * 0-1, low to high, for the few sounds that are pitched rather than percussive.
   *
   * Only `pegPing` reads it today, so the Forge can map a ball's position on the board to a
   * note and make a drop sound like a cascade rather than a rattle.
   */
  pitch?: number;
  /**
   * Per-voice level correction, applied by `playSound`. Not for callers to set.
   *
   * See `VOICE_TRIM`: a `gain` of 0.5 means wildly different things through different
   * primitives, so the numbers inside each voice describe the BALANCE BETWEEN ITS LAYERS and
   * this describes how loud the finished voice sits against the rest of the palette.
   */
  trim?: number;
}

export type Voice = (bus: AudioBus, options?: PlayOptions) => void;

const opt = (o?: PlayOptions) => {
  const intensity = o?.intensity ?? 1;
  return {
    intensity,
    pan: o?.pan ?? 0,
    delay: o?.delay ?? 0,
    pitch: o?.pitch ?? 0.5,
    /** What every layer in a voice scales by: the intensity curve times the voice's trim. */
    level: gainFor(intensity) * (o?.trim ?? 1),
  };
};

// --- weapons -----------------------------------------------------------------------------

/** The default landed blow, and the fallback for any weapon without its own voice: a short,
 *  bright metallic tick. This is the most frequent sound in the game by a wide margin, so it
 *  is the one most carefully kept short. */
const metallicTick: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity),
    frequency: pitchFor(intensity, 2800),
    q: 7,
    gain: level * 0.5,
    pan,
    delay,
  });
};

/** Hammer. A lower, heavier version of the tick with a body under it, so a hammer blow
 *  lands rather than pings. */
const heavyClang: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity) * 1.5,
    frequency: pitchFor(intensity, 1100),
    q: 4,
    gain: level * 0.55,
    pan,
    delay,
  });
  tone(bus, {
    frequency: pitchFor(intensity, 150),
    duration: decayFor(intensity) * 2,
    gain: level * 0.35,
    pan,
    delay,
  });
};

/**
 * A saw blade, described by its size.
 *
 * The Saw Blade weapon and the arena's saw hazard are the same event -- a powered blade biting
 * metal -- at two very different scales, so they are built by one function from two of these
 * rather than written twice. A change to how a saw sounds lands on both, which is the point:
 * they should always be recognisably the same machine, one of them much larger.
 *
 * Every frequency in the hazard blade is roughly 40% of the weapon's, a little over an octave
 * down, which is what reads as "bigger" rather than merely "lower".
 */
interface SawBlade {
  minSeconds: number;
  maxSeconds: number;
  /** Tooth rate at a graze. A heavy bite drags it down -- see `pitchFor`. */
  toothHz: number;
  /** Rotation, heard as chatter. A bigger blade turns slower and chatters more slowly. */
  spinHz: number;
  /** The noise layer that carries the cutting, and its ceiling. */
  cutHz: number;
  cutCeiling: number;
  /** Ceiling on the tooth buzz, kept just above its own fundamental. */
  teethCeiling: number;
  /** Mechanical weight underneath. */
  rumbleHz: number;
  rumbleCeiling: number;
  /** How much of the sound is weight. A larger blade is felt more and heard less. */
  rumbleGain: number;
  /** The initial bite as the teeth find metal. */
  biteHz: number;
}

/** Bolted to a bot: fast, light, and gone in a quarter second. */
const WEAPON_BLADE: SawBlade = {
  minSeconds: 0.1,
  maxSeconds: 0.25,
  toothHz: 780,
  spinHz: 44,
  cutHz: 900,
  cutCeiling: 2000,
  teethCeiling: 1500,
  rumbleHz: 96,
  rumbleCeiling: 340,
  rumbleGain: 0.05,
  biteHz: 1500,
};

/**
 * Set into the arena floor: much larger, slower, heavier, and in contact for longer.
 *
 * The longer contact is not decoration. A weapon saw strikes and withdraws, while a floor saw
 * is fixed and the bot is dragged across it -- so the hazard should sound like something you
 * are stuck against rather than something that hit you.
 */
const HAZARD_BLADE: SawBlade = {
  minSeconds: 0.18,
  maxSeconds: 0.4,
  toothHz: 330,
  spinHz: 17,
  cutHz: 430,
  cutCeiling: 1050,
  teethCeiling: 760,
  rumbleHz: 48,
  rumbleCeiling: 190,
  rumbleGain: 0.14,
  biteHz: 800,
};

export const SAW_BUZZ_MIN_SECONDS = WEAPON_BLADE.minSeconds;
export const SAW_BUZZ_MAX_SECONDS = WEAPON_BLADE.maxSeconds;
export const SAW_GRIND_MAX_SECONDS = HAZARD_BLADE.maxSeconds;

/**
 * A blade biting metal. The one weapon that must not sound like a hit -- and must not hurt to
 * hear.
 *
 *     spinning blade -> teeth bite -> controlled grind and chatter -> blade releases
 *
 * Getting here took four attempts and the failures are the useful part of this comment.
 *
 * The first version was one noise burst at Q 18. A filter that narrow rings at its centre
 * frequency, so it was a struck bell wearing a saw's name.
 *
 * The second had the right structure and was painful. The texture sat at 1450Hz with a raw
 * sawtooth over it, right in the 2-5kHz band hearing is most sensitive to, and the chop LFO
 * was a sawtooth whose once-per-cycle jump is a click, fifty times a second.
 *
 * The third was still painful, and the reason was not brightness at all: the voice peaked
 * 25dB above a normal weapon hit, hard enough into the master limiter that every hit came
 * back with limiter distortion on it. No amount of softening the synthesis could fix grit
 * that was being added downstream of it. See `VOICE_TRIM` -- that turned out to be a
 * palette-wide bug, not a saw bug.
 *
 * So the rules this version follows:
 *
 * - **Everything lives low.** Character comes from modulation, not brightness.
 * - **No resonant peaks anywhere.** Every Q is at or below 1, and the bite uses a lowpass
 *   rather than a bandpass so it has no peak at all.
 * - **Layer gains are balance ratios, not volumes.** A sawtooth is ~17x louder than
 *   band-passed noise at the same `gain`, so these numbers only mean anything relative to the
 *   primitive they are passed to. Absolute loudness is `VOICE_TRIM`'s job.
 * - **One rotation rate, shared by every sustained layer**, which is what makes the blade
 *   audibly keep spinning instead of sounding like three unrelated noises stacked up.
 */
function sawContact(bus: AudioBus, o: PlayOptions | undefined, blade: SawBlade): void {
  const { intensity, pan, delay, level } = opt(o);
  const bite = clamp01(intensity);
  const duration = blade.minSeconds + (blade.maxSeconds - blade.minSeconds) * bite;

  const toothHz = pitchFor(intensity, blade.toothHz);
  const CATCH = 0.03;
  const body = duration - CATCH * 0.5;
  const bodyDelay = delay + CATCH * 0.5;

  // 1. The bite. A low-mid crunch, not a skreech. `lowpass` rather than the usual bandpass so
  //    there is no resonant peak at all -- a peak here is the piercing ring to avoid.
  noiseBurst(bus, {
    duration: CATCH,
    type: 'lowpass',
    frequency: blade.biteHz,
    frequencyTo: blade.biteHz * 0.55,
    q: 0.5,
    gain: level * 0.3,
    pan,
    delay,
  });

  // 2. The rumble. Its gain looks tiny beside the others because a sawtooth is roughly
  //    seventeen times louder than band-passed noise at the same `gain`.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'sawtooth',
    frequency: blade.rumbleHz,
    lowpass: blade.rumbleCeiling,
    attack: 0.014,
    release: 0.05,
    chopHz: blade.spinHz,
    chopDepth: 0.16,
    gain: level * blade.rumbleGain,
    pan,
  });

  // 3. The cut. The main texture. Noise this low reads as crunch; the same noise an octave up
  //    reads as a hiss however hard it is capped.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'noise',
    frequency: blade.cutHz,
    frequencyTo: blade.cutHz * 0.8,
    q: 0.8,
    lowpass: blade.cutCeiling,
    attack: 0.014,
    release: 0.05,
    chopHz: blade.spinHz,
    chopDepth: 0.3,
    wobbleHz: blade.spinHz * 0.6,
    wobbleDepth: 0.14,
    gain: level * 0.3,
    pan,
  });

  // 4. The teeth. The wobble is them biting, dragging and releasing; the downward slide is the
  //    blade loading up against the armour.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'sawtooth',
    frequency: toothHz,
    frequencyTo: toothHz * 0.88,
    lowpass: blade.teethCeiling,
    attack: 0.018,
    release: 0.055,
    chopHz: blade.spinHz,
    chopDepth: 0.22,
    wobbleHz: blade.spinHz * 0.43,
    wobbleDepth: 0.07,
    gain: level * 0.09,
    pan,
  });

  // 5. Release. The blade unloads and its pitch lifts. A triangle carries almost no harmonics,
  //    so the sound ends without one last bright edge on the way out.
  const FREE = 0.05;
  sweep(bus, {
    from: toothHz * 0.92,
    to: toothHz * 1.35,
    duration: FREE,
    type: 'triangle',
    gain: level * 0.04,
    pan,
    delay: delay + Math.max(0, duration - FREE),
  });
}

/** Saw Blade, the weapon. */
const sawBuzz: Voice = (bus, o) => sawContact(bus, o, WEAPON_BLADE);

/** Spinning Bar. A whine that falls as the bar sheds energy into the target. */
const spinnerWhine: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  sweep(bus, {
    from: pitchFor(intensity, 1500),
    to: pitchFor(intensity, 520),
    duration: decayFor(intensity) * 1.3,
    type: 'sawtooth',
    gain: level * 0.22,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: decayFor(intensity),
    frequency: pitchFor(intensity, 2400),
    q: 5,
    gain: level * 0.3,
    pan,
    delay,
  });
};

/** Vertical Spinner. Same family as the bar but higher and thinner, so the two are
 *  distinguishable without being unrelated — they are both spinning metal. */
const discWhirr: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  sweep(bus, {
    from: pitchFor(intensity, 2600),
    to: pitchFor(intensity, 1100),
    duration: decayFor(intensity),
    type: 'square',
    gain: level * 0.16,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: decayFor(intensity) * 0.8,
    frequency: pitchFor(intensity, 3400),
    q: 9,
    gain: level * 0.3,
    pan,
    delay,
  });
};

/**
 * A jet of flame, described by its size.
 *
 * The Flamethrower weapon and the arena's flame hazard are one event at two scales, built by
 * one function from two of these, the same way the saws are. It keeps them recognisably the
 * same fire and stops them drifting apart.
 *
 * Every frequency in the hazard jet is about half the weapon's -- an octave down -- which is
 * what reads as a bigger fire rather than merely a lower one.
 */
interface FlameJet {
  minSeconds: number;
  maxSeconds: number;
  /** Where the airy body starts, and where it opens to as the flame flows outward. */
  bodyHz: number;
  bodyToHz: number;
  /**
   * Ceiling on the body.
   *
   * The single most important number here. Filtered noise is a whoosh below roughly 1.5kHz
   * and a gas hiss above it, and the difference between the two is entirely this.
   */
  bodyCeiling: number;
  /** Warmth underneath: enough to feel like heat, not enough to boom. */
  warmthHz: number;
  warmthCeiling: number;
  warmthGain: number;
  /** How fast the flame billows. Slow — this is flowing, not flickering. */
  billowHz: number;
  /** Crackle: where the pops sit, how far they scatter, and how loud. */
  crackleHz: number;
  crackleSpread: number;
  crackleGain: number;
  /** The soft catch of ignition. Never a burst. */
  ignitionHz: number;
}

/** Bolted to a bot: a short controlled burst. */
const WEAPON_JET: FlameJet = {
  minSeconds: 0.3,
  maxSeconds: 0.5,
  bodyHz: 340,
  bodyToHz: 520,
  bodyCeiling: 1500,
  warmthHz: 165,
  warmthCeiling: 420,
  warmthGain: 0.05,
  billowHz: 8.5,
  crackleHz: 900,
  crackleSpread: 700,
  crackleGain: 0.12,
  ignitionHz: 700,
};

/** Set into the arena: a much larger fire, slower and longer. */
const HAZARD_JET: FlameJet = {
  minSeconds: 0.45,
  maxSeconds: 0.85,
  bodyHz: 175,
  bodyToHz: 265,
  bodyCeiling: 780,
  warmthHz: 88,
  warmthCeiling: 230,
  warmthGain: 0.11,
  billowHz: 5,
  crackleHz: 470,
  crackleSpread: 350,
  crackleGain: 0.14,
  ignitionHz: 370,
};

/**
 * Flame. The one sound in the palette that is meant to be pleasant.
 *
 *     soft ignition -> warm airy whoosh -> crackle and pop -> gentle fade
 *
 * Everything else here is an impact or an abrasion; a flame jet is a continuous, flowing
 * thing, and it fires often enough that being merely correct is not good enough. It has to be
 * nice to hear a hundred times.
 *
 * That rules out most of how fire is usually synthesised. The obvious approach — bright noise
 * sweeping upward — is a gas hiss, and it is what both flame voices were before this: the
 * hazard swept 1500Hz to 2600Hz, straight through the band that makes a sound tiring. Warmth
 * is not a quiet hiss. It is a fire built an octave and a half lower than instinct suggests.
 *
 * Four layers:
 *
 * 1. **Ignition** — a soft catch, with a 30ms attack rather than an instant one. The
 *    difference between a flame taking hold and a small explosion is entirely in the attack.
 * 2. **The body** — broad, low noise that opens outward as the flame flows, billowing slowly
 *    rather than flickering. Q below 1 so it is airy rather than pitched, and capped well
 *    below the hiss band.
 * 3. **Warmth** — a triangle underneath. Triangle rather than sawtooth because it carries
 *    almost no harmonics: this layer is heat, and it must not turn into a drone or a boom.
 * 4. **Crackle** — a handful of small soft pops at genuinely random times, low and quiet
 *    enough to read as texture. Regular spacing would sound like a machine; loud ones would
 *    be the "aggressive crackling" this is meant to avoid.
 *
 * The fade is the body's release, which runs a third of the sound's length, so it thins out
 * rather than stopping.
 */
function flameJet(bus: AudioBus, o: PlayOptions | undefined, jet: FlameJet): void {
  const { intensity, pan, delay, level } = opt(o);
  const heat = clamp01(intensity);
  const duration = jet.minSeconds + (jet.maxSeconds - jet.minSeconds) * heat;

  const IGNITION = 0.09;

  // 1. Ignition. A catch, not a bang -- the slow attack is the whole difference.
  grind(bus, {
    duration: IGNITION,
    delay,
    source: 'noise',
    frequency: jet.ignitionHz,
    frequencyTo: jet.ignitionHz * 0.6,
    q: 0.7,
    lowpass: jet.bodyCeiling,
    attack: 0.03,
    release: 0.04,
    gain: level * 0.16,
    pan,
  });

  // 2. The body. The whoosh itself, opening outward as the flame flows.
  grind(bus, {
    duration,
    delay,
    source: 'noise',
    frequency: jet.bodyHz,
    frequencyTo: jet.bodyToHz,
    q: 0.7,
    lowpass: jet.bodyCeiling,
    attack: 0.05,
    release: duration * 0.34,
    // Gentle and slow. A deep chop would pulse; this is a fire breathing.
    chopHz: jet.billowHz * 0.7,
    chopDepth: 0.1,
    wobbleHz: jet.billowHz,
    wobbleDepth: 0.25,
    gain: level * 0.34,
    pan,
  });

  // 3. Warmth.
  grind(bus, {
    duration,
    delay,
    source: 'triangle',
    frequency: jet.warmthHz,
    lowpass: jet.warmthCeiling,
    attack: 0.07,
    release: duration * 0.4,
    chopHz: jet.billowHz,
    chopDepth: 0.14,
    gain: level * jet.warmthGain,
    pan,
  });

  // 4. Crackle.
  const pops = 4 + Math.round(heat * 6);
  const window = duration - IGNITION * 0.5;
  for (let n = 0; n < pops && window > 0; n++) {
    noiseBurst(bus, {
      duration: 0.014 + Math.random() * 0.012,
      frequency: jet.crackleHz + (Math.random() - 0.5) * jet.crackleSpread,
      q: 2.5,
      gain: level * jet.crackleGain * (0.5 + Math.random() * 0.5),
      pan,
      delay: delay + IGNITION * 0.5 + Math.random() * window,
    });
  }
}

export const FLAME_WHOOSH_MAX_SECONDS = WEAPON_JET.maxSeconds;
export const FLAME_BILLOW_MAX_SECONDS = HAZARD_JET.maxSeconds;

/** Flamethrower, the weapon. */
const flameWhoosh: Voice = (bus, o) => flameJet(bus, o, WEAPON_JET);

/** Ram Plate. A flat shove: all body, no ring. */
const bluntImpact: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity),
    type: 'lowpass',
    frequency: pitchFor(intensity, 700),
    q: 1,
    gain: level * 0.5,
    pan,
    delay,
  });
  tone(bus, {
    frequency: pitchFor(intensity, 110),
    duration: decayFor(intensity) * 1.5,
    gain: level * 0.3,
    pan,
    delay,
  });
};

// --- general events -----------------------------------------------------------------------

/** Bots bumping. Kept quiet and very short on purpose: this fires constantly in a scrum and
 *  its job is to sit underneath everything else, not to be noticed. */
const dullThud: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  tone(bus, {
    frequency: pitchFor(intensity, 130),
    duration: 0.07,
    gain: level * 0.18,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: 0.045,
    type: 'lowpass',
    frequency: 420,
    gain: level * 0.14,
    pan,
    delay,
  });
};

/** A bot dies. The loudest thing in the mix, and the only voice allowed to run long — a
 *  lowpass falling from bright to rubble is what an explosion is. */
const explosion: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: 0.75,
    type: 'lowpass',
    frequency: 1600,
    frequencyTo: 70,
    q: 0.8,
    gain: level * 0.85,
    pan,
    delay,
  });
  sweep(bus, { from: 180, to: 35, duration: 0.6, gain: level * 0.5, pan, delay });
};

/** A cannon firing. Distinct from an elimination so the room can tell "a hazard went off"
 *  from "somebody just died" without looking. */
const deepBoom: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  sweep(bus, { from: 240, to: 55, duration: 0.35, gain: level * 0.55, pan, delay });
  noiseBurst(bus, {
    duration: 0.18,
    type: 'lowpass',
    frequency: 900,
    frequencyTo: 200,
    gain: level * 0.4,
    pan,
    delay,
  });
};

/** A cannonball landing on a bot — the other half of `deepBoom`, heard from the receiving
 *  end. Sharper and shorter than the muzzle. */
const shellImpact: Voice = (bus, o) => {
  const { intensity, pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity) * 1.6,
    type: 'lowpass',
    frequency: pitchFor(intensity, 1300),
    frequencyTo: 180,
    gain: level * 0.6,
    pan,
    delay,
  });
  tone(bus, { frequency: 95, duration: 0.16, gain: level * 0.35, pan, delay });
};

/** A trapdoor opening. Two knocks and a rumble, because a floor giving way is a mechanism
 *  followed by a hole. */
const mechanicalClunk: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, { duration: 0.05, frequency: 1400, q: 3, gain: level * 0.4, pan, delay });
  noiseBurst(bus, { duration: 0.09, frequency: 700, q: 3, gain: level * 0.45, pan, delay: delay + 0.07 });
  sweep(bus, { from: 120, to: 45, duration: 0.4, gain: level * 0.3, pan, delay: delay + 0.07 });
};

// --- abilities ----------------------------------------------------------------------------

/** EMP Pulse. */
const electricZap: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  sweep(bus, { from: 2400, to: 320, duration: 0.22, type: 'sawtooth', gain: level * 0.3, pan, delay });
  noiseBurst(bus, { duration: 0.2, type: 'highpass', frequency: 2600, q: 2, gain: level * 0.3, pan, delay });
};

/** Nitro Boost. */
const nitroWhoosh: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: 0.42,
    type: 'bandpass',
    frequency: 500,
    frequencyTo: 2600,
    q: 1.2,
    gain: level * 0.36,
    pan,
    delay,
  });
};

/** Oil Slick. Wet and flat — the ice patch it leaves is visible, so the sound only has to
 *  say "something was dropped". */
const oilSplat: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: 0.16,
    type: 'lowpass',
    frequency: 900,
    frequencyTo: 260,
    gain: level * 0.35,
    pan,
    delay,
  });
};

/** Shockwave. A push outward, so it swells before it falls rather than starting at its
 *  loudest like the cannon does. */
const shockwaveBoom: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  sweep(bus, { from: 70, to: 190, duration: 0.12, gain: level * 0.45, pan, delay });
  sweep(bus, { from: 190, to: 48, duration: 0.45, gain: level * 0.5, pan, delay: delay + 0.1 });
  noiseBurst(bus, { duration: 0.3, type: 'lowpass', frequency: 1400, frequencyTo: 200, gain: level * 0.3, pan, delay });
};

/** Repair System. The one genuinely pleasant sound in the game — two rising notes. */
const repairChime: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  chime(bus, { frequency: 660, duration: 0.3, gain: level * 0.22, pan, delay });
  chime(bus, { frequency: 880, duration: 0.35, gain: level * 0.2, pan, delay: delay + 0.09 });
};

/** Adrenaline. A rising tone under the bot, for the moment it gets faster. */
const adrenalineRise: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  sweep(bus, { from: 260, to: 900, duration: 0.4, type: 'triangle', gain: level * 0.28, pan, delay });
};

/** Smoke Screen. Breathy and untargetable-sounding; deliberately the quietest ability. */
const smokeHiss: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: 0.5,
    type: 'highpass',
    frequency: 1800,
    frequencyTo: 3600,
    q: 0.6,
    gain: level * 0.24,
    pan,
    delay,
  });
};

// --- hazards -------------------------------------------------------------------------------

/**
 * Standing in the arena's flame jet: the same fire as the weapon, much larger.
 *
 * Named for what it is rather than what it was. It used to be `flameBillow`, and it used to
 * sweep 1500Hz to 2600Hz -- a name and a sound that agreed with each other and were both
 * wrong. Leaving the name would have quietly invited the hiss back the next time anyone
 * touched it.
 */
const flameBillow: Voice = (bus, o) => flameJet(bus, o, HAZARD_JET);

/**
 * The arena's saw hazard: the same blade as the weapon, much larger.
 *
 * Built from `HAZARD_BLADE` rather than written separately, so the two can never drift into
 * sounding like different machines. It was previously a single noise burst at Q 22 -- the same
 * struck-bell mistake the weapon started as, and at a peak of 0.003 it was inaudible anyway.
 */
const sawGrind: Voice = (bus, o) => sawContact(bus, o, HAZARD_BLADE);

/** The crusher. The heaviest single impact in the game. */
const crusherSlam: Voice = (bus, o) => {
  const { pan, delay, level } = opt(o);
  noiseBurst(bus, {
    duration: 0.3,
    type: 'lowpass',
    frequency: 800,
    frequencyTo: 90,
    gain: level * 0.7,
    pan,
    delay,
  });
  tone(bus, { frequency: 70, duration: 0.3, gain: level * 0.45, pan, delay });
};

// --- the Forge -----------------------------------------------------------------------------

/**
 * A ball striking a peg.
 *
 * The one place the sound design gets to be musical: `pitch` is mapped by the caller to the
 * ball's position on the board, so ten balls falling read as a run of notes rather than a
 * rattle. Snapped to a pentatonic scale, because a continuous pitch sweep across a hundred
 * strikes sounds like a theremin falling downstairs, and a pentatonic cannot land on a
 * dissonant interval by accident.
 */
const PENTATONIC = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66, 1396.91];

/**
 * How long a peg note rings.
 *
 * Exported because `voices.ts` sizes the peg cap from it. Peg strikes are by far the densest
 * events in the show, so the note length and how many may overlap are one decision, and
 * writing the number down twice is how they drift apart.
 */
export const PEG_PING_SECONDS = 0.09;

const pegPing: Voice = (bus, o) => {
  const { pan, delay, pitch, level } = opt(o);
  const step = Math.min(PENTATONIC.length - 1, Math.max(0, Math.round(pitch * (PENTATONIC.length - 1))));
  tone(bus, {
    frequency: PENTATONIC[step]!,
    duration: PEG_PING_SECONDS,
    type: 'triangle',
    // Quiet. Ten balls across dozens of peg rows is a lot of events, and the cascade should
    // sit under the room rather than over it.
    gain: level * 0.06 + level * 0.09,
    pan,
    delay,
  });
};

// --- levels ----------------------------------------------------------------------------------

/**
 * How loud each voice sits against the others. MEASURED, not chosen.
 *
 * This table exists because of a bug that survived three rounds of tuning. A `gain` of 0.5
 * produces a peak of 0.027 through a band-passed noise burst and 0.471 through a sawtooth —
 * seventeen times louder for the same number. Every voice above is built from a different mix
 * of primitives, so the gains inside them were never comparable, and tuning them against each
 * other by eye was tuning against nothing.
 *
 * What that produced: a palette spanning 46dB, with `metallicTick` — the most frequent sound
 * in the entire show — near the BOTTOM, and the Saw Blade 25dB above it. The saw was reported
 * as harsh three times running. It was not mainly too bright; it was enormously too loud, and
 * loud enough to drive the master limiter into distortion on every hit, which added grit
 * downstream of any softening done to the synthesis itself.
 *
 * So the numbers inside each voice describe THE BALANCE BETWEEN ITS OWN LAYERS, and these
 * describe how loud the finished voice sits in the show. The two questions are separate and
 * were previously tangled.
 *
 * Derived by rendering every voice at intensity 1 through an `OfflineAudioContext` and
 * dividing a target peak by the measured one. Targets are relative to a weapon hit at 0.12:
 * eliminations above it, abilities and textures below, and the two most frequent sounds of all
 * — collision thuds and peg strikes — lowest, because anything heard eight hundred times in a
 * battle must sit under the things heard nine times.
 *
 * RE-MEASURE AFTER CHANGING ANY VOICE. The lab's LEVELS button prints the current table; a
 * voice that has been retuned without updating its trim is silently the wrong size.
 */
export const WEAPON_PEAK = 0.12;

/**
 * How loud each voice is MEANT to be, as a peak at intensity 1. The intent; `VOICE_TRIM` is
 * the measured correction that achieves it.
 *
 * A weapon hit is the reference. Eliminations sit above it because the room reacts to them;
 * abilities and sustained textures below; and the two most frequent sounds in the show lowest
 * of all, because something heard eight hundred times in a battle has to sit under something
 * heard nine times or it becomes the battle.
 */
export const TARGET_PEAK: Record<SoundId, number> = {
  explosion: WEAPON_PEAK * 2.2,
  shockwaveBoom: WEAPON_PEAK * 1.35,
  crusherSlam: WEAPON_PEAK * 1.35,
  deepBoom: WEAPON_PEAK * 1.3,
  mechanicalClunk: WEAPON_PEAK * 1.15,
  shellImpact: WEAPON_PEAK * 1.05,

  metallicTick: WEAPON_PEAK,
  heavyClang: WEAPON_PEAK,
  sawBuzz: WEAPON_PEAK,
  spinnerWhine: WEAPON_PEAK,
  discWhirr: WEAPON_PEAK,
  flameWhoosh: WEAPON_PEAK,
  bluntImpact: WEAPON_PEAK,

  electricZap: WEAPON_PEAK * 0.75,
  nitroWhoosh: WEAPON_PEAK * 0.75,
  oilSplat: WEAPON_PEAK * 0.75,
  repairChime: WEAPON_PEAK * 0.75,
  adrenalineRise: WEAPON_PEAK * 0.75,

  smokeHiss: WEAPON_PEAK * 0.6,
  flameBillow: WEAPON_PEAK * 0.6,
  sawGrind: WEAPON_PEAK * 0.6,

  dullThud: WEAPON_PEAK * 0.45,
  pegPing: WEAPON_PEAK * 0.38,
};

export const VOICE_TRIM: Record<SoundId, number> = {
  // moments
  explosion: 1.1,
  shockwaveBoom: 0.39,
  crusherSlam: 1.25,
  deepBoom: 1.27,
  mechanicalClunk: 0.61,
  shellImpact: 1.56,

  // weapons — the reference tier
  metallicTick: 14.04,
  heavyClang: 1.3,
  sawBuzz: 0.71,
  spinnerWhine: 3.33,
  discWhirr: 3.61,
  flameWhoosh: 0.82,
  bluntImpact: 1.54,

  // abilities
  electricZap: 2.64,
  nitroWhoosh: 4.49,
  oilSplat: 4.16,
  repairChime: 0.62,
  adrenalineRise: 1.6,
  smokeHiss: 3.34,

  // sustained textures, which sit under everything
  flameBillow: 0.43,
  // 23x. Not a typo, and not really a fix: this voice renders at a peak of 0.003 and is
  // effectively inaudible as written. The trim makes it present; it still wants rebuilding.
  sawGrind: 0.3,

  // the two most frequent sounds in the show
  dullThud: 1.4,
  pegPing: 1.82,
};

// --- registry --------------------------------------------------------------------------------

export const PALETTE = {
  metallicTick,
  heavyClang,
  sawBuzz,
  spinnerWhine,
  discWhirr,
  flameWhoosh,
  bluntImpact,
  dullThud,
  explosion,
  deepBoom,
  shellImpact,
  mechanicalClunk,
  electricZap,
  nitroWhoosh,
  oilSplat,
  shockwaveBoom,
  repairChime,
  adrenalineRise,
  smokeHiss,
  flameBillow,
  sawGrind,
  crusherSlam,
  pegPing,
} as const satisfies Record<string, Voice>;

export type SoundId = keyof typeof PALETTE;

export const SOUND_IDS = Object.keys(PALETTE) as SoundId[];

/** Plays a sound by id. The single entry point every consumer uses, so an unknown id is
 *  impossible rather than merely unlikely. */
export function playSound(bus: AudioBus, id: SoundId, options?: PlayOptions): void {
  PALETTE[id](bus, { ...options, trim: VOICE_TRIM[id] });
}
