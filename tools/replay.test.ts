import { describe, it, expect } from 'vitest';
import { runEvent } from '../src/sim/event/event';
import { ARENA_VARIANTS } from '../src/sim/event/arenas';
import { DEFAULT_MATCH, createMatch, advanceMatch, type Match } from '../src/sim/arena/match';
import { assemble } from '../src/sim/parts/assemble';
import { buildsForSeed } from '../src/sim/parts/forge';
import { toEventMembers } from '../src/config/roster';

/**
 * `replay.ts` is a CLI script with top-level side effects, so it cannot be imported here
 * without running it. What matters is not the printing — it is the CONTRACT event mode
 * exists to keep: the match it screens must be the match the league will watch.
 *
 * So these tests reconstruct event mode the same way the tool does, from the same public
 * pieces, and check the fight comes out identical to the one `runEvent` recorded. If the
 * tool's construction and this reconstruction ever drift, the numbers stop matching and
 * this fails — which is the alarm worth having, because the alternative is screening a
 * fight nobody will ever see and calling the event safe.
 */

const SEED = 918273;
const event = runEvent({ masterSeed: SEED, members: toEventMembers() });

/** The construction `replay.ts`'s `eventBattle` performs, for battle `index` (0-based). */
function eventBattleMatch(masterSeed: number, index: number): Match {
  const result = runEvent({ masterSeed, members: toEventMembers() });
  return createMatch({
    ...DEFAULT_MATCH,
    arena: ARENA_VARIANTS[index]!,
    seed: result.battles[index]!.seed,
    botCount: result.members.length,
    builds: result.builds.map((build) => assemble(build)),
  });
}

function drive(match: Match): Match {
  while (!match.done) advanceMatch(match);
  return match;
}

/** Finishing places, indexed by bot, in the same shape `BattleResult.places` uses. */
function placesFrom(match: Match): number[] {
  const order = [...match.eliminations].map((e) => e.botId);
  const survivors = match.bots.filter((b) => b.alive).map((b) => b.body.id);
  const places = new Array<number>(match.bots.length).fill(0);
  // Last eliminated places highest among the fallen; survivors place above all of them.
  const ranked = [...survivors, ...order.reverse()];
  ranked.forEach((botId, i) => {
    places[Number(botId.slice('bot-'.length))] = i + 1;
  });
  return places;
}

describe('event mode', () => {
  it('replays the exact battle the event recorded, for all three battles', () => {
    // The contract. Screening is the only safeguard on a single viewing (see docs/STATUS.md
    // on why aggregate metrics cannot protect one), and a screening tool that replays a
    // different fight is worse than none — it reports confidence it has not earned.
    for (let index = 0; index < 3; index++) {
      const match = drive(eventBattleMatch(SEED, index));
      expect(placesFrom(match), `battle ${index + 1}`).toEqual(event.battles[index]!.places);
      expect(match.world.tick, `battle ${index + 1} length`).toBe(event.battles[index]!.ticks);
    }
  });

  it('screens a different fight per battle — the three are not the same match', () => {
    const lengths = [0, 1, 2].map((i) => drive(eventBattleMatch(SEED, i)).world.tick);
    expect(new Set(lengths).size).toBeGreaterThan(1);
  });

  it('is deterministic: the same master seed and battle replay identically', () => {
    const a = drive(eventBattleMatch(SEED, 1));
    const b = drive(eventBattleMatch(SEED, 1));
    expect(placesFrom(a)).toEqual(placesFrom(b));
    expect(a.world.tick).toBe(b.world.tick);
  });

  it('covers what match mode could not: battles 2 and 3', () => {
    // The trap this mode exists to close, and it is subtler than "the two modes disagree".
    //
    // `deriveSeeds` (match mode) and `deriveSubSeeds` (event mode) draw from the same
    // stream in the same order — six Forge seeds, then battles — so match mode's single
    // `matchSeed` IS battle 1's seed, and its default arena IS battle 1's arena. Battle 1
    // was therefore screenable by accident, which is exactly why the gap went unnoticed.
    //
    // Battles 2 and 3 were not. Their seeds are the eighth and ninth draws, which match
    // mode never reaches. Passing `--arena=gauntlet` with a master seed does NOT screen
    // battle 2: it screens battle 1's seed in battle 2's arena — a fight that never
    // happens, reported as though it had. A wrong screening is worse than none, because
    // it hands back confidence it has not earned.
    const asMatch = buildsForSeed(SEED, 10);
    const asEvent = runEvent({ masterSeed: SEED, members: toEventMembers() });

    expect(asMatch.matchSeed, 'battle 1 coincides — the accident above').toBe(asEvent.battles[0]!.seed);
    expect(asMatch.matchSeed, 'battle 2 does not').not.toBe(asEvent.battles[1]!.seed);
    expect(asMatch.matchSeed, 'battle 3 does not').not.toBe(asEvent.battles[2]!.seed);
  });
});
