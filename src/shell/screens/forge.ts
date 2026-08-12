import { DEFAULT_BOARD } from '../../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun, type PlinkoRun } from '../../sim/plinko/plinko';
import { createPlinkoRenderer, type PlinkoBallVisual, type PlinkoRenderer } from '../../render/plinko-renderer';
import { runEvent, type EventMember, type EventResult } from '../../sim/event/event';
import { CATEGORIES, slotCountFor, type CategoryName } from '../../sim/parts/tables';
import { ROSTER, type RosterMember } from '../../config/roster';
import { categoryForBeat, nextBeat, type BeatId } from '../beats';
import { canvasSupportsWebGL } from '../canvas-support';
import type { Screen, ScreenContext } from './types';

/**
 * Beats 4-9 — the Forge. Six boards, one per category in `CATEGORIES` order, each
 * replaying the official event's own seed for that board: ten balls drop at once, and a
 * panel beside the board reveals what each member landed on as their ball settles. See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2 (row 4-9) and §5.1/§5.2.
 *
 * This is a *replay*, not a re-roll — `replayForgeBoard` below builds the exact same
 * `PlinkoConfig` `runForgeBoard` (in `sim/event/event.ts`) built to produce the recorded
 * result, so stepping it to completion always reaches the same landings `runEvent`
 * already recorded. `forge.test.ts` asserts that equality directly.
 */

/** Ticks of physics advanced per animation frame. Fixed, never derived from measured
 *  frame delta — see the module doc comment on why: this is what keeps the drop
 *  identical on every machine, no matter how fast or slow its frames arrive. Purely a
 *  pacing knob, same as `what-to-expect.ts`'s `DEMO_TICKS_PER_FRAME`. */
const TICKS_PER_FRAME = 3;

/** How long the board holds on its finished state — the "beat to read the results" the
 *  spec asks for — before the Continue control appears. Presentation only; wall-clock
 *  timing here never touches the replay itself. */
const RESULTS_READ_DELAY_MS = 700;

/** Display names for each category, matching the section titles in `tables.ts`
 *  (`Category 1: Chassis Shape`, ... `Category 3: Front Weapon`, etc.) — the friendly
 *  label a viewer sees, as opposed to the plain `CategoryName` slug the simulation uses. */
const CATEGORY_LABEL: Record<CategoryName, string> = {
  chassis: 'Chassis Shape',
  drive: 'Drive System',
  weapon: 'Front Weapon',
  armour: 'Armour Material',
  ability: 'Special Ability',
  personality: 'Driver Personality',
};

/** This board's 1-based position among the six — "Board 3 of 6" — derived from
 *  `CATEGORIES` rather than parsed out of the beat id, for the same reason
 *  `categoryForBeat` exists: one place decides board order. */
export function boardNumberFor(category: CategoryName): number {
  return CATEGORIES.indexOf(category) + 1;
}

/** `#RRGGBB` -> `0xRRGGBB`. The roster stores colour as a CSS-ready string; the Plinko
 *  renderer wants the numeric form every other renderer in `src/render/` already uses. */
function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** Every member's ball colour and initials, indexed to match ball index — member `i` is
 *  always ball `i` (see `runForgeBoard`'s doc comment in `sim/event/event.ts`). */
export function memberBallVisuals(members: readonly RosterMember[]): PlinkoBallVisual[] {
  return members.map((member) => ({ colour: hexToNumber(member.colour), label: member.initials }));
}

/**
 * Re-runs `runEvent` once per distinct (seed, roster) pair and remembers the result.
 *
 * Every one of the six Forge beats needs the *whole* event (the checksum ties Forge,
 * battles and standings into one derivation) just to read off its own board — without
 * this, six beat mounts would mean six full re-simulations, batttles included, of the
 * same seed. `runEvent` is pure, so memoizing it is safe: the same inputs can never
 * produce a different result to go stale against.
 */
const eventResultCache = new Map<string, EventResult>();

function eventCacheKey(seed: number, members: readonly EventMember[]): string {
  return `${seed}:${members.map((member) => member.id).join(',')}`;
}

function getEventResult(seed: number, members: readonly EventMember[]): EventResult {
  const key = eventCacheKey(seed, members);
  const cached = eventResultCache.get(key);
  if (cached) return cached;

  const result = runEvent({ masterSeed: seed, members });
  eventResultCache.set(key, result);
  return result;
}

/**
 * Builds the same `PlinkoRun` `runForgeBoard` (private to `sim/event/event.ts`) built to
 * produce this board's recorded result: same default ball/board tuning, `slotCount`
 * swapped for the category's own part count, `seed` and `ballCount` taken from the
 * recorded board. Stepped to completion, it reaches the same landings by construction —
 * that equality is what `forge.test.ts` checks directly, seed by seed.
 */
export function replayForgeBoard(seed: number, category: CategoryName, memberCount: number): PlinkoRun {
  return createPlinkoRun({
    ...DEFAULT_PLINKO,
    board: { ...DEFAULT_BOARD, slotCount: slotCountFor(category) },
    seed,
    ballCount: memberCount,
  });
}

/**
 * Advances `run` by up to `ticks` ticks (fewer once it finishes), then reports which
 * balls have newly become "settled enough to reveal": crossed into the slot's enclosed
 * zone below `slotTopY`, the same line `advance()` itself treats as final — a ball there
 * cannot change slot again no matter how much it keeps jostling (see the comment on
 * `advance` in `sim/plinko/plinko.ts`). Once `run.done`, every remaining ball is forced
 * revealed too: `finish()` only ever fires after every ball has already crossed that
 * line, except in the pathological `maxTicks` fallback, which this guards against so a
 * result can never sit permanently unrevealed.
 *
 * Mutates `revealed` in place (ball index -> already shown) and returns the indices
 * newly added this call, in ball order.
 */
export function stepForgeRun(run: PlinkoRun, revealed: boolean[], ticks: number): number[] {
  for (let i = 0; i < ticks && !run.done; i++) advance(run);

  const newlyRevealed: number[] = [];
  const slotLine = run.config.board.slotTopY + run.config.ballRadius;

  run.balls.forEach((ball, index) => {
    if (revealed[index]) return;
    if (ball.body.y > slotLine || run.done) {
      revealed[index] = true;
      newlyRevealed.push(index);
    }
  });

  return newlyRevealed;
}

/** The no-WebGL fallback board — same visual vocabulary as `what-to-expect.ts`'s own
 *  fallback, since this is the same site reacting to the same limitation. The results
 *  panel keeps working regardless: it's driven by the physics loop, not the renderer. */
function mountBoardFallback(host: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback forge-board__fallback';
  el.innerHTML = `
    <div class="fallback-boards" aria-hidden="true">
      <span class="fallback-board"><i></i></span>
    </div>
    <p class="fallback-note">Ten balls are dropping. Results appear on the right as they land.</p>
  `;
  host.appendChild(el);
}

function partLabelFor(event: EventResult, boardIndex: number, memberIndex: number): string {
  return event.forge[boardIndex]!.partLabels[memberIndex]!;
}

export function forgeScreen(beat: BeatId): Screen {
  const category = categoryForBeat(beat);
  if (!category) {
    throw new Error(`forgeScreen: "${beat}" is not one of the six Forge beats.`);
  }
  const boardIndex = CATEGORIES.indexOf(category);
  const boardNumber = boardIndex + 1;

  return {
    render(ctx: ScreenContext) {
      const members = ROSTER;
      const event = getEventResult(
        ctx.seed,
        members.map(({ id, name, colour }) => ({ id, name, colour })),
      );
      const forgeBoard = event.forge[boardIndex]!;
      const run = replayForgeBoard(forgeBoard.seed, category, members.length);

      const claimedIndex = ctx.state.claimedMemberId
        ? members.findIndex((member) => member.id === ctx.state.claimedMemberId)
        : -1;
      const highlightIndex = claimedIndex >= 0 ? claimedIndex : null;

      const root = document.createElement('section');
      root.className = 'screen screen-forge';

      const dots = CATEGORIES.map((_, i) => {
        const state = i + 1 < boardNumber ? 'forge-stepper__dot--done' : i + 1 === boardNumber ? 'forge-stepper__dot--active' : '';
        return `<span class="forge-stepper__dot ${state}" aria-hidden="true"></span>`;
      }).join('');

      root.innerHTML = `
        <div class="forge-header">
          <div class="forge-stepper" role="presentation">${dots}</div>
          <p class="forge-progress">Board ${boardNumber} of ${CATEGORIES.length}</p>
          <h1 class="forge-category">${CATEGORY_LABEL[category]}</h1>
          <p class="forge-blurb">Ten balls drop at once. Nobody picks — wherever yours lands is what you get.</p>
        </div>
        <div class="forge-layout">
          <div class="forge-board" data-role="board"></div>
          <aside class="forge-panel">
            <h2 class="forge-panel__title">Results</h2>
            <p class="forge-panel__hint">Revealed as each ball settles.</p>
            <ul class="forge-result-list" data-role="results"></ul>
          </aside>
        </div>
        <div class="forge-footer">
          <button type="button" class="btn btn-primary btn-large" data-role="continue" hidden>Continue</button>
        </div>
      `;

      const boardHost = root.querySelector<HTMLElement>('[data-role="board"]')!;
      const resultsList = root.querySelector<HTMLUListElement>('[data-role="results"]')!;
      const continueButton = root.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      function appendResultRow(memberIndex: number): void {
        const member = members[memberIndex]!;
        const li = document.createElement('li');
        li.className = 'forge-result-row';
        if (memberIndex === claimedIndex) li.classList.add('forge-result-row--claimed');
        li.dataset.memberId = member.id;
        li.style.setProperty('--member-colour', member.colour);
        li.innerHTML = `
          <span class="forge-result-row__badge">${member.initials}</span>
          <span class="forge-result-row__name">${member.name}</span>
          <span class="forge-result-row__part">${partLabelFor(event, boardIndex, memberIndex)}</span>
        `;
        resultsList.appendChild(li);
      }

      let stopped = false;
      let unmounted = false;
      let frame = 0;
      let readTimer: ReturnType<typeof setTimeout> | null = null;
      let renderer: PlinkoRenderer | null = null;

      if (canvasSupportsWebGL()) {
        void createPlinkoRenderer(boardHost, run, highlightIndex, memberBallVisuals(members)).then((created) => {
          if (unmounted) created.destroy();
          else renderer = created;
        });
      } else {
        mountBoardFallback(boardHost);
      }

      const revealed = new Array<boolean>(members.length).fill(false);

      function scheduleContinue(): void {
        readTimer = setTimeout(() => {
          readTimer = null;
          continueButton.hidden = false;
        }, RESULTS_READ_DELAY_MS);
      }

      const tick = (): void => {
        if (stopped) return;

        for (const memberIndex of stepForgeRun(run, revealed, TICKS_PER_FRAME)) {
          appendResultRow(memberIndex);
        }
        renderer?.draw(run);

        if (run.done) {
          scheduleContinue();
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      continueButton.addEventListener('click', () => {
        ctx.navigate(nextBeat(beat)!);
      });

      ctx.container.appendChild(root);

      return () => {
        stopped = true;
        unmounted = true;
        cancelAnimationFrame(frame);
        if (readTimer !== null) clearTimeout(readTimer);
        renderer?.destroy();
      };
    },
  };
}
