import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../src/sim/plinko/plinko';

const base = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };

describe('deterministic replay', () => {
  it('produces byte-identical results across 25 replays of the same seed', () => {
    const first = runPlinko({ ...base, seed: 987654 });
    for (let i = 0; i < 25; i++) {
      const replay = runPlinko({ ...base, seed: 987654 });
      expect(replay.checksum).toBe(first.checksum);
      expect(replay.ticks).toBe(first.ticks);
      expect(replay.landings).toEqual(first.landings);
    }
  }, 60000);

  it('is unaffected by other simulations running in between', () => {
    const first = runPlinko({ ...base, seed: 555 });
    runPlinko({ ...base, seed: 111 });
    runPlinko({ ...base, seed: 222 });
    const again = runPlinko({ ...base, seed: 555 });
    expect(again.checksum).toBe(first.checksum);
  }, 30000);

  it('gives every seed in a sample a distinct checksum', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      seen.add(runPlinko({ ...base, seed }).checksum);
    }
    expect(seen.size).toBe(200);
  }, 180000);

  it('always settles within the tick limit across 200 seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(runPlinko({ ...base, seed }).settled).toBe(true);
    }
  }, 180000);

  // This is a golden record. Every test above compares the simulation against itself
  // within one process, which proves internal consistency but not that today's result
  // equals last month's — a changed physics constant passes all four. This one pins
  // the actual output.
  //
  // Any change to the physics constants, collision maths, board geometry, release
  // logic, or PRNG will break it. That is the point: any of those changes would
  // silently turn every previously recorded event into a different event.
  //
  // If this fails, decide deliberately whether the change was intended. If it was,
  // every existing recording must be re-recorded.
  // DO NOT paste in new numbers to make the test green.
  it('reproduces the locked golden record for seed 987654', () => {
    const result = runPlinko({ ...base, seed: 987654 });
    expect(result.checksum).toBe('c6190ef6');
    expect(result.ticks).toBe(623);
    expect(result.landings.map((l) => l.slot)).toEqual([0, 3, 5, 3, 6, 0, 2, 6, 8, 8]);
  }, 30000);
});
