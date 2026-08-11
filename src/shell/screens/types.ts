import type { BeatId } from '../beats';
import type { ProgressState, ProgressStorage } from '../progress';

/**
 * Everything a screen needs to render one beat. Built fresh by the router on every
 * navigation, so a screen never has to worry about state going stale under it — if the
 * member goes back and the router re-renders, a new `ScreenContext` with a fresh `state`
 * arrives.
 */
export interface ScreenContext {
  /** Already cleared by the router — a screen appends into this, it never needs to
   *  clear it first. */
  container: HTMLElement;
  /** The event's master seed. Progress is namespaced by it (see `progress.ts`), and
   *  screens that call `claimMember`/`recordBeatReached`/`resetWatch` need it too. */
  seed: number;
  /** Progress as of the moment this beat was reached — includes `claimedMemberId` and
   *  `hasCompletedOnce`, which name-select and (eventually) skip navigation both read. */
  state: ProgressState;
  /** Passed straight to `progress.ts` calls. `undefined` in production (those functions
   *  default to real `localStorage`); tests inject an in-memory fake here. */
  storage: ProgressStorage | null | undefined;
  /** Moves the walkthrough to `beat`. The router validates reachability
   *  (`canNavigateToBeat`), records progress, tears down the current screen, and renders
   *  the next one — a screen just calls this and doesn't reimplement any of that. */
  navigate(beat: BeatId): void;
}

export interface Screen {
  /** Renders this beat's UI into `ctx.container`. Returns an optional teardown, called
   *  by the router immediately before it renders whatever beat comes next (destroying
   *  renderers, cancelling animation frames, clearing timers). */
  render(ctx: ScreenContext): (() => void) | void;
}
