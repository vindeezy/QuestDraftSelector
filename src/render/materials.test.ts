// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { Graphics } from 'pixi.js';
import { drawBotPortrait } from './bot-portrait';
import { partsFor } from '../sim/parts/tables';
import type { BotBuild } from '../sim/parts/assemble';
import {
  MATERIAL_NAMES,
  armourTexture,
  materialForArmour,
  resetMaterialsForTest,
  surfaceMaterial,
  textureFor,
} from './materials';
import { ARENA_VARIANTS } from '../sim/event/arenas';
import { Surface, type SurfaceValue } from '../sim/arena/surface';

const BASE: BotBuild = { chassis: 0, drive: 0, weapon: 0, armour: 0, ability: 0, personality: 0 };

beforeEach(() => {
  resetMaterialsForTest();
});

describe('the armour to material mapping', () => {
  it('gives every one of the seven armour parts its own material', () => {
    // The entire point of MAT 1. Alloy, Aluminium and Titanium were three thin rims of
    // near-identical blue-silver, differing by a pixel or two of width; sharing a material
    // between any two of them would recreate exactly that.
    const materials = partsFor('armour').map((part) => materialForArmour(part.id));
    expect(materials.every((m) => m !== null)).toBe(true);
    expect(new Set(materials).size).toBe(partsFor('armour').length);
  });

  it('names a material that actually exists', () => {
    for (const part of partsFor('armour')) {
      expect(MATERIAL_NAMES, part.id).toContain(materialForArmour(part.id));
    }
  });

  it('returns null for an id it does not know, rather than guessing', () => {
    expect(materialForArmour('armour-unobtainium')).toBeNull();
    expect(materialForArmour('')).toBeNull();
    expect(materialForArmour('weapon-hammer')).toBeNull();
  });

  it('keys on part id, not slot index', () => {
    // Slot indices are a fact about the Plinko board's ordering. If that table is ever
    // reordered, an index-keyed table would silently dress every bot in the wrong metal, and
    // nothing would fail.
    const ids = partsFor('armour').map((p) => p.id);
    expect(ids).toContain('armour-titanium');
    expect(materialForArmour('armour-titanium')).toBe('titanium');
  });
});

describe('every material that is downloaded is actually drawn', () => {
  it('has a consumer for each one — nothing ships as dead weight', () => {
    // The guard for a real mistake. `weapon-steel` was generated, added to the load list, and
    // then never wired to anything: 35 KB downloaded on every visit to draw precisely nothing.
    // Nothing failed, because an unused asset is invisible to a type checker and to every other
    // test here.
    //
    // A material earns its download by being either an armour material or the weapon metal. Add
    // a ninth texture with no consumer and this fails.
    const consumed = new Set<string>(['weapon', 'floorOil']);
    for (const part of partsFor('armour')) {
      const m = materialForArmour(part.id);
      if (m !== null) consumed.add(m);
    }
    for (const surface of Object.values(Surface)) {
      const m = surfaceMaterial(surface as SurfaceValue);
      if (m !== null) consumed.add(m);
    }
    const orphans = MATERIAL_NAMES.filter((m) => !consumed.has(m));
    expect(orphans, `downloaded but never drawn: ${orphans.join(', ')}`).toEqual([]);
  });

  it('ships a floor texture only for surfaces an arena actually places', () => {
    // The second half of the same rule, and the reason gravel and the four conveyors are NOT
    // shipped despite having been generated: no arena places either, so they would download on
    // every visit to draw nothing. A surface mapped here but never placed is dead weight that
    // the orphan check above cannot see, because the mapping itself would make it look consumed.
    const placed = new Set<number>([Surface.Plain]);
    for (const arena of ARENA_VARIANTS) {
      for (const [, , surface] of arena.surfaces) placed.add(surface);
    }
    const mappedButUnplaced = Object.values(Surface)
      .filter((s) => surfaceMaterial(s as SurfaceValue) !== null)
      .filter((s) => !placed.has(s as number));
    expect(mappedButUnplaced, `mapped but no arena places it: ${mappedButUnplaced.join(', ')}`)
      .toEqual([]);
  });

  it('still covers every surface the arenas DO place', () => {
    // The other direction. A surface placed in an arena with no texture falls back to flat
    // colour, which is correct but silent -- this makes the omission visible.
    const placed = new Set<number>([Surface.Plain]);
    for (const arena of ARENA_VARIANTS) {
      for (const [, , surface] of arena.surfaces) placed.add(surface);
    }
    const untextured = [...placed].filter((s) => surfaceMaterial(s as SurfaceValue) === null);
    expect(untextured, `placed but untextured: ${untextured.join(', ')}`).toEqual([]);
  });
});

describe('the weapon metal', () => {
  /** The weapon layer of a freshly drawn portrait. */
  function weaponOf(build: BotBuild, weaponTexture: null | undefined) {
    return drawBotPortrait(build, 0xff8844, { weaponTexture }).weapon.node as Graphics;
  }

  it('draws every weapon with no texture loaded', () => {
    for (let weapon = 0; weapon < partsFor('weapon').length; weapon++) {
      const g = weaponOf({ ...BASE, weapon }, null);
      expect(g.context.instructions.length, `weapon ${weapon}`).toBeGreaterThan(0);
    }
  });

  it('is unchanged by passing null versus omitting the option', () => {
    for (let weapon = 0; weapon < partsFor('weapon').length; weapon++) {
      const omitted = weaponOf({ ...BASE, weapon }, undefined);
      const explicit = weaponOf({ ...BASE, weapon }, null);
      expect(explicit.context.instructions.length, `weapon ${weapon}`)
        .toBe(omitted.context.instructions.length);
    }
  });
});

describe('before anything has loaded', () => {
  it('reports no texture rather than throwing', () => {
    // This is the state every test runs in, and the state the real site is in for the first few
    // hundred milliseconds. It has to be ordinary, not exceptional.
    for (const name of MATERIAL_NAMES) expect(textureFor(name), name).toBeNull();
    for (const part of partsFor('armour')) expect(armourTexture(part.id), part.id).toBeNull();
  });

  it('reports no texture for an unknown material', () => {
    expect(textureFor(null)).toBeNull();
  });
});

describe('the fallback — a missing texture must leave the site as it ships today', () => {
  /** The chassis body is the first child; see `drawBotPortrait`. */
  function bodyOf(build: BotBuild) {
    return drawBotPortrait(build, 0xff8844).view.children[0] as Graphics;
  }

  /** A comparable summary of what a Graphics actually drew. */
  function fillSummary(g: Graphics): string {
    return JSON.stringify(
      g.context.instructions.map((i) => ({
        action: i.action,
        // `fill` carries either a plain colour or a texture-bearing style. Both shapes are
        // captured so a change from one to the other cannot slip past.
        style:
          typeof (i.data as { style?: unknown }).style === 'object'
            ? Object.keys((i.data as { style: object }).style ?? {}).sort()
            : ((i.data as { style?: unknown }).style ?? null),
      })),
    );
  }

  it('draws every chassis and armour combination with no texture loaded', () => {
    // 6 chassis x 7 armour. None of these may throw, and none may produce an empty body.
    for (let chassis = 0; chassis < partsFor('chassis').length; chassis++) {
      for (let armour = 0; armour < partsFor('armour').length; armour++) {
        const body = bodyOf({ ...BASE, chassis, armour });
        expect(body.context.instructions.length, `chassis ${chassis} armour ${armour}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('produces the same drawing with no texture as with the option omitted entirely', () => {
    // The promise made in the plan: a failed load leaves the site byte-for-byte as it was.
    // `texture: null` is the state a 404 produces, so it must be indistinguishable from the
    // call that predates the option.
    for (let armour = 0; armour < partsFor('armour').length; armour++) {
      const build = { ...BASE, armour };
      const omitted = drawBotPortrait(build, 0xff8844).view.children[0] as Graphics;
      const explicitNull = drawBotPortrait(build, 0xff8844, { texture: null })
        .view.children[0] as Graphics;
      expect(fillSummary(explicitNull), `armour ${armour}`).toBe(fillSummary(omitted));
    }
  });

  it('still fills with a plain colour when there is no texture', () => {
    // Not merely "did not crash" — the body must actually be filled, or a bot renders as an
    // outline with a hole in it.
    const body = bodyOf(BASE);
    const fills = body.context.instructions.filter((i) => i.action === 'fill');
    expect(fills.length).toBeGreaterThan(0);
  });
});
