import { CATEGORIES, partAt, type CategoryName } from '../../sim/parts/tables';
import type { BotBuild } from '../../sim/parts/assemble';
import { ROSTER, toEventMembers, type RosterMember } from '../../config/roster';
import { nextBeat } from '../beats';
import { readableInkFor } from '../colour';
import { CATEGORY_LABEL, getEventResult } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beat 10 — the build reveal. The six Forge boards have all finished; every member has a
 * finished bot. This screen shows the claimed member's build full-screen, one card per
 * part (category, part name, the part's `blurb`), and lets the viewer browse the other
 * nine members' builds the same way. See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §5.3.
 *
 * Two identities are tracked here and must never be confused:
 *
 * - **`claimedIndex`** — fixed for the lifetime of this render, read once from
 *   `ctx.state.claimedMemberId`. This is *who the highlight in battle follows*, and this
 *   screen never writes it: `claimMember` is not imported here, let alone called. Picking
 *   a different member to look at is scouting, not switching allegiance (§5.3).
 * - **`viewedIndex`** — mutable, local to this render. Which member's build is currently
 *   on screen. Starts on `claimedIndex` (falling back to member 0 only if nothing has been
 *   claimed yet, which should not happen this late in the walkthrough but is handled
 *   rather than crashing on it).
 *
 * The parts shown are read straight off `event.builds[memberIndex]` through `partAt` —
 * the same function `assemble()` (`sim/parts/assemble.ts`) uses to build the bot the
 * battles actually run on — rather than re-deriving anything, so what a member sees here
 * can never drift from what fights next.
 */

interface PartDisplay {
  category: CategoryName;
  categoryLabel: string;
  partLabel: string;
  blurb: string;
}

/** One member's six parts, in `CATEGORIES` order, read off the recorded event via
 *  `partAt` — the same source `assemble()` uses, so this can never disagree with what the
 *  battles actually run on. */
function partsForMember(builds: readonly BotBuild[], memberIndex: number): PartDisplay[] {
  const build = builds[memberIndex]!;
  return CATEGORIES.map((category) => {
    const part = partAt(category, build[category]);
    return { category, categoryLabel: CATEGORY_LABEL[category], partLabel: part.label, blurb: part.blurb };
  });
}

export const buildRevealScreen: Screen = {
  render(ctx: ScreenContext) {
    const members: readonly RosterMember[] = ROSTER;
    const event = getEventResult(ctx.seed, toEventMembers(members));

    const claimedIndex = ctx.state.claimedMemberId
      ? members.findIndex((member) => member.id === ctx.state.claimedMemberId)
      : -1;
    // Falls back to the first member only when nothing is claimed at all — this beat is
    // reached well after name-select, so in practice `claimedIndex` is always >= 0, but a
    // screen must not crash on a state it merely didn't expect.
    let viewedIndex = claimedIndex >= 0 ? claimedIndex : 0;

    const root = document.createElement('section');
    root.className = 'screen screen-build-reveal';
    root.innerHTML = `
      <div class="reveal-frame" data-role="frame"></div>
      <div class="reveal-selector" data-role="selector" role="list" aria-label="Scout another member's build"></div>
      <div class="reveal-footer">
        <button type="button" class="btn btn-primary btn-large reveal-continue-btn" data-role="continue">Continue</button>
      </div>
    `;

    const frameHost = root.querySelector<HTMLElement>('[data-role="frame"]')!;
    const selectorHost = root.querySelector<HTMLElement>('[data-role="selector"]')!;
    const continueButton = root.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

    function renderFrame(): void {
      const member = members[viewedIndex]!;
      const isClaimed = viewedIndex === claimedIndex;

      frameHost.style.setProperty('--member-colour', member.colour);
      frameHost.innerHTML = `
        <div class="reveal-frame__identity">
          <span class="reveal-frame__badge" style="background:${member.colour}; color:${readableInkFor(member.colour)}">
            ${member.initials}
          </span>
          <div>
            <p class="reveal-frame__eyebrow">${isClaimed ? 'Your bot' : `Scouting ${member.name}`}</p>
            <h1 class="reveal-frame__name">${member.name}</h1>
          </div>
        </div>
        <div class="reveal-parts" data-role="parts"></div>
      `;

      const partsHost = frameHost.querySelector<HTMLElement>('[data-role="parts"]')!;
      for (const part of partsForMember(event.builds, viewedIndex)) {
        const card = document.createElement('div');
        card.className = 'reveal-part-card';
        card.dataset.category = part.category;
        card.innerHTML = `
          <p class="reveal-part-card__category">${part.categoryLabel}</p>
          <p class="reveal-part-card__name">${part.partLabel}</p>
          <p class="reveal-part-card__blurb">${part.blurb}</p>
        `;
        partsHost.appendChild(card);
      }
    }

    function renderSelector(): void {
      selectorHost.innerHTML = '';
      members.forEach((member, index) => {
        const isViewed = index === viewedIndex;
        const isClaimed = index === claimedIndex;

        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'reveal-selector__badge';
        if (isViewed) badge.classList.add('reveal-selector__badge--active');
        if (isClaimed) badge.classList.add('reveal-selector__badge--claimed');
        badge.setAttribute('role', 'listitem');
        badge.setAttribute('aria-pressed', String(isViewed));
        badge.setAttribute(
          'aria-label',
          isClaimed ? `${member.name} — your bot` : `Scout ${member.name}'s bot`,
        );
        badge.dataset.memberId = member.id;
        badge.style.setProperty('--member-colour', member.colour);
        badge.style.background = member.colour;
        badge.style.color = readableInkFor(member.colour);
        badge.textContent = member.initials;

        // Scouting only: this handler updates `viewedIndex`, a local variable, and
        // re-renders. It never touches `claimedIndex`, `ctx.state`, or storage — there is
        // no `claimMember` call anywhere in this file.
        badge.addEventListener('click', () => {
          if (viewedIndex === index) return;
          viewedIndex = index;
          renderFrame();
          renderSelector();
        });

        selectorHost.appendChild(badge);
      });
    }

    renderFrame();
    renderSelector();

    continueButton.addEventListener('click', () => {
      ctx.navigate(nextBeat('build-reveal')!);
    });

    ctx.container.appendChild(root);
  },
};
