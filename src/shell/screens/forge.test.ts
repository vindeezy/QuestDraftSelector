// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { advance } from '../../sim/plinko/plinko';
import { runEvent } from '../../sim/event/event';
import { CATEGORIES, partAt, slotCountFor } from '../../sim/parts/tables';
import { ROSTER, toEventMembers } from '../../config/roster';
import { FIRST_BEAT, type BeatId } from '../beats';
import {
  forgeScreen,
  boardNumberFor,
  memberBallVisuals,
  replayForgeBoard,
  slotLabelsFor,
  stepForgeRun,
} from './forge';
import type { ScreenContext } from './types';

const SEED = 918273;
const FORGE_BEATS: BeatId[] = ['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6'];
const CATEGORY_LABELS = ['Chassis Shape', 'Drive System', 'Front Weapon', 'Armour Material', 'Special Ability', 'Driver Personality'];

function makeContext(claimedMemberId: string | null = 'paden'): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage: undefined,
    navigate: vi.fn(),
  };
}

describe('boardNumberFor', () => {
  it('numbers the six categories 1 through 6, in CATEGORIES order', () => {
    expect(CATEGORIES.map(boardNumberFor)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('memberBallVisuals', () => {
  it("gives every member their numeric ball colour and initials, indexed to match the roster", () => {
    const visuals = memberBallVisuals(ROSTER);
    expect(visuals).toHaveLength(ROSTER.length);
    visuals.forEach((visual, i) => {
      const member = ROSTER[i]!;
      expect(visual.label).toBe(member.initials);
      expect(visual.colour).toBe(parseInt(member.colour.slice(1), 16));
    });
  });
});

describe('slotLabelsFor', () => {
  it('labels every slot to match partAt, for all six categories', () => {
    CATEGORIES.forEach((category) => {
      const labels = slotLabelsFor(category);
      expect(labels).toHaveLength(slotCountFor(category));
      labels.forEach((label, slot) => {
        expect(label).toBe(partAt(category, slot).label);
      });
    });
  });

  it('covers both the 6-slot and 7-slot boards', () => {
    const counts = new Set(CATEGORIES.map((category) => slotLabelsFor(category).length));
    expect(counts.has(6)).toBe(true);
    expect(counts.has(7)).toBe(true);
  });
});

describe('replayForgeBoard — the trust model', () => {
  it("every board's replayed landings equal runEvent's recorded slots for that board", () => {
    const members = toEventMembers(ROSTER);
    const event = runEvent({ masterSeed: SEED, members });

    expect(event.forge).toHaveLength(CATEGORIES.length);

    event.forge.forEach((board, boardIndex) => {
      const category = CATEGORIES[boardIndex]!;
      expect(board.category).toBe(category);

      const run = replayForgeBoard(board.seed, category, members.length);
      while (!run.done) advance(run);

      const slots = new Array<number>(members.length);
      for (const landing of run.landings) slots[landing.ballIndex] = landing.slot;

      expect(slots).toEqual(board.slots);
    });
  });

  it('agrees across two different seeds too, so this is not a one-seed coincidence', () => {
    const members = toEventMembers(ROSTER);
    for (const seed of [1, 2147483000]) {
      const event = runEvent({ masterSeed: seed, members });
      event.forge.forEach((board, boardIndex) => {
        const category = CATEGORIES[boardIndex]!;
        const run = replayForgeBoard(board.seed, category, members.length);
        while (!run.done) advance(run);
        const slots = new Array<number>(members.length);
        for (const landing of run.landings) slots[landing.ballIndex] = landing.slot;
        expect(slots).toEqual(board.slots);
      });
    }
  });
});

describe('stepForgeRun', () => {
  it('reveals balls progressively — some ticks reveal none, some reveal a partial set — and every ball ends revealed', () => {
    const run = replayForgeBoard(4242, 'chassis', 10);
    const revealed = new Array<boolean>(10).fill(false);

    let sawPartialReveal = false;
    let guard = 0;
    while (!run.done && guard < 50000) {
      stepForgeRun(run, revealed, 3);
      const revealedSoFar = revealed.filter(Boolean).length;
      if (revealedSoFar > 0 && revealedSoFar < 10) sawPartialReveal = true;
      guard++;
    }

    expect(guard).toBeLessThan(50000);
    expect(sawPartialReveal).toBe(true);
    expect(revealed.every(Boolean)).toBe(true);
  });

  it('never reveals a ball twice', () => {
    const run = replayForgeBoard(4242, 'chassis', 10);
    const revealed = new Array<boolean>(10).fill(false);
    const seenTwice = new Set<number>();
    const everRevealed = new Set<number>();

    let guard = 0;
    while (!run.done && guard < 50000) {
      for (const index of stepForgeRun(run, revealed, 3)) {
        if (everRevealed.has(index)) seenTwice.add(index);
        everRevealed.add(index);
      }
      guard++;
    }

    expect(seenTwice.size).toBe(0);
    expect(everRevealed.size).toBe(10);
  });

  it('is a no-op once every ball is already revealed', () => {
    const run = replayForgeBoard(4242, 'chassis', 10);
    const revealed = new Array<boolean>(10).fill(false);
    while (!run.done) stepForgeRun(run, revealed, 50);
    expect(stepForgeRun(run, revealed, 50)).toEqual([]);
  });
});

describe('forgeScreen', () => {
  it('renders its own category and board number, one per beat, in CATEGORIES order', () => {
    FORGE_BEATS.forEach((beat, i) => {
      const ctx = makeContext();
      const teardown = forgeScreen(beat).render(ctx);

      const text = ctx.container.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain(`Board ${i + 1} of 6`);
      expect(text).toContain(CATEGORY_LABELS[i]);
      expect(ctx.container.querySelector('.screen-forge')).not.toBeNull();
      expect(ctx.container.querySelector('.screen-stub')).toBeNull();

      teardown?.();
    });
  });

  it('throws if handed a beat that is not one of the six Forge beats', () => {
    expect(() => forgeScreen('landing')).toThrow(/not one of the six Forge beats/);
  });

  it('starts with an empty results panel — nothing is dumped at the end before any ball has settled', () => {
    const ctx = makeContext();
    const teardown = forgeScreen('forge-1').render(ctx);

    const list = ctx.container.querySelector('[data-role="results"]')!;
    expect(list.children.length).toBe(0);

    const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
    expect(dropButton.hidden).toBe(false);
    expect(dropButton.textContent).toBe("DROP 'EM");

    const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;
    expect(continueButton.hidden).toBe(true);

    teardown?.();
  });

  it("does not start until DROP 'EM is pressed — no frame is ever scheduled beforehand", async () => {
    vi.useFakeTimers();
    try {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

      const ctx = makeContext();
      const teardown = forgeScreen('forge-1').render(ctx)!;
      const list = ctx.container.querySelector('[data-role="results"]')!;

      // Nothing advances the run except a `requestAnimationFrame`-driven tick, so time
      // passing with no click is a direct proxy for "the run has not advanced": there is
      // no other code path that could have moved a ball.
      await vi.advanceTimersByTimeAsync(2000);
      expect(rafSpy).not.toHaveBeenCalled();
      expect(list.children.length).toBe(0);

      teardown();
      rafSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("after DROP 'EM is clicked, the button is gone and the run advances", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const teardown = forgeScreen('forge-1').render(ctx)!;
      const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
      const list = ctx.container.querySelector('[data-role="results"]')!;

      dropButton.click();
      expect(dropButton.hidden).toBe(true);

      let frames = 0;
      while (list.children.length === 0 && frames < 3000) {
        await vi.advanceTimersByTimeAsync(16);
        frames++;
      }

      expect(frames).toBeLessThan(3000);
      expect(list.children.length).toBeGreaterThan(0);

      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('teardown cancels the animation frame loop', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const ctx = makeContext();
    const teardown = forgeScreen('forge-1').render(ctx);
    const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;

    dropButton.click();
    expect(rafSpy).toHaveBeenCalled();
    const scheduledFrameId = rafSpy.mock.results[0]!.value as number;

    teardown?.();

    expect(cafSpy).toHaveBeenCalledWith(scheduledFrameId);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('reveals results progressively as balls settle, then shows Continue after a pause', async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const teardown = forgeScreen('forge-1').render(ctx)!;
      const list = ctx.container.querySelector('[data-role="results"]')!;
      const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
      const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      expect(list.children.length).toBe(0);
      dropButton.click();

      let sawPartialReveal = false;
      let frames = 0;
      while (continueButton.hidden && frames < 3000) {
        await vi.advanceTimersByTimeAsync(16);
        frames++;
        const count = list.children.length;
        if (count > 0 && count < ROSTER.length) sawPartialReveal = true;
      }

      expect(frames).toBeLessThan(3000);
      expect(sawPartialReveal).toBe(true);
      expect(list.children.length).toBe(ROSTER.length);
      expect(continueButton.hidden).toBe(false);

      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the claimed member's row distinctly, and no one else's", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext('paden');
      const teardown = forgeScreen('forge-1').render(ctx)!;
      const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
      const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      dropButton.click();

      let frames = 0;
      while (continueButton.hidden && frames < 3000) {
        await vi.advanceTimersByTimeAsync(16);
        frames++;
      }

      const claimedRow = ctx.container.querySelector('[data-member-id="paden"]')!;
      expect(claimedRow.classList.contains('forge-result-row--claimed')).toBe(true);

      const otherRows = ctx.container.querySelectorAll('.forge-result-row:not([data-member-id="paden"])');
      expect(otherRows.length).toBe(ROSTER.length - 1);
      otherRows.forEach((row) => expect(row.classList.contains('forge-result-row--claimed')).toBe(false));

      teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking Continue navigates to the next beat', async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const teardown = forgeScreen('forge-6').render(ctx)!;
      const dropButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="drop"]')!;
      const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      dropButton.click();

      let frames = 0;
      while (continueButton.hidden && frames < 3000) {
        await vi.advanceTimersByTimeAsync(16);
        frames++;
      }

      continueButton.click();
      expect(ctx.navigate).toHaveBeenCalledWith('build-reveal');

      teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});
