import { describe, it, expect } from 'vitest';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from './arenas';
import { buildArena } from '../arena/arena';
import { isOverHole, TileState } from '../arena/tiles';
import { Surface } from '../arena/surface';
import { Activation } from '../arena/activation';
import { DEFAULT_MATCH, runMatch } from '../arena/match';

describe('ARENA_VARIANTS', () => {
  it('has exactly three variants and three names', () => {
    expect(ARENA_VARIANTS.length).toBe(3);
    expect(ARENA_VARIANT_NAMES.length).toBe(3);
  });
});

describe.each(ARENA_VARIANT_NAMES.map((name, i) => [name, ARENA_VARIANTS[i]!] as const))(
  'variant: %s',
  (_name, config) => {
    const arena = buildArena(config);

    it('leaves at least 20 interior tiles as solid floor', () => {
      let interior = 0;
      const size = config.tileSize;
      for (let row = 1; row < config.rows - 1; row++) {
        for (let col = 1; col < config.cols - 1; col++) {
          const x = col * size + size / 2;
          const y = row * size + size / 2;
          if (!isOverHole(arena.grid, x, y)) interior++;
        }
      }
      expect(interior).toBeGreaterThanOrEqual(20);
    });

    it('never places a surface on a hole tile', () => {
      for (let i = 0; i < arena.surfaces.length; i++) {
        if (arena.surfaces[i] === Surface.Plain) continue;
        expect(arena.grid.tiles[i]).not.toBe(TileState.Gone);
      }
    });

    const inBounds = (x: number, y: number): boolean =>
      x >= 0 && x <= arena.grid.width && y >= 0 && y <= arena.grid.height;

    it('keeps every zone within the arena bounds', () => {
      for (const zone of arena.zones) {
        expect(inBounds(zone.x, zone.y)).toBe(true);
      }
    });

    it('keeps every emitter within the arena bounds', () => {
      for (const emitter of arena.emitters) {
        expect(inBounds(emitter.x, emitter.y)).toBe(true);
      }
    });

    it('keeps every button within the arena bounds', () => {
      for (const button of arena.buttons.values()) {
        expect(inBounds(button.x, button.y)).toBe(true);
      }
    });

    it('never names a nonexistent button from a triggered activation', () => {
      for (const zone of arena.zones) {
        if (zone.activation.mode !== Activation.Triggered) continue;
        expect(arena.buttons.has(zone.activation.buttonId)).toBe(true);
      }
      for (const emitter of arena.emitters) {
        if (emitter.activation.mode !== Activation.Triggered) continue;
        expect(arena.buttons.has(emitter.activation.buttonId)).toBe(true);
      }
    });

    it(
      'produces exactly ten placements across twenty seeds',
      () => {
        for (let seed = 1; seed <= 20; seed++) {
          const result = runMatch({ ...DEFAULT_MATCH, arena: config, seed });
          expect(result.placements.length).toBe(10);
        }
      },
      60000,
    );
  },
);
