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
}

export type Voice = (bus: AudioBus, options?: PlayOptions) => void;

const opt = (o?: PlayOptions) => ({
  intensity: o?.intensity ?? 1,
  pan: o?.pan ?? 0,
  delay: o?.delay ?? 0,
  pitch: o?.pitch ?? 0.5,
});

// --- weapons -----------------------------------------------------------------------------

/** The default landed blow, and the fallback for any weapon without its own voice: a short,
 *  bright metallic tick. This is the most frequent sound in the game by a wide margin, so it
 *  is the one most carefully kept short. */
const metallicTick: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity),
    frequency: pitchFor(intensity, 2800),
    q: 7,
    gain: gainFor(intensity) * 0.5,
    pan,
    delay,
  });
};

/** Hammer. A lower, heavier version of the tick with a body under it, so a hammer blow
 *  lands rather than pings. */
const heavyClang: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity) * 1.5,
    frequency: pitchFor(intensity, 1100),
    q: 4,
    gain: gainFor(intensity) * 0.55,
    pan,
    delay,
  });
  tone(bus, {
    frequency: pitchFor(intensity, 150),
    duration: decayFor(intensity) * 2,
    gain: gainFor(intensity) * 0.35,
    pan,
    delay,
  });
};

/**
 * How long the saw stays in contact.
 *
 * The only weapon whose length is set here rather than by `decayFor`. Every other weapon is
 * an impact — struck, then fading — and a saw is not: it is a sustained cut with a beginning,
 * a middle and an end. `voices.ts` reads the maximum so a saw occupies a mixer slot for as
 * long as it can actually be heard.
 */
export const SAW_BUZZ_MIN_SECONDS = 0.1;
export const SAW_BUZZ_MAX_SECONDS = 0.25;

/**
 * Saw Blade. The one weapon that must not sound like a hit — and must not hurt to hear.
 *
 * Everything else in this file is a struck object. A powered blade is a machine doing work
 * against resistance, so this is built as one continuous gesture instead:
 *
 *     spinning blade -> teeth bite -> controlled grind and chatter -> blade releases
 *
 * Getting there took three attempts and the two failures are the useful part of this comment.
 *
 * The first version was one noise burst at Q 18. A filter that narrow rings at its centre
 * frequency, so it was a struck bell wearing a saw's name.
 *
 * The second had the right structure and was painful to listen to. Three causes, all mine:
 * the texture sat at 1450Hz with a raw sawtooth on top of it, right in the 2-5kHz band where
 * human hearing is most sensitive; the chop LFO was a sawtooth, whose once-per-cycle jump is
 * a step in a gain envelope, which is a click, fifty times a second; and the layers summed to
 * about 0.74 against a limiter threshold of 0.5, so every hit was driven hard into the master
 * limiter and came back with limiter distortion on it. That last one is why softening the
 * synthesis alone did not fix it — the grit was being added downstream of the synthesis.
 *
 * So the rules this version follows:
 *
 * - **Everything lives low.** The buzz is 310-780Hz and no layer is allowed past 1.6kHz.
 *   Character comes from modulation, not from brightness.
 * - **No resonant peaks anywhere.** Every Q is at or below 1, and the bite uses a lowpass
 *   rather than a bandpass so it has no peak at all.
 * - **It stays under the limiter.** The sustained layers sum to about 0.5, so the master
 *   limiter shapes peaks instead of crushing every hit.
 * - **One rotation rate, shared.** All three sustained layers chop at 44Hz, which is what
 *   makes the blade audibly keep spinning through the contact instead of sounding like three
 *   unrelated noises stacked up.
 */
const sawBuzz: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  const bite = clamp01(intensity);
  const duration = SAW_BUZZ_MIN_SECONDS + (SAW_BUZZ_MAX_SECONDS - SAW_BUZZ_MIN_SECONDS) * bite;
  const level = gainFor(intensity);

  // The buzz pitch: 780Hz at a graze down to 310Hz at a heavy bite. Low on purpose. This is
  // the difference between "VRRRT" and "SKREEE" -- the character of a cut has to come from
  // modulation down here, not from brightness up where it hurts.
  const toothHz = pitchFor(intensity, 780);

  // Blade rotation, and the one rate everything shares. ~44Hz is about 2,600rpm, and hearing
  // the same pulse in all three layers is what makes the blade audibly keep spinning through
  // the contact rather than sounding like three separate noises.
  const SPIN_HZ = 44;

  const CATCH = 0.03;
  const body = duration - CATCH * 0.5;
  const bodyDelay = delay + CATCH * 0.5;

  // 1. The bite. A low-mid crunch, not a skreech. `lowpass` rather than the usual bandpass so
  //    there is no resonant peak at all -- a peak here is precisely the piercing ring to avoid.
  noiseBurst(bus, {
    duration: CATCH,
    type: 'lowpass',
    frequency: 1500,
    frequencyTo: 800,
    q: 0.5,
    gain: level * 0.16,
    pan,
    delay,
  });

  // 2. The rumble. Mechanical weight under the cut, so the contact has body instead of being
  //    all texture. Capped hard: this layer should be felt more than heard.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'sawtooth',
    frequency: 96,
    lowpass: 340,
    attack: 0.014,
    release: 0.05,
    chopHz: SPIN_HZ,
    chopDepth: 0.16,
    gain: level * 0.16,
    pan,
  });

  // 3. The cut. The main texture, and the layer that was doing the damage before: noise
  //    centred at 1450Hz reads as a hiss however it is capped. Down at 720Hz with a 1.6kHz
  //    ceiling the same noise reads as crunch.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'noise',
    frequency: 720,
    frequencyTo: 600,
    q: 0.8,
    lowpass: 1600,
    attack: 0.014,
    release: 0.05,
    chopHz: SPIN_HZ,
    chopDepth: 0.3,
    wobbleHz: 26,
    wobbleDepth: 0.14,
    gain: level * 0.22,
    pan,
  });

  // 4. The teeth. A sawtooth at tooth rate, capped just above its own fundamental so what
  //    survives is the buzz and not the harmonics. The wobble is the teeth biting, dragging
  //    and releasing; the downward slide is the blade loading up against the armour.
  grind(bus, {
    duration: body,
    delay: bodyDelay,
    source: 'sawtooth',
    frequency: toothHz,
    frequencyTo: toothHz * 0.88,
    lowpass: 1250,
    attack: 0.018,
    release: 0.055,
    chopHz: SPIN_HZ,
    chopDepth: 0.22,
    wobbleHz: 19,
    wobbleDepth: 0.07,
    gain: level * 0.13,
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
    gain: level * 0.05,
    pan,
    delay: delay + Math.max(0, duration - FREE),
  });
};

/** Spinning Bar. A whine that falls as the bar sheds energy into the target. */
const spinnerWhine: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  sweep(bus, {
    from: pitchFor(intensity, 1500),
    to: pitchFor(intensity, 520),
    duration: decayFor(intensity) * 1.3,
    type: 'sawtooth',
    gain: gainFor(intensity) * 0.22,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: decayFor(intensity),
    frequency: pitchFor(intensity, 2400),
    q: 5,
    gain: gainFor(intensity) * 0.3,
    pan,
    delay,
  });
};

/** Vertical Spinner. Same family as the bar but higher and thinner, so the two are
 *  distinguishable without being unrelated — they are both spinning metal. */
const discWhirr: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  sweep(bus, {
    from: pitchFor(intensity, 2600),
    to: pitchFor(intensity, 1100),
    duration: decayFor(intensity),
    type: 'square',
    gain: gainFor(intensity) * 0.16,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: decayFor(intensity) * 0.8,
    frequency: pitchFor(intensity, 3400),
    q: 9,
    gain: gainFor(intensity) * 0.3,
    pan,
    delay,
  });
};

/** Flamethrower. No impact at all — a breathy rush, which is why it is the one weapon whose
 *  hit is filtered noise with no resonance. */
const flameWhoosh: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.3,
    type: 'lowpass',
    frequency: 1800,
    frequencyTo: 700,
    q: 0.7,
    gain: gainFor(intensity) * 0.28,
    pan,
    delay,
  });
};

/** Ram Plate. A flat shove: all body, no ring. */
const bluntImpact: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity),
    type: 'lowpass',
    frequency: pitchFor(intensity, 700),
    q: 1,
    gain: gainFor(intensity) * 0.5,
    pan,
    delay,
  });
  tone(bus, {
    frequency: pitchFor(intensity, 110),
    duration: decayFor(intensity) * 1.5,
    gain: gainFor(intensity) * 0.3,
    pan,
    delay,
  });
};

// --- general events -----------------------------------------------------------------------

/** Bots bumping. Kept quiet and very short on purpose: this fires constantly in a scrum and
 *  its job is to sit underneath everything else, not to be noticed. */
const dullThud: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  tone(bus, {
    frequency: pitchFor(intensity, 130),
    duration: 0.07,
    gain: gainFor(intensity) * 0.18,
    pan,
    delay,
  });
  noiseBurst(bus, {
    duration: 0.045,
    type: 'lowpass',
    frequency: 420,
    gain: gainFor(intensity) * 0.14,
    pan,
    delay,
  });
};

/** A bot dies. The loudest thing in the mix, and the only voice allowed to run long — a
 *  lowpass falling from bright to rubble is what an explosion is. */
const explosion: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.75,
    type: 'lowpass',
    frequency: 1600,
    frequencyTo: 70,
    q: 0.8,
    gain: 0.85,
    pan,
    delay,
  });
  sweep(bus, { from: 180, to: 35, duration: 0.6, gain: 0.5, pan, delay });
};

/** A cannon firing. Distinct from an elimination so the room can tell "a hazard went off"
 *  from "somebody just died" without looking. */
const deepBoom: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  sweep(bus, { from: 240, to: 55, duration: 0.35, gain: 0.55, pan, delay });
  noiseBurst(bus, {
    duration: 0.18,
    type: 'lowpass',
    frequency: 900,
    frequencyTo: 200,
    gain: 0.4,
    pan,
    delay,
  });
};

/** A cannonball landing on a bot — the other half of `deepBoom`, heard from the receiving
 *  end. Sharper and shorter than the muzzle. */
const shellImpact: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: decayFor(intensity) * 1.6,
    type: 'lowpass',
    frequency: pitchFor(intensity, 1300),
    frequencyTo: 180,
    gain: gainFor(intensity) * 0.6,
    pan,
    delay,
  });
  tone(bus, { frequency: 95, duration: 0.16, gain: gainFor(intensity) * 0.35, pan, delay });
};

/** A trapdoor opening. Two knocks and a rumble, because a floor giving way is a mechanism
 *  followed by a hole. */
const mechanicalClunk: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  noiseBurst(bus, { duration: 0.05, frequency: 1400, q: 3, gain: 0.4, pan, delay });
  noiseBurst(bus, { duration: 0.09, frequency: 700, q: 3, gain: 0.45, pan, delay: delay + 0.07 });
  sweep(bus, { from: 120, to: 45, duration: 0.4, gain: 0.3, pan, delay: delay + 0.07 });
};

// --- abilities ----------------------------------------------------------------------------

/** EMP Pulse. */
const electricZap: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  sweep(bus, { from: 2400, to: 320, duration: 0.22, type: 'sawtooth', gain: 0.3, pan, delay });
  noiseBurst(bus, { duration: 0.2, type: 'highpass', frequency: 2600, q: 2, gain: 0.3, pan, delay });
};

/** Nitro Boost. */
const nitroWhoosh: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.42,
    type: 'bandpass',
    frequency: 500,
    frequencyTo: 2600,
    q: 1.2,
    gain: 0.36,
    pan,
    delay,
  });
};

/** Oil Slick. Wet and flat — the ice patch it leaves is visible, so the sound only has to
 *  say "something was dropped". */
const oilSplat: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.16,
    type: 'lowpass',
    frequency: 900,
    frequencyTo: 260,
    gain: 0.35,
    pan,
    delay,
  });
};

/** Shockwave. A push outward, so it swells before it falls rather than starting at its
 *  loudest like the cannon does. */
const shockwaveBoom: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  sweep(bus, { from: 70, to: 190, duration: 0.12, gain: 0.45, pan, delay });
  sweep(bus, { from: 190, to: 48, duration: 0.45, gain: 0.5, pan, delay: delay + 0.1 });
  noiseBurst(bus, { duration: 0.3, type: 'lowpass', frequency: 1400, frequencyTo: 200, gain: 0.3, pan, delay });
};

/** Repair System. The one genuinely pleasant sound in the game — two rising notes. */
const repairChime: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  chime(bus, { frequency: 660, duration: 0.3, gain: 0.22, pan, delay });
  chime(bus, { frequency: 880, duration: 0.35, gain: 0.2, pan, delay: delay + 0.09 });
};

/** Adrenaline. A rising tone under the bot, for the moment it gets faster. */
const adrenalineRise: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  sweep(bus, { from: 260, to: 900, duration: 0.4, type: 'triangle', gain: 0.28, pan, delay });
};

/** Smoke Screen. Breathy and untargetable-sounding; deliberately the quietest ability. */
const smokeHiss: Voice = (bus, o) => {
  const { pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.5,
    type: 'highpass',
    frequency: 1800,
    frequencyTo: 3600,
    q: 0.6,
    gain: 0.24,
    pan,
    delay,
  });
};

// --- hazards -------------------------------------------------------------------------------

/** Standing in a flame jet. Hotter and shorter than the smoke hiss it could be confused
 *  with, because one is a bot hiding and the other is a bot burning. */
const flameHiss: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.22,
    type: 'bandpass',
    frequency: 1500,
    frequencyTo: 2600,
    q: 0.9,
    gain: gainFor(intensity) * 0.3,
    pan,
    delay,
  });
};

/** A saw hazard chewing on a bot. Same family as the Saw Blade weapon, lower and rougher —
 *  a floor saw is bigger than one bolted to a bot. */
const sawGrind: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.2,
    frequency: pitchFor(intensity, 1200),
    q: 22,
    gain: gainFor(intensity) * 0.4,
    pan,
    delay,
  });
};

/** The crusher. The heaviest single impact in the game. */
const crusherSlam: Voice = (bus, o) => {
  const { intensity, pan, delay } = opt(o);
  noiseBurst(bus, {
    duration: 0.3,
    type: 'lowpass',
    frequency: 800,
    frequencyTo: 90,
    gain: gainFor(intensity) * 0.7,
    pan,
    delay,
  });
  tone(bus, { frequency: 70, duration: 0.3, gain: gainFor(intensity) * 0.45, pan, delay });
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
  const { intensity, pan, delay, pitch } = opt(o);
  const step = Math.min(PENTATONIC.length - 1, Math.max(0, Math.round(pitch * (PENTATONIC.length - 1))));
  tone(bus, {
    frequency: PENTATONIC[step]!,
    duration: PEG_PING_SECONDS,
    type: 'triangle',
    // Quiet. Ten balls across dozens of peg rows is a lot of events, and the cascade should
    // sit under the room rather than over it.
    gain: 0.06 + gainFor(intensity) * 0.09,
    pan,
    delay,
  });
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
  flameHiss,
  sawGrind,
  crusherSlam,
  pegPing,
} as const satisfies Record<string, Voice>;

export type SoundId = keyof typeof PALETTE;

export const SOUND_IDS = Object.keys(PALETTE) as SoundId[];

/** Plays a sound by id. The single entry point every consumer uses, so an unknown id is
 *  impossible rather than merely unlikely. */
export function playSound(bus: AudioBus, id: SoundId, options?: PlayOptions): void {
  PALETTE[id](bus, options);
}
