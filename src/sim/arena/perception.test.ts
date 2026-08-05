import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch } from './match';
import { ENGAGE_MEMORY, areEngaged, perceive } from './perception';

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
});
