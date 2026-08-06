import { describe, it, expect } from 'vitest';
import { buildsForSeed, FAST_SETTLE_GRACE_TICKS } from './forge';
import { CATEGORIES } from './tables';

/**
 * Pins known seed -> build outputs. These values were captured from `buildsForSeed`
 * before it was moved out of `tools/arena-metrics.ts` into this shared module, and
 * verified identical immediately after the move (same seeds, same six-part labels, same
 * match seed). If this test ever fails, `buildsForSeed`'s output changed — that is a real
 * behaviour change, not a stale expectation to update.
 */
describe('buildsForSeed: pinned seed -> build outputs', () => {
  it('seed 1, 10 bots: bot 0 and the derived match seed', () => {
    const { builds, matchSeed } = buildsForSeed(1, 10);

    expect(matchSeed).toBe(727273491);
    expect(builds[0]!.partLabels).toEqual({
      chassis: 'Tower',
      drive: 'Tank Tracks',
      weapon: 'Vertical Spinner',
      armour: 'Titanium',
      ability: 'Adrenaline',
      personality: 'Hit-and-Run',
    });
    expect(builds[0]!.ability).toBe('adrenaline');
    expect(builds[0]!.personality).toBe('hitAndRun');
  });

  it('seed 42, 10 bots: bot 3 and the derived match seed', () => {
    const { builds, matchSeed } = buildsForSeed(42, 10);

    expect(matchSeed).toBe(621270294);
    expect(builds[3]!.partLabels).toEqual({
      chassis: 'Diamond',
      drive: '6 Wheels',
      weapon: 'Ram Plate',
      armour: 'Aluminium',
      ability: 'Shockwave',
      personality: 'Third Party Predator',
    });
    expect(builds[3]!.ability).toBe('shockwave');
    expect(builds[3]!.personality).toBe('thirdParty');
  });

  it('is deterministic: the same seed produces the same builds twice', () => {
    const first = buildsForSeed(7, 10);
    const second = buildsForSeed(7, 10);

    expect(second.matchSeed).toBe(first.matchSeed);
    expect(second.builds.map((b) => b.partLabels)).toEqual(first.builds.map((b) => b.partLabels));
  });

  it('returns one build per bot, with all six category labels present', () => {
    const { builds } = buildsForSeed(3, 10);

    expect(builds).toHaveLength(10);
    for (const build of builds) {
      for (const category of CATEGORIES) {
        expect(typeof build.partLabels[category]).toBe('string');
        expect(build.partLabels[category].length).toBeGreaterThan(0);
      }
    }
  });

  it('settleGraceTicks defaults to FAST_SETTLE_GRACE_TICKS and does not change the outcome', () => {
    const implicit = buildsForSeed(1, 10);
    const explicit = buildsForSeed(1, 10, FAST_SETTLE_GRACE_TICKS);
    // A longer, "real" settle time only changes how long the board keeps jostling after
    // every ball is already enclosed by its slot -- never which slot it lands in.
    const realSettle = buildsForSeed(1, 10, 400);

    expect(explicit.matchSeed).toBe(implicit.matchSeed);
    expect(explicit.builds.map((b) => b.partLabels)).toEqual(implicit.builds.map((b) => b.partLabels));
    expect(realSettle.matchSeed).toBe(implicit.matchSeed);
    expect(realSettle.builds.map((b) => b.partLabels)).toEqual(implicit.builds.map((b) => b.partLabels));
  });
});
