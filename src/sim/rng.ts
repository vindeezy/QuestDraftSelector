// The only source of randomness in the simulation.
//
// Built entirely from 32-bit integer operations (`|0`, `>>>`, `Math.imul`), which
// ECMAScript specifies exactly. The output sequence is therefore bit-identical on
// every JavaScript engine, which is what makes seed-based replay possible.

export interface Rng {
  /** Next value in [0, 1). */
  next(): number;
  /** Next value in [min, max). */
  range(min: number, max: number): number;
}

/** Expands a single integer seed into well-distributed 32-bit values. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

/**
 * Creates a generator for one simulation run.
 *
 * `seed` must be a 32-bit integer. It is coerced with `| 0`, so non-integer, NaN,
 * or out-of-range values silently alias onto other seeds — 1.5 produces the same
 * stream as 1, and 2**32 produces the same stream as 0. A recorded event is
 * identified by its seed, so an aliased seed is a corrupted record. Callers
 * generating seeds must stay within [-2**31, 2**31).
 */
export function createRng(seed: number): Rng {
  const gen = splitmix32(seed);
  let a = gen(), b = gen(), c = gen(), d = gen();

  const next = (): number => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Must not be removed: sfc32's 128-bit state starts poorly diffused, so without
  // this warmup, nearby seeds produce visibly correlated early output.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + next() * (max - min),
  };
}
