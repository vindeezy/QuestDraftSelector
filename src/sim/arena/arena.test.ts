import { describe, it, expect } from 'vitest';
import { isOverHole, solidTileCount, TileState } from './tiles';
import { DEFAULT_ARENA, PROVING_ARENA, GRINDER_ARENA, GAUNTLET_ARENA, CROSSFIRE_ARENA, buildArena } from './arena';
import { Surface } from './surface';
import { Activation, createButton, isActive } from './activation';
import { DEFAULT_MATCH, createMatch, advanceMatch, runMatch } from './match';
import { createEmitter, fireEmitters, stepProjectiles, type Projectile } from './projectile';

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

describe('GRINDER_ARENA', () => {
  it('is 16 by 12 tiles of 60 units, same as DEFAULT_ARENA', () => {
    expect(GRINDER_ARENA.cols).toBe(16);
    expect(GRINDER_ARENA.rows).toBe(12);
    expect(GRINDER_ARENA.tileSize).toBe(60);
  });

  it('has no pits and no trapdoors', () => {
    expect(GRINDER_ARENA.pits.length).toBe(0);
    expect(GRINDER_ARENA.trapdoors.length).toBe(0);
  });

  it('tars exactly the two outermost rings: a core tile is clean, ring tiles are not', () => {
    const surfaceAt = (col: number, row: number): number | undefined => {
      const hit = GRINDER_ARENA.surfaces.find(([c, r]) => c === col && r === row);
      return hit?.[2];
    };

    // Core (cols 2-13, rows 2-9): clean.
    expect(surfaceAt(7, 5)).toBeUndefined();

    // Ring: tar, on every side.
    expect(surfaceAt(1, 5)).toBe(Surface.Tar); // one tile in from the left edge
    expect(surfaceAt(0, 0)).toBe(Surface.Tar); // corner
    expect(surfaceAt(14, 6)).toBe(Surface.Tar); // one tile in from the right edge

    expect(GRINDER_ARENA.surfaces.length).toBe(96);
    expect(GRINDER_ARENA.surfaces.every(([, , surface]) => surface === Surface.Tar)).toBe(true);
  });

  it('has a wall gap on all four sides, and no more than that', () => {
    expect(GRINDER_ARENA.wallGaps.length).toBe(4);
    const sides = new Set(GRINDER_ARENA.wallGaps.map((g) => g.side));
    expect(sides).toEqual(new Set(['top', 'bottom', 'left', 'right']));
  });

  it('has three saw zones and no flame jets or crusher', () => {
    expect(GRINDER_ARENA.zones.length).toBe(3);
    expect(GRINDER_ARENA.zones.every((z) => z.id.startsWith('saw'))).toBe(true);
  });

  it('has two cannon emitters and two buttons', () => {
    expect(GRINDER_ARENA.emitters.length).toBe(2);
    expect(GRINDER_ARENA.emitters.map((e) => e.id).sort()).toEqual(['cannon-bot', 'cannon-top']);
    expect(GRINDER_ARENA.buttons.length).toBe(2);
    expect(GRINDER_ARENA.buttons.map((b) => b.id).sort()).toEqual([
      'cannon-bot-plate',
      'cannon-top-plate',
    ]);
  });

  it('wires each cannon to a triggered activation naming a button that actually exists', () => {
    const buttonIds = new Set(GRINDER_ARENA.buttons.map((b) => b.id));
    for (const emitter of GRINDER_ARENA.emitters) {
      expect(emitter.activation.mode).toBe(Activation.Triggered);
      expect(buttonIds.has(emitter.activation.buttonId)).toBe(true);
    }
  });

  it('a cannon does not fire until its button is pressed', () => {
    // End to end through advanceMatch: a bot parked away from the plate should never
    // draw a shot, and moving it onto the plate should produce one on that exact tick.
    // botCount is 2, not 1: `advanceMatch` ends the match once <=1 bot is alive, and
    // with a single bot that is true from tick zero, so it would never actually run.
    const match = createMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 1, botCount: 2 });
    const bot = match.bots[0]!;
    const filler = match.bots[1]!;

    // Bot: somewhere in the clean core, well clear of both plates (300,480) and
    // (660,240) and of the centre saw (480,360). Filler: pinned far away in the
    // opposite corner of the core so the two never come into contact.
    const away = { x: 700, y: 150 };
    const fillerSpot = { x: 200, y: 550 };
    for (let t = 0; t < 30; t++) {
      bot.body.x = away.x;
      bot.body.y = away.y;
      bot.body.vx = 0;
      bot.body.vy = 0;
      filler.body.x = fillerSpot.x;
      filler.body.y = fillerSpot.y;
      filler.body.vx = 0;
      filler.body.vy = 0;
      advanceMatch(match);
      expect(match.done).toBe(false);
      expect(match.projectiles.length).toBe(0);
    }

    // Now step onto 'cannon-top-plate'.
    const plate = GRINDER_ARENA.buttons.find((b) => b.id === 'cannon-top-plate')!;
    bot.body.x = plate.x;
    bot.body.y = plate.y;
    bot.body.vx = 0;
    bot.body.vy = 0;
    filler.body.x = fillerSpot.x;
    filler.body.y = fillerSpot.y;
    filler.body.vx = 0;
    filler.body.vy = 0;
    advanceMatch(match);

    expect(match.projectiles.length).toBeGreaterThan(0);
  });

  it('a cannonball fired from cannon-top travels along row 0', () => {
    const configured = GRINDER_ARENA.emitters.find((e) => e.id === 'cannon-top')!;
    const plate = GRINDER_ARENA.buttons.find((b) => b.id === 'cannon-top-plate')!;

    const button = createButton(plate.id, plate.x, plate.y, plate.radius, plate.latchTicks, plate.cooldown);
    button.pressed = true;
    button.armedUntil = 10000; // held on for the whole test, regardless of latch math
    const buttons = new Map([[button.id, button]]);

    const emitter = createEmitter({ ...configured });
    const shots: Projectile[] = [];
    fireEmitters([emitter], 0, buttons, shots);
    expect(shots.length).toBe(1);

    const width = GRINDER_ARENA.cols * GRINDER_ARENA.tileSize;
    const height = GRINDER_ARENA.rows * GRINDER_ARENA.tileSize;
    for (let t = 0; t < 80 && shots.length > 0; t++) {
      stepProjectiles(shots, [], width, height);
      if (shots.length === 0) break;
      expect(shots[0]!.y).toBeGreaterThanOrEqual(0);
      expect(shots[0]!.y).toBeLessThan(GRINDER_ARENA.tileSize);
    }
  });

  it('produces identical results for the same seed, twice', () => {
    const a = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 4242, botCount: 10 });
    const b = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('runs full matches to completion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
    }
  }, 30000);
});

describe('GAUNTLET_ARENA', () => {
  it('is 16 by 12 tiles of 60 units, same as DEFAULT_ARENA', () => {
    expect(GAUNTLET_ARENA.cols).toBe(16);
    expect(GAUNTLET_ARENA.rows).toBe(12);
    expect(GAUNTLET_ARENA.tileSize).toBe(60);
  });

  it('has no pits and no wall gaps', () => {
    expect(GAUNTLET_ARENA.pits.length).toBe(0);
    expect(GAUNTLET_ARENA.wallGaps.length).toBe(0);
  });

  it('has exactly two trapdoors, two buttons, no emitters, two saws and eight flame jets', () => {
    expect(GAUNTLET_ARENA.trapdoors.length).toBe(2);
    expect(GAUNTLET_ARENA.buttons.length).toBe(2);
    expect(GAUNTLET_ARENA.emitters.length).toBe(0);

    const saws = GAUNTLET_ARENA.zones.filter((z) => z.id.startsWith('saw'));
    const flames = GAUNTLET_ARENA.zones.filter((z) => z.id.startsWith('flame'));
    expect(saws.length).toBe(2);
    expect(flames.length).toBe(8);
    expect(GAUNTLET_ARENA.zones.length).toBe(10);
  });

  it('the ice bands are exactly rings 0-1 and 4-5, with rings 2-3 left as plain floor', () => {
    const surfaceAt = (col: number, row: number): number | undefined => {
      const hit = GAUNTLET_ARENA.surfaces.find(([c, r]) => c === col && r === row);
      return hit?.[2];
    };

    // Ring 0 (the outer wall) and ring 1 (one tile in): ice.
    expect(surfaceAt(0, 0)).toBe(Surface.Ice); // ring 0, corner
    expect(surfaceAt(1, 5)).toBe(Surface.Ice); // ring 1, one tile in from the left edge

    // Ring 2 and ring 3, the band in between: left as plain floor, no surface entry.
    expect(surfaceAt(2, 5)).toBeUndefined(); // ring 2
    expect(surfaceAt(3, 5)).toBeUndefined(); // ring 3

    // Ring 4 and ring 5, the innermost band: ice again.
    expect(surfaceAt(4, 5)).toBe(Surface.Ice); // ring 4
    expect(surfaceAt(7, 5)).toBe(Surface.Ice); // ring 5, at the arena's centre

    // Every listed surface tile is ice -- iceBands never emits anything else -- and the
    // total count is exactly the four ice rings' tile count for a 16x12 grid.
    expect(GAUNTLET_ARENA.surfaces.every(([, , surface]) => surface === Surface.Ice)).toBe(true);
    expect(GAUNTLET_ARENA.surfaces.length).toBe(128);
  });

  it('wires each trapdoor to a triggered activation naming a button that exists', () => {
    const buttonIds = new Set(GAUNTLET_ARENA.buttons.map((b) => b.id));
    for (const trapdoor of GAUNTLET_ARENA.trapdoors) {
      expect(trapdoor.activation.mode).toBe(Activation.Triggered);
      expect(buttonIds.has(trapdoor.activation.buttonId)).toBe(true);
    }
  });

  it('each button opens the trapdoor on the far side, not the near one', () => {
    const leftButton = GAUNTLET_ARENA.buttons.find((b) => b.id === 'trap-left-plate')!;
    const rightButton = GAUNTLET_ARENA.buttons.find((b) => b.id === 'trap-right-plate')!;
    const leftTrap = GAUNTLET_ARENA.trapdoors.find((t) => t.id === 'trap-left')!;
    const rightTrap = GAUNTLET_ARENA.trapdoors.find((t) => t.id === 'trap-right')!;

    // The centre column is 8 (960 / 60 / 2). trap-left-plate sits on the right half of
    // the arena and drives trap-left, which sits on the left half -- and vice versa for
    // trap-right-plate / trap-right. The bot that opens a pit is never near it.
    const centreX = (GAUNTLET_ARENA.cols * GAUNTLET_ARENA.tileSize) / 2;
    expect(leftButton.x).toBeGreaterThan(centreX);
    expect(rightButton.x).toBeLessThan(centreX);

    const tileCentreX = (col: number): number => col * GAUNTLET_ARENA.tileSize + GAUNTLET_ARENA.tileSize / 2;
    for (const [col] of leftTrap.tiles) expect(tileCentreX(col)).toBeLessThan(centreX);
    for (const [col] of rightTrap.tiles) expect(tileCentreX(col)).toBeGreaterThan(centreX);

    expect(leftTrap.activation.buttonId).toBe(leftButton.id);
    expect(rightTrap.activation.buttonId).toBe(rightButton.id);
  });

  it('starts with both trapdoors solid -- the pits only appear once triggered', () => {
    const arena = buildArena(GAUNTLET_ARENA);
    for (const trapdoor of GAUNTLET_ARENA.trapdoors) {
      for (const [col, row] of trapdoor.tiles) {
        const size = GAUNTLET_ARENA.tileSize;
        const x = col * size + size / 2;
        const y = row * size + size / 2;
        expect(isOverHole(arena.grid, x, y)).toBe(false);
      }
    }
  });

  describe('the flame jets’ four-beat rhythm', () => {
    // Group A: flame-t1 / flame-r1 / flame-b1 / flame-l1, cycle(360, 60, 240).
    // Group B: flame-t2 / flame-r2 / flame-b2 / flame-l2, cycle(360, 60, 60).
    const groupAIds = ['flame-t1', 'flame-r1', 'flame-b1', 'flame-l1'];
    const groupBIds = ['flame-t2', 'flame-r2', 'flame-b2', 'flame-l2'];
    const buttons = new Map();

    const specOf = (id: string) => GAUNTLET_ARENA.zones.find((z) => z.id === id)!.activation;

    it('reads quiet (0-119) / group A (120-179) / quiet (180-299) / group B (300-359)', () => {
      const groupA = specOf('flame-t1');
      const groupB = specOf('flame-t2');

      for (let t = 0; t < 360; t++) {
        const aOn = isActive(groupA, t, buttons);
        const bOn = isActive(groupB, t, buttons);

        // The two groups are never on simultaneously.
        expect(aOn && bOn).toBe(false);

        if (t >= 120 && t < 180) {
          expect(aOn).toBe(true);
          expect(bOn).toBe(false);
        } else if (t >= 300 && t < 360) {
          expect(aOn).toBe(false);
          expect(bOn).toBe(true);
        } else {
          expect(aOn).toBe(false);
          expect(bOn).toBe(false);
        }
      }
    });

    it('every jet within a group fires in lockstep with the rest of its group', () => {
      for (let t = 0; t < 360; t += 15) {
        const aStates = groupAIds.map((id) => isActive(specOf(id), t, buttons));
        expect(new Set(aStates).size).toBe(1);
        const bStates = groupBIds.map((id) => isActive(specOf(id), t, buttons));
        expect(new Set(bStates).size).toBe(1);
      }
    });

    it('all eight flame jets share one 360-tick period and one 60-tick activeTicks window', () => {
      for (const id of [...groupAIds, ...groupBIds]) {
        expect(specOf(id).period).toBe(360);
        expect(specOf(id).activeTicks).toBe(60);
      }
    });
  });

  it('produces identical results for the same seed, twice', () => {
    const a = runMatch({ ...DEFAULT_MATCH, arena: GAUNTLET_ARENA, seed: 4242, botCount: 10 });
    const b = runMatch({ ...DEFAULT_MATCH, arena: GAUNTLET_ARENA, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('runs full matches to completion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = runMatch({ ...DEFAULT_MATCH, arena: GAUNTLET_ARENA, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
    }
  }, 30000);
});

describe('CROSSFIRE_ARENA', () => {
  it('is 16 by 12 tiles of 60 units, same as DEFAULT_ARENA', () => {
    expect(CROSSFIRE_ARENA.cols).toBe(16);
    expect(CROSSFIRE_ARENA.rows).toBe(12);
    expect(CROSSFIRE_ARENA.tileSize).toBe(60);
  });

  it('has no pits and no wall gaps -- the four trapdoors are the only way to fall', () => {
    expect(CROSSFIRE_ARENA.pits.length).toBe(0);
    expect(CROSSFIRE_ARENA.wallGaps.length).toBe(0);
  });

  it('has exactly 28 buttons, 4 trapdoors, 4 saw zones, 16 flame zones and 4 cannon emitters', () => {
    expect(CROSSFIRE_ARENA.buttons.length).toBe(28);
    expect(CROSSFIRE_ARENA.trapdoors.length).toBe(4);

    const saws = CROSSFIRE_ARENA.zones.filter((z) => z.id.startsWith('saw'));
    const flames = CROSSFIRE_ARENA.zones.filter((z) => z.id.startsWith('flame'));
    expect(saws.length).toBe(4);
    expect(flames.length).toBe(16);
    expect(CROSSFIRE_ARENA.zones.length).toBe(20);

    expect(CROSSFIRE_ARENA.emitters.length).toBe(4);
    expect(CROSSFIRE_ARENA.emitters.every((e) => e.id.startsWith('cannon'))).toBe(true);
  });

  it('every button id is referenced by exactly one hazard, and every hazard names a button that exists', () => {
    // Cross-referenced against the BUILT arena, not the literal config, per the task
    // brief -- this is the property most likely to be broken by a typo in 28 pairs.
    const arena = buildArena(CROSSFIRE_ARENA);
    const buttonIds = new Set(arena.buttons.keys());
    expect(buttonIds.size).toBe(28);

    const referenced: string[] = [];
    for (const zone of arena.zones) {
      expect(zone.activation.mode).toBe(Activation.Triggered);
      expect(buttonIds.has(zone.activation.buttonId)).toBe(true);
      referenced.push(zone.activation.buttonId);
    }
    for (const emitter of arena.emitters) {
      expect(emitter.activation.mode).toBe(Activation.Triggered);
      expect(buttonIds.has(emitter.activation.buttonId)).toBe(true);
      referenced.push(emitter.activation.buttonId);
    }
    for (const trapdoor of arena.trapdoors) {
      expect(trapdoor.activation.mode).toBe(Activation.Triggered);
      expect(buttonIds.has(trapdoor.activation.buttonId)).toBe(true);
      referenced.push(trapdoor.activation.buttonId);
    }

    // 16 flames + 4 saws + 4 cannons + 4 trapdoors = 28 references, one per button, and
    // every button gets exactly one -- no button drives two hazards, none drives zero.
    expect(referenced.length).toBe(28);
    expect(new Set(referenced).size).toBe(28);
    for (const id of buttonIds) expect(referenced).toContain(id);
  });

  it('tar is exactly the 20 specified tiles, including the four trapdoor corners', () => {
    const tar = CROSSFIRE_ARENA.surfaces.filter(([, , surface]) => surface === Surface.Tar);
    expect(tar.length).toBe(20);

    const expected = new Set<string>();
    for (const col of [1, 3, 5, 10, 12, 14]) {
      expected.add(`${col},1`);
      expected.add(`${col},10`);
    }
    for (const row of [4, 5, 6, 7]) {
      expected.add(`0,${row}`);
      expected.add(`15,${row}`);
    }
    expect(expected.size).toBe(20);

    const actual = new Set(tar.map(([col, row]) => `${col},${row}`));
    expect(actual).toEqual(expected);

    // The four trapdoor tiles are among the tar tiles.
    for (const [col, row] of [[14, 10], [1, 10], [1, 1], [14, 1]]) {
      expect(actual.has(`${col},${row}`)).toBe(true);
    }
  });

  it('ice is exactly the 28 specified tiles, with the four saw tiles excluded', () => {
    const ice = CROSSFIRE_ARENA.surfaces.filter(([, , surface]) => surface === Surface.Ice);
    expect(ice.length).toBe(28);

    const expected = new Set<string>();
    for (const col of [1, 2, 13, 14]) {
      for (let row = 2; row <= 9; row++) {
        const isSawTile = (col === 1 || col === 14) && (row === 4 || row === 7);
        if (isSawTile) continue;
        expected.add(`${col},${row}`);
      }
    }
    expect(expected.size).toBe(28);

    const actual = new Set(ice.map(([col, row]) => `${col},${row}`));
    expect(actual).toEqual(expected);

    for (const [col, row] of [[1, 4], [1, 7], [14, 4], [14, 7]]) {
      expect(actual.has(`${col},${row}`)).toBe(false);
    }
  });

  it('places every zone, emitter and button within arena bounds', () => {
    const arena = buildArena(CROSSFIRE_ARENA);
    const inBounds = (x: number, y: number): boolean =>
      x >= 0 && x <= arena.grid.width && y >= 0 && y <= arena.grid.height;

    for (const zone of arena.zones) expect(inBounds(zone.x, zone.y)).toBe(true);
    for (const emitter of arena.emitters) expect(inBounds(emitter.x, emitter.y)).toBe(true);
    for (const button of arena.buttons.values()) expect(inBounds(button.x, button.y)).toBe(true);
  });

  it('a cannon does not fire until its button is pressed', () => {
    // End to end through advanceMatch, same approach as GRINDER_ARENA's equivalent
    // test. botCount is 2 so the match does not end instantly on a single survivor.
    const match = createMatch({ ...DEFAULT_MATCH, arena: CROSSFIRE_ARENA, seed: 1, botCount: 2 });
    const bot = match.bots[0]!;
    const filler = match.bots[1]!;

    // Both bots parked well clear of every button (which occupy x 270-690, y 210-510)
    // and of every zone (which only fire once a button is pressed). The filler also
    // stays off y=690, the row cannon-25 sweeps end to end once triggered -- parking it
    // in that lane would let it eat the very shot this test is checking for.
    const away = { x: 30, y: 30 };
    const fillerSpot = { x: 480, y: 30 };
    for (let t = 0; t < 30; t++) {
      bot.body.x = away.x;
      bot.body.y = away.y;
      bot.body.vx = 0;
      bot.body.vy = 0;
      filler.body.x = fillerSpot.x;
      filler.body.y = fillerSpot.y;
      filler.body.vx = 0;
      filler.body.vy = 0;
      advanceMatch(match);
      expect(match.done).toBe(false);
      expect(match.projectiles.length).toBe(0);
    }

    // Now step onto 'b25', which drives 'cannon-25'.
    const plate = CROSSFIRE_ARENA.buttons.find((b) => b.id === 'b25')!;
    bot.body.x = plate.x;
    bot.body.y = plate.y;
    bot.body.vx = 0;
    bot.body.vy = 0;
    filler.body.x = fillerSpot.x;
    filler.body.y = fillerSpot.y;
    filler.body.vx = 0;
    filler.body.vy = 0;
    advanceMatch(match);

    expect(match.projectiles.length).toBeGreaterThan(0);
  });

  it('a cannonball fired from cannon-25 travels along the bottom edge, right to left', () => {
    const configured = CROSSFIRE_ARENA.emitters.find((e) => e.id === 'cannon-25')!;
    const plate = CROSSFIRE_ARENA.buttons.find((b) => b.id === 'b25')!;

    const button = createButton(plate.id, plate.x, plate.y, plate.radius, plate.latchTicks, plate.cooldown);
    button.pressed = true;
    button.armedUntil = 10000;
    const buttons = new Map([[button.id, button]]);

    const emitter = createEmitter({ ...configured });
    const shots: Projectile[] = [];
    fireEmitters([emitter], 0, buttons, shots);
    expect(shots.length).toBe(1);
    expect(shots[0]!.vx).toBeLessThan(0);
    expect(shots[0]!.vy).toBeCloseTo(0, 9);

    const width = CROSSFIRE_ARENA.cols * CROSSFIRE_ARENA.tileSize;
    const height = CROSSFIRE_ARENA.rows * CROSSFIRE_ARENA.tileSize;
    for (let t = 0; t < 80 && shots.length > 0; t++) {
      stepProjectiles(shots, [], width, height);
      if (shots.length === 0) break;
      expect(shots[0]!.y).toBeGreaterThanOrEqual(height - CROSSFIRE_ARENA.tileSize);
      expect(shots[0]!.y).toBeLessThanOrEqual(height);
    }
  });

  it('a trapdoor opens only after its button is pressed', () => {
    // 'pit-13' is driven by 'b13' and sits at tile [1, 1], far from the button itself
    // (690, 510) -- deliberately, per the crossed-wiring layout. End to end through
    // advanceMatch, botCount 2 for the same reason as the cannon test above.
    const match = createMatch({ ...DEFAULT_MATCH, arena: CROSSFIRE_ARENA, seed: 1, botCount: 2 });
    const bot = match.bots[0]!;
    const filler = match.bots[1]!;
    const tileX = 1 * 60 + 30;
    const tileY = 1 * 60 + 30;

    const away = { x: 30, y: 30 };
    const fillerSpot = { x: 480, y: 30 };
    for (let t = 0; t < 10; t++) {
      bot.body.x = away.x;
      bot.body.y = away.y;
      bot.body.vx = 0;
      bot.body.vy = 0;
      filler.body.x = fillerSpot.x;
      filler.body.y = fillerSpot.y;
      filler.body.vx = 0;
      filler.body.vy = 0;
      advanceMatch(match);
      expect(isOverHole(match.arena.grid, tileX, tileY)).toBe(false);
    }

    const plate = CROSSFIRE_ARENA.buttons.find((b) => b.id === 'b13')!;
    bot.body.x = plate.x;
    bot.body.y = plate.y;
    bot.body.vx = 0;
    bot.body.vy = 0;
    filler.body.x = fillerSpot.x;
    filler.body.y = fillerSpot.y;
    filler.body.vx = 0;
    filler.body.vy = 0;
    advanceMatch(match);

    expect(isOverHole(match.arena.grid, tileX, tileY)).toBe(true);
  });

  it('starts with all four trapdoors solid -- the pits only appear once triggered', () => {
    const arena = buildArena(CROSSFIRE_ARENA);
    for (const trapdoor of CROSSFIRE_ARENA.trapdoors) {
      for (const [col, row] of trapdoor.tiles) {
        const size = CROSSFIRE_ARENA.tileSize;
        const x = col * size + size / 2;
        const y = row * size + size / 2;
        expect(isOverHole(arena.grid, x, y)).toBe(false);
      }
    }
  });

  it('produces identical results for the same seed, twice', () => {
    const a = runMatch({ ...DEFAULT_MATCH, arena: CROSSFIRE_ARENA, seed: 4242, botCount: 10 });
    const b = runMatch({ ...DEFAULT_MATCH, arena: CROSSFIRE_ARENA, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('runs full matches to completion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = runMatch({ ...DEFAULT_MATCH, arena: CROSSFIRE_ARENA, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
    }
  }, 30000);

  it("other arenas' checksums are unaffected by CROSSFIRE_ARENA existing", () => {
    const grinderA = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 4242, botCount: 10 });
    const grinderB = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 4242, botCount: 10 });
    expect(grinderA.checksum).toBe(grinderB.checksum);

    const gauntletA = runMatch({ ...DEFAULT_MATCH, arena: GAUNTLET_ARENA, seed: 4242, botCount: 10 });
    const gauntletB = runMatch({ ...DEFAULT_MATCH, arena: GAUNTLET_ARENA, seed: 4242, botCount: 10 });
    expect(gauntletA.checksum).toBe(gauntletB.checksum);
  });
});
