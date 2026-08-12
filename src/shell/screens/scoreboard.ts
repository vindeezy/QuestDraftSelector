import { KILL_POINTS, pointsForPlace, type BattleTally } from '../../sim/event/scoring';
import type { EventResult } from '../../sim/event/event';
import { ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { ROSTER, toEventMembers } from '../../config/roster';
import { nextBeat, type BeatId } from '../beats';
import { ordinal } from '../ordinal';
import { readableInkFor } from '../colour';
import { getEventResult } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beats 12, 14, 15 and 17 — the scoreboards between the battles. See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2 (rows 12, 14, 15, 17).
 *
 * Two shapes, and the difference between them is the whole point of the sequence:
 *
 * - **Cumulative** (`standings-1`, `standings-2`) — every battle so far broken out, ordered
 *   by grand total.
 * - **Battle only** (`battle-2-result`, `battle-3-result`) — that battle by itself, ordered
 *   by who scored most *in it*.
 *
 * The order flips between the two, and the spec is explicit that this is deliberate:
 * someone can win battle 3 outright and still land sixth overall, and "that gap is the
 * drama". Battle 1 gets only the cumulative screen, because with one battle played the
 * round result *is* the standing and a second screen would show identical numbers.
 *
 * The final draft order (beat 18) is NOT here — it is its own screen, and unlike these it
 * reads the authoritative `result.standings`. See the note on `interimRows` for why the
 * interim boards deliberately do not.
 */

/** Which board a beat draws, and from what. `throughBattle` is an inclusive 0-based index:
 *  `standings-2` is cumulative through battle index 1, i.e. the first two battles. */
export interface ScoreboardConfig {
  mode: 'cumulative' | 'battle';
  battleIndex: number;
}

const SCOREBOARD_BEATS: Partial<Record<BeatId, ScoreboardConfig>> = {
  'standings-1': { mode: 'cumulative', battleIndex: 0 },
  'battle-2-result': { mode: 'battle', battleIndex: 1 },
  'standings-2': { mode: 'cumulative', battleIndex: 1 },
  'battle-3-result': { mode: 'battle', battleIndex: 2 },
};

/** This beat's board, or `null` for any beat that isn't one of the four — the same
 *  "is this one of mine, and which" shape `battleIndexForBeat` gives the battles. */
export function scoreboardConfigFor(id: BeatId): ScoreboardConfig | null {
  return SCOREBOARD_BEATS[id] ?? null;
}

/** One battle's contribution to a member, as this screen needs it. Mirrors `scoring.ts`'s
 *  `BattleStanding` but carries the finishing place too, which the scoreboard shows and
 *  that type does not hold. */
export interface ScoreCell {
  place: number;
  placementPoints: number;
  eliminations: number;
  killPoints: number;
  total: number;
}

export interface ScoreRow {
  memberId: string;
  name: string;
  initials: string;
  colour: string;
  /** The battles this board is showing, in event order — every battle so far for a
   *  cumulative board, exactly one for a battle-only board. */
  cells: ScoreCell[];
  /** Sum of `cells[*].total`: the number this board is ordered by. */
  total: number;
  /** Eliminations across `cells`. The first tiebreak, and shown in its own right. */
  eliminations: number;
  /** Competition rank: rows level on both `total` and `eliminations` share a number, so
   *  the next rank skips (1, 2, 2, 4). */
  rank: number;
  /** Why this row sits where it does when it is level on points with a neighbour, or
   *  `null` when its total is its own. */
  tieNote: string | null;
}

/** One member's cells for battles `0..battleIndex`, or just `battleIndex` alone. */
function cellsFor(tally: BattleTally, from: number, to: number): ScoreCell[] {
  const cells: ScoreCell[] = [];
  for (let i = from; i <= to; i++) {
    const place = tally.places[i] ?? 0;
    const placementPoints = pointsForPlace(place);
    const eliminations = tally.eliminationsPerBattle[i] ?? 0;
    const killPoints = eliminations * KILL_POINTS;
    cells.push({ place, placementPoints, eliminations, killPoints, total: placementPoints + killPoints });
  }
  return cells;
}

/**
 * Ranks members for one board.
 *
 * Deliberately does NOT call `buildStandings`, and does not read `result.standings`.
 * Both settle ties with `BattleTally.damage`, which is damage across the *whole event* —
 * there is no per-battle breakdown of it anywhere in a recorded result. Using it on a
 * board shown after one or two battles would order two members by damage they have not
 * dealt yet on screen, which is both wrong and a (small) leak from battles still to come.
 *
 * So the interim chain stops one rule short: points, then eliminations, then member id for
 * determinism. Members still level after that are genuinely level at this point in the
 * event, and the board says so rather than inventing a separation. Nothing is lost, because
 * an interim tie has no consequence — only the final draft order needs a strict total
 * order, and that screen reads the authoritative `result.standings`, damage tiebreak and
 * all.
 */
export function scoreboardRows(result: EventResult, config: ScoreboardConfig): ScoreRow[] {
  const from = config.mode === 'cumulative' ? 0 : config.battleIndex;
  const rows: ScoreRow[] = result.tallies.map((tally, index) => {
    const member = ROSTER[index]!;
    const cells = cellsFor(tally, from, config.battleIndex);
    return {
      memberId: tally.memberId,
      name: member.name,
      initials: member.initials,
      colour: member.colour,
      cells,
      total: cells.reduce((sum, cell) => sum + cell.total, 0),
      eliminations: cells.reduce((sum, cell) => sum + cell.eliminations, 0),
      rank: 0,
      tieNote: null,
    };
  });

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.eliminations !== a.eliminations) return b.eliminations - a.eliminations;
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const previous = rows[i - 1];

    row.rank =
      previous && previous.total === row.total && previous.eliminations === row.eliminations
        ? previous.rank
        : i + 1;

    // "Why did this tie break?" — answered only where a tie actually exists, by looking at
    // both neighbours: a row can be level with the one above, the one below, or both.
    const levelWith = [previous, rows[i + 1]].filter((other) => other !== undefined && other.total === row.total);
    if (levelWith.length === 0) continue;
    if (levelWith.some((other) => other!.eliminations !== row.eliminations)) {
      const better = levelWith.every((other) => row.eliminations >= other!.eliminations);
      row.tieNote = better ? 'level on points — more kills' : 'level on points — fewer kills';
    } else {
      row.tieNote = 'level on points and kills';
    }
  }

  return rows;
}

/** "3 kills — 9 pts", or "no kills" when there is nothing to add. Reads better than a bare
 *  number, which is the point the plan makes about showing eliminations and not just the
 *  points they bought. */
export function killSummary(eliminations: number, killPoints: number): string {
  if (eliminations === 0) return 'no kills';
  return `${eliminations} ${eliminations === 1 ? 'kill' : 'kills'} — ${killPoints} pts`;
}

/** The heading, subheading, and the wording on the button out of this beat. */
export function scoreboardCopy(
  beat: BeatId,
  config: ScoreboardConfig,
): { title: string; subtitle: string; button: string } {
  const arena = ARENA_VARIANT_NAMES[config.battleIndex]!;
  if (config.mode === 'battle') {
    return {
      title: `Battle ${config.battleIndex + 1} result`,
      subtitle: `${arena} — this battle alone, best score in it first`,
      button: 'See the standings',
    };
  }
  if (config.battleIndex === 0) {
    return {
      title: 'Standings after battle 1',
      subtitle: `${arena} — one battle played, so this round is the standing`,
      button: 'On to battle 2',
    };
  }
  return {
    title: `Standings after ${config.battleIndex + 1} battles`,
    subtitle: 'Every battle so far, added up',
    button: `On to battle ${config.battleIndex + 2}`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The member cell: colour swatch with initials, then the full name. Same visual
 *  vocabulary the Forge panel and the arena use to say "this one is you". */
function memberCell(row: ScoreRow, isYou: boolean): string {
  const chip = isYou ? '<span class="score-you">YOU</span>' : '';
  return `
    <td class="score-member">
      <span class="score-swatch" style="background:${escapeHtml(row.colour)};color:${readableInkFor(row.colour)}"
        aria-hidden="true">${escapeHtml(row.initials)}</span>
      <span class="score-name">${escapeHtml(row.name)}</span>
      ${chip}
    </td>
  `;
}

function rankCell(row: ScoreRow): string {
  // A shared rank is shown as "T2", because two rows both reading a plain "2" looks like
  // a rendering bug rather than a genuine tie.
  const shared = row.tieNote === 'level on points and kills';
  return `<td class="score-rank">${shared ? 'T' : ''}${row.rank}</td>`;
}

function tieNoteCell(row: ScoreRow): string {
  return row.tieNote === null ? '' : `<div class="score-tie">${escapeHtml(row.tieNote)}</div>`;
}

function renderBattleTable(rows: readonly ScoreRow[], claimedMemberId: string | null): string {
  const body = rows
    .map((row) => {
      const cell = row.cells[0]!;
      const isYou = row.memberId === claimedMemberId;
      return `
        <tr class="score-row${isYou ? ' is-you' : ''}">
          ${rankCell(row)}
          ${memberCell(row, isYou)}
          <td class="score-finish">${ordinal(cell.place)}<span class="score-sub">${cell.placementPoints} pts</span></td>
          <td class="score-kills">${escapeHtml(killSummary(cell.eliminations, cell.killPoints))}</td>
          <td class="score-total">${cell.total}${tieNoteCell(row)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <table class="score-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Member</th>
          <th scope="col">Finish</th>
          <th scope="col">Kills</th>
          <th scope="col">Points</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderCumulativeTable(rows: readonly ScoreRow[], claimedMemberId: string | null): string {
  const battleCount = rows[0]?.cells.length ?? 0;
  const headers = Array.from(
    { length: battleCount },
    (_, i) => `<th scope="col">${escapeHtml(ARENA_VARIANT_NAMES[i]!)}<span class="score-sub">Battle ${i + 1}</span></th>`,
  ).join('');

  const body = rows
    .map((row) => {
      const isYou = row.memberId === claimedMemberId;
      const cells = row.cells
        .map(
          (cell) => `
            <td class="score-cell">
              <span class="score-cell__total">${cell.total}</span>
              <span class="score-sub">${ordinal(cell.place)} · ${escapeHtml(
                killSummary(cell.eliminations, cell.killPoints),
              )}</span>
            </td>
          `,
        )
        .join('');
      return `
        <tr class="score-row${isYou ? ' is-you' : ''}">
          ${rankCell(row)}
          ${memberCell(row, isYou)}
          ${cells}
          <td class="score-total">${row.total}${tieNoteCell(row)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <table class="score-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Member</th>
          ${headers}
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

export function scoreboardScreen(beat: BeatId): Screen {
  const config = scoreboardConfigFor(beat);
  if (config === null) throw new Error(`scoreboardScreen: "${beat}" is not a scoreboard beat.`);

  return {
    render(ctx: ScreenContext) {
      const result = getEventResult(ctx.seed, toEventMembers());
      const rows = scoreboardRows(result, config);
      const copy = scoreboardCopy(beat, config);

      const root = document.createElement('section');
      root.className = `screen screen-scoreboard screen-scoreboard--${config.mode}`;
      root.innerHTML = `
        <header class="score-header">
          <h1>${escapeHtml(copy.title)}</h1>
          <p class="score-subtitle">${escapeHtml(copy.subtitle)}</p>
        </header>
        <div class="score-table-wrap">
          ${config.mode === 'battle'
            ? renderBattleTable(rows, ctx.state.claimedMemberId)
            : renderCumulativeTable(rows, ctx.state.claimedMemberId)}
        </div>
        <footer class="score-footer">
          <button type="button" class="btn btn-primary btn-large" data-role="continue">
            ${escapeHtml(copy.button)}
          </button>
        </footer>
      `;

      root.querySelector<HTMLButtonElement>('[data-role="continue"]')!.addEventListener('click', () => {
        ctx.navigate(nextBeat(beat)!);
      });

      ctx.container.appendChild(root);
    },
  };
}
