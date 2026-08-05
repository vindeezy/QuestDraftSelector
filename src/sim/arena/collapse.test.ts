import { describe, it, expect } from 'vitest';
import { TileState, createTileGrid } from './tiles';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch, advanceMatch } from './match';
import {
  COLLAPSE_START_TICK,
  COLLAPSE_END_TICK,
  WARNING_TICKS,
  buildSpiralOrder,
  updateCollapse,
} from './collapse';

describe('buildSpiralOrder', () => {
  it('lists every tile exactly once', () => {
    const grid = createTileGrid(4, 3, 60);
    const order = buildSpiralOrder(grid);
    expect(order.length).toBe(12);
    expect(new Set(order).size).toBe(12);
  });

  it('starts on the outer ring', () => {
    const grid = createTileGrid(5, 5, 60);
    const first = buildSpiralOrder(grid)[0]!;
    const row = Math.floor(first / 5);
    const col = first % 5;
    expect(row === 0 || row === 4 || col === 0 || col === 4).toBe(true);
  });

  it('ends near the middle', () => {
    const grid = createTileGrid(5, 5, 60);
    const order = buildSpiralOrder(grid);
    const last = order[order.length - 1]!;
    const row = Math.floor(last / 5);
    const col = last % 5;
    expect(row).toBeGreaterThan(0);
    expect(row).toBeLessThan(4);
    expect(col).toBeGreaterThan(0);
    expect(col).toBeLessThan(4);
  });

  it('is deterministic', () => {
    const grid = createTileGrid(6, 4, 60);
    expect(buildSpiralOrder(grid)).toEqual(buildSpiralOrder(grid));
  });
});

describe('COLLAPSE timings', () => {
  it('starts at two and a half minutes and finishes at five', () => {
    expect(COLLAPSE_START_TICK).toBe(9000);
    expect(COLLAPSE_END_TICK).toBe(18000);
  });

  it('warns for long enough to react but not long enough to be safe', () => {
    expect(WARNING_TICKS).toBeGreaterThan(30);
    expect(WARNING_TICKS).toBeLessThan(200);
  });
});

describe('updateCollapse', () => {
  const match = () => createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: 4 });

  it('changes nothing before the start tick', () => {
    const m = match();
    const before = [...m.arena.grid.tiles];
    m.world.tick = COLLAPSE_START_TICK - 1;
    updateCollapse(m);
    expect([...m.arena.grid.tiles]).toEqual(before);
  });

  it('marks tiles WARNING before removing them', () => {
    const m = match();
    m.world.tick = COLLAPSE_START_TICK + 10;
    updateCollapse(m);
    expect([...m.arena.grid.tiles]).toContain(TileState.Warning);
  });

  it('removes every tile by the end tick', () => {
    const m = match();
    for (let t = COLLAPSE_START_TICK; t <= COLLAPSE_END_TICK; t++) {
      m.world.tick = t;
      updateCollapse(m);
    }
    for (const state of m.arena.grid.tiles) {
      expect(state).toBe(TileState.Gone);
    }
  });

  it('never restores a tile that has already gone', () => {
    const m = match();
    for (let t = COLLAPSE_START_TICK; t <= COLLAPSE_END_TICK; t += 7) {
      m.world.tick = t;
      const goneBefore = [...m.arena.grid.tiles].filter((s) => s === TileState.Gone).length;
      updateCollapse(m);
      const goneAfter = [...m.arena.grid.tiles].filter((s) => s === TileState.Gone).length;
      expect(goneAfter).toBeGreaterThanOrEqual(goneBefore);
    }
  });
});

describe('collapse in a real match', () => {
  it('guarantees a single survivor', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed, botCount: 10 });
      while (!m.done) advanceMatch(m);
      expect(m.bots.filter((b) => b.alive).length).toBeLessThanOrEqual(1);
    }
  });
});
