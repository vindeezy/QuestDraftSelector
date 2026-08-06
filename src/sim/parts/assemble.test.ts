import { describe, it, expect } from 'vitest';
import { assemble, type BotBuild } from './assemble';
import { CATEGORIES, slotCountFor } from './tables';

/** A build using slot 3 in every category — one of the two "common" slots in every table
 * that has rarity at all, and a genuine middle slot in the 7-wide categories. */
const ALL_COMMON: BotBuild = {
  chassis: 3,
  drive: 3,
  weapon: 3,
  armour: 3,
  ability: 3,
  personality: 3,
};

describe('assemble: all-common build', () => {
  it('produces sensible stats', () => {
    const { stats } = assemble(ALL_COMMON);

    expect(stats.radius).toBeGreaterThan(0);
    expect(stats.mass).toBeGreaterThan(0);
    expect(stats.maxHealth).toBeGreaterThan(0);
    expect(stats.armour).toBeGreaterThan(0);
    expect(stats.grip).toBeGreaterThan(0);
    expect(stats.maxSpeed).toBeGreaterThan(0);
    expect(stats.maxSpeed).toBeLessThan(stats.radius);
    expect(stats.attackCooldown).toBeGreaterThanOrEqual(1);
    expect(stats.weaponDamage).toBeGreaterThan(0);
    expect(stats.thrust).toBeGreaterThan(0);
    expect(stats.turnRate).toBeGreaterThan(0);
  });
});

describe('assemble: chassis shape', () => {
  it('a Wedge chassis (slot 0) yields a 0.40 front vulnerability', () => {
    const { stats } = assemble({ ...ALL_COMMON, chassis: 0 });
    expect(stats.frontVulnerability).toBeCloseTo(0.4, 8);
  });
});

describe('assemble: order of application', () => {
  it('Depleted Uranium (armour 0) + Box (chassis 4) is heavier than Carbon Fibre (armour 1) + Tower (chassis 5)', () => {
    const heavy = assemble({ ...ALL_COMMON, chassis: 4, armour: 0 });
    const light = assemble({ ...ALL_COMMON, chassis: 5, armour: 1 });
    expect(heavy.stats.mass).toBeGreaterThan(light.stats.mass);
  });

  it('assembling the same build twice gives identical output', () => {
    const build: BotBuild = { chassis: 4, drive: 5, weapon: 1, armour: 0, ability: 5, personality: 6 };
    const first = assemble(build);
    const second = assemble(build);

    expect(second.stats).toEqual(first.stats);
    expect(second.ability).toBe(first.ability);
    expect(second.personality).toBe(first.personality);
    expect(second.partLabels).toEqual(first.partLabels);
  });

  it('does not let one build leak mutable state into another', () => {
    const first = assemble({ ...ALL_COMMON, chassis: 4, armour: 0 });
    const second = assemble(ALL_COMMON);

    // Mutating the result of one call must not affect a later call's output.
    first.stats.mass = -999;
    first.partLabels.chassis = 'tampered';

    const third = assemble(ALL_COMMON);
    expect(third.stats.mass).toBe(second.stats.mass);
    expect(third.partLabels.chassis).toBe(second.partLabels.chassis);
  });
});

describe('assemble: labels and names', () => {
  it('partLabels carries a human-readable name for all six categories', () => {
    const { partLabels } = assemble(ALL_COMMON);
    for (const category of CATEGORIES) {
      expect(typeof partLabels[category]).toBe('string');
      expect(partLabels[category].length).toBeGreaterThan(0);
    }
  });

  it('ability and personality come through as names', () => {
    const { ability, personality } = assemble({ ...ALL_COMMON, ability: 0, personality: 0 });
    expect(ability).toBe('emp');
    expect(personality).toBe('aggressive');
  });
});

describe('assemble: out-of-range slots', () => {
  it('clamps rather than crashing', () => {
    const build: BotBuild = {
      chassis: -1,
      drive: 999,
      weapon: -50,
      armour: 1000,
      ability: -1,
      personality: 999,
    };
    expect(() => assemble(build)).not.toThrow();

    const result = assemble(build);
    expect(result.stats.radius).toBeGreaterThan(0);
    expect(result.ability).toBeTruthy();
    expect(result.personality).toBeTruthy();
  });
});

describe('assemble: exhaustive tunnelling and non-positivity guard', () => {
  it(
    'no build in the entire 74,088-combination space produces maxSpeed >= radius, or a non-positive maxHealth, mass, armour or grip',
    () => {
      const counts = {
        chassis: slotCountFor('chassis'),
        drive: slotCountFor('drive'),
        weapon: slotCountFor('weapon'),
        armour: slotCountFor('armour'),
        ability: slotCountFor('ability'),
        personality: slotCountFor('personality'),
      };

      let total = 0;
      for (let chassis = 0; chassis < counts.chassis; chassis++) {
        for (let drive = 0; drive < counts.drive; drive++) {
          for (let weapon = 0; weapon < counts.weapon; weapon++) {
            for (let armour = 0; armour < counts.armour; armour++) {
              for (let ability = 0; ability < counts.ability; ability++) {
                for (let personality = 0; personality < counts.personality; personality++) {
                  total++;
                  const { stats } = assemble({ chassis, drive, weapon, armour, ability, personality });

                  if (stats.maxSpeed >= stats.radius) {
                    throw new Error(
                      `tunnelling: maxSpeed ${stats.maxSpeed} >= radius ${stats.radius} for build ` +
                        `chassis=${chassis} drive=${drive} weapon=${weapon} armour=${armour} ` +
                        `ability=${ability} personality=${personality}`,
                    );
                  }
                  if (stats.maxHealth <= 0) {
                    throw new Error(`non-positive maxHealth ${stats.maxHealth} for build chassis=${chassis} drive=${drive} weapon=${weapon} armour=${armour} ability=${ability} personality=${personality}`);
                  }
                  if (stats.mass <= 0) {
                    throw new Error(`non-positive mass ${stats.mass} for build chassis=${chassis} drive=${drive} weapon=${weapon} armour=${armour} ability=${ability} personality=${personality}`);
                  }
                  if (stats.armour <= 0) {
                    throw new Error(`non-positive armour ${stats.armour} for build chassis=${chassis} drive=${drive} weapon=${weapon} armour=${armour} ability=${ability} personality=${personality}`);
                  }
                  if (stats.grip <= 0) {
                    throw new Error(`non-positive grip ${stats.grip} for build chassis=${chassis} drive=${drive} weapon=${weapon} armour=${armour} ability=${ability} personality=${personality}`);
                  }
                }
              }
            }
          }
        }
      }

      expect(total).toBe(6 * 6 * 6 * 7 * 7 * 7);
    },
    30000,
  );
});
