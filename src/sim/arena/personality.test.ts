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

  it('makes hit-and-run the strongest disengager', () => {
    const hr = weightsFor('hitAndRun');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'hitAndRun' || name === 'defensive') continue;
      expect(hr.disengage).toBeGreaterThanOrEqual(weightsFor(name).disengage);
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
