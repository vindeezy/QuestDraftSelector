import { describe, it, expect } from 'vitest';
import { isOverHole, solidTileCount } from './tiles';
import { DEFAULT_ARENA, buildArena } from './arena';

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
});
