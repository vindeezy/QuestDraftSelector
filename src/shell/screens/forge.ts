import { DEFAULT_BOARD } from '../../sim/plinko/board';
import {
  DEFAULT_PLINKO, advance, createPlinkoRun, type PlinkoEffect, type PlinkoRun,
} from '../../sim/plinko/plinko';
import {
  createPlinkoRenderer,
  releaseMargin,
  type PlinkoBallVisual,
  type PlinkoRenderer,
} from '../../render/plinko-renderer';
import { runEvent, type EventMember, type EventResult } from '../../sim/event/event';
import { CATEGORIES, partAt, slotCountFor, type CategoryName } from '../../sim/parts/tables';
import { ROSTER, type RosterMember } from '../../config/roster';
import { categoryForBeat, nextBeat, type BeatId } from '../beats';
import { canvasSupportsWebGL } from '../canvas-support';
import { sharedAudioBus } from '../audio';
import { emptyState, playPlinkoFrame, tickToMs } from '../../audio/play';
import { mountAudioControls, mountReplayControl } from './audio-controls';
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

/**
 * Ticks of physics advanced per animation frame. Fixed, never derived from measured
 * frame delta — see the module doc comment on why: this is what keeps the drop
 * identical on every machine, no matter how fast or slow its frames arrive. Purely a
 * pacing knob, same as `what-to-expect.ts`'s `DEMO_TICKS_PER_FRAME`.
 *
 * 1 — real time, one tick per rendered frame at 60fps — is the slowest this can go
 * without advancing by less than a whole tick, which `advance()` doesn't support and
 * fractional/frame-delta stepping would break determinism to get anyway (see the specs
 * in the task brief this shipped against). Measured across several seeds and every
 * category, a full board settles in 580-710 ticks, i.e. roughly 10-12 seconds at this
 * rate — easily long enough to watch a ball actually bounce, against the ~3.5s a full
 * board took at the old `TICKS_PER_FRAME = 3`. If that ever reads as still too quick to
 * follow, the next step down is an integer *frames per tick* (2 real frames held per
 * physics tick, etc.), never a value between 0 and 1.
 */
const TICKS_PER_FRAME = 1;

/** How long the board holds on its finished state — the "beat to read the results" the
 *  spec asks for — before the Continue control appears. Presentation only; wall-clock
 *  timing here never touches the replay itself. */
const RESULTS_READ_DELAY_MS = 700;

/** Display names for each category, matching the section titles in `tables.ts`
 *  (`Category 1: Chassis Shape`, ... `Category 3: Front Weapon`, etc.) — the friendly
 *  label a viewer sees, as opposed to the plain `CategoryName` slug the simulation uses.
 *  Exported so `build-reveal.ts` uses this exact same mapping rather than a second copy. */
export const CATEGORY_LABEL: Record<CategoryName, string> = {
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

/** Exported so `build-reveal.ts` shares this same cache — both beats need the whole
 *  event for the same (seed, roster) pair, and there is no reason to pay for it twice. */
export function getEventResult(seed: number, members: readonly EventMember[]): EventResult {
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
 *
 * `effects` collects every peg strike across the ticks this call ran, because `advance`
 * clears the run's own list at the start of each tick — reading `run.effects` afterwards
 * would hear only the last tick's strikes and silently drop the rest the moment
 * `TICKS_PER_FRAME` rises above one. Same reason `advanceBattleFrame` accumulates.
 */
export function stepForgeRun(
  run: PlinkoRun,
  revealed: boolean[],
  ticks: number,
  effects?: PlinkoEffect[],
): number[] {
  for (let i = 0; i < ticks && !run.done; i++) {
    advance(run);
    if (effects) effects.push(...run.effects);
  }

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
 *  panel keeps working regardless: it's driven by the physics loop, not the renderer.
 *  Worded to hold true both before and after the drop, since this static markup is
 *  never updated when the button is pressed. */
function mountBoardFallback(host: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback forge-board__fallback';
  el.innerHTML = `
    <div class="fallback-boards" aria-hidden="true">
      <span class="fallback-board"><i></i></span>
    </div>
    <p class="fallback-note">Press DROP 'EM to send the ten balls down. Results appear on the right as they land.</p>
  `;
  host.appendChild(el);
}

/** Every slot's label, in slot order, for `category`'s board — what the board shows on
 *  each slot from the moment the screen loads, before any ball has dropped. Pure and
 *  DOM-free on purpose: `forge-renderer.test.ts` mocks the renderer entirely, so the
 *  labels it receives are only ever checked by calling this directly. */
export function slotLabelsFor(category: CategoryName): string[] {
  const count = slotCountFor(category);
  return Array.from({ length: count }, (_, slot) => partAt(category, slot).label);
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
        </div>
        <div class="forge-layout">
          <div class="forge-board" data-role="board">
            <button type="button" class="btn btn-primary btn-large forge-overlay-btn forge-drop-btn" data-role="drop">DROP 'EM</button>
            <button type="button" class="btn btn-primary btn-large forge-overlay-btn" data-role="continue" hidden>Continue</button>
          </div>
          <aside class="forge-panel">
            <h2 class="forge-panel__title">Results</h2>
            <p class="forge-panel__hint">Revealed as each ball settles.</p>
            <ul class="forge-result-list" data-role="results"></ul>
          </aside>
        </div>
      `;

      const boardHost = root.querySelector<HTMLElement>('[data-role="board"]')!;
      const resultsList = root.querySelector<HTMLUListElement>('[data-role="results"]')!;
      const dropButton = root.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
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

      // Unlocked several beats ago by BEGIN on the landing screen. Each board gets a fresh
      // mixer state: six boards in a row must not accumulate one another's voice budgets.
      const bus = sharedAudioBus();
      let voices = emptyState();
      let unmountAudioControls: (() => void) | null = null;

      // Computed from `run.balls` before anything else touches them — the run is still
      // at tick 0 here, so this reads the true release positions (see `releaseMargin`'s
      // doc comment), the ones the "at rest" pre-drop frame needs to be able to show.
      const boardExtras = { slotLabels: slotLabelsFor(category), topMargin: releaseMargin(run) };

      if (canvasSupportsWebGL()) {
        void createPlinkoRenderer(boardHost, run, highlightIndex, memberBallVisuals(members), boardExtras).then(
          (created) => {
            if (unmounted) created.destroy();
            else renderer = created;
          },
        );
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

        const pegHits: PlinkoEffect[] = [];
        for (const memberIndex of stepForgeRun(run, revealed, TICKS_PER_FRAME, pegHits)) {
          appendResultRow(memberIndex);
        }

        // Pitch follows the ball across the board, so ten balls cascading read as a run of
        // notes rather than a rattle. Clocked off the run's own tick count for the same
        // reason the battle is: the mix must not thin out on a machine that drops frames.
        voices = playPlinkoFrame({
          bus,
          effects: pegHits,
          state: voices,
          nowMs: tickToMs(run.world.tick),
          width: run.config.board.width,
        });

        renderer?.draw(run);

        if (run.done) {
          replayControl.reveal();
          scheduleContinue();
          return;
        }
        frame = requestAnimationFrame(tick);
      };

      // The drop is triggered, not automatic: the board mounts and holds at rest — no
      // ticks advanced, nothing moving — until this fires. That is the anticipation beat
      // the project owner asked for; see the module doc comment's "the reason matters"
      // note. Once pressed, the button is gone for good; there is no re-drop.
      dropButton.addEventListener('click', () => {
        dropButton.hidden = true;
        frame = requestAnimationFrame(tick);
      });

      continueButton.addEventListener('click', () => {
        ctx.navigate(nextBeat(beat)!);
      });

            // Docked under Back rather than in the board's own header, where the slider overlapped
      // the category name.
      unmountAudioControls = mountAudioControls({ bus, host: ctx.controls });
      const replayControl = mountReplayControl(ctx.controls, ctx.replay);

      ctx.container.appendChild(root);

      return () => {
        stopped = true;
        unmounted = true;
        cancelAnimationFrame(frame);
        if (readTimer !== null) clearTimeout(readTimer);
        // DOM cleanup before the renderer, deliberately. `renderer.destroy()` is the one
        // step here that has actually thrown in the wild -- see the router's `runTeardown`
        // comment -- and anything after a throw never runs. The router catches it and moves
        // on, so the cost of being second in this list is a control left behind on screen.
        unmountAudioControls?.();
        replayControl.destroy();
        renderer?.destroy();
      };
    },
  };
}
