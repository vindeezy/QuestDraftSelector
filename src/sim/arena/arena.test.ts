import { describe, it, expect } from 'vitest';
import { isOverHole, solidTileCount, TileState } from './tiles';
import { DEFAULT_ARENA, PROVING_ARENA, buildArena } from './arena';
import { Surface } from './surface';
import { Activation } from './activation';
import { DEFAULT_MATCH, runMatch } from './match';

describe('buildArena', () => {
  const arena = buildArena(DEFAULT_ARENA);

  it('builds the configured grid', () => {
    expect(arena.grid.cols).toBe(DEFAULT_ARENA.cols);
    expect(arena.grid.rows).toBe(DEFAULT_ARENA.rows);
    expect(arena.grid.width).toBe(DEFAULT_ARENA.cols * DEFAULT_ARENA.tileSize);
  });

  it('punches the configured pits out of the floor', () => {
    expect(DEFAULT_ARENA.pits.length).toBeGreaterThan(0);
    for (const [col, row] of DEFAULT_ARENA.pits) {
      const size = DEFAULT_ARENA.tileSize;
      const x = col * size + size / 2;
      const y = row * size + size / 2;
      expect(isOverHole(arena.grid, x, y)).toBe(true);
    }
  });

  it('removes floor for pits AND for the tiles behind wall gaps', () => {
    // Wall gaps remove floor too, otherwise a bot shoved through one would hover
    // outside the arena instead of falling.
    const total = DEFAULT_ARENA.cols * DEFAULT_ARENA.rows;
    const gapTiles = DEFAULT_ARENA.wallGaps.reduce((sum, g) => sum + (g.to - g.from), 0);
    expect(solidTileCount(arena.grid)).toBe(total - DEFAULT_ARENA.pits.length - gapTiles);
  });

  it('creates wall segments on all four sides', () => {
    expect(arena.segments.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves a gap in the walls for every configured gap', () => {
    // A gap is an absent segment, so more gaps means the walls are split into more
    // pieces. With gaps configured, there must be more than the 4 plain sides.
    expect(DEFAULT_ARENA.wallGaps.length).toBeGreaterThan(0);
    expect(arena.segments.length).toBeGreaterThan(4);
  });

  it('places every wall segment on the arena boundary', () => {
    for (const s of arena.segments) {
      const onVertical = s.x1 === s.x2 && (s.x1 === 0 || s.x1 === arena.grid.width);
      const onHorizontal = s.y1 === s.y2 && (s.y1 === 0 || s.y1 === arena.grid.height);
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it('marks the tiles behind each wall gap as gone, so bots pushed out fall', () => {
    for (const gap of DEFAULT_ARENA.wallGaps) {
      const size = DEFAULT_ARENA.tileSize;
      for (let i = gap.from; i < gap.to; i++) {
        const isVertical = gap.side === 'left' || gap.side === 'right';
        const col = isVertical ? (gap.side === 'left' ? 0 : DEFAULT_ARENA.cols - 1) : i;
        const row = isVertical ? i : gap.side === 'top' ? 0 : DEFAULT_ARENA.rows - 1;
        const x = col * size + size / 2;
        const y = row * size + size / 2;
        expect(isOverHole(arena.grid, x, y)).toBe(true);
      }
    }
  });
});

describe('hazards', () => {
  const arena = buildArena(DEFAULT_ARENA);

  it('stamps every configured surface tile with the right surface', () => {
    expect(DEFAULT_ARENA.surfaces.length).toBeGreaterThan(0);
    for (const [col, row, surface] of DEFAULT_ARENA.surfaces) {
      const index = row * DEFAULT_ARENA.cols + col;
      expect(arena.surfaces[index]).toBe(surface);
    }
  });

  it('never places a surface on a hole tile', () => {
    for (let i = 0; i < arena.surfaces.length; i++) {
      if (arena.surfaces[i] === Surface.Plain) continue;
      expect(arena.grid.tiles[i]).not.toBe(TileState.Gone);
    }
  });

  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x <= arena.grid.width && y >= 0 && y <= arena.grid.height;

  it('places every zone within the arena bounds', () => {
    expect(arena.zones.length).toBeGreaterThan(0);
    for (const zone of arena.zones) {
      expect(inBounds(zone.x, zone.y)).toBe(true);
    }
  });

  it('places every emitter within the arena bounds', () => {
    expect(arena.emitters.length).toBeGreaterThan(0);
    for (const emitter of arena.emitters) {
      expect(inBounds(emitter.x, emitter.y)).toBe(true);
    }
  });

  it('places every button within the arena bounds', () => {
    expect(arena.buttons.size).toBeGreaterThan(0);
    for (const button of arena.buttons.values()) {
      expect(inBounds(button.x, button.y)).toBe(true);
    }
  });

  it('never names a nonexistent button from a triggered activation', () => {
    // A dangling reference is a hazard that silently never fires: `isActive` returns
    // false for a missing button id with no error, so this must be checked explicitly.
    for (const zone of arena.zones) {
      if (zone.activation.mode !== Activation.Triggered) continue;
      expect(arena.buttons.has(zone.activation.buttonId)).toBe(true);
    }
    for (const emitter of arena.emitters) {
      if (emitter.activation.mode !== Activation.Triggered) continue;
      expect(arena.buttons.has(emitter.activation.buttonId)).toBe(true);
    }
  });

  it('does not share button or emitter runtime state between two arenas built from one config', () => {
    const a = buildArena(DEFAULT_ARENA);
    const b = buildArena(DEFAULT_ARENA);

    expect(a.buttons).not.toBe(b.buttons);
    for (const [id, buttonA] of a.buttons) {
      const buttonB = b.buttons.get(id)!;
      expect(buttonA).not.toBe(buttonB);
    }
    const [firstId] = a.buttons.keys();
    const buttonA = a.buttons.get(firstId!)!;
    const buttonB = b.buttons.get(firstId!)!;
    buttonA.pressed = true;
    buttonA.armedUntil = 999;
    expect(buttonB.pressed).toBe(false);
    expect(buttonB.armedUntil).toBe(0);

    expect(a.emitters).not.toBe(b.emitters);
    for (let i = 0; i < a.emitters.length; i++) {
      expect(a.emitters[i]).not.toBe(b.emitters[i]);
    }
    a.emitters[0]!.wasActive = true;
    expect(b.emitters[0]!.wasActive).toBe(false);
  });
});

describe('DEFAULT_ARENA', () => {
  it('is 16 by 12 tiles of 60 units', () => {
    expect(DEFAULT_ARENA.cols).toBe(16);
    expect(DEFAULT_ARENA.rows).toBe(12);
    expect(DEFAULT_ARENA.tileSize).toBe(60);
  });

  it('leaves tiles comfortably larger than a bot', () => {
    // Bot radius is 20, so diameter 40 against a 60-unit tile.
    expect(DEFAULT_ARENA.tileSize).toBeGreaterThan(40);
  });

  it('keeps pits and gaps from consuming too much floor', () => {
    const total = DEFAULT_ARENA.cols * DEFAULT_ARENA.rows;
    expect(DEFAULT_ARENA.pits.length).toBeLessThan(total * 0.1);
  });

  it('has no trapdoors, and builds an arena with an empty trapdoor list', () => {
    // Existing arenas must keep working unmodified: an arena with no trapdoors
    // configured gets a runtime Trapdoor[] that is simply empty, not undefined.
    expect(DEFAULT_ARENA.trapdoors.length).toBe(0);
    const arena = buildArena(DEFAULT_ARENA);
    expect(arena.trapdoors).toEqual([]);
  });

  it('runs a full match unaffected by the trapdoor primitive existing', () => {
    const r = runMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 99, botCount: 10 });
    expect(r.placements.length).toBe(10);
  });
});

describe('PROVING_ARENA', () => {
  const arena = buildArena(PROVING_ARENA);

  it('is 16 by 12 tiles of 60 units, same as DEFAULT_ARENA', () => {
    expect(PROVING_ARENA.cols).toBe(16);
    expect(PROVING_ARENA.rows).toBe(12);
    expect(PROVING_ARENA.tileSize).toBe(60);
  });

  it('has no static pits and exactly one trapdoor', () => {
    expect(PROVING_ARENA.pits.length).toBe(0);
    expect(PROVING_ARENA.trapdoors.length).toBe(1);
    expect(arena.trapdoors.length).toBe(1);
  });

  it('has a wall gap on all four sides', () => {
    const sides = new Set(PROVING_ARENA.wallGaps.map((g) => g.side));
    expect(sides).toEqual(new Set(['top', 'bottom', 'left', 'right']));
  });

  it('starts with the trapdoor tiles solid -- the pit only appears once triggered', () => {
    for (const [col, row] of PROVING_ARENA.trapdoors[0]!.tiles) {
      const size = PROVING_ARENA.tileSize;
      const x = col * size + size / 2;
      const y = row * size + size / 2;
      expect(isOverHole(arena.grid, x, y)).toBe(false);
    }
  });

  it('never names a nonexistent button from the trapdoor activation', () => {
    for (const trapdoor of arena.trapdoors) {
      expect(arena.buttons.has(trapdoor.activation.buttonId)).toBe(true);
    }
  });

  it('runs full matches to completion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = runMatch({ ...DEFAULT_MATCH, arena: PROVING_ARENA, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
    }
  }, 30000);
});
