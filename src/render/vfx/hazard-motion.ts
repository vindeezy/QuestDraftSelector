/**
 * How hazards move, as arithmetic.
 *
 * Pure — no PixiJS, no time, no state. The same split as `weapon-motion.ts`, for the same
 * reason: a crusher slams once every four seconds and a cannon's recoil lasts a fifth of one,
 * so catching either in a browser is luck. Here the shape can simply be asserted.
 */

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

/**
 * How high a crusher's plate rides, 1 at the floor and 0 held up in its frame.
 *
 * The same top-down projection problem the hammer has, and the same answer: a plate that
 * moves straight up cannot be shown moving, so it is shown getting BIGGER, because it is
 * nearer the camera. Nothing else about it changes.
 *
 * The timing is not symmetrical and that asymmetry is the whole character of the thing. It
 * drops in three ticks — half a tenth of a second, faster than the eye tracks, which is what
 * makes it read as a slam rather than a descent — and is winched back up over forty, slowly
 * enough that you can see it coming and know to be somewhere else. The simulation agrees:
 * the zone is only dangerous while active, and `active` here means down.
 */
export const CRUSHER_DROP_TICKS = 3;
export const CRUSHER_RAISE_TICKS = 40;

/** How much bigger the plate looks at the top of its frame. */
const CRUSHER_RISE = 0.5;

export function crusherHeight(active: boolean, ticksSinceChange: number): number {
  const t = Number.isFinite(ticksSinceChange) ? Math.max(0, ticksSinceChange) : 0;
  if (active) {
    // Falling. Eased IN: it accelerates into the floor rather than coasting down.
    const p = clamp01(t / CRUSHER_DROP_TICKS);
    return 1 - p * p;
  }
  // Rising. Eased OUT: the winch takes up the load quickly and then labours.
  const p = clamp01(t / CRUSHER_RAISE_TICKS);
  return Math.sin(p * (Math.PI / 2));
}

/** The plate's scale, from its height. 1 at the floor, larger the higher it rides. */
export function crusherScale(active: boolean, ticksSinceChange: number): number {
  return 1 + CRUSHER_RISE * crusherHeight(active, ticksSinceChange);
}

/**
 * How far a cannon's barrel is driven back after firing, in local units.
 *
 * Recoil is the only thing that makes a gun look like it did the firing rather than merely
 * having something appear in front of it. It snaps back instantly on the shot and returns
 * over about a quarter of a second, which is roughly how a real carriage behaves and, more to
 * the point, is long enough to see.
 */
export const RECOIL_TICKS = 15;
const RECOIL_DEPTH = 9;

export function recoilOffset(ticksSinceFire: number): number {
  if (!Number.isFinite(ticksSinceFire) || ticksSinceFire < 0) return 0;
  const p = clamp01(ticksSinceFire / RECOIL_TICKS);
  // 1 at the shot, 0 at the end, easing out — fast off the mark, drifting home.
  return RECOIL_DEPTH * (1 - p) * (1 - p);
}

/**
 * How bright a muzzle flash is, 0-1.
 *
 * Three ticks. A flash is over before it registers as a shape; what registers is that
 * something happened at that spot. Longer and it reads as a light being switched on.
 */
export const FLASH_TICKS = 3;

export function muzzleFlash(ticksSinceFire: number): number {
  if (!Number.isFinite(ticksSinceFire) || ticksSinceFire < 0) return 0;
  return 1 - clamp01(ticksSinceFire / FLASH_TICKS);
}

/**
 * How often a burning hazard jet spawns particles, in ticks.
 *
 * Not every tick, and this is the one number in the file chosen by measurement rather than by
 * feel. The gauntlet arena places 24 flame jets on a 70-in-180 cycle, so roughly nine burn at
 * any moment; at a weapon's spawn rate that alone asks for well over a thousand live particles
 * and starves every spark, every puff of dust and every cannonball trail in the fight, because
 * the pool recycles OLDEST-first and a continuously burning jet always has the oldest.
 *
 * Spawning half as often and letting each particle live its full life costs almost nothing
 * visually -- the cone is the same length and the same colour, marginally less dense -- and
 * halves the largest consumer in the show. `tools/mix-metrics.ts` reports what it actually
 * costs against the real recorded event.
 */
export const HAZARD_JET_EVERY = 2;
