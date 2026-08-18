import { CATEGORIES, partAt, type CategoryName } from '../../sim/parts/tables';
import type { BotBuild } from '../../sim/parts/assemble';
import { ROSTER, toEventMembers, type RosterMember } from '../../config/roster';
import { nextBeat } from '../beats';
import { readableInkFor } from '../colour';
import { canvasSupportsWebGL } from '../canvas-support';
import { mountBotPortraitStage, type BotPortraitAnchors, type BotPortraitStage } from '../../render/bot-portrait';
import { CATEGORY_LABEL, getEventResult } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beat 10 — the build reveal. The six Forge boards have all finished; every member has a
 * finished bot. This is the emotional peak the project owner asked for by name: "the
 * first time you get to see your bot that will be fighting" should have "a real Wow
 * moment with pride in your final bot" — a video-game character-select screen, not six
 * text cards. See `docs/superpowers/specs/2026-08-11-website-design.md` §5.3 and §8.
 *
 * The bot itself is drawn by `render/bot-portrait.ts` — silhouette (chassis), fill colour
 * (member identity), rim (armour) and front attachment (weapon), the "four visual
 * channels" §8 lays out. Drive, ability and personality have no visual channel of their
 * own — that's expected, not a gap — so their cards get no leader line; only chassis,
 * weapon and armour do, from `BotPortraitAnchors`.
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

/** `#RRGGBB` -> `0xRRGGBB`. The roster stores colour as a CSS-ready string; the portrait
 *  renderer wants the numeric form every other renderer in `src/render/` already uses
 *  (same conversion `forge.ts` does for the Plinko balls). */
function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/**
 * Which side of the stage a category's card sits on, and in what top-to-bottom order.
 *
 * Not `CATEGORIES` order top-to-bottom: the portrait is presented facing "up" (see
 * `mountBotPortraitStage`'s doc comment), which puts the weapon anchor near the *top* of
 * the stage and the chassis anchor near the *bottom* — the reverse of `CATEGORIES`'
 * chassis-then-weapon order. Placing the cards in that same reversed order (weapon
 * highest, chassis lowest) is what keeps their leader lines running roughly straight
 * across to the stage instead of crossing each other in a big X above it.
 */
const LEFT_COLUMN: readonly CategoryName[] = ['weapon', 'drive', 'chassis'];
const RIGHT_COLUMN: readonly CategoryName[] = ['armour', 'ability', 'personality'];

/** The three categories `bot-portrait.ts` exports an anchor for. Everything else
 *  (drive, ability, personality) has no visual channel on the bot — §8 calls this out
 *  explicitly — so those cards simply never appear here. */
const ANCHORED_CATEGORIES: readonly (keyof BotPortraitAnchors)[] = ['chassis', 'weapon', 'armour'];

function isAnchoredCategory(category: CategoryName): category is keyof BotPortraitAnchors {
  return (ANCHORED_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Bounds on the portrait canvas's native pixel size.
 *
 * The canvas is rendered at its native size and never CSS-rescaled — that is what lets
 * `anchorPositions()` hand back exact viewport coordinates with no second scale factor to
 * track (see `mountBotPortraitStage`). But "never rescaled" and "a hardcoded constant" are
 * different things, and conflating them was a bug: one fixed number is simultaneously too
 * small on a large display and too wide to fit on a laptop, and because it cannot shrink,
 * being too big means overflowing rather than adapting.
 *
 * So the size is *chosen at mount* from the space actually available, then held. Anchors
 * stay exact because the canvas still renders at whatever size was picked.
 */
/**
 * The floor must not exceed what the layout actually guarantees, or the canvas overflows the
 * track it sits in and covers the cards either side. That is what 380 did: `.reveal-arena`'s
 * centre column is `minmax(280px, 620px)`, so between 280 and 380 the portrait was wider than
 * its own track and simply spilled over — the exact failure the comment above warns about,
 * reintroduced by the clamp meant to prevent it.
 *
 * 260 sits below the track's own minimum, so the two are genuinely in step now.
 */
export const PORTRAIT_MIN_SIZE = 260;
export const PORTRAIT_MAX_SIZE = 600;

/** How long `resize` has to stay quiet before the portrait is rebuilt. A fullscreen
 *  transition and a window drag both fire it continuously, and each rebuild tears down and
 *  recreates a PixiJS application — cheap once, wasteful sixty times a second. */
const RESIZE_SETTLE_MS = 180;

/** Picks the portrait's native size from the room its host actually has, squared off so
 *  the bot is never letterboxed, and clamped so it stays legible on a small window and
 *  stops growing before it dwarfs the cards on a very large one. */
export function portraitSizeFor(hostWidth: number, hostHeight: number): number {
  const available = Math.floor(Math.min(hostWidth, hostHeight));
  if (available < PORTRAIT_MIN_SIZE) return PORTRAIT_MIN_SIZE;
  if (available > PORTRAIT_MAX_SIZE) return PORTRAIT_MAX_SIZE;
  return available;
}

/** The no-WebGL fallback — same visual vocabulary as `forge.ts`'s own board fallback:
 *  a static shape in the member's colour, since there is no live portrait to draw. No
 *  anchors exist in this path, so the caller never asks for leader lines here. */
function mountPortraitFallback(host: HTMLElement, memberColourHex: string): void {
  const el = document.createElement('div');
  el.className = 'reveal-stage__fallback';
  el.style.setProperty('--member-colour', memberColourHex);
  host.appendChild(el);
}

/**
 * Mounts (or, on the no-WebGL path, statically shows) one member's portrait into `host`,
 * driving its own idle-drift animation frame loop and reporting fresh anchor positions
 * every frame via `onFrame` (or `null` once, in the fallback path, so the caller knows
 * not to wait for anchors that will never come).
 *
 * Owns exactly one `requestAnimationFrame` loop end to end and cancels it on `destroy` —
 * the same contract `forge.ts`'s own drop loop has, checked by
 * `build-reveal-portrait.test.ts` the same way `forge.test.ts` checks `forgeScreen`'s.
 */
function mountPortrait(
  host: HTMLElement,
  build: BotBuild,
  memberColourHex: string,
  onFrame: (anchors: BotPortraitAnchors | null) => void,
): () => void {
  let stopped = false;
  let stage: BotPortraitStage | null = null;
  let frame = 0;

  if (canvasSupportsWebGL()) {
    // Measured from the host at mount, not a constant — see `portraitSizeFor`. `host` is
    // the stage element, already laid out by the time a screen renders into the document.
    const rect = host.getBoundingClientRect();
    const size = portraitSizeFor(rect.width || PORTRAIT_MAX_SIZE, rect.height || PORTRAIT_MAX_SIZE);
    void mountBotPortraitStage(host, build, hexToNumber(memberColourHex), size).then((created) => {
      if (stopped) {
        created.destroy();
        return;
      }
      stage = created;
      const loop = (): void => {
        if (stopped) return;
        stage!.tick();
        onFrame(stage!.anchorPositions());
        frame = requestAnimationFrame(loop);
      };
      loop();
    });
  } else {
    mountPortraitFallback(host, memberColourHex);
    onFrame(null);
  }

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stage?.destroy();
  };
}

/** Redraws the leader-line overlay from scratch every frame — three lines at most (one
 *  per anchored category actually present as a card), cheap enough not to bother diffing.
 *  `anchors` is `null` on the no-WebGL fallback path, in which case the overlay is simply
 *  left empty: there is nothing live to point a line at. */
function redrawLeaderLines(
  svg: SVGSVGElement,
  anchors: BotPortraitAnchors | null,
  cardEls: Partial<Record<CategoryName, HTMLElement>>,
  memberColourHex: string,
): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!anchors) return;

  const svgRect = svg.getBoundingClientRect();
  const svgMidX = svgRect.left + svgRect.width / 2;

  for (const key of ANCHORED_CATEGORIES) {
    const card = cardEls[key];
    if (!card) continue;
    const anchor = anchors[key];
    const cardRect = card.getBoundingClientRect();
    const cardMidX = cardRect.left + cardRect.width / 2;
    // The line leaves from whichever vertical edge of the card faces the stage, not the
    // card's centre — starting inside the card's own box would draw straight through its
    // text.
    const startX = cardMidX < svgMidX ? cardRect.right : cardRect.left;
    const startY = cardRect.top + cardRect.height / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'reveal-leader-line');
    line.setAttribute('x1', String(startX - svgRect.left));
    line.setAttribute('y1', String(startY - svgRect.top));
    line.setAttribute('x2', String(anchor.x - svgRect.left));
    line.setAttribute('y2', String(anchor.y - svgRect.top));
    line.setAttribute('stroke', memberColourHex);
    svg.appendChild(line);

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'reveal-leader-dot');
    dot.setAttribute('cx', String(anchor.x - svgRect.left));
    dot.setAttribute('cy', String(anchor.y - svgRect.top));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', memberColourHex);
    svg.appendChild(dot);
  }
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

    // Owns exactly one live portrait mount at a time — scouting tears the previous one
    // down before mounting the next, so there is never more than one animation frame
    // loop running (see `mountPortrait`'s own doc comment on that contract).
    let portraitTeardown: (() => void) | null = null;

    function renderFrame(): void {
      portraitTeardown?.();
      portraitTeardown = null;

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
        <div class="reveal-arena" data-role="arena">
          <div class="reveal-cards reveal-cards--left" data-role="cards-left"></div>
          <div class="reveal-stage-wrap" data-role="stage-wrap">
            <div class="reveal-stage" data-role="stage" style="--member-colour:${member.colour}"></div>
            <svg class="reveal-leader-lines" data-role="leader-lines" aria-hidden="true"></svg>
          </div>
          <div class="reveal-cards reveal-cards--right" data-role="cards-right"></div>
        </div>
      `;

      const cardsLeftHost = frameHost.querySelector<HTMLElement>('[data-role="cards-left"]')!;
      const cardsRightHost = frameHost.querySelector<HTMLElement>('[data-role="cards-right"]')!;
      const stageHost = frameHost.querySelector<HTMLElement>('[data-role="stage"]')!;
      const leaderLinesSvg = frameHost.querySelector<SVGSVGElement>('[data-role="leader-lines"]')!;

      const cardEls: Partial<Record<CategoryName, HTMLElement>> = {};
      const partsByCategory = new Map(partsForMember(event.builds, viewedIndex).map((part) => [part.category, part]));

      for (const [host, order] of [
        [cardsLeftHost, LEFT_COLUMN],
        [cardsRightHost, RIGHT_COLUMN],
      ] as const) {
        for (const category of order) {
          const part = partsByCategory.get(category)!;
          const card = document.createElement('div');
          card.className = 'reveal-part-card';
          card.dataset.category = part.category;
          if (isAnchoredCategory(part.category)) card.classList.add('reveal-part-card--anchored');
          card.innerHTML = `
            <p class="reveal-part-card__category">${part.categoryLabel}</p>
            <p class="reveal-part-card__name">${part.partLabel}</p>
            <p class="reveal-part-card__blurb">${part.blurb}</p>
          `;
          host.appendChild(card);
          cardEls[part.category] = card;
        }
      }

      let latestAnchors: BotPortraitAnchors | null = null;
      const scheduleLeaderLines = (): void => redrawLeaderLines(leaderLinesSvg, latestAnchors, cardEls, member.colour);

      portraitTeardown = mountPortrait(stageHost, event.builds[viewedIndex]!, member.colour, (anchors) => {
        latestAnchors = anchors;
        scheduleLeaderLines();
      });

      // The idle-drift loop inside `mountPortrait` redraws anchors every frame, which is
      // what keeps the lines attached as the portrait drifts — but the *cards'* own DOM
      // rects only change on layout events, not every frame, so a resize needs its own
      // redraw rather than waiting on the next animation frame from the portrait.
      const onResize = (): void => scheduleLeaderLines();
      window.addEventListener('resize', onResize);
      const previousTeardown = portraitTeardown;
      portraitTeardown = () => {
        window.removeEventListener('resize', onResize);
        previousTeardown();
      };
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

    /**
     * Re-mount the portrait when the window changes size.
     *
     * The canvas is rendered at a size measured once, at mount, and is deliberately never
     * CSS-rescaled — that is what keeps the leader-line anchors in exact viewport
     * coordinates. The cost is that it does not notice the window changing underneath it:
     * entering fullscreen grew the layout around a canvas that stayed exactly as it was,
     * leaving the portrait mis-sized against its container and the leader lines pointing
     * at coordinates from the old layout.
     *
     * Debounced because a fullscreen transition and a window drag both fire `resize` many
     * times, and each one tears down and rebuilds a PixiJS application.
     */
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = (): void => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        renderFrame();
      }, RESIZE_SETTLE_MS);
    };
    window.addEventListener('resize', onResize);

    ctx.container.appendChild(root);

    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      portraitTeardown?.();
      portraitTeardown = null;
    };
  },
};
