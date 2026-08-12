// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { runEvent } from '../../sim/event/event';
import { KILL_POINTS, pointsForPlace } from '../../sim/event/scoring';
import { ROSTER, toEventMembers } from '../../config/roster';
import { FIRST_BEAT, type BeatId } from '../beats';
import {
  killSummary,
  scoreboardConfigFor,
  scoreboardCopy,
  scoreboardRows,
  scoreboardScreen,
  type ScoreRow,
} from './scoreboard';
import type { ScreenContext } from './types';

const SEED = 918273;
const event = runEvent({ masterSeed: SEED, members: toEventMembers(ROSTER) });

function makeContext(claimedMemberId: string | null): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage: null,
    navigate: vi.fn(),
  };
}

const rowsFor = (beat: BeatId): ScoreRow[] => scoreboardRows(event, scoreboardConfigFor(beat)!);

describe('scoreboardConfigFor', () => {
  it('claims exactly the four scoreboard beats', () => {
    expect(scoreboardConfigFor('standings-1')).toEqual({ mode: 'cumulative', battleIndex: 0 });
    expect(scoreboardConfigFor('battle-2-result')).toEqual({ mode: 'battle', battleIndex: 1 });
    expect(scoreboardConfigFor('standings-2')).toEqual({ mode: 'cumulative', battleIndex: 1 });
    expect(scoreboardConfigFor('battle-3-result')).toEqual({ mode: 'battle', battleIndex: 2 });
  });

  it('claims nothing else', () => {
    for (const beat of ['landing', 'battle-1', 'battle-3', 'draft-order', 'complete'] as BeatId[]) {
      expect(scoreboardConfigFor(beat)).toBeNull();
    }
  });
});

describe('scoreboardRows', () => {
  it('shows one cell per battle played on a cumulative board, and exactly one on a battle board', () => {
    expect(rowsFor('standings-1').every((row) => row.cells.length === 1)).toBe(true);
    expect(rowsFor('standings-2').every((row) => row.cells.length === 2)).toBe(true);
    expect(rowsFor('battle-2-result').every((row) => row.cells.length === 1)).toBe(true);
    expect(rowsFor('battle-3-result').every((row) => row.cells.length === 1)).toBe(true);
  });

  it('reads a battle-only board from that battle alone, not from the first one', () => {
    // `battle-3-result` must show battle 3's places. Checked against the recorded result
    // directly, so a slicing mistake (showing battle 1 under a battle 3 heading) fails.
    for (const row of rowsFor('battle-3-result')) {
      const index = ROSTER.findIndex((m) => m.id === row.memberId);
      expect(row.cells[0]!.place).toBe(event.battles[2]!.places[index]);
    }
  });

  it('orders a battle-only board by that battle, and a cumulative board by the running total', () => {
    for (const beat of ['standings-1', 'standings-2', 'battle-2-result', 'battle-3-result'] as BeatId[]) {
      const rows = rowsFor(beat);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.total).toBeGreaterThanOrEqual(rows[i]!.total);
      }
    }
  });

  it('orders the battle-3 board differently from the cumulative board — the drama the spec is built on', () => {
    // The spec's claim: someone can win a battle outright and still sit mid-table overall.
    // If these two orders ever agree, the two screens are showing the same thing twice and
    // the sequence has lost its point.
    const battleOrder = rowsFor('battle-3-result').map((row) => row.memberId);
    const cumulative = scoreboardRows(event, { mode: 'cumulative', battleIndex: 2 }).map((row) => row.memberId);
    expect(battleOrder).not.toEqual(cumulative);

    const battleWinner = rowsFor('battle-3-result')[0]!.memberId;
    expect(cumulative.indexOf(battleWinner)).toBeGreaterThan(0);
  });

  it('totals each cell as placement points plus kill points', () => {
    for (const row of rowsFor('standings-2')) {
      for (const cell of row.cells) {
        expect(cell.placementPoints).toBe(pointsForPlace(cell.place));
        expect(cell.killPoints).toBe(cell.eliminations * KILL_POINTS);
        expect(cell.total).toBe(cell.placementPoints + cell.killPoints);
      }
      expect(row.total).toBe(row.cells.reduce((sum, cell) => sum + cell.total, 0));
    }
  });

  it('agrees with the authoritative standings once all three battles are counted', () => {
    // The real guard on this screen's arithmetic. It deliberately reimplements the running
    // total rather than calling `buildStandings` (see its doc comment on the damage
    // tiebreak) — so the totals must still land exactly where the official scoring puts
    // them, member for member, or the interim boards are quietly lying.
    const rows = scoreboardRows(event, { mode: 'cumulative', battleIndex: 2 });
    for (const row of rows) {
      const official = event.standings.find((s) => s.memberId === row.memberId)!;
      expect(row.total, row.memberId).toBe(official.points);
      expect(row.eliminations, row.memberId).toBe(official.eliminations);
    }
  });

  it('is deterministic — the same event ranks identically every time', () => {
    expect(rowsFor('standings-2').map((r) => r.memberId)).toEqual(rowsFor('standings-2').map((r) => r.memberId));
  });

  it('gives every member exactly one row, with their roster identity attached', () => {
    const rows = rowsFor('standings-1');
    expect(rows.length).toBe(ROSTER.length);
    expect([...rows].map((r) => r.memberId).sort()).toEqual([...ROSTER].map((m) => m.id).sort());
    for (const row of rows) {
      const member = ROSTER.find((m) => m.id === row.memberId)!;
      expect(row.name).toBe(member.name);
      expect(row.initials).toBe(member.initials);
      expect(row.colour).toBe(member.colour);
    }
  });
});

describe('ties', () => {
  /** Builds rows from a hand-made event fragment, so a tie can be constructed on demand
   *  rather than hunted for across seeds. Only the fields `scoreboardRows` reads are
   *  filled in. */
  function rowsFromPlaces(places: number[][], elims: number[][]): ScoreRow[] {
    const fake = {
      tallies: ROSTER.map((member, i) => ({
        memberId: member.id,
        places: places[i]!,
        eliminationsPerBattle: elims[i]!,
        damage: 0,
      })),
    } as unknown as Parameters<typeof scoreboardRows>[0];
    return scoreboardRows(fake, { mode: 'cumulative', battleIndex: 0 });
  }

  it('explains a tie that eliminations broke', () => {
    // 3rd (15) + 1 kill (3) = 18, against 2nd (18) + 0 kills = 18.
    const places = ROSTER.map((_, i) => [i + 1]);
    const elims = ROSTER.map((_, i) => [i === 2 ? 1 : 0]);
    const rows = rowsFromPlaces(places, elims);

    const tied = rows.filter((row) => row.total === 18);
    expect(tied.length).toBe(2);
    expect(tied[0]!.tieNote).toBe('level on points — more kills');
    expect(tied[1]!.tieNote).toBe('level on points — fewer kills');
    // Eliminations put the kill-scorer above the better finisher.
    expect(tied[0]!.eliminations).toBe(1);
    // Separated, so they take distinct ranks.
    expect(tied[0]!.rank).not.toBe(tied[1]!.rank);
  });

  it('says so plainly when two members are level on points AND kills, and shares their rank', () => {
    // Two members handed identical results: nothing in the interim chain can separate
    // them, and the board should not pretend otherwise.
    const places = ROSTER.map((_, i) => [i === 1 ? 1 : i + 1]);
    const elims = ROSTER.map(() => [0]);
    const rows = rowsFromPlaces(places, elims);

    const tied = rows.filter((row) => row.total === pointsForPlace(1));
    expect(tied.length).toBe(2);
    expect(tied[0]!.tieNote).toBe('level on points and kills');
    expect(tied[1]!.tieNote).toBe('level on points and kills');
    expect(tied[0]!.rank).toBe(tied[1]!.rank);
    // Competition ranking: the shared rank is 1, so the next row is 3rd, not 2nd.
    expect(rows[2]!.rank).toBe(3);
  });

  it('leaves a row alone when its total is its own', () => {
    const places = ROSTER.map((_, i) => [i + 1]);
    const elims = ROSTER.map(() => [0]);
    const rows = rowsFromPlaces(places, elims);
    expect(rows.every((row) => row.tieNote === null)).toBe(true);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('killSummary', () => {
  it('names the eliminations, not just the points they bought', () => {
    expect(killSummary(3, 9)).toBe('3 kills — 9 pts');
  });

  it('reads singular for one', () => {
    expect(killSummary(1, 3)).toBe('1 kill — 3 pts');
  });

  it('says "no kills" rather than "0 kills — 0 pts"', () => {
    expect(killSummary(0, 0)).toBe('no kills');
  });
});

describe('scoreboardCopy', () => {
  it('names the arena on a battle-only board and points forward to the standings', () => {
    const copy = scoreboardCopy('battle-2-result', scoreboardConfigFor('battle-2-result')!);
    expect(copy.title).toBe('Battle 2 result');
    expect(copy.subtitle).toContain('The Gauntlet');
    expect(copy.button).toBe('See the standings');
  });

  it('explains why battle 1 gets only one screen', () => {
    const copy = scoreboardCopy('standings-1', scoreboardConfigFor('standings-1')!);
    expect(copy.subtitle).toContain('one battle played');
    expect(copy.button).toBe('On to battle 2');
  });

  it('counts battles, not indexes, on the cumulative board', () => {
    const copy = scoreboardCopy('standings-2', scoreboardConfigFor('standings-2')!);
    expect(copy.title).toBe('Standings after 2 battles');
    expect(copy.button).toBe('On to battle 3');
  });
});

describe('scoreboardScreen', () => {
  it('renders a row per member, in ranked order, with the totals shown', () => {
    const ctx = makeContext(null);
    scoreboardScreen('standings-2').render(ctx);

    const rows = ctx.container.querySelectorAll('.score-row');
    expect(rows.length).toBe(ROSTER.length);

    const expected = rowsFor('standings-2');
    const names = [...ctx.container.querySelectorAll('.score-name')].map((el) => el.textContent);
    expect(names).toEqual(expected.map((row) => row.name));

    const totals = [...ctx.container.querySelectorAll('.score-total')].map((el) =>
      Number.parseInt(el.textContent!.trim(), 10),
    );
    expect(totals).toEqual(expected.map((row) => row.total));
  });

  it('marks the claimed member\'s row and nobody else\'s', () => {
    const claimed = ROSTER[6]!;
    const ctx = makeContext(claimed.id);
    scoreboardScreen('standings-1').render(ctx);

    const marked = ctx.container.querySelectorAll('.score-row.is-you');
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain(claimed.name);
    expect(ctx.container.querySelectorAll('.score-you').length).toBe(1);
  });

  it('marks nobody when no member has been claimed', () => {
    const ctx = makeContext(null);
    scoreboardScreen('standings-1').render(ctx);
    expect(ctx.container.querySelectorAll('.score-row.is-you').length).toBe(0);
  });

  it('shows a column per battle played on the cumulative board', () => {
    const ctx = makeContext(null);
    scoreboardScreen('standings-2').render(ctx);
    const headers = [...ctx.container.querySelectorAll('thead th')].map((el) => el.textContent!.trim());
    // #, Member, two battles, Total.
    expect(headers.length).toBe(5);
    expect(headers[2]).toContain('The Grinder');
    expect(headers[3]).toContain('The Gauntlet');
  });

  it('shows finish and kills as their own columns on a battle-only board', () => {
    const ctx = makeContext(null);
    scoreboardScreen('battle-3-result').render(ctx);
    const headers = [...ctx.container.querySelectorAll('thead th')].map((el) => el.textContent!.trim());
    expect(headers).toEqual(['#', 'Member', 'Finish', 'Kills', 'Points']);
    expect(ctx.container.querySelectorAll('.score-finish').length).toBe(ROSTER.length);
  });

  it('advances to the next beat when the button is pressed', () => {
    const ctx = makeContext(null);
    scoreboardScreen('battle-2-result').render(ctx);
    ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('standings-2');
  });

  it('renders every tie note the rows carry', () => {
    // Whichever of the four boards happens to contain a tie on this seed, the explanation
    // must reach the DOM — a note computed and then dropped would be worse than none.
    for (const beat of ['standings-1', 'standings-2', 'battle-2-result', 'battle-3-result'] as BeatId[]) {
      const expected = rowsFor(beat).filter((row) => row.tieNote !== null);
      const ctx = makeContext(null);
      scoreboardScreen(beat).render(ctx);
      const notes = [...ctx.container.querySelectorAll('.score-tie')].map((el) => el.textContent!.trim());
      expect(notes, beat).toEqual(expected.map((row) => row.tieNote));
    }
  });

  it('refuses to build a screen for a beat that is not a scoreboard', () => {
    expect(() => scoreboardScreen('battle-1')).toThrow(/not a scoreboard beat/);
  });
});
