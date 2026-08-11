import { describe, it, expect } from 'vitest';
import { PLACEMENT_POINTS, KILL_POINTS, pointsForPlace, buildStandings, type BattleTally } from './scoring';

const tally = (
  memberId: string,
  places: number[],
  eliminationsPerBattle: number[] = places.map(() => 0),
  damage = 0,
): BattleTally => ({ memberId, places, eliminationsPerBattle, damage });

describe('PLACEMENT_POINTS', () => {
  it('runs 25 down to 1 across ten places', () => {
    expect(PLACEMENT_POINTS).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
  });

  it('rewards winning far more than second', () => {
    // The gap at the top is deliberately larger than anywhere else, so a battle win
    // is worth chasing rather than settling for a safe second.
    const topGap = PLACEMENT_POINTS[0]! - PLACEMENT_POINTS[1]!;
    const midGap = PLACEMENT_POINTS[4]! - PLACEMENT_POINTS[5]!;
    expect(topGap).toBeGreaterThan(midGap * 3);
  });
});

describe('KILL_POINTS', () => {
  it('is a flat 3 points per credited elimination', () => {
    expect(KILL_POINTS).toBe(3);
  });
});

describe('pointsForPlace', () => {
  it('maps first place to the top score', () => {
    expect(pointsForPlace(1)).toBe(25);
  });

  it('maps last place to one point', () => {
    expect(pointsForPlace(10)).toBe(1);
  });

  it('gives nothing for a place beyond the table', () => {
    expect(pointsForPlace(11)).toBe(0);
    expect(pointsForPlace(0)).toBe(0);
  });
});

describe('buildStandings', () => {
  it('totals points across battles', () => {
    const s = buildStandings([tally('a', [1, 1, 1]), tally('b', [2, 2, 2])]);
    expect(s[0]!.memberId).toBe('a');
    expect(s[0]!.points).toBe(75);
    expect(s[1]!.points).toBe(54);
  });

  it('assigns draft positions in points order', () => {
    const s = buildStandings([tally('a', [3, 3, 3]), tally('b', [1, 1, 1]), tally('c', [5, 5, 5])]);
    expect(s.map((r) => r.memberId)).toEqual(['b', 'a', 'c']);
    expect(s.map((r) => r.draftPosition)).toEqual([1, 2, 3]);
  });

  it('scores a credited elimination as placement points plus KILL_POINTS each', () => {
    // Place 1 is worth 25; three credited eliminations add 3 * KILL_POINTS on top.
    const s = buildStandings([tally('a', [1], [3])]);
    expect(s[0]!.points).toBe(25 + 3 * KILL_POINTS);
  });

  it('awards no kill points for eliminations nobody was credited with', () => {
    // A tally's `eliminationsPerBattle` only ever holds credited kills by the time it
    // reaches `buildStandings` -- `event.ts`'s `tallyKillCredit` drops environmental
    // deaths (`byId === null`) before this point. Zero credited eliminations means zero
    // bonus.
    const s = buildStandings([tally('a', [1], [0])]);
    expect(s[0]!.points).toBe(25);
  });

  it('breaks a tie on total eliminations', () => {
    // Since eliminations feed straight into points via KILL_POINTS, a genuine tie needs
    // placement + kill points to land on the same total despite different kill counts:
    // place 1 (25) + 1 elimination (3) = 28, matching place 5 (10) + 6 eliminations
    // (18) = 28.
    //
    // These numbers are KILL_POINTS-specific by nature — the fixture has to construct a
    // tie, and what ties depends on the constant. They were recomputed when it moved
    // from 5 to 3. If it moves again, recompute them again rather than relaxing the
    // assertion: a fixture that no longer ties silently stops testing the tiebreak.
    const s = buildStandings([tally('a', [1], [1]), tally('b', [5], [6])]);
    expect(s[0]!.points).toBe(s[1]!.points);
    expect(s[0]!.memberId).toBe('b');
  });

  it('breaks a deeper tie on damage dealt', () => {
    const s = buildStandings([
      tally('a', [1, 10, 10], [3, 0, 0], 120),
      tally('b', [1, 10, 10], [3, 0, 0], 340),
    ]);
    expect(s[0]!.memberId).toBe('b');
  });

  it('records why a tie was broken, so the site can explain it', () => {
    // Same constructed tie as 'breaks a tie on total eliminations' above: points match
    // (28 each) so the tiebreak falls to eliminations, which differ (1 vs 6).
    const s = buildStandings([tally('a', [1], [1]), tally('b', [5], [6])]);
    expect(s[0]!.tiebreak).toBe('eliminations');
    expect(s[1]!.tiebreak).toBe('eliminations');
  });

  it('leaves tiebreak null when points alone decided it', () => {
    const s = buildStandings([tally('a', [1]), tally('b', [5])]);
    expect(s[0]!.tiebreak).toBe(null);
  });

  it('is deterministic when everything ties', () => {
    // Never leave the order to sort stability. Fall back to member id so the same
    // inputs always produce the same draft order, on any engine.
    const a = buildStandings([tally('b', [1], [1], 1), tally('a', [1], [1], 1)]);
    const b = buildStandings([tally('a', [1], [1], 1), tally('b', [1], [1], 1)]);
    expect(a.map((r) => r.memberId)).toEqual(b.map((r) => r.memberId));
  });

  it('carries per-battle placement points through for the scoreboard', () => {
    const s = buildStandings([tally('a', [1, 5, 10])]);
    expect(s[0]!.battles.map((b) => b.placementPoints)).toEqual([25, 10, 1]);
  });

  it('computes per-battle kill points correctly for kills spread unevenly across battles', () => {
    // 3 kills in battle 1, 0 in battle 2, 1 in battle 3.
    const s = buildStandings([tally('a', [1, 1, 1], [3, 0, 1])]);
    const [b1, b2, b3] = s[0]!.battles;
    expect(b1!.eliminations).toBe(3);
    expect(b1!.killPoints).toBe(3 * KILL_POINTS);
    expect(b1!.total).toBe(25 + 3 * KILL_POINTS);

    expect(b2!.eliminations).toBe(0);
    expect(b2!.killPoints).toBe(0);
    expect(b2!.total).toBe(25);

    expect(b3!.eliminations).toBe(1);
    expect(b3!.killPoints).toBe(1 * KILL_POINTS);
    expect(b3!.total).toBe(25 + 1 * KILL_POINTS);
  });

  it("a member's grand total equals the sum of their per-battle totals", () => {
    const s = buildStandings([tally('a', [1, 4, 8], [2, 1, 0], 55)]);
    const sumOfBattleTotals = s[0]!.battles.reduce((sum, b) => sum + b.total, 0);
    expect(s[0]!.points).toBe(sumOfBattleTotals);
  });

  it('scores according to an explicit kill-points value when one is given', () => {
    // Same shape as the "scores a credited elimination..." test above, but at a rate
    // other than the default 5, to prove the parameter actually drives the arithmetic.
    const s = buildStandings([tally('a', [1], [3])], 1);
    expect(s[0]!.points).toBe(25 + 3 * 1);
  });

  it('matches today\'s behaviour exactly when no kill-points value is given', () => {
    const withDefault = buildStandings([tally('a', [1, 4, 8], [2, 1, 0], 55)]);
    const withExplicitFive = buildStandings([tally('a', [1, 4, 8], [2, 1, 0], 55)], KILL_POINTS);
    expect(withDefault).toEqual(withExplicitFive);
  });

  it('produces the same grand total as the old event-wide calculation', () => {
    // Before this refactor, `points` was `sum(placementPoints) + eliminations * KILL_POINTS`
    // where `eliminations` was a single event-wide sum. Construct the same tally both ways
    // and assert the grand totals are identical -- per-battle attribution must not change
    // the arithmetic, only make it visible.
    const places = [1, 4, 8];
    const perBattleEliminations = [3, 0, 1];

    const eventWideEliminations = perBattleEliminations.reduce((sum, n) => sum + n, 0);
    const oldStylePoints =
      places.reduce((sum, place) => sum + pointsForPlace(place), 0) + eventWideEliminations * KILL_POINTS;

    const s = buildStandings([tally('a', places, perBattleEliminations)]);
    expect(s[0]!.points).toBe(oldStylePoints);
  });
});
