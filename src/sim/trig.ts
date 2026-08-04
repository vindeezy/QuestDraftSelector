/**
 * Integer-indexed trigonometry for the simulation.
 *
 * `Math.sin` and `Math.cos` are implementation-approximated and are NOT guaranteed to
 * return identical bits across JavaScript engines, which would silently change every
 * recorded event. This module replaces them.
 *
 * Two decisions make it exact:
 *
 * 1. A heading is an integer index in [0, 4096), not a float angle. Turning is integer
 *    addition with wraparound, so it accumulates exactly zero error. Repeatedly rotating
 *    a float vector instead would drift and denormalise.
 *
 * 2. The table is built from a Taylor series using only +, -, * and /, which IEEE 754
 *    specifies exactly. Quadrant reduction is integer arithmetic on the index.
 *
 * There is deliberately no atan2 replacement. Steering does not need one — see
 * `steerToward` in `arena/bot.ts`, which uses cross and dot products instead.
 */

export const ANGLE_STEPS = 4096;
export const ANGLE_MASK = ANGLE_STEPS - 1;

const TAU = 6.283185307179586;
export const STEPS_PER_RADIAN = ANGLE_STEPS / TAU;

/** Radians per index step. */
const STEP_RADIANS = TAU / ANGLE_STEPS;
/** Indices per quadrant. 4096 / 4. */
const QUADRANT = ANGLE_STEPS / 4;

/**
 * Taylor series for sine on [0, PI/2], in Horner form.
 *
 * Terms through x^13 (7 terms) leave an error as large as ~6.5e-10 at the top of the
 * range (x close to PI/2) — measured empirically, not merely estimated at x = PI/4.
 * That is too coarse for the exact self-consistency checks this table has to satisfy
 * (two independently-reduced indices landing on the same true angle must agree to
 * within ~5e-13). Extending to terms through x^19 (10 terms) pushes the worst-case
 * error down to ~3.3e-16, comfortably below every threshold this module is tested
 * against. Accuracy is not actually the point: identical output on every engine is.
 * Accuracy only ensures a bot pointed at 45 degrees really travels at 45 degrees.
 */
// Coefficients of x^1, x^3, x^5, ..., x^19, innermost (highest power) first, for
// Horner evaluation. sign(k) alternates; magnitude is 1 / (2k+1)!.
const SIN_COEFFS = [
  -1 / 121645100408832000, // x^19 / 19!
  1 / 355687428096000, // x^17 / 17!
  -1 / 1307674368000, // x^15 / 15!
  1 / 6227020800, // x^13 / 13!
  -1 / 39916800, // x^11 / 11!
  1 / 362880, // x^9 / 9!
  -1 / 5040, // x^7 / 7!
  1 / 120, // x^5 / 5!
  -1 / 6, // x^3 / 3!
  1, // x^1 / 1!
];

// Coefficients of x^0, x^2, x^4, ..., x^18, innermost (highest power) first.
const COS_COEFFS = [
  -1 / 6402373705728000, // x^18 / 18!
  1 / 20922789888000, // x^16 / 16!
  -1 / 87178291200, // x^14 / 14!
  1 / 479001600, // x^12 / 12!
  -1 / 3628800, // x^10 / 10!
  1 / 40320, // x^8 / 8!
  -1 / 720, // x^6 / 6!
  1 / 24, // x^4 / 4!
  -1 / 2, // x^2 / 2!
  1, // x^0 / 0!
];

function polySin(x: number): number {
  const x2 = x * x;
  let acc = SIN_COEFFS[0]!;
  for (let i = 1; i < SIN_COEFFS.length; i++) {
    acc = SIN_COEFFS[i]! + x2 * acc;
  }
  return x * acc;
}

/** Taylor series for cosine on [0, PI/2], in Horner form. See `polySin` for why the
 * series runs through x^18 rather than the x^12 a naive estimate would suggest. */
function polyCos(x: number): number {
  const x2 = x * x;
  let acc = COS_COEFFS[0]!;
  for (let i = 1; i < COS_COEFFS.length; i++) {
    acc = COS_COEFFS[i]! + x2 * acc;
  }
  return acc;
}

const COS = new Float64Array(ANGLE_STEPS);
const SIN = new Float64Array(ANGLE_STEPS);

for (let i = 0; i < ANGLE_STEPS; i++) {
  // Exact integer reduction into a quadrant, then evaluate the polynomial on the
  // remainder only. This keeps the polynomial argument inside [0, PI/2), where the
  // series converges fastest.
  const quadrant = (i / QUADRANT) | 0;
  const remainder = i - quadrant * QUADRANT;
  const x = remainder * STEP_RADIANS;
  const s = polySin(x);
  const c = polyCos(x);

  if (quadrant === 0) {
    COS[i] = c;
    SIN[i] = s;
  } else if (quadrant === 1) {
    COS[i] = -s;
    SIN[i] = c;
  } else if (quadrant === 2) {
    COS[i] = -c;
    SIN[i] = -s;
  } else {
    COS[i] = s;
    SIN[i] = -c;
  }
}

/** Wraps any integer into [0, ANGLE_STEPS). */
export function normalizeAngle(index: number): number {
  return index & ANGLE_MASK;
}

/** Cosine of an angle index. Index 0 points along +x. */
export function cosOf(index: number): number {
  return COS[index & ANGLE_MASK]!;
}

/** Sine of an angle index. Increasing index turns toward +y, which is DOWN on screen. */
export function sinOf(index: number): number {
  return SIN[index & ANGLE_MASK]!;
}
