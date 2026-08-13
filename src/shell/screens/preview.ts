import { runEvent } from '../../sim/event/event';
import { ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { toEventMembers, ROSTER } from '../../config/roster';
import { anonymiseFor, anonColourFor } from '../../config/anonymise';
import { createArenaRenderer, type ArenaBotVisual, type ArenaRenderer } from '../../render/arena-renderer';
import type { Effect } from '../../sim/arena/effects';
import type { Match } from '../../sim/arena/match';
import { canvasSupportsWebGL } from '../canvas-support';
import { advanceBattleFrame, replayBattle, TICKS_PER_FRAME } from './battle';

/**
 * The seed preview: watch a candidate seed's three battles with every entrant anonymised,
 * so the official seed can be chosen on how it LOOKS as well as how it measures.
 *
 * Reached only by `?preview=<seed>` (see `boot.ts`) and deliberately outside the router and
 * the nineteen beats: it touches no progress state, records nothing, and never reads the
 * official record. Previewing a candidate must not advance, reset or unlock anything in the
 * real walkthrough, and a viewer who lands here by accident must be able to leave without
 * having spoiled or altered their own watch.
 *
 * Anonymity is the entire point, so it is enforced in three places at once — labels are
 * `anonymiseFor`'s A..J shuffle, colours come from `ANON_COLOURS` keyed by that letter, and
 * no roster name is ever put in the DOM. The letters match the ones in the written seed
 * reports, so a swing that looked good in a table can be watched by name.
 */

/** Battles are `battle=1|2|3` in the URL, 0-based everywhere inside. */
export interface PreviewRequest {
  seed: number;
  battleIndex: number;
}

/**
 * Reads `?preview=<seed>&battle=<n>` off a URL, or `null` when the preview is not being
 * asked for. Exported and pure so the parsing rules are testable without a browser.
 *
 * A malformed battle number falls back to the first battle rather than refusing: the point
 * of this route is to get eyes on a candidate quickly, and rejecting the whole request over
 * a typo in an optional parameter would be the wrong trade.
 */
export function parsePreviewRequest(search: string): PreviewRequest | null {
  const params = new URLSearchParams(search);
  const raw = params.get('preview');
  if (raw === null) return null;

  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 1) return null;

  const battle = Number(params.get('battle') ?? '1');
  const battleIndex = Number.isInteger(battle) && battle >= 1 && battle <= 3 ? battle - 1 : 0;
  return { seed, battleIndex };
}

/** The anonymous visual for every entrant, indexed to match `match.bots`. */
export function previewVisuals(seed: number, memberCount: number): ArenaBotVisual[] {
  const labels = anonymiseFor(seed, memberCount);
  return labels.map((label) => ({ colour: anonColourFor(label), label }));
}

/** `?preview=43000236&battle=2` for the next battle, or the next seed's first battle at the
 *  end of a run. Returns `null` when there is nowhere further to go. */
export function nextPreviewHref(request: PreviewRequest, otherSeeds: readonly number[]): string | null {
  if (request.battleIndex < 2) return `?preview=${request.seed}&battle=${request.battleIndex + 2}`;
  const next = otherSeeds.find((s) => s !== request.seed);
  return next === undefined ? null : `?preview=${next}&battle=1`;
}

function fallback(host: HTMLElement, battleIndex: number): void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback battle-arena__fallback';
  el.innerHTML = `
    <div class="fallback-arena" aria-hidden="true">
      ${Array.from({ length: 6 }, () => '<span class="fallback-bot"></span>').join('')}
    </div>
    <p class="fallback-note">${ARENA_VARIANT_NAMES[battleIndex]} cannot be drawn — this browser has no WebGL.</p>
  `;
  host.appendChild(el);
}

/**
 * Mounts the preview into `container`. Returns a teardown, like a screen would, so
 * `boot.ts` can dispose of it — the animation loop and the PixiJS renderer both need
 * stopping or a navigation away leaves a canvas rendering into a detached DOM.
 */
export function mountPreview(
  container: HTMLElement,
  request: PreviewRequest,
  otherSeeds: readonly number[] = [],
): () => void {
  const { seed, battleIndex } = request;
  const result = runEvent({ masterSeed: seed, members: toEventMembers() });
  const memberCount = ROSTER.length;
  const visuals = previewVisuals(seed, memberCount);
  const match: Match = replayBattle(result.battles[battleIndex]!.seed, battleIndex, result.builds, memberCount);

  const next = nextPreviewHref(request, otherSeeds);
  const root = document.createElement('section');
  root.className = 'screen screen-battle screen-preview';
  root.innerHTML = `
    <div class="battle-header">
      <p class="battle-progress">PREVIEW · seed ${seed} · battle ${battleIndex + 1} of 3</p>
      <h1 class="battle-arena-name">${ARENA_VARIANT_NAMES[battleIndex]}</h1>
      <p class="preview-note">Entrants are anonymous. The letters match the seed report.</p>
    </div>
    <div class="battle-layout">
      <div class="battle-arena" data-role="arena">
        <button type="button" class="btn btn-primary btn-large forge-overlay-btn battle-start-btn" data-role="begin">
          BEGIN
        </button>
      </div>
    </div>
    <div class="battle-footer">
      <span class="preview-status" data-role="status" aria-live="polite"></span>
      ${next === null ? '' : `<a class="btn btn-primary btn-large is-hidden" data-role="next" href="${next}">Next battle</a>`}
    </div>
  `;

  const arenaHost = root.querySelector<HTMLElement>('[data-role="arena"]')!;
  const beginButton = root.querySelector<HTMLButtonElement>('[data-role="begin"]')!;
  const nextLink = root.querySelector<HTMLAnchorElement>('[data-role="next"]');
  const status = root.querySelector<HTMLElement>('[data-role="status"]')!;
  container.appendChild(root);

  let renderer: ArenaRenderer | null = null;
  let frame = 0;
  let stopped = false;

  beginButton.addEventListener('click', () => {
    beginButton.remove();
    status.textContent = 'Running…';

    const run = (): void => {
      const tick = (): void => {
        if (stopped) return;
        const effects: Effect[] = [];
        advanceBattleFrame(match, TICKS_PER_FRAME, effects);
        void effects;
        renderer?.draw(match);
        if (match.done) {
          const survivor = match.bots.find((b) => b.alive);
          status.textContent = survivor
            ? `Winner: ${visuals[Number(survivor.body.id.slice('bot-'.length))]!.label} · ${(match.world.tick / 60).toFixed(0)}s`
            : `No winner · ${(match.world.tick / 60).toFixed(0)}s`;
          nextLink?.classList.remove('is-hidden');
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    if (!canvasSupportsWebGL()) {
      fallback(arenaHost, battleIndex);
      run();
      return;
    }
    void createArenaRenderer(arenaHost, match, null, new Map(), visuals).then((r) => {
      if (stopped) {
        r.destroy();
        return;
      }
      renderer = r;
      run();
    });
  });

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    renderer?.destroy();
  };
}
