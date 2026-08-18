import { describe, it, expect } from 'vitest';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from '../sim/event/arenas';
import { Surface, type SurfaceValue } from '../sim/arena/surface';
import { OIL_COLOR, PLAIN_FLOOR_COLOR, SURFACE_COLOR } from '../render/floor-state';
import { FLOOR_BACKDROP, FLOOR_KEY, hasMovementEffect, keyedSurfaces, swatchHex } from './floor-key';

/** WCAG relative luminance, on a 24-bit colour. */
function luminance(colour: number): number {
  const channel = (shift: number): number => {
    const c = ((colour >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every surface the three battles actually place on the floor. */
function surfacesInPlay(): Set<SurfaceValue> {
  const out = new Set<SurfaceValue>();
  for (const arena of ARENA_VARIANTS) {
    for (const [, , surface] of arena.surfaces) out.add(surface);
  }
  return out;
}

describe('what the key covers', () => {
  it('describes exactly the surfaces the three arenas place — no more, no less', () => {
    // The whole point of the module. `Surface` defines Gravel and four conveyors as well,
    // all implemented and all placed by zero arenas; listing them would teach the room to
    // watch for floors that never appear. Asserted as set EQUALITY rather than a subset, so
    // this fails in both directions: adding gravel to an arena later breaks the key instead
    // of quietly leaving it under-described.
    expect([...keyedSurfaces()].sort()).toEqual([...surfacesInPlay()].sort());
  });

  it('is Tar and Ice today, which is worth stating out loud', () => {
    // Pinned literally as well as structurally. If this ever changes, the change should be a
    // decision somebody made, not something noticed on draft night.
    expect([...surfacesInPlay()].sort()).toEqual([Surface.Tar, Surface.Ice].sort());
  });

  it('never describes a surface that does nothing', () => {
    for (const surface of keyedSurfaces()) {
      expect(hasMovementEffect(surface), String(surface)).toBe(true);
    }
  });

  it('leaves the collapsing floor and every hazard out', () => {
    const text = FLOOR_KEY.map((e) => `${e.label} ${e.blurb}`).join(' ').toLowerCase();
    // Crossfire's hidden traps are the one thing that arena is built around, and the pits
    // are a spectacle nobody needs briefing on.
    for (const word of ['saw', 'flame', 'cannon', 'button', 'pit', 'collapse', 'trapdoor']) {
      expect(text, word).not.toContain(word);
    }
  });
});

describe('the swatch colours', () => {
  it('takes every colour from the renderer rather than a copy', () => {
    // A legend with hardcoded hex is a legend that goes wrong the next time the floor is
    // retuned, silently, on the one screen whose job is explaining the floor.
    const byLabel = new Map(FLOOR_KEY.map((e) => [e.label, e.colour]));
    expect(byLabel.get('Tar')).toBe(SURFACE_COLOR[Surface.Tar]);
    expect(byLabel.get('Ice')).toBe(SURFACE_COLOR[Surface.Ice]);
    expect(byLabel.get('Oil')).toBe(OIL_COLOR);
  });

  it('gives every entry a colour a viewer can actually tell apart', () => {
    // Three swatches side by side. Two that read the same would be worse than no key.
    const seen = new Set(FLOOR_KEY.map((e) => e.colour));
    expect(seen.size).toBe(FLOOR_KEY.length);
  });

  it('frames every swatch against the arena floor, not the card', () => {
    // The bug this caught, with the numbers that caught it. Tar and oil are very dark and
    // the key's card sits on `--bg-1` (0x0b0f16), so the bare swatches measured 1.12:1 and
    // 1.09:1 against it — two black squares where the legend's whole job is showing a
    // colour. Against the plain floor, which is what they sit on in a real battle, the same
    // colours clear 2:1 and are perfectly readable. The swatch shows the surface framed in
    // floor, so the legend carries the same contrast as the thing it describes.
    expect(FLOOR_BACKDROP).toBe(PLAIN_FLOOR_COLOR);

    const CARD_BG = 0x0b0f16;
    for (const entry of FLOOR_KEY) {
      const vsFloor = contrast(entry.colour, FLOOR_BACKDROP);
      expect(vsFloor, `${entry.label} against the floor`).toBeGreaterThan(1.9);
      // Not asserted as "better than the card" for ice, which is pale and reads fine on
      // either. The dark two are the ones that needed the backdrop.
      if (contrast(entry.colour, CARD_BG) < 1.5) {
        expect(vsFloor, `${entry.label} rescued by the backdrop`).toBeGreaterThan(
          contrast(entry.colour, CARD_BG),
        );
      }
    }
  });

  it('keeps every swatch distinguishable from the backdrop it sits on', () => {
    // A surface whose colour drifted towards the plain floor would produce a swatch that
    // looks like an empty frame.
    for (const entry of FLOOR_KEY) {
      expect(contrast(entry.colour, FLOOR_BACKDROP), entry.label).toBeGreaterThan(1.5);
    }
  });

  it('formats as six-digit hex, including colours with a leading zero byte', () => {
    expect(swatchHex(0x241a10)).toBe('#241a10');
    expect(swatchHex(0x7fc4e8)).toBe('#7fc4e8');
    expect(swatchHex(0x00ff00)).toBe('#00ff00');
    expect(swatchHex(0x000001)).toBe('#000001');
  });
});

describe('the entries themselves', () => {
  it('gives every entry a label and a blurb', () => {
    for (const entry of FLOOR_KEY) {
      expect(entry.label.length, entry.label).toBeGreaterThan(0);
      expect(entry.blurb.length, entry.label).toBeGreaterThan(0);
    }
  });

  it('marks oil as the one entry with no surface behind it', () => {
    // Oil is `Surface.Ice` in the simulation. The key lists it separately because it looks
    // nothing like ice and arrives for a different reason; `surface: null` is what keeps it
    // out of the coverage comparison above.
    const oil = FLOOR_KEY.find((e) => e.label === 'Oil')!;
    expect(oil.surface).toBeNull();
    expect(oil.blurb.toLowerCase()).toContain('ability');
  });

  it('names three arenas, matching what the event actually runs', () => {
    // The moved copy on this panel opens with "Three arenas". If a fourth is ever added the
    // sentence is wrong, and this is the cheapest place to find that out.
    expect(ARENA_VARIANT_NAMES).toHaveLength(3);
    expect(ARENA_VARIANTS).toHaveLength(3);
  });
});
