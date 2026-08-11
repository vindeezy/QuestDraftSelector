import { createRng } from '../rng';
import { hashNumbers } from '../checksum';
import { DEFAULT_BOARD } from '../plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../plinko/plinko';
import { DEFAULT_MATCH, runMatch, type Elimination } from '../arena/match';
import { assemble, type AssembledBot, type BotBuild } from '../parts/assemble';
import { CATEGORIES, partAt, slotCountFor, type CategoryName } from '../parts/tables';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from './arenas';
import { buildStandings, type BattleTally, type Standing } from './scoring';

/**
 * The whole show, from one seed: six Forge boards — one per category in `CATEGORIES`
 * order — build every member's bot, then three battles decide the draft order.
 *
 * A record of an event is therefore just the master seed and the roster — replaying it
 * means calling `runEvent` again and checking the checksum still matches. That is the
 * entire reason every sub-system in `src/sim` is deterministic.
 */

const FORGE_BOARD_COUNT = CATEGORIES.length;
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
  /** Which of the six categories this board assigns. */
  category: CategoryName;
  seed: number;
  /** Slot each member landed in, indexed to match `members`. The simulation reads only
   *  this — `partIds`/`partLabels` below exist for the website and must never be able to
   *  change a battle outcome. */
  slots: number[];
  /** Part id each member landed on, indexed to match `members`. */
  partIds: string[];
  /** Human-readable part name each member landed on, indexed to match `members`. */
  partLabels: string[];
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
  /** The per-member tallies `standings` was built from — see `buildStandings` in
   *  `scoring.ts`. Exposed so a caller can re-score the same battles at a different kill-
   *  points rate without re-simulating anything: placements, eliminations and damage are
   *  already decided by this point, and only the points arithmetic can differ. Not part of
   *  the checksum (see below) — it is derived entirely from data the checksum already
   *  covers (`battles` and `standings`), so including it would be redundant, not new
   *  information. */
  tallies: BattleTally[];
  /** Every member's build, indexed to match `members`. What the battles actually run on. */
  builds: BotBuild[];
  /** Every member's human-readable part names, indexed to match `members`. What the
   *  website shows — never read by the simulation. */
  partLabels: Record<CategoryName, string>[];
  checksum: string;
}

/**
 * Draws the nine sub-seeds from the master seed: six Forge board seeds (one per category,
 * in `CATEGORIES` order), then three battle seeds, in that fixed order.
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
 * Runs one Forge board for one category and reads off each member's landing slot and
 * the part it corresponds to.
 *
 * Member index maps straight to ball index — member 0 is ball 0, and so on. That mapping
 * is already fair: the board shuffles release position and height independently, from its
 * own seeded stream, so no member is permanently advantaged by their index. Adding another
 * shuffle here on top would only make the mapping harder to explain, not fairer.
 */
function runForgeBoard(
  boardIndex: number,
  category: CategoryName,
  seed: number,
  memberCount: number,
): ForgeBoardResult {
  const result = runPlinko({
    ...DEFAULT_PLINKO,
    board: { ...DEFAULT_BOARD, slotCount: slotCountFor(category) },
    ballCount: memberCount,
    seed,
  });

  const slots = new Array<number>(memberCount);
  for (const landing of result.landings) {
    slots[landing.ballIndex] = landing.slot;
  }

  const partIds = new Array<string>(memberCount);
  const partLabels = new Array<string>(memberCount);
  for (let i = 0; i < memberCount; i++) {
    const part = partAt(category, slots[i]!);
    partIds[i] = part.id;
    partLabels[i] = part.label;
  }

  return { boardIndex, category, seed, slots, partIds, partLabels };
}

/** Folds one member's six landing slots (one per board, in `CATEGORIES` order) into a
 *  `BotBuild`. */
function buildFor(forge: readonly ForgeBoardResult[], memberIndex: number): BotBuild {
  const build = {} as Record<CategoryName, number>;
  for (const board of forge) {
    build[board.category] = board.slots[memberIndex]!;
  }
  return build as BotBuild;
}

/**
 * Runs one battle and reads off each member's finishing place.
 *
 * Member index maps straight to bot index for the same reason it does on the Forge board:
 * the arena shuffles spawn position independently from its own seeded stream, and `builds`
 * is already indexed to match `members`, so the mapping is already fair without a further
 * shuffle. `createMatch` reads personality and ability straight off each build rather than
 * drawing its own shuffle, since the Forge already assigned both fairly.
 */
function runBattle(
  battleIndex: number,
  seed: number,
  memberCount: number,
  builds: AssembledBot[],
): { result: BattleResult; damage: Map<string, number> } {
  const arenaConfig = ARENA_VARIANTS[battleIndex]!;
  const arenaName = ARENA_VARIANT_NAMES[battleIndex]!;

  const matchResult = runMatch({
    ...DEFAULT_MATCH,
    arena: arenaConfig,
    botCount: memberCount,
    seed,
    builds,
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

/**
 * Folds one battle's eliminations into per-member kill credit, in place.
 *
 * An environmental death — a pit, a saw, a flame jet, a cannon, a crusher — has
 * `byId === null` (see `EliminationCause` in `match.ts`) and, correctly, credits nobody:
 * `KILL_POINTS` in `scoring.ts` rewards eliminations a bot *caused*, not deaths that
 * merely happened nearby.
 */
export function tallyKillCredit(eliminationsByMember: number[], eliminations: readonly Elimination[]): void {
  for (const elimination of eliminations) {
    if (elimination.byId === null) continue;
    eliminationsByMember[botIdToIndex(elimination.byId)]! += 1;
  }
}

/** Appends a string's char codes to a checksum accumulator, terminated by a sentinel. */
function pushStringCodes(values: number[], text: string): void {
  for (let i = 0; i < text.length; i++) values.push(text.charCodeAt(i));
  values.push(-1);
}

/** Runs the entire event from a single master seed. */
export function runEvent(config: EventConfig): EventResult {
  const { members } = config;
  const memberCount = members.length;

  const { forgeSeeds, battleSeeds } = deriveSubSeeds(config.masterSeed);

  const forge: ForgeBoardResult[] = forgeSeeds.map((seed, i) =>
    runForgeBoard(i, CATEGORIES[i]!, seed, memberCount),
  );

  // Every member's build, and the assembled bot the battles actually run on. Personality
  // and ability the Forge assigned flow straight into the match through `assembledBots` —
  // see `createMatch`'s `builds` option.
  const builds: BotBuild[] = members.map((_, i) => buildFor(forge, i));
  const assembledBots: AssembledBot[] = builds.map((build) => assemble(build));
  const partLabels: Record<CategoryName, string>[] = assembledBots.map((bot) => bot.partLabels);

  const battles: BattleResult[] = [];
  // Indexed [battleIndex][memberIndex] — kept per battle, not folded into a single running
  // sum, so `buildStandings` can attribute kill points to the battle that earned them.
  const eliminationsByMemberPerBattle: number[][] = [];
  const damageByMember = new Array<number>(memberCount).fill(0);

  battleSeeds.forEach((seed, i) => {
    const { result, damage } = runBattle(i, seed, memberCount, assembledBots);
    battles.push(result);

    const eliminationsThisBattle = new Array<number>(memberCount).fill(0);
    tallyKillCredit(eliminationsThisBattle, result.eliminations);
    eliminationsByMemberPerBattle.push(eliminationsThisBattle);

    for (const [botId, dealt] of damage) {
      damageByMember[botIdToIndex(botId)]! += dealt;
    }
  });

  const tallies: BattleTally[] = members.map((member, i) => ({
    memberId: member.id,
    places: battles.map((battle) => battle.places[i]!),
    eliminationsPerBattle: eliminationsByMemberPerBattle.map((battleElims) => battleElims[i]!),
    damage: damageByMember[i]!,
  }));

  const standings = buildStandings(tallies);

  // Members are inputs to the event, not just a headcount: two rosters of the same size
  // but different people must never share a checksum, or a record would go on "verifying"
  // after the league swapped a member out. Character codes fold each id/name/colour into
  // the hash; -1 is not a valid char code, so it safely separates fields and members
  // without a real string-hash function (which would need banned Math operations).
  const checksumValues: number[] = [config.masterSeed, memberCount];
  for (const member of members) {
    pushStringCodes(checksumValues, member.id);
    pushStringCodes(checksumValues, member.name);
    pushStringCodes(checksumValues, member.colour);
  }
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
    pushStringCodes(checksumValues, standing.memberId);
    checksumValues.push(standing.points, standing.draftPosition, standing.eliminations, standing.damage);
  }

  return {
    masterSeed: config.masterSeed,
    members,
    forge,
    battles,
    standings,
    tallies,
    builds,
    partLabels,
    checksum: hashNumbers(checksumValues),
  };
}
