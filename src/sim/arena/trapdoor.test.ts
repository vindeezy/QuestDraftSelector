import { describe, it, expect } from 'vitest';
import { createTrapdoor, updateTrapdoors } from './trapdoor';
import { createTileGrid, TileState } from './tiles';
import { createButton, triggered, updateButtons, type Button } from './activation';
import { createBot } from './bot';
import { DEFAULT_MATCH, createMatch, advanceMatch } from './match';
import { PROVING_ARENA, type ArenaConfig } from './arena';
import { COLLAPSE_END_TICK, COLLAPSE_START_TICK } from './collapse';
import { Surface } from './surface';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });

describe('createTrapdoor', () => {
  it('starts closed', () => {
    const t = createTrapdoor('t', [[0, 0]], triggered('a'));
    expect(t.open).toBe(false);
  });
});

describe('updateTrapdoors', () => {
  it('opens its tiles while its button is armed and closes them when the latch expires', () => {
    const grid = createTileGrid(5, 5, 60);
    const button = createButton('plate', 100, 100, 30, 90, 0);
    const buttons = new Map<string, Button>([[button.id, button]]);
    const trapdoor = createTrapdoor('t1', [[2, 2]], triggered('plate'));
    const index = 2 * 5 + 2;

    // Nobody on the plate yet: closed.
    updateButtons(buttons, [], 0);
    updateTrapdoors([trapdoor], grid, 0, buttons);
    expect(trapdoor.open).toBe(false);
    expect(grid.tiles[index]).toBe(TileState.Solid);

    // A bot steps on the plate: the trapdoor opens.
    updateButtons(buttons, [bot(105, 100)], 1);
    updateTrapdoors([trapdoor], grid, 1, buttons);
    expect(trapdoor.open).toBe(true);
    expect(grid.tiles[index]).toBe(TileState.Gone);

    // The bot leaves, but the latch (90 ticks) keeps it armed for a while.
    updateButtons(buttons, [bot(900, 900)], 2);
    updateTrapdoors([trapdoor], grid, 2, buttons);
    expect(trapdoor.open).toBe(true);
    expect(grid.tiles[index]).toBe(TileState.Gone);

    // Latch expires at tick 91 (armed at 1, latchTicks 90 -> armedUntil 91).
    updateButtons(buttons, [bot(900, 900)], 91);
    updateTrapdoors([trapdoor], grid, 91, buttons);
    expect(trapdoor.open).toBe(false);
    expect(grid.tiles[index]).toBe(TileState.Solid);
  });

  it('covers every configured tile, not just the first', () => {
    const grid = createTileGrid(5, 5, 60);
    const button = createButton('plate', 100, 100, 30, 0, 0);
    const buttons = new Map<string, Button>([[button.id, button]]);
    const trapdoor = createTrapdoor('t1', [[1, 1], [2, 1], [1, 2], [2, 2]], triggered('plate'));

    updateButtons(buttons, [bot(105, 100)], 0);
    updateTrapdoors([trapdoor], grid, 0, buttons);

    for (const [col, row] of trapdoor.tiles) {
      expect(grid.tiles[row * 5 + col]).toBe(TileState.Gone);
    }
  });
});

describe('trapdoor and falling', () => {
  it('a bot standing over an open trapdoor falls, and the same bot on a closed one does not', () => {
    // One arena where the button sits under the bot itself (so the trapdoor is armed the
    // instant the match starts), and one where the button sits far away (never armed).
    const openArena: ArenaConfig = {
      cols: 5,
      rows: 5,
      tileSize: 60,
      pits: [],
      wallGaps: [],
      surfaces: [],
      zones: [],
      emitters: [],
      buttons: [createButton('plate', 2 * 60 + 30, 2 * 60 + 30, 30, 0, 0)],
      trapdoors: [createTrapdoor('t1', [[2, 2]], triggered('plate'))],
    };
    const closedArena: ArenaConfig = {
      ...openArena,
      buttons: [createButton('plate', 500, 500, 30, 0, 0)],
    };

    const open = createMatch({ ...DEFAULT_MATCH, arena: openArena, seed: 1, botCount: 1 });
    const closed = createMatch({ ...DEFAULT_MATCH, arena: closedArena, seed: 1, botCount: 1 });

    for (const m of [open, closed]) {
      const victim = m.bots[0]!;
      victim.body.x = 2 * 60 + 30;
      victim.body.y = 2 * 60 + 30;
      victim.body.vx = 0;
      victim.body.vy = 0;
    }

    advanceMatch(open);
    advanceMatch(closed);

    expect(open.bots[0]!.alive).toBe(false);
    expect(open.eliminations.some((e) => e.cause === 'fell')).toBe(true);
    expect(closed.bots[0]!.alive).toBe(true);
  });
});

describe('trapdoor vs. the collapse', () => {
  it('does not resurrect a tile the collapse has already claimed when the trapdoor closes', () => {
    // A trapdoor wired to a button that is never pressed: `isActive` is false every
    // tick, so `updateTrapdoors` tries to set its tiles back to Solid every tick.
    const arena: ArenaConfig = {
      cols: 5,
      rows: 5,
      tileSize: 60,
      pits: [],
      wallGaps: [],
      surfaces: [],
      zones: [],
      emitters: [],
      buttons: [createButton('never-pressed', 900, 900, 1, 0, 0)],
      trapdoors: [createTrapdoor('t1', [[2, 2], [2, 3]], triggered('never-pressed'))],
    };
    const m = createMatch({ ...DEFAULT_MATCH, arena, seed: 1, botCount: 1 });

    // Run the tick to exactly the end of the collapse window, where every tile in the
    // spiral order -- which is every tile in the grid -- has been claimed Gone.
    m.world.tick = COLLAPSE_END_TICK;
    advanceMatch(m);

    const indexA = 3 * 5 + 2; // [2, 3]
    const indexB = 2 * 5 + 2; // [2, 2]
    expect(m.arena.grid.tiles[indexA]).toBe(TileState.Gone);
    expect(m.arena.grid.tiles[indexB]).toBe(TileState.Gone);
  });

  it('a trapdoor still governs its tiles before the collapse has claimed them', () => {
    // Sanity check for the test above: before COLLAPSE_START_TICK the collapse has not
    // touched anything, so a closed trapdoor's tiles are genuinely Solid, not Gone by
    // some other means.
    const arena: ArenaConfig = {
      cols: 5,
      rows: 5,
      tileSize: 60,
      pits: [],
      wallGaps: [],
      surfaces: [],
      zones: [],
      emitters: [],
      buttons: [createButton('never-pressed', 900, 900, 1, 0, 0)],
      trapdoors: [createTrapdoor('t1', [[2, 2]], triggered('never-pressed'))],
    };
    const m = createMatch({ ...DEFAULT_MATCH, arena, seed: 1, botCount: 1 });
    expect(COLLAPSE_START_TICK).toBeGreaterThan(0);
    advanceMatch(m);
    expect(m.arena.grid.tiles[2 * 5 + 2]).toBe(TileState.Solid);
  });
});

describe('PROVING_ARENA', () => {
  it('has no static pits and exactly one trapdoor', () => {
    expect(PROVING_ARENA.pits.length).toBe(0);
    expect(PROVING_ARENA.trapdoors.length).toBe(1);
  });

  it('surfaces flank the trapdoor rather than overlapping it', () => {
    const trapdoorTiles = new Set(PROVING_ARENA.trapdoors[0]!.tiles.map(([c, r]) => `${c},${r}`));
    for (const [col, row, surface] of PROVING_ARENA.surfaces) {
      if (surface === Surface.Tar) {
        expect(trapdoorTiles.has(`${col},${row}`)).toBe(false);
      }
    }
  });
});
