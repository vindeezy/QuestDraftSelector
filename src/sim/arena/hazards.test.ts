import { describe, it, expect } from 'vitest';
import { HAZARD_NAMES, hazardPreset, HazardCategory } from './hazards';

describe('HAZARD_NAMES', () => {
  it('lists twelve presets', () => {
    expect(HAZARD_NAMES.length).toBe(12);
  });

  it('has no duplicates', () => {
    expect(new Set(HAZARD_NAMES).size).toBe(HAZARD_NAMES.length);
  });
});

describe('hazardPreset', () => {
  it('gives every preset a category and a label', () => {
    for (const name of HAZARD_NAMES) {
      const p = hazardPreset(name);
      expect(p.label.length).toBeGreaterThan(0);
      expect([HazardCategory.Surface, HazardCategory.Zone, HazardCategory.Emitter]).toContain(
        p.category,
      );
    }
  });

  it('returns a fresh copy so a placement cannot mutate the table', () => {
    const a = hazardPreset('saw');
    a.label = 'changed';
    expect(hazardPreset('saw').label).not.toBe('changed');
  });

  it('gives the air blaster knockback but no damage', () => {
    const p = hazardPreset('airBlaster');
    expect(p.zone!.damagePerTick).toBe(0);
    expect(p.zone!.knockback).toBeGreaterThan(1);
  });

  it('gives the cannon a projectile fast enough to need sweeping', () => {
    const p = hazardPreset('cannon');
    expect(p.emitter!.speed).toBeGreaterThan(10);
  });

  it('makes every damaging hazard survivable for at least a second of contact', () => {
    // A hazard that kills instantly on touch is not a hazard, it is a pit.
    for (const name of HAZARD_NAMES) {
      const p = hazardPreset(name);
      if (p.zone && p.zone.damagePerTick > 0) {
        expect(p.zone.damagePerTick * 60).toBeLessThan(100);
      }
    }
  });
});
