import { describe, it, expect } from 'vitest';
import { DEMO_SEED } from './demo-seed';
import officialRecordData from '../../data/official-event.json';

/**
 * The orientation screen's live panels must never run the official event's own seed —
 * see `demo-seed.ts`'s doc comment and
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2.1 ("Any demo loop must use a
 * seed that is not the official one"). This is the one test that keeps a future edit
 * from quietly pointing the demo panels at the real seed.
 */
describe('DEMO_SEED', () => {
  it('differs from the official recorded event\'s master seed', () => {
    expect(DEMO_SEED).not.toBe(officialRecordData.masterSeed);
  });

  it('is a valid master seed in its own right (1..2,147,483,647)', () => {
    expect(Number.isInteger(DEMO_SEED)).toBe(true);
    expect(DEMO_SEED).toBeGreaterThanOrEqual(1);
    expect(DEMO_SEED).toBeLessThanOrEqual(2147483647);
  });
});
