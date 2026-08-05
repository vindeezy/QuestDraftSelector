import type { World } from './world';

/**
 * FNV-1a over the raw IEEE 754 bits of each number.
 *
 * Hashing the actual bits rather than a rounded string means the smallest possible
 * divergence between two runs is caught. That is the entire point: this is the
 * tripwire that tells us seed-based replay has stopped being trustworthy.
 */
export function hashNumbers(values: Iterable<number>): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  let hash = 0x811c9dc5;

  for (const value of values) {
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) {
      hash ^= view.getUint8(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Hashes every body position and velocity, plus the tick count. */
export function hashWorld(world: World): string {
  const values: number[] = [];
  for (const body of world.bodies) {
    values.push(body.x, body.y, body.vx, body.vy);
  }
  values.push(world.tick);
  return hashNumbers(values);
}
