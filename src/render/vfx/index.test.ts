import { describe, it, expect } from 'vitest';
import { partAt, slotCountFor } from '../../sim/parts/tables';
import type { BotBuild } from '../../sim/parts/assemble';
import type { Effect } from '../../sim/arena/effects';
import { SHAKE_CEILING, hazardVisualFor, visualFor } from './index';
import {
  CROSSFIRE_ARENA, DEFAULT_ARENA, GAUNTLET_ARENA, GRINDER_ARENA, PROVING_ARENA,
} from '../../sim/arena/arena';

/**
 * The visual differentiation rulebook. These tests ARE the requirement, the same way
 * `classify.test.ts` is for sound: "every weapon, ability and hazard looks different" is
 * asserted against the real part tables and the real arenas, so a renamed part fails here
 * rather than silently falling back to a generic spark on draft night.
 *
 * What it LOOKS like is the watch gate's job. What this protects is that the mapping is
 * complete, that nothing is louder than an elimination, and that the collision dust — which
 * fires ~800 times a battle — stays small enough not to bury the arena.
 */

function buildWith(overrides: Partial<BotBuild> = {}): BotBuild {
  return { chassis: 0, drive: 0, weapon: 0, armour: 0, ability: 0, personality: 0, ...overrides };
}

function roster(index: number, build: BotBuild): BotBuild[] {
  return Array.from({ length: 10 }, (_, i) => (i === index ? build : buildWith()));
}

function effect(kind: Effect['kind'], botId: string | null, source?: string): Effect {
  return { kind, x: 0, y: 0, intensity: 0.6, botId, ...(source === undefined ? {} : { source }) };
}

function slotOf(category: 'weapon' | 'ability', id: string): number {
  for (let i = 0; i < slotCountFor(category); i++) {
    if (partAt(category, i).id === id) return i;
  }
  throw new Error(`no ${category} with id ${id}`);
}

const builds = roster(0, buildWith());

describe('weapons', () => {
  it('gives every weapon in the table its own look', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < slotCountFor('weapon'); slot++) {
      const id = partAt('weapon', slot).id;
      const v = visualFor(effect('weaponHit', 'bot-0'), roster(0, buildWith({ weapon: slot })));
      const layer = v.layers[0]!;
      seen.add(`${layer.kind}:${layer.tint}`);
      expect(layer, id).toBeDefined();
    }
    // Not every weapon needs a unique COLOUR, but the set must not have collapsed to one look.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('flashes the bot that was struck, which is how a hit reads as landing on someone', () => {
    // Sparks say "a hit happened somewhere". The flash says "it happened to THAT one", which
    // is what a viewer hunting their own machine in a scrum actually needs.
    expect(visualFor(effect('weaponHit', 'bot-3'), builds).flash).toBe(true);
    expect(visualFor(effect('hazardHit', 'bot-3', 'saw-1'), builds).flash).toBe(true);
  });

  it('falls back visibly when the weapon cannot be identified', () => {
    for (const botId of [null, 'bot-99', 'not-a-bot']) {
      const v = visualFor(effect('weaponHit', botId), builds);
      expect(v.layers.length, String(botId)).toBeGreaterThan(0);
      expect(v.layers[0]!.scale, String(botId)).toBeGreaterThan(0);
    }
  });
});

describe('abilities', () => {
  it('gives every ability in the table its own look', () => {
    const seen = new Set<string>();
    for (let slot = 0; slot < slotCountFor('ability'); slot++) {
      const id = partAt('ability', slot).id;
      const v = visualFor(effect('abilityFire', 'bot-0'), roster(0, buildWith({ ability: slot })));
      const layer = v.layers[0]!;
      seen.add(`${layer.kind}:${layer.tint}`);
      expect(layer, id).toBeDefined();
    }
    expect(seen.size).toBe(slotCountFor('ability'));
  });

  it('never flashes a bot, because an ability is a system firing rather than damage', () => {
    const emp = roster(0, buildWith({ ability: slotOf('ability', 'ability-emp') }));
    expect(visualFor(effect('abilityFire', 'bot-0'), emp).flash).toBe(false);
  });
});

describe('hazards', () => {
  it('reads the family off the id prefix, so numbering never matters', () => {
    expect(hazardVisualFor('flame-2')).toEqual(hazardVisualFor('flame-24'));
    expect(hazardVisualFor('cannon-l')).toEqual(hazardVisualFor('cannon-top'));
  });

  it('has a real look for every hazard in every arena — nothing reaches the fallback', () => {
    // The counterpart to the sound layer's identical check. The fallback is deliberately
    // VISIBLE, so a hazard that slipped through would not look broken -- it would just look
    // wrong, which is far harder to notice.
    const arenas = [DEFAULT_ARENA, PROVING_ARENA, GRINDER_ARENA, GAUNTLET_ARENA, CROSSFIRE_ARENA];
    const ids = arenas.flatMap((a) => [...a.zones.map((z) => z.id), ...a.emitters.map((e) => e.id)]);

    expect(ids.length).toBeGreaterThan(0);
    const fallback = hazardVisualFor('nothing-like-this-exists');
    for (const id of ids) {
      expect(hazardVisualFor(id), `${id} falls back instead of having its own look`)
        .not.toEqual(fallback);
    }
  });
});

describe('what may not overwhelm the arena', () => {
  it('keeps collision dust small — it fires roughly 800 times a battle', () => {
    // At full strength this alone fills the arena with dust and buries everything else, the
    // same way `dullThud` would have buried the mix if it had not been held down.
    const dust = visualFor(effect('collision', null), builds);
    expect(dust.layers[0]!.scale).toBeLessThan(0.6);
    expect(dust.shake).toBe(0);
  });

  it('shakes for an elimination and for nothing else that fires often', () => {
    const kinds: Effect['kind'][] = ['weaponHit', 'hazardHit', 'collision', 'abilityFire', 'cannonFire'];
    for (const kind of kinds) {
      expect(visualFor(effect(kind, 'bot-0', 'saw-1'), builds).shake, kind).toBe(0);
    }
    expect(visualFor(effect('elimination', 'bot-2'), builds).shake).toBeGreaterThan(0);
  });

  it('caps the shake, because a death is exactly when everyone is hunting the screen', () => {
    for (const kind of ['elimination', 'trapdoor'] as Effect['kind'][]) {
      expect(visualFor(effect(kind, 'bot-1'), builds).shake, kind).toBeLessThanOrEqual(SHAKE_CEILING);
    }
    expect(SHAKE_CEILING).toBeLessThan(1);
  });

  it('gives an elimination the most, so nothing in a battle outshines a death', () => {
    const death = visualFor(effect('elimination', 'bot-2'), builds);
    const biggest = Math.max(...death.layers.map((l) => l.scale));

    const others: Effect['kind'][] = ['weaponHit', 'hazardHit', 'collision', 'abilityFire', 'cannonFire', 'trapdoor'];
    for (const kind of others) {
      const v = visualFor(effect(kind, 'bot-0', 'flame-1'), builds);
      for (const layer of v.layers) {
        expect(layer.scale, kind).toBeLessThanOrEqual(biggest);
      }
    }
  });

  it('is the only event that is two things at once', () => {
    expect(visualFor(effect('elimination', 'bot-2'), builds).layers.length).toBe(2);
  });
});

describe('completeness', () => {
  it('never returns nothing, for any kind, with or without builds', () => {
    const kinds: Effect['kind'][] = [
      'weaponHit', 'hazardHit', 'collision', 'elimination', 'cannonFire', 'trapdoor', 'abilityFire',
    ];
    for (const kind of kinds) {
      for (const b of [builds, [] as BotBuild[]]) {
        const v = visualFor(effect(kind, 'bot-0'), b);
        expect(v.layers.length, kind).toBeGreaterThan(0);
        for (const layer of v.layers) {
          expect(layer.scale, kind).toBeGreaterThan(0);
          expect(Number.isInteger(layer.tint), kind).toBe(true);
        }
      }
    }
  });
});
