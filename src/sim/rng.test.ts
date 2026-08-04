import { describe, it, expect } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range() stays within bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('has a roughly uniform distribution', () => {
    const rng = createRng(4242);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) {
      buckets[Math.floor(rng.next() * 10)]!++;
    }
    // Each bucket should hold ~10% of samples. At n=100000, p=0.1, the standard
    // deviation is ~94.9; these bounds are ~4 sigma. The seed is fixed and the
    // generator deterministic, so bucket counts are the same integers on every
    // run forever — there is no flake risk to guard against with looser bounds.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n * 0.0962);
      expect(count).toBeLessThan(n * 0.1038);
    }
  });

  // These arrays lock the generator's output. They are not arbitrary samples —
  // recorded simulation events are replayed by re-running this exact sequence, so
  // changing these numbers invalidates every event ever recorded.
  //
  // If one of these tests fails, the generator changed. Revert the change.
  // DO NOT regenerate these arrays to make the test pass.
  it('matches the locked reference sequence for seed 12345', () => {
    const rng = createRng(12345);
    const actual = Array.from({ length: 8 }, () => rng.next());
    expect(actual).toEqual([
      0.498803693568334, 0.7180248491931707, 0.46510869706980884,
      0.727176858112216, 0.26155974506400526, 0.262401201762259,
      0.9079904058016837, 0.013901109574362636,
    ]);
  });

  it('matches the locked reference sequence for seed 0', () => {
    const rng = createRng(0);
    const actual = Array.from({ length: 8 }, () => rng.next());
    expect(actual).toEqual([
      0.1276340070180595, 0.2554530606139451, 0.5167204516474158,
      0.3874804873485118, 0.810084972763434, 0.7064054848160595,
      0.8412643105257303, 0.11602121056057513,
    ]);
  });

  it('produces a valid sequence for seed 0', () => {
    const rng = createRng(0);
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('produces a valid sequence for a negative seed', () => {
    const rng = createRng(-12345);
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('aliases non-integer seeds onto their truncated integer, as documented', () => {
    const a = createRng(1.5);
    const b = createRng(1);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});
