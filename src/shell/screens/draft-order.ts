import { toEventMembers } from '../../config/roster';
import { nextBeat } from '../beats';
import { ordinal } from '../ordinal';
import { resetWatch } from '../progress';
import { draftOrderRows, renderCumulativeTable, type ScoreRow } from './scoreboard';
import { getEventResult } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beats 18 and 19 — THE DRAFT ORDER, and the completion screen that follows it. See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2 (rows 18, 19).
 *
 * This is the payoff the whole site exists to deliver, so the order is not simply printed:
 * it fills in from tenth pick upward, one row at a time, ending on who drafts first. The
 * table is the same sectioned board the standings use (`renderCumulativeTable`), with all
 * three arenas broken out — familiar by now, which is the point. Nobody should be learning
 * a new layout at the moment they find out where they pick.
 *
 * Timing here is wall-clock (`setTimeout`), unlike anything in `src/sim/`. That is safe
 * precisely because it is presentation only: every number on this screen was decided by
 * `runEvent` long before the first row appears, so how fast they are uncovered cannot
 * change what they say.
 */

/**
 * Gap between one pick being uncovered and the next — every pick, including first.
 *
 * Slow on purpose: the spec asks for "counted up from tenth to first, slow", and a reveal
 * that outruns the room reading it is just a table with extra steps.
 *
 * There is deliberately no longer pause before first pick. One was tried, and it was
 * suspense about nothing: with ten members, uncovering nine of them has already named the
 * tenth by elimination, so holding on the last row asks the room to wait for something it
 * worked out a row ago.
 */
export const REVEAL_INTERVAL_MS = 1500;

/** How long after the last row before the way onward appears, so the board is read rather
 *  than clicked past. */
export const SETTLE_MS = 1600;

/**
 * The order rows are uncovered in, as indices into a standings-ordered list (0 is first
 * pick). Tenth upward, so the table fills from the bottom and the top row is last.
 *
 * Pure and exported so the sequence is testable without running a single timer.
 */
export function revealSequence(rowCount: number): number[] {
  const order: number[] = [];
  for (let i = rowCount - 1; i >= 0; i--) order.push(i);
  return order;
}

/** "1st pick — Pat Driscoll". The running caption over the board, so the reveal has a
 *  voice rather than only rows quietly appearing. */
export function pickCaption(row: ScoreRow): string {
  return `${ordinal(row.rank)} pick — ${row.name}`;
}

function tableMarkup(rows: readonly ScoreRow[], claimedMemberId: string | null, hidden: boolean): string {
  return `<div class="score-table-wrap">${renderCumulativeTable(rows, claimedMemberId, hidden)}</div>`;
}

export const draftOrderScreen: Screen = {
  render(ctx: ScreenContext) {
    const result = getEventResult(ctx.seed, toEventMembers());
    const rows = draftOrderRows(result);

    const root = document.createElement('section');
    root.className = 'screen screen-scoreboard screen-draft-order';
    root.innerHTML = `
      <header class="score-header">
        <h1 class="draft-title">The draft order</h1>
        <p class="draft-caption" data-role="caption" aria-live="polite">Tenth pick first.</p>
      </header>
      ${tableMarkup(rows, ctx.state.claimedMemberId, true)}
      <footer class="score-footer">
        <button type="button" class="btn btn-primary btn-large" data-role="reveal">Reveal the draft order</button>
        <button type="button" class="btn btn-primary btn-large is-hidden" data-role="continue">Finish</button>
      </footer>
    `;

    const caption = root.querySelector<HTMLElement>('[data-role="caption"]')!;
    const revealButton = root.querySelector<HTMLButtonElement>('[data-role="reveal"]')!;
    const continueButton = root.querySelector<HTMLButtonElement>('[data-role="continue"]')!;
    const rowEls = [...root.querySelectorAll<HTMLElement>('.score-row')];

    // One live timer at a time, chained — so teardown has exactly one thing to cancel and
    // a screen left mid-reveal can never fire into a torn-down DOM.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const uncover = (index: number): void => {
      const el = rowEls[index];
      if (!el) return;
      el.classList.remove('is-hidden');
      el.classList.add('is-landing');
      if (index === 0) el.classList.add('is-first-pick');
      caption.textContent = pickCaption(rows[index]!);
    };

    const run = (sequence: readonly number[], at: number): void => {
      if (stopped) return;
      if (at >= sequence.length) {
        timer = setTimeout(() => {
          if (stopped) return;
          caption.textContent = `${rows[0]!.name} drafts first.`;
          continueButton.classList.remove('is-hidden');
          continueButton.focus();
        }, SETTLE_MS);
        return;
      }
      const index = sequence[at]!;
      timer = setTimeout(() => {
        if (stopped) return;
        uncover(index);
        run(sequence, at + 1);
      }, REVEAL_INTERVAL_MS);
    };

    revealButton.addEventListener('click', () => {
      revealButton.classList.add('is-hidden');
      run(revealSequence(rows.length), 0);
    });

    continueButton.addEventListener('click', () => {
      ctx.navigate(nextBeat('draft-order')!);
    });

    ctx.container.appendChild(root);

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  },
};

/**
 * Beat 19 — the final board, persisting. Reaching it is what sets `hasCompletedOnce`
 * (`recordBeatReached` fires on `LAST_BEAT`), which is what unlocks free navigation for
 * good.
 *
 * "Watch again as someone else" clears only the current watch: `resetWatch` deliberately
 * leaves the completion unlock alone, so picking a different name never re-locks anything.
 * See `progress.ts`.
 */
export const completeScreen: Screen = {
  render(ctx: ScreenContext) {
    const result = getEventResult(ctx.seed, toEventMembers());
    const rows = draftOrderRows(result);
    const you = rows.find((row) => row.memberId === ctx.state.claimedMemberId);

    const root = document.createElement('section');
    root.className = 'screen screen-scoreboard screen-complete';
    root.innerHTML = `
      <header class="score-header">
        <h1 class="draft-title">${you ? `You pick ${ordinal(you.rank)}` : 'The draft order'}</h1>
        <p class="score-subtitle">${
          you
            ? `${rows[0]!.name} drafts first. That is the order.`
            : 'Three battles, one running total. That is the order.'
        }</p>
      </header>
      ${tableMarkup(rows, ctx.state.claimedMemberId, false)}
      <footer class="score-footer">
        <button type="button" class="btn btn-large" data-role="again">Watch again as someone else</button>
      </footer>
    `;

    root.querySelector<HTMLButtonElement>('[data-role="again"]')!.addEventListener('click', () => {
      resetWatch(ctx.seed, ctx.storage);
      ctx.navigate('name-select');
    });

    ctx.container.appendChild(root);
  },
};
