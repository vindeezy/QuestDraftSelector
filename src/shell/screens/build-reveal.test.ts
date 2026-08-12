// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEvent } from '../../sim/event/event';
import { CATEGORIES, partAt } from '../../sim/parts/tables';
import { ROSTER, toEventMembers } from '../../config/roster';
import { FIRST_BEAT } from '../beats';
import { claimMember, loadProgress, type ProgressStorage } from '../progress';
import { buildRevealScreen } from './build-reveal';
import type { ScreenContext } from './types';

const SEED = 918273;

/** An in-memory stand-in for `localStorage`, the same shape `progress.test.ts` uses —
 *  needed here so "does scouting change `claimedMemberId`" can be checked by actually
 *  reading storage back, not just by trusting the screen didn't call anything. */
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
  if (claimedMemberId) claimMember(SEED, claimedMemberId, storage);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage,
    navigate: vi.fn(),
  };
}

const event = runEvent({ masterSeed: SEED, members: toEventMembers(ROSTER) });

describe('buildRevealScreen', () => {
  it("renders the claimed member's build on mount: name, initials, colour, and all six parts", () => {
    const claimed = ROSTER[3]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    expect(ctx.container.querySelector('.screen-build-reveal')).not.toBeNull();

    const text = ctx.container.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(claimed.name);

    const badge = ctx.container.querySelector('.reveal-frame__badge')!;
    expect(badge.textContent!.trim()).toBe(claimed.initials);
    expect((ctx.container.querySelector('.reveal-frame') as HTMLElement).style.getPropertyValue('--member-colour')).toBe(
      claimed.colour,
    );

    const cards = ctx.container.querySelectorAll('.reveal-part-card');
    expect(cards.length).toBe(CATEGORIES.length);
  });

  it("every part shown matches runEvent's recorded build for the claimed member — label and blurb, not hardcoded text", () => {
    const memberIndex = 3;
    const claimed = ROSTER[memberIndex]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    const build = event.builds[memberIndex]!;
    CATEGORIES.forEach((category) => {
      const part = partAt(category, build[category]);
      const card = ctx.container.querySelector(`.reveal-part-card[data-category="${category}"]`)!;
      const cardText = card.textContent!.replace(/\s+/g, ' ');
      expect(cardText).toContain(part.label);
      expect(cardText).toContain(part.blurb);
    });
  });

  it('selecting another member shows their build instead', () => {
    const claimedIndex = 0;
    const otherIndex = 5;
    const claimed = ROSTER[claimedIndex]!;
    const other = ROSTER[otherIndex]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    const badge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${other.id}"]`)!;
    badge.click();

    const text = ctx.container.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(other.name);

    const build = event.builds[otherIndex]!;
    CATEGORIES.forEach((category) => {
      const part = partAt(category, build[category]);
      const card = ctx.container.querySelector(`.reveal-part-card[data-category="${category}"]`)!;
      expect(card.textContent).toContain(part.label);
    });
  });

  it('selecting another member does not change claimedMemberId — progress read back is unchanged', () => {
    const claimed = ROSTER[0]!;
    const other = ROSTER[7]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    expect(loadProgress(SEED, storage).claimedMemberId).toBe(claimed.id);

    const badge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${other.id}"]`)!;
    badge.click();

    expect(loadProgress(SEED, storage).claimedMemberId).toBe(claimed.id);

    // And scouting a third member on top of that still doesn't move it.
    const third = ROSTER[9]!;
    const thirdBadge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${third.id}"]`)!;
    thirdBadge.click();
    expect(loadProgress(SEED, storage).claimedMemberId).toBe(claimed.id);
  });

  it('the currently-viewed member and the claimed member are both distinguishable in the selector, even when they differ', () => {
    const claimed = ROSTER[2]!;
    const other = ROSTER[6]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    const claimedBadge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${claimed.id}"]`)!;
    expect(claimedBadge.classList.contains('reveal-selector__badge--claimed')).toBe(true);
    expect(claimedBadge.classList.contains('reveal-selector__badge--active')).toBe(true);

    const otherBadge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${other.id}"]`)!;
    otherBadge.click();

    // Selecting a member rebuilds the whole selector row, so the claimed badge must be
    // re-queried rather than reusing the (now detached) reference from before the click.
    const claimedBadgeAfter = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${claimed.id}"]`)!;

    // After scouting: the claimed badge keeps its "claimed" marker but is no longer
    // "active"; the newly viewed badge becomes "active" but never "claimed".
    expect(claimedBadgeAfter.classList.contains('reveal-selector__badge--claimed')).toBe(true);
    expect(claimedBadgeAfter.classList.contains('reveal-selector__badge--active')).toBe(false);

    const otherBadgeAfter = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${other.id}"]`)!;
    expect(otherBadgeAfter.classList.contains('reveal-selector__badge--active')).toBe(true);
    expect(otherBadgeAfter.classList.contains('reveal-selector__badge--claimed')).toBe(false);
  });

  it('clicking Continue advances to battle-1', () => {
    const claimed = ROSTER[1]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    const continueButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="continue"]')!;
    continueButton.click();

    expect(ctx.navigate).toHaveBeenCalledWith('battle-1');
  });

  it('never calls claimMember on this screen: the ten selector clicks in a row leave storage untouched beyond the initial claim', () => {
    const claimed = ROSTER[0]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    ROSTER.forEach((member) => {
      const badge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${member.id}"]`)!;
      badge.click();
    });

    expect(loadProgress(SEED, storage).claimedMemberId).toBe(claimed.id);
  });
});
