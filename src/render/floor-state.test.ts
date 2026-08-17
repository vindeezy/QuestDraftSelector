import { describe, it, expect } from 'vitest';
import { Surface } from '../sim/arena/surface';
import {
  OIL_COLOR,
  OIL_SPLAT_RADIUS,
  isOiled,
  isTexturedSurface,
  oilSplatPoints,
} from './floor-state';

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

describe('the shape of a slick', () => {
  const SIZE = 60;

  /** The radius of each point from the splat's centre. */
  function radii(index: number): number[] {
    const pts = oilSplatPoints(0, 0, SIZE, index);
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(Math.hypot(pts[i]!, pts[i + 1]!));
    return out;
  }

  it('is not a circle — the radius has to wander or it is just a dot', () => {
    const r = radii(7);
    const spread = Math.max(...r) - Math.min(...r);
    expect(spread).toBeGreaterThan(SIZE * 0.12);
  });

  it('covers roughly the tile it stands for', () => {
    // The tile is what is slippery. A small tidy puddle would look better and misinform about
    // where it is safe to drive — the same objection that decided how far a flame is drawn.
    const r = radii(7);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    expect(mean).toBeGreaterThan(SIZE * 0.45);
    expect(mean).toBeLessThan(SIZE * 0.72);
  });

  it('never collapses to nothing or sprawls across the arena', () => {
    for (const index of [0, 1, 5, 40, 191, 9999]) {
      const r = radii(index);
      expect(Math.min(...r), `index ${index}`).toBeGreaterThan(SIZE * 0.25);
      expect(Math.max(...r), `index ${index}`).toBeLessThan(SIZE * 0.95);
    }
  });

  it('gives the SAME tile the same shape every time', () => {
    // The site has a Replay button. A spill that reshaped itself between two viewings of one
    // seed would quietly undermine the claim the whole event rests on.
    expect(oilSplatPoints(10, 20, SIZE, 42)).toEqual(oilSplatPoints(10, 20, SIZE, 42));
  });

  it('gives DIFFERENT tiles different shapes, including neighbours', () => {
    // Adjacent indices are the case that matters: a hash that leaves neighbours similar would
    // put a visible repeating rhythm across the floor.
    const shapes = [40, 41, 42, 56].map((i) => JSON.stringify(radii(i).map((n) => n.toFixed(3))));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('is centred where it is asked to be', () => {
    const pts = oilSplatPoints(100, 250, SIZE, 3);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pts.length; i += 2) {
      sx += pts[i]!;
      sy += pts[i + 1]!;
    }
    expect(sx / (pts.length / 2)).toBeCloseTo(100, 0);
    expect(sy / (pts.length / 2)).toBeCloseTo(250, 0);
  });

  it('returns a closed loop of x,y pairs', () => {
    const pts = oilSplatPoints(0, 0, SIZE, 1);
    expect(pts.length % 2).toBe(0);
    expect(pts.length / 2).toBeGreaterThanOrEqual(16);
  });

  it('keeps its mean radius clear of both the tile edge and the corner', () => {
    // Below half and every slick sits inside a visible ring of clean floor; above the
    // half-diagonal and it routinely covers corners of tiles nobody oiled.
    expect(OIL_SPLAT_RADIUS).toBeGreaterThan(0.5);
    expect(OIL_SPLAT_RADIUS).toBeLessThan(0.707);
  });
});
