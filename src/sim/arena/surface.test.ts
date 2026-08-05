import { describe, it, expect } from 'vitest';
import { createTileGrid } from './tiles';
import { Surface, createSurfaceMap, setSurface, surfaceAt, effectOf } from './surface';

const grid = () => createTileGrid(4, 3, 60);

describe('createSurfaceMap', () => {
  it('starts every tile plain', () => {
    const s = createSurfaceMap(grid());
    expect(s.length).toBe(12);
    for (const v of s) expect(v).toBe(Surface.Plain);
  });
});

describe('surfaceAt', () => {
  it('round-trips a surface', () => {
    const g = grid();
    const s = createSurfaceMap(g);
    setSurface(s, 5, Surface.Ice);
    expect(surfaceAt(g, s, 70, 70)).toBe(Surface.Ice);
  });

  it('reports plain off the grid — there is no floor to be made of', () => {
    const g = grid();
    expect(surfaceAt(g, createSurfaceMap(g), -10, -10)).toBe(Surface.Plain);
  });
});

describe('effectOf', () => {
  it('leaves plain floor completely neutral', () => {
    expect(effectOf(Surface.Plain)).toEqual({ drag: 1, grip: 1, pushX: 0, pushY: 0 });
  });

  it('makes tar slow but not slippery', () => {
    const tar = effectOf(Surface.Tar);
    expect(tar.drag).toBeLessThan(1);
    expect(tar.grip).toBe(1);
  });

  it('makes ice slippery but not slow', () => {
    const ice = effectOf(Surface.Ice);
    expect(ice.grip).toBeLessThan(1);
    expect(ice.drag).toBe(1);
  });

  it('makes gravel the inverse of ice — grippier, slightly slower', () => {
    const gravel = effectOf(Surface.Gravel);
    expect(gravel.grip).toBeGreaterThan(1);
    expect(gravel.drag).toBeLessThan(1);
  });

  it('gives conveyors a push and nothing else', () => {
    for (const s of [Surface.ConveyorN, Surface.ConveyorS, Surface.ConveyorE, Surface.ConveyorW]) {
      const e = effectOf(s);
      expect(Math.abs(e.pushX) + Math.abs(e.pushY)).toBeGreaterThan(0);
      expect(e.drag).toBe(1);
    }
  });

  it('points the four conveyors in opposite pairs', () => {
    expect(effectOf(Surface.ConveyorN).pushY).toBeLessThan(0);
    expect(effectOf(Surface.ConveyorS).pushY).toBeGreaterThan(0);
    expect(effectOf(Surface.ConveyorE).pushX).toBeGreaterThan(0);
    expect(effectOf(Surface.ConveyorW).pushX).toBeLessThan(0);
  });

  it('never returns a zero or negative multiplier', () => {
    for (const s of Object.values(Surface)) {
      expect(effectOf(s).drag).toBeGreaterThan(0);
      expect(effectOf(s).grip).toBeGreaterThan(0);
    }
  });
});
