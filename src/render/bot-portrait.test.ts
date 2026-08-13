// @vitest-environment jsdom
//
// Not for the DOM — every test below is a pure function. It is for the IMPORT: this file
// reaches `src/render/`, which pulls in pixi.js, and pixi touches `navigator` at module
// load. Node only defines `navigator` globally from v21, so under vitest's default `node`
// environment this file passes on a modern local Node and dies on CI's Node 20 with
// `ReferenceError: navigator is not defined`. jsdom supplies the global and makes the
// result independent of whichever Node is running.
import { describe, it, expect } from 'vitest';
import type { Graphics } from 'pixi.js';
import { drawBotPortrait } from './bot-portrait';
import { partsFor, slotCountFor, type CategoryName } from '../sim/parts/tables';
import type { BotBuild } from '../sim/parts/assemble';

/**
 * `drawBotPortrait` never needs a renderer to be exercised: `Graphics` builds its own
 * draw instructions and can compute its own local bounds with no WebGL/WebGPU context at
 * all (only turning them into pixels needs one) — see the module doc comment on
 * `bot-portrait.ts`. That is what makes every test in this file possible under plain
 * jsdom, no mocking required.
 */

const BASE_BUILD: BotBuild = { chassis: 0, drive: 0, weapon: 0, armour: 0, ability: 0, personality: 0 };
const MEMBER_COLOUR = 0x4ce0ff;

/**
 * `GraphicsContext.instructions`' real type is a broad union that also covers image
 * draws (`data.style` can be a bare texture id number, `data.path` doesn't exist at
 * all) — cases this module's `fill`/`stroke`-only drawing never produces. Rather than
 * fight that union with casts at every call site, `drawInstructions` below narrows to
 * this shape once, right where the underlying `GraphicsContext` is unwrapped.
 */
interface DrawInstruction {
  action: string;
  data: {
    style: { color: number; alpha: number; width?: number };
    path: { instructions: { action: string; data: unknown }[] };
  };
}

function drawInstructions(g: Graphics): DrawInstruction[] {
  return g.context.instructions as unknown as DrawInstruction[];
}

/**
 * A JSON-safe summary of everything a `Graphics` object actually drew: each
 * instruction's action (`fill`/`stroke`), its colour/alpha/width (armour's rim
 * treatments are frequently the *same* traced outline at a different thickness and
 * shade — Alloy vs. Hardened Steel is one plain stroke each, distinguished only by
 * width and colour — so those count as part of "the drawing" here), plus the shape path
 * underneath it (action and numeric point data). Deliberately excludes the rest of
 * `data.style` — a fill/stroke style object holds a `Texture`, which holds an
 * `EventEmitter`, which is circular and cannot survive `JSON.stringify`.
 */
function geometrySignature(g: Graphics): string {
  const summary = drawInstructions(g).map((instr) => ({
    action: instr.action,
    color: instr.data.style.color,
    alpha: instr.data.style.alpha,
    width: instr.data.style.width ?? null,
    path: instr.data.path.instructions.map((p) => ({
      action: p.action,
      data: Array.isArray(p.data) ? p.data.filter((d) => typeof d !== 'object' || Array.isArray(d)) : p.data,
    })),
  }));
  return JSON.stringify(summary);
}

/** `drawBotPortrait` always adds its three layers in this order — see the function body
 *  in `bot-portrait.ts`. Asserted once here (in the "distinct drawings" tests below) so
 *  every other test can just index into `view.children` without re-deriving it. */
function layersOf(build: BotBuild, colour = MEMBER_COLOUR) {
  const drawing = drawBotPortrait(build, colour);
  const [chassisLayer, armourLayer, weaponLayer] = drawing.view.children as Graphics[];
  return { drawing, chassisLayer: chassisLayer!, armourLayer: armourLayer!, weaponLayer: weaponLayer! };
}

describe('drawBotPortrait — chassis silhouettes', () => {
  const chassisParts = partsFor('chassis');

  it('every one of the 6 chassis draws genuinely different geometry from every other', () => {
    const signatures = chassisParts.map((_, slot) => {
      const { chassisLayer } = layersOf({ ...BASE_BUILD, chassis: slot });
      return geometrySignature(chassisLayer);
    });
    expect(new Set(signatures).size).toBe(chassisParts.length);
  });

  it("Tower draws at 3/4 the radius of every other chassis, matching its scale: { radius: 0.75 } stat", () => {
    const towerSlot = chassisParts.findIndex((p) => p.id === 'chassis-tower');
    const squareSlot = chassisParts.findIndex((p) => p.id === 'chassis-square');
    const { drawing: tower } = layersOf({ ...BASE_BUILD, chassis: towerSlot });
    const { drawing: square } = layersOf({ ...BASE_BUILD, chassis: squareSlot });
    expect(tower.radius).toBeCloseTo(square.radius * 0.75, 5);
  });

  it('every chassis produces a non-empty silhouette (real bounds, not a degenerate shape)', () => {
    chassisParts.forEach((_, slot) => {
      const { drawing } = layersOf({ ...BASE_BUILD, chassis: slot });
      const bounds = drawing.view.getLocalBounds();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });
  });
});

describe('drawBotPortrait — weapon attachments', () => {
  const weaponParts = partsFor('weapon');

  it('every one of the 6 weapons draws genuinely different geometry from every other', () => {
    const signatures = weaponParts.map((_, slot) => {
      const { weaponLayer } = layersOf({ ...BASE_BUILD, weapon: slot });
      return geometrySignature(weaponLayer);
    });
    expect(new Set(signatures).size).toBe(weaponParts.length);
  });

  it('every weapon draws something (not an empty layer)', () => {
    weaponParts.forEach((_, slot) => {
      const { weaponLayer } = layersOf({ ...BASE_BUILD, weapon: slot });
      expect(drawInstructions(weaponLayer).length).toBeGreaterThan(0);
    });
  });
});

describe('drawBotPortrait — armour rim treatments', () => {
  const armourParts = partsFor('armour');

  it('every one of the 7 armours draws genuinely different geometry from every other', () => {
    const signatures = armourParts.map((_, slot) => {
      const { armourLayer } = layersOf({ ...BASE_BUILD, armour: slot });
      return geometrySignature(armourLayer);
    });
    expect(new Set(signatures).size).toBe(armourParts.length);
  });

  it('Spiked Composite is the one armour that draws visible spikes — strictly more draw instructions than a plain stroke rim', () => {
    const spikedSlot = armourParts.findIndex((p) => p.id === 'armour-spiked-composite');
    const alloySlot = armourParts.findIndex((p) => p.id === 'armour-alloy');
    const { armourLayer: spiked } = layersOf({ ...BASE_BUILD, armour: spikedSlot });
    const { armourLayer: alloy } = layersOf({ ...BASE_BUILD, armour: alloySlot });
    // Alloy is the plainest treatment in the table: one stroke, no embellishment.
    expect(drawInstructions(alloy).length).toBe(1);
    // Spiked Composite adds one filled triangle per spike on top of its own rim stroke.
    expect(drawInstructions(spiked).length).toBeGreaterThan(drawInstructions(alloy).length + 1);
  });
});

describe('drawBotPortrait — geometry differs across every category, all 252 combinations', () => {
  // Not just "each category varies in isolation" (the three describe blocks above) — a
  // full chassis x weapon x armour sweep, the actual space the reveal screen can show,
  // stays exhaustively distinct and in-bounds too.
  const chassisParts = partsFor('chassis');
  const weaponParts = partsFor('weapon');
  const armourParts = partsFor('armour');

  it('every anchor lands inside the drawn bounds, for all 252 chassis x weapon x armour combinations', () => {
    for (let c = 0; c < chassisParts.length; c++) {
      for (let w = 0; w < weaponParts.length; w++) {
        for (let a = 0; a < armourParts.length; a++) {
          const { drawing } = layersOf({ ...BASE_BUILD, chassis: c, weapon: w, armour: a });
          const bounds = drawing.view.getLocalBounds();
          const eps = 1e-6;
          for (const [name, p] of Object.entries(drawing.anchors)) {
            expect(p.x, `${name} x for chassis ${c} weapon ${w} armour ${a}`).toBeGreaterThanOrEqual(bounds.x - eps);
            expect(p.x, `${name} x for chassis ${c} weapon ${w} armour ${a}`).toBeLessThanOrEqual(
              bounds.x + bounds.width + eps,
            );
            expect(p.y, `${name} y for chassis ${c} weapon ${w} armour ${a}`).toBeGreaterThanOrEqual(bounds.y - eps);
            expect(p.y, `${name} y for chassis ${c} weapon ${w} armour ${a}`).toBeLessThanOrEqual(
              bounds.y + bounds.height + eps,
            );
          }
        }
      }
    }
  });
});

describe('drawBotPortrait — member colour', () => {
  it("fills the chassis body with the member's own colour, not a fixed palette entry", () => {
    for (const colour of [0xff6a3d, 0x1c1f26, 0xffffff, 0x4ce0ff]) {
      const { chassisLayer } = layersOf(BASE_BUILD, colour);
      const fillInstruction = drawInstructions(chassisLayer).find((i) => i.action === 'fill')!;
      expect(fillInstruction.data.style.color).toBe(colour);
    }
  });

  it('two different members with the same build get the same silhouette but different fill colour', () => {
    const a = layersOf(BASE_BUILD, 0xff6a3d);
    const b = layersOf(BASE_BUILD, 0x3ddc84);

    const fillA = drawInstructions(a.chassisLayer).find((i) => i.action === 'fill')!;
    const fillB = drawInstructions(b.chassisLayer).find((i) => i.action === 'fill')!;
    expect(fillA.data.style.color).not.toBe(fillB.data.style.color);

    // The silhouette itself — path geometry, stripped of colour — is identical.
    const pathA = JSON.stringify(fillA.data.path.instructions);
    const pathB = JSON.stringify(fillB.data.path.instructions);
    expect(pathA).toBe(pathB);
  });
});

describe('drawBotPortrait — anchors', () => {
  it('exposes exactly chassis, weapon and armour anchors — no anchor for drive, ability or personality', () => {
    const { drawing } = layersOf(BASE_BUILD);
    const anchorKeys = Object.keys(drawing.anchors).sort();
    expect(anchorKeys).toEqual(['armour', 'chassis', 'weapon']);
  });

  it('the weapon anchor sits further forward (+x) than the chassis anchor, which sits at the rear (-x)', () => {
    const { drawing } = layersOf(BASE_BUILD);
    expect(drawing.anchors.weapon.x).toBeGreaterThan(0);
    expect(drawing.anchors.chassis.x).toBeLessThan(0);
  });
});

/** Sanity check on the category table itself, since every describe block above assumes
 *  these counts — if `tables.ts` ever grows a slot, this fails loudly instead of the
 *  "every one draws differently" tests silently checking fewer parts than exist. */
describe('bot-portrait.test.ts assumptions', () => {
  const EXPECTED: Partial<Record<CategoryName, number>> = { chassis: 6, weapon: 6, armour: 7 };
  for (const [category, count] of Object.entries(EXPECTED)) {
    it(`${category} still has ${count} slots`, () => {
      expect(slotCountFor(category as CategoryName)).toBe(count);
    });
  }
});
