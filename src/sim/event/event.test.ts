import { describe, it, expect } from 'vitest';
import { runEvent, type EventConfig, type EventMember } from './event';

const COLOURS = [
  '#e6194b',
  '#3cb44b',
  '#ffe119',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
];

function makeMembers(count = 10): EventMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    name: `Member ${i + 1}`,
    colour: COLOURS[i % COLOURS.length]!,
  }));
}

function makeConfig(masterSeed: number, count = 10): EventConfig {
  return { masterSeed, members: makeMembers(count) };
}

describe('runEvent', () => {
  it(
    'runs seven forge boards and three battles',
    () => {
      const result = runEvent(makeConfig(1));
      expect(result.forge.length).toBe(7);
      expect(result.battles.length).toBe(3);
    },
    30000,
  );

  it(
    'gives every member a slot on every board',
    () => {
      const config = makeConfig(2);
      const result = runEvent(config);
      for (const board of result.forge) {
        expect(board.slots.length).toBe(config.members.length);
        for (const slot of board.slots) {
          expect(Number.isInteger(slot)).toBe(true);
        }
      }
    },
    30000,
  );

  it(
    'gives every member a finishing place in every battle',
    () => {
      const config = makeConfig(3);
      const result = runEvent(config);
      for (const battle of result.battles) {
        expect(battle.places.length).toBe(config.members.length);
        const sorted = [...battle.places].sort((a, b) => a - b);
        expect(sorted).toEqual(Array.from({ length: config.members.length }, (_, i) => i + 1));
      }
    },
    30000,
  );

  it(
    'produces a full draft order',
    () => {
      const config = makeConfig(4);
      const result = runEvent(config);
      expect(result.standings.length).toBe(config.members.length);

      const positions = result.standings.map((s) => s.draftPosition).sort((a, b) => a - b);
      expect(positions).toEqual(Array.from({ length: config.members.length }, (_, i) => i + 1));

      const memberIds = new Set(result.standings.map((s) => s.memberId));
      expect(memberIds.size).toBe(config.members.length);
      for (const member of config.members) {
        expect(memberIds.has(member.id)).toBe(true);
      }
    },
    30000,
  );

  it(
    'is identical for the same master seed',
    () => {
      const config = makeConfig(5);
      const a = runEvent(config);
      const b = runEvent(config);
      expect(a.checksum).toBe(b.checksum);
      expect(a.standings).toEqual(b.standings);
    },
    60000,
  );

  it(
    'differs for a different master seed',
    () => {
      const a = runEvent(makeConfig(6));
      const b = runEvent(makeConfig(7));
      expect(a.checksum).not.toBe(b.checksum);
    },
    30000,
  );

  it(
    'is unaffected by other events running in between',
    () => {
      const config = makeConfig(8);
      const first = runEvent(config);
      runEvent(makeConfig(9));
      runEvent(makeConfig(10));
      const second = runEvent(config);
      expect(first.checksum).toBe(second.checksum);
      expect(first.standings).toEqual(second.standings);
    },
    90000,
  );

  it(
    'uses a different arena for each battle',
    () => {
      const result = runEvent(makeConfig(11));
      expect(new Set(result.battles.map((b) => b.arenaName)).size).toBe(3);
    },
    30000,
  );

  it(
    'gives different master seeds different draft orders',
    () => {
      // Not strictly guaranteed, but a collision across this many seeds would mean the
      // seed is barely influencing the outcome, which is worth knowing about.
      const orders = new Set<string>();
      for (let seed = 1; seed <= 15; seed++) {
        const result = runEvent(makeConfig(seed));
        orders.add(result.standings.map((s) => s.memberId).join(','));
      }
      expect(orders.size).toBeGreaterThan(1);
    },
    180000,
  );

  it(
    'never awards the same draft position twice',
    () => {
      for (let seed = 100; seed <= 110; seed++) {
        const result = runEvent(makeConfig(seed));
        const positions = result.standings.map((s) => s.draftPosition).sort((a, b) => a - b);
        expect(positions).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      }
    },
    180000,
  );
});
