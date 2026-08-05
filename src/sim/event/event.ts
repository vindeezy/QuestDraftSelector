import { createRng } from '../rng';
import { hashNumbers } from '../checksum';
import { DEFAULT_BOARD } from '../plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../plinko/plinko';
import { DEFAULT_MATCH, runMatch, type Elimination } from '../arena/match';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from './arenas';
import { buildStandings, type BattleTally, type Standing } from './scoring';

/**
 * The whole show, from one seed: seven Forge boards build every member's bot, then three
 * battles decide the draft order.
 *
 * A record of an event is therefore just the master seed and the roster — replaying it
 * means calling `runEvent` again and checking the checksum still matches. That is the
 * entire reason every sub-system in `src/sim` is deterministic.
 */

const FORGE_BOARD_COUNT = 7;
const BATTLE_COUNT = 3;

/** Upper bound for a drawn sub-seed. `createRng` treats seeds as 32-bit integers. */
const MAX_SUB_SEED = 2147483647;

export interface EventMember {
  id: string;
  name: string;
  colour: string;
}

export interface EventConfig {
  masterSeed: number;
  members: readonly EventMember[];
}

export interface ForgeBoardResult {
  boardIndex: number;
  seed: number;
  /** Slot each member landed in, indexed to match `members`. */
  slots: number[];
}

export interface BattleResult {
  battleIndex: number;
  seed: number;
  arenaName: string;
  /** Finishing place per member, indexed to match `members`. 1 is the winner. */
  places: number[];
  eliminations: Elimination[];
  ticks: number;
}

export interface EventResult {
  masterSeed: number;
  members: readonly EventMember[];
  forge: ForgeBoardResult[];
  battles: BattleResult[];
  standings: Standing[];
  checksum: string;
}

/**
 * Draws the ten sub-seeds from the master seed: seven Forge board seeds, then three
 * battle seeds, in that fixed order.
 *
 * The order is part of the contract. Changing it, or the count, changes what every
 * previously recorded master seed produces.
 */
function deriveSubSeeds(masterSeed: number): { forgeSeeds: number[]; battleSeeds: number[] } {
  const rng = createRng(masterSeed);

  const forgeSeeds: number[] = [];
  for (let i = 0; i < FORGE_BOARD_COUNT; i++) {
    forgeSeeds.push(Math.floor(rng.next() * MAX_SUB_SEED));
  }

  const battleSeeds: number[] = [];
  for (let i = 0; i < BATTLE_COUNT; i++) {
    battleSeeds.push(Math.floor(rng.next() * MAX_SUB_SEED));
  }

  return { forgeSeeds, battleSeeds };
}

/**
 * Runs one Forge board and reads off each member's landing slot.
 *
 * Member index maps straight to ball index — member 0 is ball 0, and so on. That mapping
 * is already fair: the board shuffles release position and height independently, from its
 * own seeded stream, so no member is permanently advantaged by their index. Adding another
 * shuffle here on top would only make the mapping harder to explain, not fairer.
 */
function runForgeBoard(boardIndex: number, seed: number, memberCount: number): ForgeBoardResult {
  const result = runPlinko({
    ...DEFAULT_PLINKO,
    board: DEFAULT_BOARD,
    ballCount: memberCount,
    seed,
  });

  const slots = new Array<number>(memberCount);
  for (const landing of result.landings) {
    slots[landing.ballIndex] = landing.slot;
  }

  return { boardIndex, seed, slots };
}

/**
 * Runs one battle and reads off each member's finishing place.
 *
 * Member index maps straight to bot index for the same reason it does on the Forge board:
 * the arena shuffles spawn position and personality independently from its own seeded
 * stream, so the mapping is already fair without a further shuffle.
 */
function runBattle(
  battleIndex: number,
  seed: number,
  memberCount: number,
): { result: BattleResult; damage: Map<string, number> } {
  const arenaConfig = ARENA_VARIANTS[battleIndex]!;
  const arenaName = ARENA_VARIANT_NAMES[battleIndex]!;

  const matchResult = runMatch({
    ...DEFAULT_MATCH,
    arena: arenaConfig,
    botCount: memberCount,
    seed,
  });

  const places = new Array<number>(memberCount);
  for (const placement of matchResult.placements) {
    const botIndex = botIdToIndex(placement.botId);
    places[botIndex] = placement.place;
  }

  // Damage is scoped to this single match, so it must be summed into the running total
  // by the caller rather than read as a running total itself.
  const damage = new Map<string, number>();
  for (const entry of matchResult.damage) {
    damage.set(entry.botId, entry.damageDealt);
  }

  return {
    result: {
      battleIndex,
      seed,
      arenaName,
      places,
      eliminations: matchResult.eliminations,
      ticks: matchResult.ticks,
    },
    damage,
  };
}

/** `bot-3` -> 3. Bot ids are always `bot-${memberIndex}`, assigned in `createMatch`. */
function botIdToIndex(botId: string): number {
  return Number(botId.slice('bot-'.length));
}

/** Runs the entire event from a single master seed. */
export function runEvent(config: EventConfig): EventResult {
  const { members } = config;
  const memberCount = members.length;

  const { forgeSeeds, battleSeeds } = deriveSubSeeds(config.masterSeed);

  const forge: ForgeBoardResult[] = forgeSeeds.map((seed, i) => runForgeBoard(i, seed, memberCount));

  const battles: BattleResult[] = [];
  const eliminationsByMember = new Array<number>(memberCount).fill(0);
  const damageByMember = new Array<number>(memberCount).fill(0);

  battleSeeds.forEach((seed, i) => {
    const { result, damage } = runBattle(i, seed, memberCount);
    battles.push(result);

    for (const elimination of result.eliminations) {
      if (elimination.byId === null) continue;
      eliminationsByMember[botIdToIndex(elimination.byId)]! += 1;
    }

    for (const [botId, dealt] of damage) {
      damageByMember[botIdToIndex(botId)]! += dealt;
    }
  });

  const tallies: BattleTally[] = members.map((member, i) => ({
    memberId: member.id,
    places: battles.map((battle) => battle.places[i]!),
    eliminations: eliminationsByMember[i]!,
    damage: damageByMember[i]!,
  }));

  const standings = buildStandings(tallies);

  const checksumValues: number[] = [config.masterSeed];
  for (const board of forge) {
    checksumValues.push(board.seed);
    for (const slot of board.slots) checksumValues.push(slot);
  }
  for (const battle of battles) {
    checksumValues.push(battle.seed, battle.ticks);
    for (const place of battle.places) checksumValues.push(place);
    for (const elimination of battle.eliminations) checksumValues.push(elimination.tick);
  }
  for (const standing of standings) {
    checksumValues.push(standing.points, standing.draftPosition, standing.eliminations, standing.damage);
  }

  return {
    masterSeed: config.masterSeed,
    members,
    forge,
    battles,
    standings,
    checksum: hashNumbers(checksumValues),
  };
}
