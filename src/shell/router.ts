import { FIRST_BEAT, isBeforeBeat, nextBeat, previousBeat, type BeatId } from './beats';
import {
  canNavigateToBeat,
  hasSeenBeat,
  loadProgress,
  recordBeatReached,
  type ProgressStorage,
} from './progress';
import { SCREENS } from './screens';
import type { ScreenContext } from './screens/types';
import { playTransition } from './transitions';

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
   * The screen transition state.
   *
   * `navigate` stops being instantaneous once an outgoing screen has to animate away, and
   * three things follow from that which are easy to get wrong.
   *
   * `currentBeat` still updates SYNCHRONOUSLY -- only the DOM swap waits. A caller that
   * navigates and immediately asks where it is gets the truthful answer, and every existing
   * test that does exactly that keeps passing.
   *
   * `pending` rather than a captured argument, because a viewer can click twice. The second
   * navigation replaces the destination and lets the animation already in flight deliver it,
   * instead of starting a second exit on a screen that is halfway gone.
   *
   * `destroyed` because an animation's completion is a callback into a router that may no
   * longer exist. Rendering a beat into a detached container is silent and would only show up
   * as a screen that never appeared.
   */
  let screenAnimation: Animation | null = null;
  let exiting = false;
  let pending: BeatId | null = null;
  let destroyed = false;

  /** Plays one transition on the container, replacing any still running. */
  function play(beat: BeatId, phase: 'enter' | 'exit'): Animation | null {
    screenAnimation?.cancel();
    screenAnimation = playTransition(container, beat, phase);
    return screenAnimation;
  }

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

    // The left cluster is built BEFORE the screen renders, because screens dock their own
    // playback controls into it and cannot append to something that does not exist yet. It is
    // added to the container afterwards, though, since `renderBeat` clears the container and
    // the screen's own render would wipe it.
    const left = buildLeftNav(beat);

    const ctx: ScreenContext = {
      container,
      seed,
      state,
      storage,
      navigate: go,
      controls: left.controls,
      replay: () => {
        renderBeat(beat);
      },
    };

    teardown = SCREENS[beat].render(ctx) ?? null;
    if (left.root) container.appendChild(left.root);
    renderBeatNav(beat, state);

    // Fire and forget: nothing waits on an entrance, because the content is already there and
    // already correct. Only the exit is on the critical path.
    play(beat, 'enter');
  }

  /**
   * Back, plus an empty slot beneath it for whatever the screen wants docked there.
   *
   * Playback controls belong next to navigation rather than inside the screen's own layout.
   * They were first put in the battle and Forge headers, where the volume slider sat on top of
   * the arena's name — the header is content, and controls floating over content is exactly
   * the kind of thing nobody notices until they see it.
   */
  function buildLeftNav(beat: BeatId): { root: HTMLDivElement | null; controls: HTMLElement } {
    const back = previousBeat(beat);
    if (back === null) {
      // The landing screen has no Back and makes no sound, so nothing is docked there. The
      // slot still exists so a screen never has to check whether it has one.
      return { root: null, controls: document.createElement('div') };
    }

    const root = document.createElement('div');
    root.className = 'beat-nav beat-nav-left';
    root.appendChild(navButton('back', '← Back', `Go back to the previous step (${back})`, back));

    const controls = document.createElement('div');
    controls.className = 'beat-nav-controls';
    controls.dataset.role = 'screen-controls';
    root.appendChild(controls);

    return { root, controls };
  }

  /** One quiet nav button. `nav` becomes `data-nav`, which is what tests and any screen
   *  reasoning about these should match on — never the visible text, which is a wording
   *  decision rather than a contract. */
  function navButton(nav: string, label: string, ariaLabel: string, target: BeatId): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn beat-nav-btn';
    button.dataset.nav = nav;
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', () => {
      go(target);
    });
    return button;
  }

  /**
   * The walkthrough's own navigation — back, forward, and resume — owned by the router
   * rather than repeated across nineteen screens, the same reason `navigate` lives here.
   *
   * Appended AFTER the screen has rendered, because `renderBeat` clears `container`
   * first; anything added before would be wiped. Both clusters are positioned `fixed`
   * (see `.beat-nav` in `shell.css`) so they never join the screen's own flex or grid
   * layout — a screen that centres its content cannot be nudged off-centre by these
   * existing.
   *
   * Back lives in `buildLeftNav` rather than here, because screens dock controls beneath it
   * and so it has to be built before they render. Forward and resume are gated on
   * `hasSeenBeat`, NOT on `canNavigateToBeat` —
   * see that function's doc comment for why the difference matters: the latter permits
   * one step past the frontier, which is precisely the skip forward navigation must
   * never allow.
   */
  function renderBeatNav(beat: BeatId, state: ReturnType<typeof loadProgress>): void {
    const forward = nextBeat(beat);
    const canGoForward = forward !== null && hasSeenBeat(state, forward);
    // Resume is only worth offering when it lands somewhere Forward wouldn't already
    // reach — i.e. the frontier is more than a single step ahead. It is also skipped
    // whenever the frontier is at or behind the current beat, which is the normal case
    // while watching new ground, and the state `resetWatch` leaves behind.
    const showResume =
      isBeforeBeat(beat, state.furthestBeat) && state.furthestBeat !== forward && hasSeenBeat(state, state.furthestBeat);

    if (!canGoForward && !showResume) return;

    const right = document.createElement('div');
    right.className = 'beat-nav beat-nav-right';
    if (canGoForward) {
      right.appendChild(
        navButton('forward', 'Forward →', `Go forward one step (${forward}), which you have already seen`, forward),
      );
    }
    if (showResume) {
      right.appendChild(
        navButton(
          'resume',
          'Resume',
          `Skip ahead to where you had got to (${state.furthestBeat})`,
          state.furthestBeat,
        ),
      );
    }
    container.appendChild(right);
  }

  /** Renders whatever destination is outstanding. */
  function flush(): void {
    const beat = pending;
    pending = null;
    if (beat !== null && !destroyed) renderBeat(beat);
  }

  function go(beat: BeatId): void {
    const state = loadProgress(seed, storage);
    if (!canNavigateToBeat(state, beat)) return;

    recordBeatReached(seed, beat, storage);
    // Captured before `currentBeat` moves: the exit belongs to the screen being LEFT, and it is
    // the outgoing beat that decides how it leaves.
    const leaving = currentBeat;
    currentBeat = beat;
    pending = beat;

    // An exit is already playing. It will deliver the new destination when it lands.
    if (exiting) return;

    const exit = play(leaving, 'exit');
    if (exit === null) {
      // No Web Animations API, or the viewer asked for less motion. Behaves exactly as it did
      // before transitions existed, which is what keeps this change backward-compatible.
      flush();
      return;
    }

    exiting = true;
    const done = (): void => {
      exiting = false;
      // Releases the forwards fill BEFORE the swap, so the container is back at full opacity
      // when the next screen lands in it rather than being left transparent.
      exit.cancel();
      flush();
    };
    // Both paths, because a cancelled animation rejects. A rejected exit must still change the
    // screen -- a viewer stuck on the previous beat is the worst outcome available here.
    exit.finished.then(done, done);
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
      destroyed = true;
      pending = null;
      screenAnimation?.cancel();
      screenAnimation = null;
      runTeardown();
      teardown = null;
    },
  };
}
