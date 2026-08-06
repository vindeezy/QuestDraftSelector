import { describe, it, expect } from 'vitest';
import { runEvent, tallyKillCredit, type EventConfig, type EventMember } from './event';
import { CATEGORIES, slotCountFor } from '../parts/tables';
import { createMatch, DEFAULT_MATCH } from '../arena/match';
import { DEFAULT_ARENA } from '../arena/arena';
import { assemble } from '../parts/assemble';
import type { Elimination } from '../arena/match';

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

describe('tallyKillCredit', () => {
  const elim = (byId: string | null, botId = 'bot-9'): Elimination => ({
    botId,
    cause: byId === null ? 'fell' : 'destroyed',
    tick: 1,
    byId,
  });

  it('credits the killer for a combat elimination', () => {
    const eliminationsByMember = [0, 0, 0];
    tallyKillCredit(eliminationsByMember, [elim('bot-0')]);
    expect(eliminationsByMember).toEqual([1, 0, 0]);
  });

  it('awards nobody for an environmental death', () => {
    // A pit, a saw, a flame jet -- anything with a null `byId` is not credited to
    // anyone, so it must not move any member's kill points.
    const eliminationsByMember = [0, 0, 0];
    tallyKillCredit(eliminationsByMember, [elim(null)]);
    expect(eliminationsByMember).toEqual([0, 0, 0]);
  });

  it('accumulates multiple credited eliminations for the same killer', () => {
    const eliminationsByMember = [0, 0, 0];
    tallyKillCredit(eliminationsByMember, [elim('bot-2'), elim('bot-2'), elim(null)]);
    expect(eliminationsByMember).toEqual([0, 0, 2]);
  });
});

describe('runEvent', () => {
  it(
    'runs six forge boards and three battles',
    () => {
      const result = runEvent(makeConfig(1));
      expect(result.forge.length).toBe(6);
      expect(result.battles.length).toBe(3);
    },
    30000,
  );

  it(
    'runs the six boards in CATEGORIES order',
    () => {
      const result = runEvent(makeConfig(1));
      expect(result.forge.map((board) => board.category)).toEqual([...CATEGORIES]);
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

describe('runEvent: Forge builds real bots', () => {
  it(
    'gives every member a part id and label from every board, matching the board category',
    () => {
      const config = makeConfig(20);
      const result = runEvent(config);
      for (const board of result.forge) {
        expect(board.partIds.length).toBe(config.members.length);
        expect(board.partLabels.length).toBe(config.members.length);
        for (let i = 0; i < config.members.length; i++) {
          expect(typeof board.partIds[i]).toBe('string');
          expect(board.partIds[i]!.length).toBeGreaterThan(0);
          expect(typeof board.partLabels[i]).toBe('string');
          expect(board.partLabels[i]!.length).toBeGreaterThan(0);
        }
      }
    },
    30000,
  );

  it(
    'gives every member a build with six valid slot indices',
    () => {
      const config = makeConfig(21);
      const result = runEvent(config);
      expect(result.builds.length).toBe(config.members.length);

      for (const build of result.builds) {
        for (const category of CATEGORIES) {
          const slot = build[category];
          expect(Number.isInteger(slot)).toBe(true);
          expect(slot).toBeGreaterThanOrEqual(0);
          expect(slot).toBeLessThan(slotCountFor(category));
        }
      }
    },
    30000,
  );

  it(
    'gives every member part labels for all six categories',
    () => {
      const config = makeConfig(22);
      const result = runEvent(config);
      expect(result.partLabels.length).toBe(config.members.length);
      for (const labels of result.partLabels) {
        for (const category of CATEGORIES) {
          expect(typeof labels[category]).toBe('string');
          expect(labels[category].length).toBeGreaterThan(0);
        }
      }
    },
    30000,
  );

  it(
    'the ten bots that actually fight are not identical — at least two distinct maxHealth values',
    () => {
      const config = makeConfig(23);
      const result = runEvent(config);
      const maxHealths = result.builds.map((build) => assemble(build).stats.maxHealth);
      expect(new Set(maxHealths).size).toBeGreaterThanOrEqual(2);
    },
    30000,
  );

  it(
    'a battle uses the assembled builds — createMatch with those builds reflects each build\'s personality and ability',
    () => {
      const config = makeConfig(24);
      const result = runEvent(config);
      const assembledBots = result.builds.map((build) => assemble(build));

      const m = createMatch({
        ...DEFAULT_MATCH,
        arena: DEFAULT_ARENA,
        botCount: config.members.length,
        seed: 999,
        builds: assembledBots,
      });

      m.bots.forEach((bot, i) => {
        expect(m.aiStates.get(bot.body.id)!.personality).toBe(assembledBots[i]!.personality);
        expect(m.abilityStates.get(bot.body.id)!.name).toBe(assembledBots[i]!.ability);
      });
    },
    30000,
  );
});
