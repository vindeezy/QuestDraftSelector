import { describe, it, expect } from 'vitest';
import { Surface } from '../sim/arena/surface';
import { OIL_COLOR, isOiled, isTexturedSurface } from './floor-state';

/** A surface map of `n` tiles, all plain unless overridden. */
function surfaces(n: number, overrides: Record<number, number> = {}): Uint8Array {
  const out = new Uint8Array(n).fill(Surface.Plain);
  for (const [index, value] of Object.entries(overrides)) out[Number(index)] = value;
  return out;
}

describe('finding the oil', () => {
  it('spots a tile that became ice after the match began', () => {
    const base = surfaces(9);
    const now = surfaces(9, { 4: Surface.Ice });
    expect(isOiled(base, now, 4)).toBe(true);
  });

  it('does NOT mistake the arena\'s own ice for a slick', () => {
    // The failure this whole module exists to prevent. Two of the three arenas place ice as
    // scenery; treating that as oil would paint half the floor black and make the ability
    // invisible again, by the opposite route.
    const base = surfaces(9, { 4: Surface.Ice });
    const now = surfaces(9, { 4: Surface.Ice });
    expect(isOiled(base, now, 4)).toBe(false);
  });

  it('leaves every other surface alone', () => {
    for (const surface of [Surface.Tar, Surface.Gravel, Surface.ConveyorE, Surface.Plain]) {
      const base = surfaces(4);
      const now = surfaces(4, { 1: surface });
      expect(isOiled(base, now, 1), String(surface)).toBe(false);
    }
  });

  it('sees a slick laid on top of a surface that was something else', () => {
    // Oil dropped on gravel or a conveyor is still oil.
    for (const was of [Surface.Gravel, Surface.Tar, Surface.ConveyorN, Surface.Plain]) {
      const base = surfaces(4, { 2: was });
      const now = surfaces(4, { 2: Surface.Ice });
      expect(isOiled(base, now, 2), String(was)).toBe(true);
    }
  });

  it('handles a tile that collapsed back to plain', () => {
    // Floor collapse is the only other mid-match writer, and it sets Plain. An oiled tile that
    // then dropped out of the floor must stop being oil rather than staying painted.
    const base = surfaces(4);
    const now = surfaces(4, { 3: Surface.Plain });
    expect(isOiled(base, now, 3)).toBe(false);
  });

  it('refuses an index outside either array instead of reading garbage', () => {
    const base = surfaces(4);
    const now = surfaces(4, { 0: Surface.Ice });
    for (const index of [-1, 4, 99, Number.NaN]) {
      expect(isOiled(base, now, index), String(index)).toBe(false);
    }
    // A short baseline must not produce a confident answer about tiles it does not cover.
    expect(isOiled(surfaces(2), now, 3)).toBe(false);
  });
});

describe('the oil colour', () => {
  it('is dark, where the ice it replaces is pale', () => {
    // The two are the same surface value, so colour is the only thing telling them apart.
    const red = (OIL_COLOR >> 16) & 0xff;
    const green = (OIL_COLOR >> 8) & 0xff;
    const blue = OIL_COLOR & 0xff;
    expect(Math.max(red, green, blue)).toBeLessThan(80);
    // Cooler than it is warm, and clear of the collapse warning's orange-brown.
    expect(blue).toBeGreaterThan(red);
  });
});

describe('which surfaces want a texture', () => {
  it('skips plain floor and covers the rest', () => {
    expect(isTexturedSurface(Surface.Plain)).toBe(false);
    for (const surface of [Surface.Tar, Surface.Ice, Surface.Gravel, Surface.ConveyorW]) {
      expect(isTexturedSurface(surface), String(surface)).toBe(true);
    }
  });
});
