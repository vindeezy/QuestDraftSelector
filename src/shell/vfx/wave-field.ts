/**
 * The landing screen's moving background: a field of horizontal lines rippling across a dark
 * room, like heat coming off a floor that has already been fought on.
 *
 * Pure arithmetic — no canvas, no DOM. Given a position and a time this returns where a line
 * sits and how bright it is; something else strokes it.
 *
 * **Why lines rather than a shader.** The reference is a WebGL shader gradient, and this site
 * could run one — PixiJS is already a dependency. It would also mean a second WebGL context,
 * on the one screen whose entire job is loading fast and looking certain. Summed sines on a 2D
 * canvas cost a few thousand points a frame, need no shader plumbing, and give something a
 * gradient cannot: structure. Lines read as a signal, a scan, a seismograph — which is the
 * industrial register the site is already in, where a soft gradient would read as a lava lamp.
 *
 * **Three sines, not noise.** A noise field needs a permutation table and a lookup per point;
 * three sines at incommensurable frequencies never visibly repeat and cost three multiplies.
 * The frequencies are deliberately not integer multiples of each other, so the pattern does not
 * find a common period and start looping in front of somebody waiting on the landing screen.
 *
 * **No randomness.** Same as everything else here: the site has a Replay button and a recorded
 * event, and a background that differed between two viewings would be the one moving thing on
 * the page nobody could account for.
 */

/**
 * How many lines are drawn. Enough to read as a field rather than as a few stripes.
 *
 * Set together with `WAVE_AMPLITUDE`, and the pair is a contrast decision as much as a visual
 * one. The canvas composites with `lighter`, so wherever lines cross, their alpha ADDS. At 44
 * lines and an amplitude three times the line spacing, six lines could pile onto one pixel and
 * the field peaked at 0.71 alpha under the tagline — measured, not guessed — against a 0.22
 * stroke. Keeping the amplitude near the spacing holds the pile-up to two or three.
 */
export const WAVE_LINES = 32;

/** Horizontal samples per line. The lines are wide and smooth, so this can be low. */
export const WAVE_SAMPLES = 96;

/** Peak vertical displacement, as a fraction of the viewport height. See `WAVE_LINES`. */
export const WAVE_AMPLITUDE = 0.038;

/** How fast the field travels, in radians per second. Slow: this is weather, not an effect. */
export const WAVE_SPEED = 0.34;

/**
 * Vertical displacement at `x`, for `line`, at `seconds`.
 *
 * `x` and the return value are both normalised 0-1 against the viewport, so the caller scales
 * once and this never learns the screen size.
 */
export function waveOffset(x: number, line: number, seconds: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(line) || !Number.isFinite(seconds)) return 0;

  // Each line is phase-shifted by its index so the field moves as a body rather than as
  // parallel bars in lockstep.
  const phase = line * 0.38;

  const a = Math.sin(x * 3.1 + seconds * WAVE_SPEED + phase);
  const b = Math.sin(x * 5.7 - seconds * WAVE_SPEED * 0.72 + phase * 1.31);
  const c = Math.sin(x * 9.3 + seconds * WAVE_SPEED * 1.43 + phase * 0.67);

  // Weighted so the slowest wave dominates and the fast one only breaks up the crests.
  return (a * 0.6 + b * 0.28 + c * 0.12) * WAVE_AMPLITUDE * centreEnvelope(x);
}

/**
 * Tapers the displacement to nothing at the left and right edges.
 *
 * Without this the lines meet the edge of the screen mid-swing and the field reads as a
 * rectangle of animation sitting on the page, rather than as something the room is doing.
 */
function centreEnvelope(x: number): number {
  const t = clamp01(x);
  return Math.sin(t * Math.PI) ** 0.7;
}

/**
 * How bright a line is, 0-1.
 *
 * Brightest through the middle band and falling away above and below, so the field has a
 * horizon rather than filling the screen evenly. The title sits in that bright band, which is
 * why the scrim behind it exists.
 */
export function lineAlpha(line: number, total = WAVE_LINES): number {
  if (total <= 1) return 1;
  const t = clamp01(line / (total - 1));
  // Distance from the middle, eased, so the falloff is gentle near the centre and quick at
  // the extremes.
  const fromCentre = Math.abs(t - 0.5) * 2;
  return clamp01(1 - fromCentre ** 1.6);
}

/** Where a line sits vertically before displacement, normalised 0-1. */
export function lineBase(line: number, total = WAVE_LINES): number {
  if (total <= 1) return 0.5;
  // Spread across the middle 84% of the height, so the outermost lines are not flush against
  // the viewport edge where the vignette is darkest anyway.
  return 0.08 + (line / (total - 1)) * 0.84;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
