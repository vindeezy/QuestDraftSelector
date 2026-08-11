import { describe, it, expect } from 'vitest';
import { CATEGORIES, partsFor, partAt, slotCountFor, type CategoryName } from './tables';

const EXPECTED_SLOT_COUNTS: Record<CategoryName, number> = {
  chassis: 6,
  drive: 6,
  weapon: 6,
  armour: 7,
  ability: 7,
  personality: 7,
};

describe('slotCountFor', () => {
  for (const category of CATEGORIES) {
    it(`reports ${EXPECTED_SLOT_COUNTS[category]} slots for ${category}`, () => {
      expect(slotCountFor(category)).toBe(EXPECTED_SLOT_COUNTS[category]);
    });
  }
});

describe('partsFor', () => {
  for (const category of CATEGORIES) {
    it(`returns exactly slotCountFor(${category}) parts`, () => {
      expect(partsFor(category).length).toBe(slotCountFor(category));
    });
  }

  it('has no duplicate part ids anywhere across all six categories', () => {
    const ids = CATEGORIES.flatMap((category) => partsFor(category).map((part) => part.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every part a non-empty label', () => {
    for (const category of CATEGORIES) {
      for (const part of partsFor(category)) {
        expect(typeof part.label).toBe('string');
        expect(part.label.length).toBeGreaterThan(0);
      }
    }
  });

  // Player-facing copy, shown when a league member sees their bot for the first time.
  // 120 characters is the chosen sane maximum: comfortably over the longest blurb actually
  // written (105) with room to breathe, while still forcing one or two short sentences.
  const MAX_BLURB_LENGTH = 120;

  it('gives every part a non-empty blurb', () => {
    for (const category of CATEGORIES) {
      for (const part of partsFor(category)) {
        expect(typeof part.blurb).toBe('string');
        expect(part.blurb.length).toBeGreaterThan(0);
      }
    }
  });

  it(`keeps every blurb at or under ${MAX_BLURB_LENGTH} characters`, () => {
    for (const category of CATEGORIES) {
      for (const part of partsFor(category)) {
        expect(part.blurb.length).toBeLessThanOrEqual(MAX_BLURB_LENGTH);
      }
    }
  });

  it('has no duplicate blurbs across all six categories', () => {
    const blurbs = CATEGORIES.flatMap((category) => partsFor(category).map((part) => part.blurb));
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });

  it('tags every part with the category it came from', () => {
    for (const category of CATEGORIES) {
      for (const part of partsFor(category)) {
        expect(part.category).toBe(category);
      }
    }
  });
});

describe('partAt', () => {
  it('returns the part at a valid slot', () => {
    expect(partAt('chassis', 0).id).toBe(partsFor('chassis')[0]!.id);
    expect(partAt('armour', 6).id).toBe(partsFor('armour')[6]!.id);
  });

  it('clamps a negative slot to the first part rather than returning undefined', () => {
    expect(partAt('drive', -1)).toBe(partsFor('drive')[0]);
    expect(partAt('drive', -100)).toBe(partsFor('drive')[0]);
  });

  it('clamps an over-range slot to the last part rather than returning undefined', () => {
    const parts = partsFor('personality');
    expect(partAt('personality', parts.length)).toBe(parts[parts.length - 1]);
    expect(partAt('personality', 999)).toBe(parts[parts.length - 1]);
  });
});

describe('ability parts', () => {
  it('every ability part carries an ability name and no stats', () => {
    for (const part of partsFor('ability')) {
      expect(part.ability).toBeDefined();
      expect(part.personality).toBeUndefined();
      expect(part.set).toBeUndefined();
      expect(part.add).toBeUndefined();
      expect(part.scale).toBeUndefined();
    }
  });

  it('has exactly the seven ability names from the spec, each used once', () => {
    const names = partsFor('ability').map((part) => part.ability);
    expect(new Set(names).size).toBe(7);
    expect(names.sort()).toEqual(
      ['adrenaline', 'emp', 'nitro', 'oilSlick', 'repair', 'shockwave', 'smokeScreen'].sort(),
    );
  });
});

describe('personality parts', () => {
  it('every personality part carries a personality name and no stats', () => {
    for (const part of partsFor('personality')) {
      expect(part.personality).toBeDefined();
      expect(part.ability).toBeUndefined();
      expect(part.set).toBeUndefined();
      expect(part.add).toBeUndefined();
      expect(part.scale).toBeUndefined();
    }
  });

  it('maps to all seven existing personalities exactly once each', () => {
    const names = partsFor('personality').map((part) => part.personality);
    expect(new Set(names).size).toBe(7);
  });
});

describe('chassis parts', () => {
  it('every chassis defines all three vulnerability values', () => {
    // A partial armour profile would silently inherit whatever the previous part set —
    // this is the guard against that.
    for (const part of partsFor('chassis')) {
      expect(part.set).toBeDefined();
      expect(typeof part.set!.frontVulnerability).toBe('number');
      expect(typeof part.set!.sideVulnerability).toBe('number');
      expect(typeof part.set!.rearVulnerability).toBe('number');
    }
  });
});

describe('weapon parts', () => {
  it('every weapon sets arc, damage, cooldown and knockback absolutely', () => {
    for (const part of partsFor('weapon')) {
      expect(part.set).toBeDefined();
      expect(typeof part.set!.weaponArc).toBe('number');
      expect(typeof part.set!.weaponDamage).toBe('number');
      expect(typeof part.set!.attackCooldown).toBe('number');
      expect(typeof part.set!.weaponKnockback).toBe('number');
    }
  });

  it('converts every arc from degrees to whole angle steps', () => {
    for (const part of partsFor('weapon')) {
      expect(Number.isInteger(part.set!.weaponArc)).toBe(true);
    }
  });
});

describe('armour parts', () => {
  it('every armour sets armour and damageReflect absolutely', () => {
    for (const part of partsFor('armour')) {
      expect(part.set).toBeDefined();
      expect(typeof part.set!.armour).toBe('number');
      expect(typeof part.set!.damageReflect).toBe('number');
    }
  });

  it('only Spiked Composite reflects damage', () => {
    for (const part of partsFor('armour')) {
      if (part.id === 'armour-spiked-composite') {
        expect(part.set!.damageReflect).toBeCloseTo(0.35, 8);
      } else {
        expect(part.set!.damageReflect).toBe(0);
      }
    }
  });
});

describe('drive parts', () => {
  it('every drive sets maxSpeed, thrust and grip absolutely', () => {
    for (const part of partsFor('drive')) {
      expect(part.set).toBeDefined();
      expect(typeof part.set!.maxSpeed).toBe('number');
      expect(typeof part.set!.thrust).toBe('number');
      expect(typeof part.set!.grip).toBe('number');
    }
  });
});
