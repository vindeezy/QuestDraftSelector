/**
 * Expanding shock rings — the Shockwave ability, and only that.
 *
 * Pure arithmetic. No PixiJS, no drawing: a wave is an origin and an age, and everything else
 * is a function of how long it has been travelling.
 *
 * **Why this exists at all, rather than another particle effect.** Shockwave and EMP Pulse were
 * both `kind: 'ring'` in `vfx/index.ts` — the same emitter, the same evenly-spaced particles,
 * differing only in tint. Two abilities that do completely different things (one shoves every
 * bot away, one freezes them where they stand) looked like the same event in a different
 * colour, and no amount of retinting fixes that, because the thing a viewer reads first is
 * MOTION, not hue.
 *
 * So the two are separated by medium instead. EMP keeps the particle ring: discrete, electric,
 * scattering outward. Shockwave becomes a single drawn annulus that expands and thins — one
 * continuous front rather than a crowd of sparks. That difference survives at forty pixels, in
 * peripheral vision, on a phone, which "slightly whiter particles" does not.
 *
 * **Drawn UNDER the bots.** The house rule in `vfx/index.ts` is that if effects hide bots,
 * effects lose, and a ring big enough to read is easily big enough to swallow a machine. Under
 * the silhouettes it still reads, because it is a bright edge crossing a dark floor.
 *
 * **No randomness anywhere**, for the same reason as `tracks.ts`: the site has a Replay button,
 * and a wave that expanded differently the second time would undermine the claim the whole
 * event rests on.
 */

/** How long a wave lives, in ticks. Just under half a second at 60Hz — a shove is instant, and
 *  a ring that outstays that reads as a lingering field, which is the EMP's job. */
export const WAVE_LIFE_TICKS = 26;

/** Where the front starts, in world units. Roughly a bot's own radius, so the ring is born at
 *  the edge of the machine that made it rather than inside it. */
export const WAVE_START_RADIUS = 20;

/** How far the front reaches at full intensity. The ability shoves everything nearby; the ring
 *  has to cover enough floor to look like the cause of that rather than a decoration on top. */
export const WAVE_END_RADIUS = 190;

/** Stroke width at birth, in world units, before it thins. */
export const WAVE_MAX_WIDTH = 7;

/**
 * How many waves may exist at once.
 *
 * Shockwave fires on a health threshold, six times per life, and ten bots can hold it at once.
 * Overlapping waves are rare but not impossible, and the pool degrades by dropping the oldest
 * rather than by refusing to draw — the same discipline as the particle pool and the track
 * field, for the same reason: the busiest moment is exactly when allocation is worst.
 */
export const WAVE_CAPACITY = 12;

export interface Wave {
  active: boolean;
  x: number;
  y: number;
  /** Ticks since it was emitted. */
  age: number;
  /** 0-1, straight from the effect. Scales how far the front travels and how bright it is. */
  intensity: number;
}

export interface WaveField {
  /** The whole pool, live and dead. Exposed for the renderer and the tests to walk. */
  readonly waves: readonly Wave[];
  /** Starts a wave at `x, y`. Ignores nonsense rather than emitting a NaN ring. */
  emit(x: number, y: number, intensity: number): boolean;
  /** Ages every wave by one tick and retires the expired ones. */
  advance(): void;
  clear(): void;
}

export function createWaveField(capacity = WAVE_CAPACITY): WaveField {
  const size = Math.max(1, Math.floor(capacity));
  const waves: Wave[] = Array.from({ length: size }, () => ({
    active: false,
    x: 0,
    y: 0,
    age: 0,
    intensity: 0,
  }));

  /** A free slot, or the oldest live one when there are none. */
  function claim(): Wave {
    let oldest = waves[0]!;
    for (const w of waves) {
      if (!w.active) return w;
      if (w.age > oldest.age) oldest = w;
    }
    return oldest;
  }

  return {
    waves,

    emit(x, y, intensity) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(intensity)) return false;
      const w = claim();
      w.active = true;
      w.x = x;
      w.y = y;
      w.age = 0;
      w.intensity = Math.max(0, Math.min(1, intensity));
      return true;
    },

    advance() {
      for (const w of waves) {
        if (!w.active) continue;
        w.age += 1;
        if (w.age >= WAVE_LIFE_TICKS) w.active = false;
      }
    },

    clear() {
      for (const w of waves) w.active = false;
    },
  };
}

/** Age as a 0-1 fraction of a wave's life, clamped. */
function progress(age: number, life = WAVE_LIFE_TICKS): number {
  if (!Number.isFinite(age) || age <= 0) return 0;
  if (life <= 0) return 1;
  return Math.min(1, age / life);
}

/**
 * The front's radius at `age`, in world units.
 *
 * Eased OUT — fast at birth, decelerating — because that is what a pressure front does and,
 * more usefully, because it puts the ring's most legible moment (wide and still bright) early,
 * while the viewer's eye is still on the bot that fired it. A linear expansion reads as a
 * growing circle; this reads as something being released.
 */
export function waveRadius(age: number, intensity = 1): number {
  const t = progress(age);
  const eased = 1 - (1 - t) * (1 - t);
  const reach = WAVE_START_RADIUS + (WAVE_END_RADIUS - WAVE_START_RADIUS) * clamp01(intensity);
  return WAVE_START_RADIUS + (reach - WAVE_START_RADIUS) * eased;
}

/**
 * How bright the front is at `age`, 0-1.
 *
 * Holds briefly, then falls away faster than linearly. The hold is what makes the ring feel
 * like an event with a moment of arrival rather than something already dissolving, and it is
 * the same reasoning `trackAlpha` uses about oil.
 */
export function waveAlpha(age: number, intensity = 1): number {
  const t = progress(age);
  if (t >= 1) return 0;
  const held = t <= 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
  return clamp01(held * held * (0.55 + 0.45 * clamp01(intensity)));
}

/**
 * How thick the front is at `age`, in world units.
 *
 * Thins as it grows, which is the whole reason this reads as a WAVE and not as an expanding
 * circle: the same energy spread around an ever-longer circumference has to get thinner. Held
 * above a floor so it never disappears into a hairline before its alpha has finished.
 */
export function waveWidth(age: number, intensity = 1): number {
  const t = progress(age);
  return Math.max(1, WAVE_MAX_WIDTH * (1 - t * 0.75) * (0.6 + 0.4 * clamp01(intensity)));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
