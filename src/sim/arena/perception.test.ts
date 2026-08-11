import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA, GRINDER_ARENA, type ArenaConfig } from './arena';
import { cycle } from './activation';
import { createEmitter } from './projectile';
import { DEFAULT_MATCH, createMatch, runMatch } from './match';
import { ENGAGE_MEMORY, WALL_REPULSION_SCALE, areEngaged, perceive } from './perception';

/**
 * A 960x720 arena (same dimensions as GRINDER_ARENA) with two cannons for the
 * emitter-repulsion regression tests below:
 *
 * - 'cannon-top' sits at (0, 30), firing along +x -- identical placement to
 *   GRINDER_ARENA's wall-hugging cannon, whose lane (y = -30 to 90, clipped by the top
 *   wall at y = 0) is what trapped bots against the wall before the fix.
 * - 'cannon-mid' sits at (0, 360), firing along +x through the vertical centre, far
 *   enough from every wall that a bot on its centreline picks up zero hole-repulsion --
 *   needed to test the emitter's own on/off contribution in isolation.
 *
 * Both use `cycle(200, 1)`, same as the 'cannon' preset, so tick 0 is active and every
 * other tick (until the next multiple of 200) is inactive -- full control over "armed"
 * without needing to simulate a button press.
 */
const LANE_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  pits: [],
  wallGaps: [],
  surfaces: [],
  zones: [],
  emitters: [
    createEmitter({
      id: 'cannon-top',
      x: 0,
      y: 30,
      heading: 0,
      speed: 14,
      damage: 18,
      radius: 6,
      activation: cycle(200, 1),
    }),
    createEmitter({
      id: 'cannon-mid',
      x: 0,
      y: 360,
      heading: 0,
      speed: 14,
      damage: 18,
      radius: 6,
      activation: cycle(200, 1),
    }),
  ],
  buttons: [],
  trapdoors: [],
};

const laneMatch = () => createMatch({ ...DEFAULT_MATCH, arena: LANE_ARENA, seed: 1, botCount: 2 });

const match = (botCount: number) =>
  createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount });

describe('areEngaged', () => {
  it('is false for bots that have never touched', () => {
    const m = match(4);
    expect(areEngaged(m.bots[0]!, m.bots[1]!, 100)).toBe(false);
  });

  it('is true when two bots last touched each other recently', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 100;
    b.lastContactTick = 100;
    expect(areEngaged(a, b, 100)).toBe(true);
  });

  it('is false once the memory window has expired', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 0;
    b.lastContactTick = 0;
    expect(areEngaged(a, b, ENGAGE_MEMORY + 1)).toBe(false);
  });

  it('is false when only one of them is looking at the other', () => {
    const m = match(4);
    const [a, b, c] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    a.lastContactTick = 100;
    b.lastContactId = c.body.id;
    b.lastContactTick = 100;
    expect(areEngaged(a, b, 100)).toBe(false);
  });

  it('ignores eliminated bots', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 100;
    b.lastContactTick = 100;
    b.alive = false;
    expect(areEngaged(a, b, 100)).toBe(false);
  });
});

describe('perceive', () => {
  it('finds the nearest living bot', () => {
    const m = match(4);
    const self = m.bots[0]!;
    m.bots[1]!.body.x = self.body.x + 30;
    m.bots[1]!.body.y = self.body.y;
    m.bots[2]!.body.x = self.body.x + 500;
    const view = perceive(m, self);
    expect(view.nearest?.body.id).toBe(m.bots[1]!.body.id);
  });

  it('never returns the bot itself', () => {
    const m = match(4);
    const view = perceive(m, m.bots[0]!);
    expect(view.nearest?.body.id).not.toBe(m.bots[0]!.body.id);
  });

  it('finds the weakest living bot', () => {
    const m = match(4);
    m.bots[2]!.health = 5;
    expect(perceive(m, m.bots[0]!).weakest?.body.id).toBe(m.bots[2]!.body.id);
  });

  it('finds the leader by kill count', () => {
    const m = match(4);
    m.bots[3]!.kills = 3;
    expect(perceive(m, m.bots[0]!).leader?.body.id).toBe(m.bots[3]!.body.id);
  });

  it('returns no leader when nobody has a kill', () => {
    const m = match(4);
    expect(perceive(m, m.bots[0]!).leader).toBe(null);
  });

  it('finds a pair engaged with each other', () => {
    const m = match(4);
    const [self, a, b] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = m.world.tick;
    b.lastContactTick = m.world.tick;
    const view = perceive(m, self);
    expect(view.engagedPair).not.toBe(null);
    const ids = [view.engagedPair![0].body.id, view.engagedPair![1].body.id].sort();
    expect(ids).toEqual([a.body.id, b.body.id].sort());
  });

  it('does not report a pair the bot itself is part of', () => {
    const m = match(4);
    const [self, a] = [m.bots[0]!, m.bots[1]!];
    self.lastContactId = a.body.id;
    a.lastContactId = self.body.id;
    self.lastContactTick = m.world.tick;
    a.lastContactTick = m.world.tick;
    expect(perceive(m, self).engagedPair).toBe(null);
  });

  it('produces a repulsion vector pointing away from a nearby hole', () => {
    const m = match(4);
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    // Stand one tile to the left of a pit. Repulsion should push further left.
    self.body.x = (col - 1) * size + size / 2;
    self.body.y = row * size + size / 2;
    const view = perceive(m, self);
    expect(view.avoidX).toBeLessThan(0);
  });

  it('produces no repulsion in open floor', () => {
    // Tile (8, 4) is the open spot for a 3-tile scan radius: it sweeps cols 5-11 and
    // rows 1-7, which excludes both pits ([4,3] is outside the columns, [11,8] outside
    // the rows), the wall gaps on row 0, and every grid edge.
    //
    // This position had to move when the scan radius went from 2 to 3 — at (8, 5) the
    // sweep reaches row 8 and catches pit [11,8]. The radius widened because bots were
    // spotting pits too late to turn away from them.
    const m = match(4);
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    self.body.x = 8 * size + size / 2;
    self.body.y = 4 * size + size / 2;
    const view = perceive(m, self);
    expect(view.avoidX).toBe(0);
    expect(view.avoidY).toBe(0);
  });

  it('produces repulsion from an active saw', () => {
    // saw-l sits at (0, 300), always active. Just outside its notice range (dist ~251),
    // this spot reads exactly zero — proof the arena has no other contamination here —
    // so the nonzero reading a few units closer, well within range (dist ~241), is
    // attributable to the saw alone.
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 180;
    self.body.y = 460;
    const view = perceive(m, self);
    expect(view.avoidX).toBeGreaterThan(0);
    expect(view.avoidY).toBeGreaterThan(0);
  });

  it('produces no repulsion from a flame jet during its off phase', () => {
    // flame-t sits at (300, 0) on a cycle(180, 70) — off from tick 70 to tick 179. This
    // spot (col 8, row 4) is within flame-t's notice range but keeps every pit, wall
    // gap, saw, the other flame jet, the crusher and the cannon's lane out of range.
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 480;
    self.body.y = 245;
    m.world.tick = 100;
    const view = perceive(m, self);
    expect(view.avoidX).toBe(0);
    expect(view.avoidY).toBe(0);
  });

  it('produces more repulsion from a flame jet on than off', () => {
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 480;
    self.body.y = 245;

    m.world.tick = 100; // off phase
    const off = perceive(m, self);
    const offMag = Math.sqrt(off.avoidX * off.avoidX + off.avoidY * off.avoidY);

    m.world.tick = 0; // on phase
    const on = perceive(m, self);
    const onMag = Math.sqrt(on.avoidX * on.avoidX + on.avoidY * on.avoidY);

    expect(onMag).toBeGreaterThan(offMag);
  });

  it('produces no repulsion from a button-triggered zone whose button is unpressed', () => {
    // The crusher at (480, 500) is wired to 'plate-1', which nobody has stepped on, so
    // it never latches (armedUntil stays 0). This spot is well within the crusher's
    // notice range but keeps every pit, saw, flame jet and the cannon's lane out of
    // range, so a nonzero reading here could only be the crusher's own -- and there is
    // none.
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 480;
    self.body.y = 280;
    const view = perceive(m, self);
    expect(view.avoidX).toBe(0);
    expect(view.avoidY).toBe(0);
  });

  it('produces repulsion from standing in an emitter firing lane, sideways rather than back', () => {
    // cannon-l fires along +x from (0, 600). Standing north of its centreline should
    // push further north (negative y) -- sideways, out of the lane -- not back toward
    // -x, away from the emitter along its own axis.
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 300;
    self.body.y = 590;
    const view = perceive(m, self);
    expect(view.avoidY).toBeLessThan(-10);
  });

  it('pushes the other way on the other side of an emitter lane', () => {
    const m = match(4);
    const self = m.bots[0]!;
    self.body.x = 300;
    self.body.y = 610;
    const view = perceive(m, self);
    expect(view.avoidY).toBeGreaterThan(10);
  });
});

describe('emitterRepulsion threat gating and wall-safe escape direction', () => {
  it('gives zero repulsion for a bot inside a lane whose emitter is inactive', () => {
    // (300, 360) sits on cannon-mid's centreline, four tiles from every wall -- outside
    // the hole scan's reach in every direction -- so a nonzero reading here can only be
    // attributed to the lane itself.
    const m = laneMatch();
    m.world.tick = 5; // cycle(200, 1): active only at tick 0 (and 200, 400, ...)
    const self = m.bots[0]!;
    self.body.x = 300;
    self.body.y = 360;
    const view = perceive(m, self);
    expect(view.avoidX).toBe(0);
    expect(view.avoidY).toBe(0);
  });

  it('pushes a bot out of the same lane once its emitter is active', () => {
    const m = laneMatch();
    m.world.tick = 0; // cycle(200, 1)'s one active tick
    const self = m.bots[0]!;
    self.body.x = 300;
    self.body.y = 360;
    const view = perceive(m, self);
    expect(view.avoidY).not.toBe(0);
  });

  it('pushes a bot trapped against the top wall downward, into the arena, not into the wall', () => {
    // Direct regression test for the wall-trap bug: cannon-top's lane runs from
    // y = -30 to y = 90, clipped by the top wall at y = 0. A bot at (663, 21) is only
    // 21 units from that wall and 9 units above the emitter's centreline (across = -9).
    // The old code pushed further in whichever direction the bot already leaned --
    // here, further up, into the wall. The fix must push it down (+y) instead, since
    // that is the only direction that actually leaves the lane without leaving the
    // arena.
    const m = laneMatch();
    m.world.tick = 0;
    const self = m.bots[0]!;
    self.body.x = 663;
    self.body.y = 21;
    const view = perceive(m, self);
    expect(view.avoidY).toBeGreaterThan(0);
  });

  it('still pushes a bot on the interior side of the same lane further into the interior', () => {
    // Same lane as the wall-trap case, opposite side: (663, 39) is across = +9, on the
    // arena-interior side (away from the top wall). The fix must not invert this --
    // it should still push further down/south, same direction as before the fix.
    const m = laneMatch();
    m.world.tick = 0;
    const self = m.bots[0]!;
    self.body.x = 663;
    self.body.y = 39;
    const view = perceive(m, self);
    expect(view.avoidY).toBeGreaterThan(0);
  });

  it('gives a finite, deterministic push for a bot exactly on the lane centreline', () => {
    const m = laneMatch();
    m.world.tick = 0;
    const self = m.bots[0]!;
    self.body.x = 663;
    self.body.y = 30; // across = 0 exactly: on cannon-top's own centreline
    const view = perceive(m, self);
    expect(Number.isFinite(view.avoidX)).toBe(true);
    expect(Number.isFinite(view.avoidY)).toBe(true);
    expect(view.avoidY).not.toBe(0);
  });

  it('produces the same checksum for the same seed, twice, on an arena with wall-hugging cannons', () => {
    const a = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 496446, botCount: 10 });
    const b = runMatch({ ...DEFAULT_MATCH, arena: GRINDER_ARENA, seed: 496446, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });
});

/**
 * Regression tests for the wall-repulsion fix: `holeRepulsion` treated `index < 0`
 * (off-grid, i.e. the solid perimeter wall) exactly like a real `TileState.Gone` hole,
 * so bots fled solid concrete as hard as they fled a lethal pit. `WALL_REPULSION_SCALE`
 * now scales down only the off-grid case; a real hole -- including the floor tile
 * `buildArena` removes behind every wall gap -- is untouched.
 */
describe('holeRepulsion: wall vs. real hole (WALL_REPULSION_SCALE)', () => {
  it('gives an off-grid sample strictly weaker repulsion than a real Gone tile at the same distance, by exactly WALL_REPULSION_SCALE', () => {
    // Grid A: a bare 16x12 arena (no pits, no gaps, no zones/emitters). The bot sits at
    // (col 8, row 11) -- the last valid row -- so its 7x3 scan window catches rows
    // 12-14, all off-grid, at columns 5-11 (all on-grid), with nothing else in range.
    const bareArena: ArenaConfig = {
      cols: 16,
      rows: 12,
      tileSize: 60,
      pits: [],
      wallGaps: [],
      surfaces: [],
      zones: [],
      emitters: [],
      buttons: [],
      trapdoors: [],
    };
    const mOffGrid = createMatch({ ...DEFAULT_MATCH, arena: bareArena, seed: 1, botCount: 4 });
    const offGridSelf = mOffGrid.bots[0]!;
    offGridSelf.body.x = 8 * 60 + 30;
    offGridSelf.body.y = 11 * 60 + 30;
    const offGridView = perceive(mOffGrid, offGridSelf);

    // Grid B: the same arena extended by three rows, with exactly the tiles that were
    // off-grid in Grid A (rows 12-14, cols 5-11) marked as real pits instead. Same bot
    // position, so every (dx, dy) offset into those tiles is identical between the two
    // -- the only difference is that these are now genuine on-grid Gone tiles.
    const mirroredPits: [number, number][] = [];
    for (let r = 12; r <= 14; r++) {
      for (let c = 5; c <= 11; c++) mirroredPits.push([c, r]);
    }
    const mirroredArena: ArenaConfig = {
      cols: 16,
      rows: 15,
      tileSize: 60,
      pits: mirroredPits,
      wallGaps: [],
      surfaces: [],
      zones: [],
      emitters: [],
      buttons: [],
      trapdoors: [],
    };
    const mGone = createMatch({ ...DEFAULT_MATCH, arena: mirroredArena, seed: 1, botCount: 4 });
    const goneSelf = mGone.bots[0]!;
    goneSelf.body.x = 8 * 60 + 30;
    goneSelf.body.y = 11 * 60 + 30;
    const goneView = perceive(mGone, goneSelf);

    // Both readings push straight up (negative y) with no sideways component -- the
    // hole tiles are symmetric left-right around the bot's column, so avoidX cancels.
    expect(offGridView.avoidX).toBeCloseTo(0, 6);
    expect(goneView.avoidX).toBeCloseTo(0, 6);
    expect(offGridView.avoidY).toBeLessThan(0);
    expect(goneView.avoidY).toBeLessThan(0);

    // Strictly weaker, and by exactly the named scale -- not just "less".
    expect(Math.abs(offGridView.avoidY)).toBeLessThan(Math.abs(goneView.avoidY));
    const ratio = offGridView.avoidY / goneView.avoidY;
    expect(ratio).toBeCloseTo(WALL_REPULSION_SCALE, 6);
  });

  it('is unaffected for a real hole: pins the exact repulsion beside a pit (regression guard)', () => {
    // Standing at (col 7, row 6) -- diagonally offset (180, 180) from the real pit at
    // (4, 3) -- has nothing else in its scan window: the other pit (11, 8), both wall
    // gaps (row 0 and row 11) and every grid edge all fall outside rows 3-9 / cols
    // 4-10. This is a pure single-hole reading, pinned to prove the fix left real-hole
    // repulsion byte-for-byte unchanged.
    const m = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: 4 });
    const self = m.bots[0]!;
    self.body.x = 7 * 60 + 30;
    self.body.y = 6 * 60 + 30;
    const view = perceive(m, self);
    expect(view.avoidX).toBeCloseTo(0.039283710065919304, 12);
    expect(view.avoidY).toBeCloseTo(0.039283710065919304, 12);
  });

  it('gives a bot beside a wall gap full-strength repulsion, matching a real pit at the same distance', () => {
    // DEFAULT_ARENA's top wall gap (cols 7-9, row 0) removes the floor tile behind it,
    // per buildArena, so (8, 0) is a genuine on-grid Gone tile -- not off-grid. Standing
    // at (col 11, row 3) is diagonally offset (180, 180) from it, with nothing else in
    // scan range (rows 0-6 / cols 8-14 excludes the other gap tile at col 7, the bottom
    // gap, both pits, and every grid edge is still on-grid).
    //
    // That offset (180, 180) is identical to the pit case in the test above, so if the
    // wall-gap floor tile were being treated as off-grid (the bug) or scaled at all,
    // this reading would come out weaker than that pinned pit value. It must not.
    const m = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: 4 });
    const self = m.bots[0]!;
    self.body.x = 11 * 60 + 30;
    self.body.y = 3 * 60 + 30;
    const view = perceive(m, self);
    expect(view.avoidX).toBeCloseTo(0.039283710065919304, 12);
    expect(view.avoidY).toBeCloseTo(0.039283710065919304, 12);
  });
});
