import { KILL_POINTS, pointsForPlace, type BattleTally, type Tiebreak } from '../../sim/event/scoring';
import type { EventResult } from '../../sim/event/event';
import { ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { ROSTER, toEventMembers } from '../../config/roster';
import { nextBeat, type BeatId } from '../beats';
import { ordinal } from '../ordinal';
import { readableInkFor, isDarkColour } from '../colour';
import { movementLabel, rankMovement, type RankMove } from '../rank-movement';
import { canAnimateScreens } from '../transitions';
import { getEventResult } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beats 12, 14, 15 and 17 — the scoreboards between the battles. See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2 (rows 12, 14, 15, 17).
 *
 * Two shapes:
 *
 * - **Battle** (`standings-1`, `battle-2-result`, `battle-3-result`) — the battle that just
 *   happened, ordered by who scored most in it. Placement, then the two point sources side
 *   by side, then the total.
 * - **Cumulative** (`standings-2`) — every battle so far, each arena getting its own
 *   two-column section (placement points, kill points), ordered by the running total.
 *
 * The order flips between the two, and the spec is explicit that this is deliberate:
 * someone can win battle 3 outright and still land sixth overall, and "that gap is the
 * drama".
 *
 * Battle 1 uses the *battle* shape even though its beat is named `standings-1`, because
 * with one battle played the two are numerically identical — a cumulative board there
 * would be the same numbers under more columns. The cumulative shape earns its keep from
 * battle 2 onward, and again on the draft order (beat 18, its own screen).
 */

/** Which board a beat draws, and from what. On a cumulative board `battleIndex` is
 *  inclusive: `standings-2` covers battles 0 and 1. */
export interface ScoreboardConfig {
  mode: 'cumulative' | 'battle';
  battleIndex: number;
}

const SCOREBOARD_BEATS: Partial<Record<BeatId, ScoreboardConfig>> = {
  'standings-1': { mode: 'battle', battleIndex: 0 },
  'battle-2-result': { mode: 'battle', battleIndex: 1 },
  'standings-2': { mode: 'cumulative', battleIndex: 1 },
  'battle-3-result': { mode: 'battle', battleIndex: 2 },
};

/** This beat's board, or `null` for any beat that isn't one of the four — the same
 *  "is this one of mine, and which" shape `battleIndexForBeat` gives the battles. */
export function scoreboardConfigFor(id: BeatId): ScoreboardConfig | null {
  return SCOREBOARD_BEATS[id] ?? null;
}

/** One battle's contribution to a member. Mirrors `scoring.ts`'s `BattleStanding` but
 *  carries the finishing place too, which the board shows and that type does not hold. */
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
  /** The battles this board shows, in event order — every battle so far on a cumulative
   *  board, exactly one on a battle board. */
  cells: ScoreCell[];
  /** Sum of `cells[*].total`: the number this board is ordered by. */
  total: number;
  /** Eliminations across `cells`. The first tiebreak, and shown in its own right. */
  eliminations: number;
  /**
   * This row's position on the board, always 1..10 with no gaps and no shared numbers.
   *
   * Deliberately a position rather than a competition rank (1, 2, 2, 4). Two members level
   * on points and kills are still listed one above the other, so giving them the same
   * number leaves the column reading 1st, 2nd, 2nd, 4th — which looks like a rendering
   * fault at a glance, and makes the board harder to scan for the one thing everybody is
   * scanning it for. The tie is not hidden: `tieNote` says they are level, on the total
   * that is actually level.
   */
  rank: number;
  /** Why this row sits where it does when it is level on points with a neighbour, or
   *  `null` when its total is its own. */
  tieNote: string | null;
}

/** One member's cells for battles `from..to` inclusive. */
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

    row.rank = i + 1;

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

/** How the official scoring settled a tie, in the site's own words. `memberId` is the
 *  last-resort alphabetical fallback — vanishingly rare, but it must not be described as
 *  something it isn't. */
const TIEBREAK_WORDING: Record<Tiebreak, string> = {
  eliminations: 'level on points — settled by kills',
  damage: 'level on points and kills — settled by damage',
  memberId: 'level on every count — settled alphabetically',
};

/**
 * The final draft order, read from `result.standings` — the authoritative ranking, unlike
 * every interim board on this screen.
 *
 * This is the one place the damage tiebreak applies and should: by now all three battles
 * have been watched, so nothing is being decided by information the viewer has not seen.
 * `scoreboardRows`'s doc comment explains why the interim boards deliberately stop short
 * of it.
 *
 * Cells come from `result.tallies`, because `Standing.battles` carries each battle's
 * points but not the finishing place that earned them, and the board shows both.
 */
export function draftOrderRows(result: EventResult): ScoreRow[] {
  return result.standings.map((standing) => {
    const index = result.members.findIndex((member) => member.id === standing.memberId);
    const member = ROSTER[index]!;
    const tally = result.tallies[index]!;
    return {
      memberId: standing.memberId,
      name: member.name,
      initials: member.initials,
      colour: member.colour,
      cells: cellsFor(tally, 0, standing.battles.length - 1),
      total: standing.points,
      eliminations: standing.eliminations,
      rank: standing.draftPosition,
      tieNote: standing.tiebreak === null ? null : TIEBREAK_WORDING[standing.tiebreak],
    };
  });
}

/** "25 pts", "1 pt". The unit is repeated on every points cell rather than pushed up into
 *  the column header, because these boards are read at a glance across a room. The
 *  singular is not hypothetical: last place is worth exactly 1 point, so every board with
 *  a tenth place in it shows one. */
export function pointsLabel(points: number): string {
  return `${points} ${points === 1 ? 'pt' : 'pts'}`;
}

/** "3 kills", "1 kill", "no kills" — the quiet line under a kill-points figure, naming
 *  the eliminations that bought it rather than leaving a bare number to be divided by 3. */
export function killCountLabel(eliminations: number): string {
  if (eliminations === 0) return 'no kills';
  return `${eliminations} ${eliminations === 1 ? 'kill' : 'kills'}`;
}

/** The heading, optional subheading, and the wording on the button out of this beat. An
 *  empty `subtitle` renders nothing at all. */
export function scoreboardCopy(
  beat: BeatId,
  config: ScoreboardConfig,
): { title: string; subtitle: string; button: string } {
  const arena = ARENA_VARIANT_NAMES[config.battleIndex]!;
  if (config.mode === 'cumulative') {
    return {
      title: `Standings after ${config.battleIndex + 1} battles`,
      subtitle: '',
      button: `On to battle ${config.battleIndex + 2}`,
    };
  }
  if (config.battleIndex === 0) {
    return {
      title: 'Battle 1 result',
      subtitle: `${arena} — one battle played, so this is the standing too`,
      button: 'On to battle 2',
    };
  }
  return {
    title: `Battle ${config.battleIndex + 1} result`,
    subtitle: `${arena} — this battle alone, best score in it first`,
    button: 'See the standings',
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * The member cell: colour swatch with initials, then the full name.
 *
 * The flex lives on an inner span, NOT on the `<td>`. A table cell with `display: flex`
 * stops being a table cell: it no longer stretches to the row's height, so its background
 * painted only its own box and the page showed through underneath — which on the
 * highlighted row read as a stray dark block sitting over the highlight.
 */
function memberCell(row: ScoreRow, isYou: boolean): string {
  const ring = isDarkColour(row.colour) ? 'score-swatch--dark' : '';
  return `
    <td class="score-member">
      <span class="score-member__inner">
        <span class="score-swatch ${ring}"
          style="background:${escapeHtml(row.colour)};color:${readableInkFor(row.colour)}"
          aria-hidden="true">${escapeHtml(row.initials)}</span>
        <span class="score-name">${escapeHtml(row.name)}</span>
        ${isYou ? '<span class="score-you">YOU</span>' : ''}
      </span>
    </td>
  `;
}

/** A points figure in the board's large numeral, with an optional quiet line beneath. */
function pointsCell(points: number, sub: string, extraClass = ''): string {
  return `
    <td class="score-points ${extraClass}">
      <span class="score-points__value">${pointsLabel(points)}</span>
      ${sub === '' ? '' : `<span class="score-sub">${escapeHtml(sub)}</span>`}
    </td>
  `;
}

/**
 * The leftmost column, identical on both board shapes: where this member sits on THIS
 * board, 1st through 10th, always in order and never repeated.
 *
 * It reads off `total`, never off a finishing place — so on a battle board it stays in
 * order even when kills reshuffle the scoring and the actual finishes run out of order.
 * Those finishes are still shown, as the quiet line under the placement points, which is
 * how the cumulative board has always read them.
 */
/**
 * The movement badge: a drawn triangle and a number, or a bar for a member who held station.
 *
 * Drawn rather than typed. An arrow glyph inherits whatever the system font has decided an
 * arrow looks like, at whatever weight, and next to tabular numerals in a table that is
 * otherwise precise it reads as a character that wandered in. Three shapes in one 8x6 viewBox
 * share a silhouette and a weight, so the column reads as one thing with three states.
 *
 * The number is the distance, not the destination — "up 4" answers what a viewer is asking at
 * that moment, where "to 2nd" is already in the rank beside it.
 */
function movementBadge(move: RankMove | undefined): string {
  if (move === undefined) return '';
  const dir = move.delta > 0 ? 'up' : move.delta < 0 ? 'down' : 'hold';
  const shape =
    move.delta === 0
      ? '<rect x="0" y="2.5" width="8" height="1" rx="0.5" />'
      : '<path d="M4 0 8 6 0 6Z" />';
  const distance = move.delta === 0 ? '' : String(Math.abs(move.delta));
  return `
    <span class="score-move score-move--${dir}">
      <svg class="score-move__mark" viewBox="0 0 8 6" aria-hidden="true">${shape}</svg>
      <span class="score-move__distance" aria-hidden="true">${distance}</span>
      <span class="sr-only">${escapeHtml(movementLabel(move))}</span>
    </span>
  `;
}

/**
 * The ordinal sits in its own element rather than as a bare text node in the cell.
 *
 * The movement badge shares this cell, so "what does the rank column say" stops being
 * answerable from the cell's text once a badge is in it — the cell reads "1st 5 up 5 places
 * to 1", which is right for a screen reader and useless for anything asking about ranks.
 * A named element keeps that question answerable.
 */
function rankCell(row: ScoreRow, move?: RankMove): string {
  return `<td class="score-rank"><span class="score-rank__value">${ordinal(row.rank)}</span>${movementBadge(move)}</td>`;
}

function totalCell(row: ScoreRow): string {
  return `
    <td class="score-points score-total">
      <span class="score-points__value">${pointsLabel(row.total)}</span>
      ${row.tieNote === null ? '' : `<span class="score-tie">${escapeHtml(row.tieNote)}</span>`}
    </td>
  `;
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
          ${pointsCell(cell.placementPoints, ordinal(cell.place))}
          ${pointsCell(cell.killPoints, killCountLabel(cell.eliminations))}
          ${totalCell(row)}
        </tr>
      `;
    })
    .join('');

  return `
    <table class="score-table">
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Member</th>
          <th scope="col">Placement points</th>
          <th scope="col">Kill points</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

/**
 * The sectioned board: one two-column group per arena, ordered by running total.
 *
 * Exported because the draft order reveal (`draft-order.ts`) is the same table with all
 * three arenas and its rows revealed one at a time — `hideRows` starts every row hidden
 * (but still occupying its space, so nothing shifts as they appear) and tags each with the
 * index that screen reveals it by.
 */
export function renderCumulativeTable(
  rows: readonly ScoreRow[],
  claimedMemberId: string | null,
  hideRows = false,
  moves: ReadonlyMap<string, RankMove> = new Map(),
): string {
  const battleCount = rows[0]?.cells.length ?? 0;

  // Two header rows: each arena names a section spanning its own two columns, so it is
  // obvious which pair of numbers belongs to which battle. Placement, Member and Total sit
  // outside the sections and span both rows.
  const groupHeaders = Array.from(
    { length: battleCount },
    (_, i) => `<th scope="colgroup" colspan="2" class="score-group">${escapeHtml(ARENA_VARIANT_NAMES[i]!)}</th>`,
  ).join('');
  const subHeaders = Array.from(
    { length: battleCount },
    () => '<th scope="col" class="score-group-start">Placement</th><th scope="col">Kills</th>',
  ).join('');

  const body = rows
    .map((row, index) => {
      const isYou = row.memberId === claimedMemberId;
      const cells = row.cells
        .map(
          (cell) =>
            pointsCell(cell.placementPoints, ordinal(cell.place), 'score-group-start') +
            pointsCell(cell.killPoints, killCountLabel(cell.eliminations)),
        )
        .join('');
      return `
        <tr class="score-row${isYou ? ' is-you' : ''}${hideRows ? ' is-hidden' : ''}" data-row="${index}" data-member="${escapeHtml(row.memberId)}">
          ${rankCell(row, moves.get(row.memberId))}
          ${memberCell(row, isYou)}
          ${cells}
          ${totalCell(row)}
        </tr>
      `;
    })
    .join('');

  return `
    <table class="score-table score-table--cumulative">
      <thead>
        <tr>
          <th scope="col" rowspan="2">Rank</th>
          <th scope="col" rowspan="2">Member</th>
          ${groupHeaders}
          <th scope="col" rowspan="2">Total</th>
        </tr>
        <tr>${subHeaders}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

/**
 * Slides each row from the position it held on the previous board to the one it holds now.
 *
 * FLIP, and specifically the invert half of it: the table is rendered ONCE, in its correct
 * final order, then each moved row is offset backwards to where it used to be and released.
 * Rendering the old order first and re-sorting would work too and is worse — it puts a wrong
 * board on screen, and any frame where the standings are wrong is a frame somebody can read.
 *
 * Offsets come from the rows' own measured positions rather than a row-height constant,
 * because a tie note makes a row taller and a constant would drift every row below it.
 *
 * The badges are held back until the movement has almost finished (see `--settle` in the CSS).
 * Motion first, number second: the eye follows the row that is moving and then reads what it
 * did, where showing both at once makes the viewer choose.
 */
function playRankMovement(root: HTMLElement, moves: ReadonlyMap<string, RankMove>): void {
  // Reduced motion keeps the badges and drops the travel. The board still says who climbed;
  // it just stops being a thing that slides.
  if (moves.size === 0 || !canAnimateScreens()) return;

  const rows = [...root.querySelectorAll<HTMLElement>('tr.score-row[data-member]')];
  if (rows.length === 0) return;

  const tops = rows.map((row) => row.offsetTop);
  const moved: { row: HTMLElement; dy: number }[] = [];

  for (const row of rows) {
    const move = moves.get(row.dataset.member ?? '');
    if (move === undefined || move.delta === 0) continue;
    const from = tops[move.from - 1];
    const to = tops[move.to - 1];
    if (from === undefined || to === undefined) continue;
    moved.push({ row, dy: from - to });
  }

  if (moved.length === 0) return;

  for (const { row, dy } of moved) {
    row.style.transform = `translateY(${dy}px)`;
  }

  // Two frames, not one. A single rAF can still land inside the same style recalculation as
  // the writes above, and the browser then interpolates from the final value to itself --
  // which is a board that simply appears sorted, exactly the thing this replaces.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add('is-shuffling');
      for (const { row } of moved) row.style.transform = '';
    });
  });
}

export function scoreboardScreen(beat: BeatId): Screen {
  const config = scoreboardConfigFor(beat);
  if (config === null) throw new Error(`scoreboardScreen: "${beat}" is not a scoreboard beat.`);

  return {
    render(ctx: ScreenContext) {
      const result = getEventResult(ctx.seed, toEventMembers());
      const rows = scoreboardRows(result, config);
      const copy = scoreboardCopy(beat, config);

      // Movement is only meaningful on a cumulative board that HAS a previous one. After
      // battle one everybody starts level, every delta reads zero, and a column of zeroes
      // teaches a viewer to ignore the column right before the next board needs them to read
      // it. The battle-only boards show one battle's points and have no standing to move.
      const moves =
        config.mode === 'cumulative' && config.battleIndex > 0
          ? rankMovement(rows, scoreboardRows(result, { ...config, battleIndex: config.battleIndex - 1 }))
          : new Map<string, RankMove>();

      const root = document.createElement('section');
      root.className = `screen screen-scoreboard screen-scoreboard--${config.mode}`;
      root.innerHTML = `
        <header class="score-header">
          <h1>${escapeHtml(copy.title)}</h1>
          ${copy.subtitle === '' ? '' : `<p class="score-subtitle">${escapeHtml(copy.subtitle)}</p>`}
        </header>
        <div class="score-table-wrap">
          ${config.mode === 'battle'
            ? renderBattleTable(rows, ctx.state.claimedMemberId)
            : renderCumulativeTable(rows, ctx.state.claimedMemberId, false, moves)}
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

      // After append: the rows need real measured positions, which they do not have while
      // the section is still detached.
      playRankMovement(root, moves);
    },
  };
}
