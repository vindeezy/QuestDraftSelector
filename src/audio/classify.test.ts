import { describe, it, expect } from 'vitest';
import {
  CROSSFIRE_ARENA, DEFAULT_ARENA, GAUNTLET_ARENA, GRINDER_ARENA, PROVING_ARENA,
} from '../sim/arena/arena';
import { partAt, slotCountFor } from '../sim/parts/tables';
import type { BotBuild } from '../sim/parts/assemble';
import type { Effect } from '../sim/arena/effects';
import { ABILITY_SOUNDS, WEAPON_SOUNDS, hazardSoundFor, soundFor } from './classify';

/**
 * The differentiation rulebook, and the only part of the audio layer that is pure enough to
 * test properly. These tests ARE the requirement — "every weapon, ability and hazard sounds
 * different" is asserted against the real part tables, so renaming a part fails here with
 * the missing id rather than silently falling back to a generic thud on draft night.
 */

/** A build whose slots are all 0 except the ones named. */
function buildWith(overrides: Partial<BotBuild> = {}): BotBuild {
  return { chassis: 0, drive: 0, weapon: 0, armour: 0, ability: 0, personality: 0, ...overrides };
}

/** Ten builds, with `index` replaced by `build`. */
function roster(index: number, build: BotBuild): BotBuild[] {
  return Array.from({ length: 10 }, (_, i) => (i === index ? build : buildWith()));
}

function effect(kind: Effect['kind'], botId: string | null, source?: string): Effect {
  return { kind, x: 0, y: 0, intensity: 0.5, botId, ...(source === undefined ? {} : { source }) };
}

/** The slot index of a part id, so the tests name parts the way a person would. */
function slotOf(category: 'weapon' | 'ability', id: string): number {
  for (let i = 0; i < slotCountFor(category); i++) {
    if (partAt(category, i).id === id) return i;
  }
  throw new Error(`no ${category} with id ${id}`);
}

describe('soundFor — weapons', () => {
  it('picks the sound from the WEAPON that landed the hit, not from the event kind', () => {
    const builds = roster(3, buildWith({ weapon: slotOf('weapon', 'weapon-saw-blade') }));
    expect(soundFor(effect('weaponHit', 'bot-3'), builds)).toBe('sawBuzz');
  });

  it('gives a hammer and a saw different sounds from the same event kind', () => {
    const hammer = roster(0, buildWith({ weapon: slotOf('weapon', 'weapon-hammer') }));
    const saw = roster(0, buildWith({ weapon: slotOf('weapon', 'weapon-saw-blade') }));
    expect(soundFor(effect('weaponHit', 'bot-0'), hammer)).not.toBe(
      soundFor(effect('weaponHit', 'bot-0'), saw),
    );
  });

  it('has an entry for every weapon in the table', () => {
    for (let slot = 0; slot < slotCountFor('weapon'); slot++) {
      const id = partAt('weapon', slot).id;
      expect(WEAPON_SOUNDS.has(id), `no sound for ${id}`).toBe(true);
    }
  });

  it('gives every weapon its OWN sound — no two share one', () => {
    expect(new Set(WEAPON_SOUNDS.values()).size).toBe(slotCountFor('weapon'));
  });
});

describe('soundFor — abilities', () => {
  it('picks the sound from the ABILITY that fired', () => {
    const builds = roster(5, buildWith({ ability: slotOf('ability', 'ability-emp') }));
    expect(soundFor(effect('abilityFire', 'bot-5'), builds)).toBe('electricZap');
  });

  it('has an entry for every ability in the table', () => {
    for (let slot = 0; slot < slotCountFor('ability'); slot++) {
      const id = partAt('ability', slot).id;
      expect(ABILITY_SOUNDS.has(id), `no sound for ${id}`).toBe(true);
    }
  });

  it('gives every ability its OWN sound', () => {
    expect(new Set(ABILITY_SOUNDS.values()).size).toBe(slotCountFor('ability'));
  });
});

describe('soundFor — hazards', () => {
  it('picks the sound from the hazard id prefix', () => {
    const builds = roster(0, buildWith());
    expect(soundFor(effect('hazardHit', 'bot-1', 'flame-12'), builds)).toBe('flameHiss');
    expect(soundFor(effect('hazardHit', 'bot-1', 'saw-3'), builds)).toBe('sawGrind');
    expect(soundFor(effect('hazardHit', 'bot-1', 'cannon-25'), builds)).toBe('shellImpact');
    expect(soundFor(effect('hazardHit', 'bot-1', 'crusher'), builds)).toBe('crusherSlam');
  });

  it('reads the prefix, not the whole id, so numbering never matters', () => {
    expect(hazardSoundFor('flame-2')).toBe(hazardSoundFor('flame-24'));
    expect(hazardSoundFor('cannon-l')).toBe(hazardSoundFor('cannon-top'));
  });

  it('falls back audibly on an unknown hazard rather than going silent', () => {
    // A new hazard should sound like SOMETHING the first time it fires, not like nothing.
    expect(hazardSoundFor('mystery-9')).toBe('bluntImpact');
    expect(hazardSoundFor(undefined)).toBe('bluntImpact');
  });

  it('has a real sound for every hazard in every arena — nothing reaches the fallback', () => {
    // The counterpart to the weapon and ability completeness checks, and the reason they
    // matter: the fallback above is deliberately audible, so a hazard that slipped through
    // would NOT be silent on draft night — it would just sound wrong, which is far harder to
    // notice. Asserting against the real arenas means a new hazard family fails here.
    const arenas = [
      DEFAULT_ARENA, PROVING_ARENA, GRINDER_ARENA, GAUNTLET_ARENA, CROSSFIRE_ARENA,
    ];
    const ids = arenas.flatMap((a) => [
      ...a.zones.map((z) => z.id),
      ...a.emitters.map((e) => e.id),
    ]);

    expect(ids.length).toBeGreaterThan(0); // guards against the arenas losing their hazards
    for (const id of ids) {
      expect(hazardSoundFor(id), `${id} falls back instead of having its own sound`)
        .not.toBe('bluntImpact');
    }
  });
});

describe('soundFor — everything else', () => {
  const builds = roster(0, buildWith());

  it('maps the fixed event kinds', () => {
    expect(soundFor(effect('collision', null), builds)).toBe('dullThud');
    expect(soundFor(effect('elimination', 'bot-2'), builds)).toBe('explosion');
    expect(soundFor(effect('cannonFire', null, 'cannon-25'), builds)).toBe('deepBoom');
    expect(soundFor(effect('trapdoor', null, 'trap-1'), builds)).toBe('mechanicalClunk');
  });

  it('falls back to the generic tick when a weaponHit has no identifiable bot', () => {
    expect(soundFor(effect('weaponHit', null), builds)).toBe('metallicTick');
    expect(soundFor(effect('weaponHit', 'bot-99'), builds)).toBe('metallicTick');
    expect(soundFor(effect('weaponHit', 'not-a-bot-id'), builds)).toBe('metallicTick');
  });

  it('never returns nothing, for any kind, with or without builds', () => {
    const kinds: Effect['kind'][] = [
      'weaponHit', 'hazardHit', 'collision', 'elimination', 'cannonFire', 'trapdoor', 'abilityFire',
    ];
    for (const kind of kinds) {
      expect(soundFor(effect(kind, 'bot-0'), builds), kind).toBeTruthy();
      expect(soundFor(effect(kind, 'bot-0'), []), `${kind} with no builds`).toBeTruthy();
    }
  });
});
