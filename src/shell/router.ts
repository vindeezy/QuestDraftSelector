import { FIRST_BEAT, type BeatId } from './beats';
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

  function renderBeat(beat: BeatId): void {
    teardown?.();
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
      teardown?.();
      teardown = null;
    },
  };
}
