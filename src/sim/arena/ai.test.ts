import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch } from './match';
import { perceive } from './perception';
import { weightsFor } from './personality';
import { createAiState, chooseAction, driveWithAi, CELEBRATE_TICKS } from './ai';

const match = (n = 4) => createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: n });

describe('createAiState', () => {
  it('starts unlocked with its personality weights', () => {
    const s = createAiState('aggressive');
    expect(s.personality).toBe('aggressive');
    expect(s.lockedUntil).toBe(0);
    expect(s.weights.chaseNearest).toBe(weightsFor('aggressive').chaseNearest);
  });
});

describe('chooseAction', () => {
  it('picks an offensive action for an aggressive bot with a target nearby', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    const action = chooseAction(m, self, perceive(m, self), state);
    expect(['chase', 'charge']).toContain(action);
  });

  it('makes a badly hurt defensive bot retreat', () => {
    const m = match();
    const self = m.bots[0]!;
    self.health = 5;
    const state = createAiState('defensive');
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('retreat');
  });

  it('does not make a badly hurt aggressive bot retreat', () => {
    const m = match();
    const self = m.bots[0]!;
    self.health = 5;
    const state = createAiState('aggressive');
    expect(chooseAction(m, self, perceive(m, self), state)).not.toBe('retreat');
  });

  it('sends a third-party bot at an engaged pair', () => {
    const m = match(4);
    const [self, a, b] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = m.world.tick;
    b.lastContactTick = m.world.tick;
    const state = createAiState('thirdParty');
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('attackEngaged');
  });

  it('honours a locked action state instead of rescoring', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    state.lockedAction = 'celebrate';
    state.lockedUntil = m.world.tick + 30;
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('celebrate');
  });

  it('releases the lock once it expires', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    state.lockedAction = 'celebrate';
    state.lockedUntil = m.world.tick;
    expect(chooseAction(m, self, perceive(m, self), state)).not.toBe('celebrate');
  });

  it('is deterministic — same inputs, same choice', () => {
    const m = match();
    const self = m.bots[0]!;
    const view = perceive(m, self);
    const a = chooseAction(m, self, view, createAiState('showman'));
    const b = chooseAction(m, self, view, createAiState('showman'));
    expect(a).toBe(b);
  });
});

describe('driveWithAi', () => {
  it('moves the bot', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    driveWithAi(m, self, state);
    expect(self.body.vx * self.body.vx + self.body.vy * self.body.vy).toBeGreaterThan(0);
  });

  it('steers a cautious bot away from an adjacent pit', () => {
    const m = match();
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    self.body.x = (col - 1) * size + size / 2;
    self.body.y = row * size + size / 2;
    // Put the only target directly beyond the pit, so chasing means driving into it.
    for (const other of m.bots) {
      if (other === self) continue;
      other.alive = false;
    }
    m.bots[1]!.alive = true;
    m.bots[1]!.body.x = (col + 2) * size;
    m.bots[1]!.body.y = row * size + size / 2;

    const cautious = createAiState('defensive');
    driveWithAi(m, self, cautious);
    // A defensive bot must not accelerate straight at the hole.
    expect(self.body.vx).toBeLessThan(0.35);
  });

  it('does nothing for an eliminated bot', () => {
    const m = match();
    const self = m.bots[0]!;
    self.alive = false;
    driveWithAi(m, self, createAiState('aggressive'));
    expect(self.body.vx).toBe(0);
    expect(self.body.vy).toBe(0);
  });
});

describe('CELEBRATE_TICKS', () => {
  it('is a visible but brief window', () => {
    expect(CELEBRATE_TICKS).toBeGreaterThan(30);
    expect(CELEBRATE_TICKS).toBeLessThan(180);
  });
});
