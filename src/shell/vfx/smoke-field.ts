/**
 * The landing screen's moving background: slow organic smoke, lit from below by something
 * warm and off-screen.
 *
 * Pure arithmetic — no canvas, no DOM. Given a point and a time this returns how dense the
 * smoke is there and what colour that density is; something else paints it.
 *
 * **Domain-warped fractal noise.** This is what makes smoke look like smoke rather than like
 * a gradient sliding around. Plain fractal noise (fBm) gives you clouds, but clouds that drift
 * rigidly — every part moves the same way. Warping feeds noise through ITSELF: sample the
 * field once to get an offset, then sample it again at the offset position. The result curls
 * and folds into itself, because each region is being displaced by a different amount. It is
 * the standard technique for this look and it is the same one the reference component's shader
 * will be using.
 *
 * **Value noise, not Perlin or simplex.** Value noise interpolates hashed lattice corners; it
 * is cheaper, and once four octaves are stacked and the whole thing is warped twice over, the
 * differences that matter to a purist are not visible on a background at 22% opacity. Cost is
 * the constraint here — see `smoke-canvas.ts` for the resolution this runs at and why.
 *
 * **No randomness.** Same rule as the rest of this project: the site has a Replay button and a
 * recorded event, and a background that differed between two viewings would be the one moving
 * thing on the page nobody could account for. The lattice is hashed from its integer
 * coordinates, so the field is a fixed, infinite, reproducible thing that time moves through.
 */

/**
 * Octaves of noise stacked per fBm call.
 *
 * Four, not the six or eight a still image would use. Every octave doubles the lattice
 * lookups, this runs three fBm calls per pixel per frame, and octaves past the fourth are
 * contributing detail finer than the pixels the field is actually rasterised at.
 */
export const OCTAVES = 4;

/**
 * How hard the field displaces itself. The single most important number here.
 *
 * Below about 1.5 it reads as clouds gently sliding. Above about 5 it tears into filaments and
 * stops reading as one continuous body of smoke.
 */
export const WARP = 3.4;

/** How fast the smoke evolves, in field-units per second. Slow: this is a room, not an effect. */
export const DRIFT = 0.05;

/**
 * A deterministic hash of a lattice point to a value in 0-1.
 *
 * `Math.imul` throughout because the constants overflow 32 bits, and plain `*` would silently
 * promote to float and throw away the low bits that make this a hash at all.
 */
function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** One octave: the four surrounding lattice corners, smoothstepped together. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Smoothstep rather than a straight lerp. Linear interpolation leaves the lattice visible as
  // a grid of creases, because the first derivative jumps at every cell boundary.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Stacked octaves, each half the amplitude and twice the frequency of the last. */
export function fbm(x: number, y: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < OCTAVES; octave++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * How dense the smoke is at `(x, y)` at `seconds`, in 0-1.
 *
 * Three fBm calls: two to build the displacement vector, one to sample the field at the
 * displaced position. A second warp stage (five calls) is the textbook version and looks
 * slightly better; it also costs 66% more per pixel, which at this resolution is the
 * difference between comfortably inside a frame and not. Measured, then dropped.
 *
 * Time enters as motion THROUGH the field rather than as a third noise dimension — 3D noise
 * would double the lattice lookups per octave for an effect that, on smoke this slow, is not
 * distinguishable.
 */
export function smokeDensity(x: number, y: number, seconds: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seconds)) return 0;

  const t = seconds * DRIFT;

  // The two offsets are arbitrary but must be far apart and not axis-aligned: sampling the
  // same field twice near the same place would give a displacement vector pointing diagonally
  // everywhere, and the smoke would shear in one direction instead of curling.
  const warpX = fbm(x + t, y);
  const warpY = fbm(x + 5.2, y + 1.3 - t * 0.7);

  return fbm(x + WARP * warpX, y + WARP * warpY + t * 0.35);
}

/**
 * The window of raw density that becomes visible smoke, and how the values inside it are
 * distributed. All three numbers were fitted numerically, not chosen.
 *
 * Raw fBm spans roughly 0.21 to 0.81 with a median of 0.478 — a narrow hump. The first attempt
 * mapped 0.34-0.68 onto the full range, which put NINETEEN PERCENT of pixels above 0.8 and
 * clamped a tenth of the screen to solid 1.0. That is what turned the landing into a slab of
 * orange: not the ramp, the distribution feeding it.
 *
 * These were found by sweeping the window and the gamma against 43,200 real samples, scoring
 * against what smoke actually looks like — mostly nothing, some body, rare lit edges. The
 * result: 47% of the screen effectively empty, 16% carrying visible smoke, 4% reaching the hot
 * end of the ramp.
 */
export const SHAPE_LOW = 0.26;
export const SHAPE_HIGH = 0.78;
export const SHAPE_GAMMA = 2.2;

/**
 * Maps raw density to visible density, 0-1.
 *
 * The window opens the narrow hump out; the gamma then pushes the bulk of it back down, so the
 * midtones stay dark and only genuine peaks light up. Both are needed — the window alone
 * distributes values evenly across the range, and an evenly-lit smoke field is a marble
 * texture.
 */
export function shape(density: number): number {
  if (!Number.isFinite(density)) return 0;
  let t = (density - SHAPE_LOW) / (SHAPE_HIGH - SHAPE_LOW);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.pow(t * t * (3 - 2 * t), SHAPE_GAMMA);
}

/**
 * The colour ramp, darkest to brightest.
 *
 * The reference runs deep teal to blue to cyan to near-white. This is the same four-step
 * structure — void, body, lit edge, hot core — rebuilt in the site's ember and charcoal, which
 * is the part the brief actually left to me.
 *
 * The top stop is a long way short of white on purpose. It is the rarest part of the field by
 * a wide margin, and it is the only part with the power to hurt the title's contrast.
 */
export interface SmokeStop {
  readonly at: number;
  readonly rgb: readonly [number, number, number];
}

/** The void the smoke sits in. */
const SMOKE_RAMP_START: SmokeStop = { at: 0, rgb: [8, 10, 13] };
/** The hot core, and the rarest thing on screen — roughly 4% of pixels reach it. */
const SMOKE_RAMP_END: SmokeStop = { at: 1, rgb: [198, 106, 48] };

export const SMOKE_RAMP: readonly SmokeStop[] = [
  SMOKE_RAMP_START,
  { at: 0.45, rgb: [23, 27, 33] },
  { at: 0.78, rgb: [92, 48, 22] },
  SMOKE_RAMP_END,
];

/**
 * The ramp evaluated at `density` (0-1), as `[r, g, b]` bytes.
 *
 * Walked with `for...of` rather than by index, because `noUncheckedIndexedAccess` is on and
 * every `SMOKE_RAMP[i]` would otherwise need an assertion. Iterating avoids the question
 * entirely instead of silencing it.
 */
export function smokeColour(density: number): [number, number, number] {
  const t = !Number.isFinite(density) ? 0 : density < 0 ? 0 : density > 1 ? 1 : density;

  // `lower` ends up as the last stop at or below `t`, `upper` as the first one above it. At
  // t = 1 nothing is above, so both land on the final stop and the span collapses to zero —
  // handled below rather than by a special case.
  let lower = SMOKE_RAMP_START;
  let upper = SMOKE_RAMP_END;
  for (const stop of SMOKE_RAMP) {
    if (stop.at <= t) {
      lower = stop;
      continue;
    }
    upper = stop;
    break;
  }

  const span = upper.at - lower.at;
  const f = span <= 0 ? 0 : (t - lower.at) / span;
  return [
    Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * f),
    Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * f),
    Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * f),
  ];
}
