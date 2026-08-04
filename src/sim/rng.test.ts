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
    // Each bucket should hold ~10% of samples. Allow 8%-12%.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n * 0.08);
      expect(count).toBeLessThan(n * 0.12);
    }
  });
});
