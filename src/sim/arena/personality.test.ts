import { describe, it, expect } from 'vitest';
import { PERSONALITY_NAMES, weightsFor } from './personality';

describe('PERSONALITIES', () => {
  it('defines all seven', () => {
    expect(PERSONALITY_NAMES.length).toBe(7);
    expect(PERSONALITY_NAMES).toContain('aggressive');
    expect(PERSONALITY_NAMES).toContain('defensive');
    expect(PERSONALITY_NAMES).toContain('hitAndRun');
    expect(PERSONALITY_NAMES).toContain('thirdParty');
    expect(PERSONALITY_NAMES).toContain('chaos');
    expect(PERSONALITY_NAMES).toContain('showman');
    expect(PERSONALITY_NAMES).toContain('instigator');
  });

  it('gives every personality a full weight vector', () => {
    for (const name of PERSONALITY_NAMES) {
      const w = weightsFor(name);
      for (const value of Object.values(w)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps risk tolerance between 0 and 1', () => {
    for (const name of PERSONALITY_NAMES) {
      expect(weightsFor(name).riskTolerance).toBeGreaterThanOrEqual(0);
      expect(weightsFor(name).riskTolerance).toBeLessThanOrEqual(1);
    }
  });

  it('returns a copy, so a bot cannot mutate the shared table', () => {
    const a = weightsFor('aggressive');
    a.chaseNearest = 999;
    expect(weightsFor('aggressive').chaseNearest).not.toBe(999);
  });

  it('makes aggressive chase harder and retreat less than defensive', () => {
    const agg = weightsFor('aggressive');
    const def = weightsFor('defensive');
    expect(agg.chaseNearest).toBeGreaterThan(def.chaseNearest);
    expect(agg.retreat).toBeLessThan(def.retreat);
    expect(agg.riskTolerance).toBeGreaterThan(def.riskTolerance);
  });

  // This used to assert hit-and-run held the highest disengage weight in the table, which
  // it did at 1.0 — and that made it the strongest build in the game (26.4% win rate
  // against a fair 10%). Now 0.5, which puts it below instigator's 0.7.
  //
  // That is intended, not a regression. Instigator's brief is "rarely commits to a fight
  // itself", which is more disengagement than "strike, break off, repeat", and instigator
  // measures weak (3.2%) — so a high disengage weight was never what made hit-and-run
  // strong. The dangerous combination was breaking off WHILE hunting the wounded
  // (`chaseWeakest` 0.8, `charge` 0.5), which instigator does not do.
  //
  // So the assertion is now the one that actually carries the design: hit-and-run breaks
  // off more readily than every personality meant to commit to a fight.
  it('makes hit-and-run break off more readily than the committed fighters', () => {
    const hr = weightsFor('hitAndRun');
    for (const name of ['aggressive', 'defensive', 'thirdParty', 'showman'] as const) {
      expect(hr.disengage).toBeGreaterThan(weightsFor(name).disengage);
    }
  });

  it('makes third party the strongest at attacking engaged pairs', () => {
    const tp = weightsFor('thirdParty');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'thirdParty') continue;
      expect(tp.attackEngaged).toBeGreaterThanOrEqual(weightsFor(name).attackEngaged);
    }
  });

  it('makes instigator the strongest shover and a poor committer', () => {
    const inst = weightsFor('instigator');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'instigator') continue;
      expect(inst.shove).toBeGreaterThanOrEqual(weightsFor(name).shove);
    }
    expect(inst.chaseNearest).toBeLessThan(weightsFor('aggressive').chaseNearest);
  });

  it('makes showman the strongest charger and celebrator', () => {
    const show = weightsFor('showman');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'showman') continue;
      expect(show.charge).toBeGreaterThanOrEqual(weightsFor(name).charge);
      expect(show.celebrate).toBeGreaterThanOrEqual(weightsFor(name).celebrate);
    }
  });
});
