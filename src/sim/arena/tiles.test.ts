import { describe, it, expect } from 'vitest';
import {
  TileState,
  createTileGrid,
  tileIndexAt,
  tileStateAt,
  setTileState,
  isOverHole,
  solidTileCount,
} from './tiles';

const grid = () => createTileGrid(4, 3, 60);

describe('createTileGrid', () => {
  it('starts every tile solid', () => {
    const g = grid();
    expect(g.tiles.length).toBe(12);
    expect(solidTileCount(g)).toBe(12);
  });

  it('records its pixel dimensions', () => {
    const g = grid();
    expect(g.width).toBe(240);
    expect(g.height).toBe(180);
  });
});

describe('tileIndexAt', () => {
  it('maps a position to a tile index in row-major order', () => {
    const g = grid();
    expect(tileIndexAt(g, 10, 10)).toBe(0);
    expect(tileIndexAt(g, 70, 10)).toBe(1);
    expect(tileIndexAt(g, 10, 70)).toBe(4);
    expect(tileIndexAt(g, 230, 170)).toBe(11);
  });

  it('returns -1 outside the grid', () => {
    const g = grid();
    expect(tileIndexAt(g, -1, 10)).toBe(-1);
    expect(tileIndexAt(g, 10, -1)).toBe(-1);
    expect(tileIndexAt(g, 240, 10)).toBe(-1);
    expect(tileIndexAt(g, 10, 180)).toBe(-1);
  });

  it('puts a boundary exactly on the higher tile', () => {
    const g = grid();
    expect(tileIndexAt(g, 60, 0)).toBe(1);
    expect(tileIndexAt(g, 0, 60)).toBe(4);
  });
});

describe('setTileState and tileStateAt', () => {
  it('round-trips a state change', () => {
    const g = grid();
    setTileState(g, 5, TileState.Gone);
    expect(tileStateAt(g, 70, 70)).toBe(TileState.Gone);
    expect(solidTileCount(g)).toBe(11);
  });

  it('counts WARNING tiles as still solid', () => {
    const g = grid();
    setTileState(g, 5, TileState.Warning);
    expect(solidTileCount(g)).toBe(12);
  });
});

describe('isOverHole', () => {
  it('is false over a solid tile', () => {
    expect(isOverHole(grid(), 10, 10)).toBe(false);
  });

  it('is false over a warning tile — it has not dropped yet', () => {
    const g = grid();
    setTileState(g, 0, TileState.Warning);
    expect(isOverHole(g, 10, 10)).toBe(false);
  });

  it('is true over a gone tile', () => {
    const g = grid();
    setTileState(g, 0, TileState.Gone);
    expect(isOverHole(g, 10, 10)).toBe(true);
  });

  it('is true anywhere outside the grid — leaving the arena is falling', () => {
    const g = grid();
    expect(isOverHole(g, -5, 10)).toBe(true);
    expect(isOverHole(g, 1000, 10)).toBe(true);
    expect(isOverHole(g, 10, -5)).toBe(true);
  });
});
