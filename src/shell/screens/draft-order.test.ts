// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEvent } from '../../sim/event/event';
import { ROSTER, toEventMembers } from '../../config/roster';
import { BEAT_IDS, FIRST_BEAT, LAST_BEAT, type BeatId } from '../beats';
import { loadProgress, type ProgressStorage } from '../progress';
import { mountRouter } from '../router';
import { draftOrderRows } from './scoreboard';
import {
  completeScreen,
  delayBefore,
  draftOrderScreen,
  FINAL_REVEAL_PAUSE_MS,
  pickCaption,
  REVEAL_INTERVAL_MS,
  revealSequence,
  SETTLE_MS,
} from './draft-order';
import type { ScreenContext } from './types';

const SEED = 918273;
const event = runEvent({ masterSeed: SEED, members: toEventMembers(ROSTER) });

class MemoryStorage implements ProgressStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

function makeContext(claimedMemberId: string | null): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage,
    navigate: vi.fn(),
  };
}

describe('draftOrderRows', () => {
  it('matches runEvent standings exactly — order, positions, totals', () => {
    // The one assertion this whole screen exists to satisfy. What the league sees must be
    // what the recorded event decided, member for member, with nothing recomputed.
    const rows = draftOrderRows(event);
    expect(rows.map((row) => row.memberId)).toEqual(event.standings.map((s) => s.memberId));
    expect(rows.map((row) => row.rank)).toEqual(event.standings.map((s) => s.draftPosition));
    expect(rows.map((row) => row.total)).toEqual(event.standings.map((s) => s.points));
    expect(rows.map((row) => row.eliminations)).toEqual(event.standings.map((s) => s.eliminations));
  });

  it('counts a clean 1 through 10', () => {
    expect(draftOrderRows(event).map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('breaks out all three battles, with the finishing place that earned each figure', () => {
    for (const row of draftOrderRows(event)) {
      expect(row.cells.length).toBe(3);
      const index = ROSTER.findIndex((m) => m.id === row.memberId);
      expect(row.cells.map((cell) => cell.place)).toEqual([0, 1, 2].map((b) => event.battles[b]!.places[index]));
    }
  });

  it('carries the roster identity for each standing', () => {
    for (const row of draftOrderRows(event)) {
      const member = ROSTER.find((m) => m.id === row.memberId)!;
      expect(row.name).toBe(member.name);
      expect(row.colour).toBe(member.colour);
    }
  });

  it('says which rule settled a tie, when the official scoring needed one', () => {
    const rows = draftOrderRows(event);
    for (const [i, standing] of event.standings.entries()) {
      if (standing.tiebreak === null) {
        expect(rows[i]!.tieNote).toBeNull();
      } else {
        expect(rows[i]!.tieNote).toContain('level on');
      }
    }
  });
});

describe('revealSequence', () => {
  it('counts up from tenth pick to first', () => {
    expect(revealSequence(10)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('ends on first pick, never starts there', () => {
    const sequence = revealSequence(10);
    expect(sequence[sequence.length - 1]).toBe(0);
    expect(sequence[0]).not.toBe(0);
  });

  it('reveals every row exactly once', () => {
    expect([...revealSequence(10)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('delayBefore', () => {
  it('holds longer before first pick than any other', () => {
    expect(delayBefore(0)).toBe(FINAL_REVEAL_PAUSE_MS);
    expect(delayBefore(0)).toBeGreaterThan(REVEAL_INTERVAL_MS);
  });

  it('uses the standard interval for everyone else', () => {
    for (let i = 1; i < 10; i++) expect(delayBefore(i)).toBe(REVEAL_INTERVAL_MS);
  });
});

describe('pickCaption', () => {
  it('names the pick and who has it', () => {
    const rows = draftOrderRows(event);
    expect(pickCaption(rows[0]!)).toBe(`1st pick — ${rows[0]!.name}`);
    expect(pickCaption(rows[9]!)).toBe(`10th pick — ${rows[9]!.name}`);
  });
});

describe('draftOrderScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with every row hidden and nothing revealed', () => {
    const ctx = makeContext('tommy');
    draftOrderScreen.render(ctx);

    const rows = [...ctx.container.querySelectorAll('.score-row')];
    expect(rows.length).toBe(ROSTER.length);
    expect(rows.every((row) => row.classList.contains('is-hidden'))).toBe(true);
    expect(ctx.container.querySelector('[data-role="reveal"]')).not.toBeNull();
    expect(ctx.container.querySelector('[data-role="continue"]')!.classList.contains('is-hidden')).toBe(true);
  });

  it('lays the full table out from the first frame, so nothing shifts as picks land', () => {
    // Hidden rows are hidden by opacity, not by being absent — the ten rows and every
    // figure in them are in the DOM before the reveal starts.
    const ctx = makeContext(null);
    draftOrderScreen.render(ctx);
    const expected = draftOrderRows(event);
    const names = [...ctx.container.querySelectorAll('.score-name')].map((el) => el.textContent);
    expect(names).toEqual(expected.map((row) => row.name));
  });

  it('uncovers rows from tenth pick up to first, one at a time', () => {
    const ctx = makeContext(null);
    draftOrderScreen.render(ctx);
    const rows = [...ctx.container.querySelectorAll('.score-row')];

    ctx.container.querySelector<HTMLButtonElement>('[data-role="reveal"]')!.click();

    const revealed = (): number[] =>
      rows.map((row, i) => (row.classList.contains('is-hidden') ? -1 : i)).filter((i) => i >= 0);

    expect(revealed()).toEqual([]);

    // Tenth pick is the last row, and lands first.
    vi.advanceTimersByTime(REVEAL_INTERVAL_MS);
    expect(revealed()).toEqual([9]);

    vi.advanceTimersByTime(REVEAL_INTERVAL_MS);
    expect(revealed()).toEqual([8, 9]);

    // Through to second pick, with first still covered.
    vi.advanceTimersByTime(REVEAL_INTERVAL_MS * 7);
    expect(revealed()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows[0]!.classList.contains('is-hidden')).toBe(true);

    // First pick waits out the longer pause.
    vi.advanceTimersByTime(FINAL_REVEAL_PAUSE_MS - 1);
    expect(rows[0]!.classList.contains('is-hidden')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rows[0]!.classList.contains('is-hidden')).toBe(false);
    expect(rows[0]!.classList.contains('is-first-pick')).toBe(true);
  });

  it('names each pick in the caption as it lands', () => {
    const ctx = makeContext(null);
    draftOrderScreen.render(ctx);
    const rows = draftOrderRows(event);
    const caption = ctx.container.querySelector('[data-role="caption"]')!;

    ctx.container.querySelector<HTMLButtonElement>('[data-role="reveal"]')!.click();

    vi.advanceTimersByTime(REVEAL_INTERVAL_MS);
    expect(caption.textContent).toBe(pickCaption(rows[9]!));

    vi.advanceTimersByTime(REVEAL_INTERVAL_MS);
    expect(caption.textContent).toBe(pickCaption(rows[8]!));
  });

  it('offers the way onward only after the board has settled', () => {
    const ctx = makeContext(null);
    draftOrderScreen.render(ctx);
    const continueButton = ctx.container.querySelector('[data-role="continue"]')!;

    ctx.container.querySelector<HTMLButtonElement>('[data-role="reveal"]')!.click();
    vi.advanceTimersByTime(REVEAL_INTERVAL_MS * 9 + FINAL_REVEAL_PAUSE_MS);
    expect(continueButton.classList.contains('is-hidden')).toBe(true);

    vi.advanceTimersByTime(SETTLE_MS);
    expect(continueButton.classList.contains('is-hidden')).toBe(false);
    expect(ctx.container.querySelector('[data-role="caption"]')!.textContent).toContain(
      draftOrderRows(event)[0]!.name,
    );
  });

  it('advances to the completion beat', () => {
    const ctx = makeContext(null);
    draftOrderScreen.render(ctx);
    ctx.container.querySelector<HTMLButtonElement>('[data-role="reveal"]')!.click();
    vi.advanceTimersByTime(REVEAL_INTERVAL_MS * 9 + FINAL_REVEAL_PAUSE_MS + SETTLE_MS);
    ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('complete');
  });

  it('cancels a reveal in progress on teardown, firing nothing into a dead screen', () => {
    const ctx = makeContext(null);
    const teardown = draftOrderScreen.render(ctx);
    ctx.container.querySelector<HTMLButtonElement>('[data-role="reveal"]')!.click();
    vi.advanceTimersByTime(REVEAL_INTERVAL_MS * 2);

    teardown!();
    const revealedAtTeardown = ctx.container.querySelectorAll('.score-row:not(.is-hidden)').length;

    vi.advanceTimersByTime(REVEAL_INTERVAL_MS * 20);
    expect(ctx.container.querySelectorAll('.score-row:not(.is-hidden)').length).toBe(revealedAtTeardown);
  });

  it('marks the claimed member so they can find themselves in the final order', () => {
    const ctx = makeContext('tommy');
    draftOrderScreen.render(ctx);
    const marked = ctx.container.querySelectorAll('.score-row.is-you');
    expect(marked.length).toBe(1);
    expect(marked[0]!.textContent).toContain('Tommy McCormick');
  });
});

describe('completeScreen', () => {
  it('shows the final board with every row already visible', () => {
    const ctx = makeContext('tommy');
    completeScreen.render(ctx);
    const rows = [...ctx.container.querySelectorAll('.score-row')];
    expect(rows.length).toBe(ROSTER.length);
    expect(rows.some((row) => row.classList.contains('is-hidden'))).toBe(false);
  });

  it('leads with where the claimed member picks', () => {
    const ctx = makeContext('tommy');
    completeScreen.render(ctx);
    const rows = draftOrderRows(event);
    const tommy = rows.find((row) => row.memberId === 'tommy')!;
    expect(ctx.container.querySelector('h1')!.textContent).toContain(`You pick`);
    expect(ctx.container.querySelector('h1')!.textContent).toContain(String(tommy.rank));
  });

  it('falls back to a neutral heading when nobody was claimed', () => {
    const ctx = makeContext(null);
    completeScreen.render(ctx);
    expect(ctx.container.querySelector('h1')!.textContent).toBe('The draft order');
  });

  it('sends "watch again" back to name select, clearing the watch but not the unlock', () => {
    const ctx = makeContext('tommy');
    storage.setItem(`questDraftSelector:v1:${SEED}:hasCompletedOnce`, 'true');
    storage.setItem(
      `questDraftSelector:v1:${SEED}:watch`,
      JSON.stringify({ claimedMemberId: 'tommy', furthestBeat: LAST_BEAT }),
    );
    completeScreen.render(ctx);

    ctx.container.querySelector<HTMLButtonElement>('[data-role="again"]')!.click();

    expect(ctx.navigate).toHaveBeenCalledWith('name-select');
    const state = loadProgress(SEED, storage);
    expect(state.claimedMemberId).toBeNull();
    expect(state.furthestBeat).toBe(FIRST_BEAT);
    // Never re-locked: the whole point of keeping the two values in separate keys.
    expect(state.hasCompletedOnce).toBe(true);
  });
});

describe('reaching the end', () => {
  it('sets the completion unlock, freeing navigation for good', () => {
    // The plan's acceptance criterion. `hasCompletedOnce` is set by `recordBeatReached`
    // when the LAST beat is reached, so it takes actually arriving at `complete` — which
    // is why that screen had to be built here and not left a stub.
    const container = document.createElement('div');
    document.body.appendChild(container);
    storage.setItem(
      `questDraftSelector:v1:${SEED}:watch`,
      JSON.stringify({ claimedMemberId: 'tommy', furthestBeat: 'draft-order' satisfies BeatId }),
    );

    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(false);

    const router = mountRouter({ container, seed: SEED, storage });
    expect(router.currentBeat).toBe('draft-order');
    router.navigate('complete');

    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(true);
    // And with the unlock set, every beat is reachable.
    for (const beat of BEAT_IDS) {
      router.navigate(beat);
      expect(router.currentBeat, beat).toBe(beat);
    }
    router.destroy();
  });
});
