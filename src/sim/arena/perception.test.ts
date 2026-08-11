import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA, GRINDER_ARENA, type ArenaConfig } from './arena';
import { cycle } from './activation';
import { createEmitter } from './projectile';
import { DEFAULT_MATCH, createMatch, runMatch } from './match';
import { ENGAGE_MEMORY, areEngaged, perceive } from './perception';

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
