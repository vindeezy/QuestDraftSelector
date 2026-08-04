/**
 * 2D vector helpers for the simulation.
 *
 * Only +, -, *, / and Math.sqrt are used. Prefer `lengthSq` over `length` in
 * comparisons — it skips the square root entirely.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Returns (x, y) scaled down so its magnitude is at most `max`. */
export function clampLength(x: number, y: number, max: number): Vec2 {
  const lenSq = x * x + y * y;
  if (lenSq <= max * max || lenSq === 0) return { x, y };
  const scale = max / Math.sqrt(lenSq);
  return { x: x * scale, y: y * scale };
}
