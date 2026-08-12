import { FIRST_BEAT, previousBeat, type BeatId } from './beats';
import { canNavigateToBeat, loadProgress, recordBeatReached, type ProgressStorage } from './progress';
import { SCREENS } from './screens';
import type { ScreenContext } from './screens/types';

/**
 * The screen-per-beat router: shows the screen for whatever beat a member is on, and
 * moves between beats when a screen calls `navigate`.
 *
 * "Resume where you left off" (§3 of the design spec) is not a separate code path —
 * mounting always starts at `loadProgress(seed).furthestBeat`, which is `landing` for a
 * first-time viewer and wherever they stopped for a returning one. The router doesn't
 * know the difference; `progress.ts` already resolved it.
 */

export interface RouterHandle {
  /** The beat currently on screen. */
  readonly currentBeat: BeatId;
  /** Attempts to move to `beat`. A no-op if `beat` isn't reachable yet
   *  (`canNavigateToBeat`) — the same anti-spoiler rule every other navigation path in
   *  the app is bound by. */
  navigate(beat: BeatId): void;
  /** Tears down whatever screen is currently mounted. Call when replacing the router
   *  entirely (a test moving on to its next case; the page unloading). */
  destroy(): void;
}

export interface MountRouterOptions {
  container: HTMLElement;
  /** The event's master seed — namespaces all progress storage (`progress.ts`) so a
   *  re-recorded event never resumes a viewer into a beat sequence that no longer
   *  matches what was recorded. */
  seed: number;
  /** Defaults to real `localStorage` (via `progress.ts`'s own default) when omitted.
   *  Tests inject an in-memory fake. */
  storage?: ProgressStorage | null;
}

export function mountRouter(options: MountRouterOptions): RouterHandle {
  const { container, seed, storage } = options;

  let currentBeat: BeatId = FIRST_BEAT;
  let teardown: (() => void) | null = null;

  /**
   * Runs the current screen's teardown, and never lets it stop the walkthrough.
   *
   * This is not defensive programming for its own sake — it is the fix for a real bug. A
   * PixiJS renderer threw `_cancelResize is not a function` while being destroyed, the
   * exception propagated out of `teardown()` before `container.innerHTML = ''` could run,
   * and the viewer was stranded on the previous screen permanently. Progress kept
   * recording the beat they had reached, so the stored state and the screen disagreed and
   * the site looked simply broken.
   *
   * Cleanup failing is a leak. Cleanup failing and blocking navigation is a dead site on
   * draft night, which is the one thing this cannot do. So a thrown teardown is logged and
   * swallowed, and the next screen renders regardless.
   */
  function runTeardown(): void {
    try {
      teardown?.();
    } catch (error) {
      console.error('router: a screen teardown threw. Continuing to the next beat.', error);
    }
  }

  function renderBeat(beat: BeatId): void {
    runTeardown();
    teardown = null;

    container.innerHTML = '';
    container.dataset.beat = beat;

    const state = loadProgress(seed, storage);
    const ctx: ScreenContext = {
      container,
      seed,
      state,
      storage,
      navigate: go,
    };

    teardown = SCREENS[beat].render(ctx) ?? null;
    renderBackButton(beat);
  }

  /**
   * The one back affordance for the whole walkthrough, owned by the router rather than
   * repeated across nineteen screens — the same reason `navigate` lives here.
   *
   * Appended AFTER the screen has rendered, because `renderBeat` clears `container`
   * first; anything added before would be wiped. It is positioned `fixed` (see
   * `.beat-back` in `shell.css`) so it never joins the screen's own flex or grid layout —
   * a screen that centres its content cannot be nudged off-centre by this button
   * existing.
   *
   * No button on `landing`: there is nothing before it. Everywhere else, the target is
   * always a beat already seen, so `canNavigateToBeat` permits it unconditionally and
   * `recordBeatReached` leaves `furthestBeat` alone — going back never costs progress.
   * That was designed into `progress.ts` from the start; this only exposes it.
   */
  function renderBackButton(beat: BeatId): void {
    const target = previousBeat(beat);
    if (target === null) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn beat-back';
    // Targetable by tests and by any screen that needs to reason about it, without
    // matching on visible text (which is a wording decision, not a contract).
    button.dataset.nav = 'back';
    button.textContent = '← Back';
    button.setAttribute('aria-label', `Go back to the previous step (${target})`);
    button.addEventListener('click', () => {
      go(target);
    });
    container.appendChild(button);
  }

  function go(beat: BeatId): void {
    const state = loadProgress(seed, storage);
    if (!canNavigateToBeat(state, beat)) return;

    recordBeatReached(seed, beat, storage);
    currentBeat = beat;
    renderBeat(beat);
  }

  const initialBeat = loadProgress(seed, storage).furthestBeat;
  // Idempotent when `initialBeat` was already the furthest beat reached (the common
  // case on a fresh mount) — this only actually advances anything the first time a beat
  // is shown, which for a brand-new viewer is `landing` itself.
  recordBeatReached(seed, initialBeat, storage);
  currentBeat = initialBeat;
  renderBeat(initialBeat);

  return {
    get currentBeat() {
      return currentBeat;
    },
    navigate: go,
    destroy: () => {
      runTeardown();
      teardown = null;
    },
  };
}
