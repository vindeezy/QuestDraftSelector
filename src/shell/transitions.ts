/**
 * How one beat gives way to the next.
 *
 * Nineteen beats currently cut between each other instantly, which reads less like pacing and
 * more like a page reload. This module owns the two animations that fix that — the outgoing
 * screen's exit and the incoming screen's entrance — and nothing else.
 *
 * **Driven from JavaScript rather than CSS, on purpose.** A CSS-class-plus-`animationend`
 * approach cannot be feature-detected: jsdom happily accepts the class, never fires the event,
 * and the router waits forever, so the whole test suite hangs. The Web Animations API can be
 * detected in one expression — jsdom implements no part of it — which is what lets the router
 * stay entirely synchronous in tests while animating in a browser. See `canAnimateScreens`.
 *
 * **The exit is deliberately shorter than the entrance.** An exit delays the swap, so every
 * millisecond of it is latency the viewer feels on a click. An entrance costs nothing — the
 * content is already there.
 *
 * There is a happy accident worth knowing about. A screen transition already costs about
 * 230 ms of PixiJS teardown-and-rebuild (see `docs/STATUS.md`), which until now presented as a
 * freeze. The exit animation runs immediately before that work, so what used to look like the
 * site hanging now looks like a deliberate fade into the next beat. The total wait is slightly
 * longer and reads considerably better.
 */

import type { BeatId } from './beats';
import { prefersReducedMotion } from '../render/reduced-motion';

/**
 * Whether screen transitions can run at all.
 *
 * Two independent reasons to say no, and both matter:
 *
 * - **No Web Animations API.** jsdom has none, so every existing router test keeps its
 *   synchronous `navigate()` and needed no changes. It also covers any browser old enough to
 *   lack it, where a screen must still change.
 * - **The viewer asked for less motion.** The same setting the arena's screen shake honours.
 *   A transition is milder than shake, but the request was explicit and costs one query.
 */
export function canAnimateScreens(): boolean {
  if (typeof Element === 'undefined') return false;
  if (typeof (Element.prototype as { animate?: unknown }).animate !== 'function') return false;
  return !prefersReducedMotion();
}

/** Entrance duration. Long enough to be felt, short enough not to be sat through. */
const ENTER_MS = 280;

/**
 * Exit duration.
 *
 * Held well under the ~200 ms at which a delayed response starts registering as lag, because
 * unlike the entrance this one is spent between the click and anything happening.
 */
const EXIT_MS = 140;

/** Decelerating: fast off the mark, settling. The standard for something arriving. */
const ENTER_EASE = 'cubic-bezier(0.16, 1, 0.30, 1)';

/** Accelerating, so a departure gathers pace instead of trailing off. */
const EXIT_EASE = 'cubic-bezier(0.45, 0, 0.90, 1)';

/**
 * The three ways a beat can arrive.
 *
 * Three rather than nineteen, and rather than one. One transition for everything is a
 * screensaver; nineteen is nineteen things to maintain and to get subtly inconsistent. Three
 * is enough to say something about what kind of beat this is.
 */
type Move = 'fade' | 'rise' | 'arrive';

/**
 * Which beats get which move.
 *
 * `fade` is for the quiet, mostly-text screens where motion would be an affectation. `rise`
 * suits the Forge and the scoreboards — things that assemble, delivered from below. `arrive` is
 * for the four moments the whole site exists to deliver: the finished machine, the three
 * battles, and the draft order. It scales up into place, which is the only one of the three
 * that reads as an entrance rather than a fade.
 *
 * Anything not listed falls through to `fade`, so a beat added later is quiet rather than
 * broken — the same fallback principle as an unrecognised hazard or a missing sound.
 */
const MOVES: Partial<Record<BeatId, Move>> = {
  landing: 'fade',
  'name-select': 'fade',
  'what-to-expect': 'fade',
  'forge-1': 'rise',
  'forge-2': 'rise',
  'forge-3': 'rise',
  'forge-4': 'rise',
  'forge-5': 'rise',
  'forge-6': 'rise',
  'build-reveal': 'arrive',
  'battle-1': 'arrive',
  'battle-2': 'arrive',
  'battle-3': 'arrive',
  'standings-1': 'rise',
  'standings-2': 'rise',
  'battle-2-result': 'rise',
  'battle-3-result': 'rise',
  'draft-order': 'arrive',
  complete: 'fade',
};

/**
 * Keyframes per move.
 *
 * Nothing scales ABOVE 1 anywhere here. An element briefly larger than its container can push
 * a scrollbar into existence for a few frames, and a layout that flickers wider mid-transition
 * undoes everything the transition was added to achieve. `arrive` therefore grows into place
 * from slightly small rather than settling down from slightly large.
 */
const KEYFRAMES: Record<Move, { enter: Keyframe[]; exit: Keyframe[] }> = {
  fade: {
    enter: [{ opacity: 0 }, { opacity: 1 }],
    exit: [{ opacity: 1 }, { opacity: 0 }],
  },
  rise: {
    enter: [
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    exit: [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-6px)' },
    ],
  },
  arrive: {
    enter: [
      { opacity: 0, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    exit: [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.99)' },
    ],
  },
};

export function moveFor(beat: BeatId): Move {
  return MOVES[beat] ?? 'fade';
}

/** The keyframes and timing a beat enters or leaves with. Exported for the tests, which can
 *  assert the shape of a transition in an environment that cannot run one. */
export function transitionFor(beat: BeatId, phase: 'enter' | 'exit'): {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
} {
  const move = moveFor(beat);
  const entering = phase === 'enter';
  return {
    keyframes: KEYFRAMES[move][phase],
    options: {
      duration: entering ? ENTER_MS : EXIT_MS,
      easing: entering ? ENTER_EASE : EXIT_EASE,
      // Asymmetric, and both halves are deliberate. An exit holds its final frame, because its
      // end state has to survive until the container is replaced -- without it the outgoing
      // screen snaps back to full opacity for a frame first, which is the exact flicker the
      // transition exists to remove. An entrance fills BACKWARDS instead: it needs its first
      // frame applied the instant it is created, and it must leave nothing behind afterwards,
      // since it ends where the element already sits.
      fill: entering ? 'backwards' : 'forwards',
    },
  };
}

/**
 * Plays a beat's transition on `element`, or returns null if it cannot.
 *
 * Null is a real answer and callers must handle it: it is what the router keys off to stay
 * synchronous under test and under reduced motion.
 */
export function playTransition(
  element: Element,
  beat: BeatId,
  phase: 'enter' | 'exit',
): Animation | null {
  if (!canAnimateScreens()) return null;
  const { keyframes, options } = transitionFor(beat, phase);
  try {
    return element.animate(keyframes, options);
  } catch {
    // A browser with a partial implementation must not be able to strand a viewer between
    // beats. Failing to animate means the screen changes instantly, which is exactly what it
    // did before this file existed.
    return null;
  }
}

export const TRANSITION_MS = { enter: ENTER_MS, exit: EXIT_MS } as const;
