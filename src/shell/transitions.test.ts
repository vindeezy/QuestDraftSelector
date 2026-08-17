// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { BEAT_IDS, type BeatId } from './beats';
import {
  TRANSITION_MS,
  canAnimateScreens,
  moveFor,
  playTransition,
  transitionFor,
} from './transitions';

describe('the feature gate', () => {
  it('refuses to animate in jsdom, which is what keeps navigation synchronous under test', () => {
    // The load-bearing assertion of the whole design. Nineteen router and screen tests navigate
    // and then assert on the DOM in the very next statement. That only works because the exit
    // animation cannot start here, so the router falls straight through to rendering.
    //
    // If a future jsdom ships the Web Animations API this test fails FIRST, before the failure
    // arrives as a dozen unrelated tests mysteriously seeing the previous screen.
    expect(typeof (Element.prototype as { animate?: unknown }).animate).toBe('undefined');
    expect(canAnimateScreens()).toBe(false);
  });

  it('returns null rather than throwing when it cannot animate', () => {
    const el = document.createElement('div');
    expect(playTransition(el, 'landing', 'enter')).toBeNull();
    expect(playTransition(el, 'landing', 'exit')).toBeNull();
  });
});

describe('the transition table', () => {
  it('gives every one of the nineteen beats a move', () => {
    // Not "does not crash" — every beat is explicitly listed. The fallback exists for beats
    // added later, and a beat that exists today silently taking the fallback is an omission.
    for (const beat of BEAT_IDS) {
      expect(moveFor(beat), beat).toBeTruthy();
    }
  });

  it('gives the moments the site exists for its most deliberate entrance', () => {
    const arriving: BeatId[] = ['build-reveal', 'battle-1', 'battle-2', 'battle-3', 'draft-order'];
    for (const beat of arriving) expect(moveFor(beat), beat).toBe('arrive');
  });

  it('keeps the text screens quiet', () => {
    for (const beat of ['landing', 'name-select', 'what-to-expect', 'complete'] as BeatId[]) {
      expect(moveFor(beat), beat).toBe('fade');
    }
  });
});

describe('the timing', () => {
  it('leaves faster than it arrives, because only the exit is latency', () => {
    // An exit is spent between the click and anything happening; an entrance plays over content
    // that is already correct. Matching them would make every navigation feel slower for no
    // gain the viewer can see.
    expect(TRANSITION_MS.exit).toBeLessThan(TRANSITION_MS.enter);
  });

  it('keeps the exit under the threshold where a delay reads as lag', () => {
    expect(TRANSITION_MS.exit).toBeLessThanOrEqual(160);
  });

  it('is short enough overall that nineteen beats do not add up to a wait', () => {
    // Roughly eight seconds of pure transition across a full watch would be its own problem.
    expect((TRANSITION_MS.enter + TRANSITION_MS.exit) * BEAT_IDS.length).toBeLessThan(9000);
  });
});

describe('the keyframes', () => {
  it('never scales anything above 1, which would flicker a scrollbar into existence', () => {
    // A few frames of an element wider than its container is a layout that jumps mid-transition
    // — the exact ugliness the transition was added to remove.
    for (const beat of BEAT_IDS) {
      for (const phase of ['enter', 'exit'] as const) {
        for (const frame of transitionFor(beat, phase).keyframes) {
          const transform = String((frame as { transform?: unknown }).transform ?? '');
          const scale = /scale\(([\d.]+)\)/.exec(transform);
          if (scale) expect(Number(scale[1]), `${beat} ${phase} ${transform}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('starts an entrance invisible and ends it fully visible', () => {
    for (const beat of BEAT_IDS) {
      const frames = transitionFor(beat, 'enter').keyframes;
      expect(frames[0]?.opacity, beat).toBe(0);
      expect(frames[frames.length - 1]?.opacity, beat).toBe(1);
    }
  });

  it('runs an exit the other way, so a beat does not fade in as it leaves', () => {
    for (const beat of BEAT_IDS) {
      const frames = transitionFor(beat, 'exit').keyframes;
      expect(frames[0]?.opacity, beat).toBe(1);
      expect(frames[frames.length - 1]?.opacity, beat).toBe(0);
    }
  });

  it('holds an exit at its last frame and leaves an entrance behind cleanly', () => {
    // An exit whose fill is not forwards snaps the outgoing screen back to full opacity for one
    // frame before the swap. An entrance whose fill IS forwards accumulates a retained
    // animation on the container for every beat of the walkthrough.
    expect(transitionFor('battle-1', 'exit').options.fill).toBe('forwards');
    expect(transitionFor('battle-1', 'enter').options.fill).toBe('backwards');
  });
});
