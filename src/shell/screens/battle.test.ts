// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { advanceMatch } from '../../sim/arena/match';
import type { Effect } from '../../sim/arena/effects';
import { runEvent } from '../../sim/event/event';
import { ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { ROSTER, toEventMembers } from '../../config/roster';
import { FIRST_BEAT, type BeatId } from '../beats';
import {
  advanceBattleFrame,
  battleIndexForBeat,
  battleLabelFor,
  battleScreen,
  placesFromFinishedMatch,
  replayBattle,
  TICKS_PER_FRAME,
} from './battle';
import type { ScreenContext } from './types';

const SEED = 743219;
const BATTLE_BEATS: BeatId[] = ['battle-1', 'battle-2', 'battle-3'];

function makeContext(claimedMemberId: string | null = 'paden'): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage: undefined,
    navigate: vi.fn(),
    controls: document.createElement('div'),
    replay: vi.fn(),
  };
}

describe('battleIndexForBeat', () => {
  it('maps the three battle beats to 0, 1 and 2, in order', () => {
    expect(battleIndexForBeat('battle-1')).toBe(0);
    expect(battleIndexForBeat('battle-2')).toBe(1);
    expect(battleIndexForBeat('battle-3')).toBe(2);
  });

  it('is null for every beat that is not one of the three battles', () => {
    expect(battleIndexForBeat('landing')).toBeNull();
    expect(battleIndexForBeat('build-reveal')).toBeNull();
    expect(battleIndexForBeat('battle-2-result')).toBeNull();
    expect(battleIndexForBeat('draft-order')).toBeNull();
  });
});

describe('battleLabelFor', () => {
  it('names the arena and which battle this is, matching the spec\'s own wording', () => {
    expect(battleLabelFor(0)).toBe('Battle 1 of 3 — The Grinder');
    expect(battleLabelFor(1)).toBe('Battle 2 of 3 — The Gauntlet');
    expect(battleLabelFor(2)).toBe('Battle 3 of 3 — The Crossfire');
  });
});

describe('replayBattle / placesFromFinishedMatch — the trust model', () => {
  it("every battle's replayed placements equal runEvent's recorded places for that battle", () => {
    const members = toEventMembers(ROSTER);
    const event = runEvent({ masterSeed: SEED, members });

    event.battles.forEach((battle, battleIndex) => {
      expect(battle.arenaName).toBe(ARENA_VARIANT_NAMES[battleIndex]);

      const match = replayBattle(battle.seed, battleIndex, event.builds, members.length);
      while (!match.done) advanceMatch(match);

      const places = placesFromFinishedMatch(match, members.length);
      expect(places).toEqual(battle.places);
    });
  }, 30000);

  it('agrees across two different seeds too, so this is not a one-seed coincidence', () => {
    const members = toEventMembers(ROSTER);
    for (const seed of [1, 2147483000]) {
      const event = runEvent({ masterSeed: seed, members });
      event.battles.forEach((battle, battleIndex) => {
        const match = replayBattle(battle.seed, battleIndex, event.builds, members.length);
        while (!match.done) advanceMatch(match);
        expect(placesFromFinishedMatch(match, members.length)).toEqual(battle.places);
      });
    }
  }, 60000);
});

describe('advanceBattleFrame', () => {
  it('advances a fixed whole number of ticks per call — never a fraction or a frame delta', () => {
    expect(Number.isInteger(TICKS_PER_FRAME)).toBe(true);
    expect(TICKS_PER_FRAME).toBeGreaterThan(0);

    const members = toEventMembers(ROSTER);
    const event = runEvent({ masterSeed: SEED, members });
    const battle = event.battles[0]!;
    const match = replayBattle(battle.seed, 0, event.builds, members.length);

    const before = match.world.tick;
    advanceBattleFrame(match, TICKS_PER_FRAME, []);
    expect(match.world.tick - before).toBe(TICKS_PER_FRAME);
  });

  it('never advances past match.done', () => {
    const members = toEventMembers(ROSTER);
    const event = runEvent({ masterSeed: SEED, members });
    const battle = event.battles[0]!;
    const match = replayBattle(battle.seed, 0, event.builds, members.length);
    while (!match.done) advanceMatch(match);

    const tickAtFinish = match.world.tick;
    advanceBattleFrame(match, 50, []);
    expect(match.world.tick).toBe(tickAtFinish);
  });

  it(
    'drains effects after every individual advanceMatch call, not once per frame — ' +
      'a multi-tick frame must not lose the earlier ticks\' effects',
    () => {
      const members = toEventMembers(ROSTER);
      const event = runEvent({ masterSeed: SEED, members });
      const battle = event.battles[0]!;
      // Comfortably inside battle 0's own length for this seed (7635 ticks) so neither
      // drive below finishes early and the two become incomparable.
      const TOTAL_TICKS = 2800;

      const oneAtATime = replayBattle(battle.seed, 0, event.builds, members.length);
      const oneAtATimeBuffer: Effect[] = [];
      for (let advanced = 0; advanced < TOTAL_TICKS; advanced++) {
        advanceBattleFrame(oneAtATime, 1, oneAtATimeBuffer);
      }

      const chunked = replayBattle(battle.seed, 0, event.builds, members.length);
      const chunkedBuffer: Effect[] = [];
      for (let advanced = 0; advanced < TOTAL_TICKS; ) {
        const step = Math.min(7, TOTAL_TICKS - advanced);
        advanceBattleFrame(chunked, step, chunkedBuffer);
        advanced += step;
      }

      expect(oneAtATime.world.tick).toBe(chunked.world.tick);
      expect(chunkedBuffer).toEqual(oneAtATimeBuffer);
      // Not a vacuous pass — real activity happened in this window.
      expect(chunkedBuffer.length).toBeGreaterThan(0);
    },
  );
});

describe('battleScreen', () => {
  it('renders its own battle number and arena name, one per beat, and never the stub', () => {
    BATTLE_BEATS.forEach((beat, i) => {
      const ctx = makeContext();
      const teardown = battleScreen(beat).render(ctx);

      const text = ctx.container.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain(`Battle ${i + 1} of 3`);
      expect(text).toContain(ARENA_VARIANT_NAMES[i]);
      expect(ctx.container.querySelector('.screen-battle')).not.toBeNull();
      expect(ctx.container.querySelector('.screen-stub')).toBeNull();

      teardown?.();
    });
  });

  it('throws if handed a beat that is not one of the three battle beats', () => {
    expect(() => battleScreen('landing')).toThrow(/not one of the three battle beats/);
  });

  it('does not start until BEGIN is pressed — no frame is ever scheduled beforehand', async () => {
    vi.useFakeTimers();
    try {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

      const ctx = makeContext();
      const teardown = battleScreen('battle-1').render(ctx)!;
      const startButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="start"]')!;
      const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      expect(startButton.hidden).toBe(false);
      expect(startButton.textContent).toBe('BEGIN');
      expect(continueButton.hidden).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);
      expect(rafSpy).not.toHaveBeenCalled();

      teardown();
      rafSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('after BEGIN is clicked, the button is gone and the frame loop is scheduled', async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const teardown = battleScreen('battle-1').render(ctx)!;
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
      const startButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="start"]')!;

      startButton.click();
      expect(startButton.hidden).toBe(true);

      await vi.advanceTimersByTimeAsync(16);
      expect(rafSpy).toHaveBeenCalled();

      teardown();
      rafSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('teardown cancels the animation frame loop', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const ctx = makeContext();
    const teardown = battleScreen('battle-1').render(ctx);
    const startButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="start"]')!;

    startButton.click();
    expect(rafSpy).toHaveBeenCalled();
    const scheduledFrameId = rafSpy.mock.results[0]!.value as number;

    teardown?.();

    expect(cafSpy).toHaveBeenCalledWith(scheduledFrameId);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('runs the battle to completion and then shows Continue, which navigates onward', async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const teardown = battleScreen('battle-2').render(ctx)!;
      const startButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="start"]')!;
      const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      startButton.click();
      expect(continueButton.hidden).toBe(true);

      // One large jump rather than a stepwise 16ms loop: `vi.advanceTimersByTimeAsync`
      // flushes every chained `requestAnimationFrame`/`setTimeout` inside the window it's
      // given, so this reaches the end of even a several-thousand-tick battle in one call
      // rather than thousands of individually awaited frames.
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

      expect(continueButton.hidden).toBe(false);

      continueButton.click();
      expect(ctx.navigate).toHaveBeenCalledWith('battle-2-result');

      teardown();
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
});

describe('sound', () => {
  it('puts volume and mute in the header, and takes them away on teardown', () => {
    // Draft night is ten people in a room around one screen. Somebody will want it quieter,
    // and the control has to be on the screen that is making the noise.
    const ctx = makeContext();
    const teardown = battleScreen('battle-1').render(ctx)!;

    // Docked in the router's slot beneath Back, not in the screen's own header -- the
    // slider used to sit on top of the arena/category name.
    const controls = ctx.controls.querySelector('.audio-controls');
    expect(controls).not.toBeNull();
    expect(ctx.container.querySelector('.audio-controls')).toBeNull();

    teardown();
    expect(ctx.controls.querySelector('.audio-controls')).toBeNull();
  });
});
