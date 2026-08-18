import { DEFAULT_BOARD } from '../../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun } from '../../sim/plinko/plinko';
import { createPlinkoRenderer } from '../../render/plinko-renderer';
import { GRINDER_ARENA } from '../../sim/arena/arena';
import { DEFAULT_MATCH, advanceMatch, createMatch, type Match } from '../../sim/arena/match';
import { buildsForSeed } from '../../sim/parts/forge';
import { createArenaRenderer } from '../../render/arena-renderer';
import { PLACEMENT_POINTS, KILL_POINTS } from '../../sim/event/scoring';
import { DEMO_SEED } from '../demo-seed';
import { FLOOR_BACKDROP, FLOOR_KEY, swatchHex } from '../floor-key';
import { nextBeat } from '../beats';
import { ordinal } from '../ordinal';
import { canvasSupportsWebGL } from '../canvas-support';
import type { Screen, ScreenContext } from './types';

/**
 * Beat 3 — What to expect. The orientation, and the beat that's supposed to build
 * excitement rather than just explain rules — see
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2.1.
 *
 * Four sections, each with a short description *and* a picture: a looping Forge drop, a
 * miniature battle, the floor key, and the points table. Both live panels run `DEMO_SEED`
 * (never the official seed — see that module's doc comment) so this screen can never
 * spoil the real event it is previewing.
 *
 * The split between sections two and three is deliberate and was chosen rather than
 * inherited. "The battles" sells the thing — ten machines, no driver, last one moving.
 * "The arenas" explains it, and holds the copy about the three layouts that used to sit
 * inside the battles paragraph. Selling and explaining in one breath did neither well.
 */

// --- Demo panel tuning -----------------------------------------------------------------
//
// Fewer balls/bots than the real event (which always runs the full ten) so the loop
// settles quickly and reads as a lively preview rather than something to wait out.
const DEMO_BALL_COUNT = 6;
const DEMO_BOT_COUNT = 6;
/** Presentation only — see the identical note in the old dev workbench (`main.ts`'s
 *  predecessor): ticks-per-frame changes how fast the loop is *watched*, never what it
 *  produces, so it cannot affect determinism. */
const DEMO_TICKS_PER_FRAME = 2;
/** How long a settled loop holds on its result before quietly resetting. */
const DEMO_LOOP_HOLD_MS = 900;

/** Panels are shown at a fraction of the renderer's native pixel size — see
 *  `mountScaledStage`. Picked so both panels read as roughly the same size next to each
 *  other despite the Forge board and the arena having different native aspect ratios. */
const FORGE_PANEL_SCALE = 0.34;
const ARENA_PANEL_SCALE = 0.26;

/**
 * Wraps a renderer's canvas in a fixed-size, clipped box scaled down from its native
 * pixel size — "miniature" without touching the renderer itself, which always draws at
 * its one true size. Returns the element the renderer should mount into.
 */
function mountScaledStage(host: HTMLElement, nativeWidth: number, nativeHeight: number, scale: number): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'expect-visual__stage';
  stage.style.width = `${Math.round(nativeWidth * scale)}px`;
  stage.style.height = `${Math.round(nativeHeight * scale)}px`;

  const inner = document.createElement('div');
  inner.className = 'expect-visual__inner';
  inner.style.width = `${nativeWidth}px`;
  inner.style.height = `${nativeHeight}px`;
  inner.style.transform = `scale(${scale})`;
  inner.style.transformOrigin = 'top left';

  stage.appendChild(inner);
  host.appendChild(stage);
  return inner;
}

function makeDemoPlinkoRun() {
  return createPlinkoRun({
    ...DEFAULT_PLINKO,
    board: DEFAULT_BOARD,
    seed: DEMO_SEED,
    ballCount: DEMO_BALL_COUNT,
  });
}

function mountForgeFallback(host: HTMLElement): () => void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback';
  el.innerHTML = `
    <div class="fallback-boards" aria-hidden="true">
      ${Array.from({ length: 6 }, () => '<span class="fallback-board"><i></i></span>').join('')}
    </div>
    <p class="fallback-note">Six boards. Ten balls. Watch it live in a moment.</p>
  `;
  host.appendChild(el);
  return () => el.remove();
}

/** Mounts the looping Forge preview into `host`. Restarts from the same fixed
 *  `DEMO_SEED` every time it settles, so the loop is a clean, repeatable animation
 *  rather than a new (and therefore occasionally awkward-looking) drop each pass. */
async function mountForgeLoop(host: HTMLElement): Promise<() => void> {
  if (!canvasSupportsWebGL()) return mountForgeFallback(host);

  let current = makeDemoPlinkoRun();
  const inner = mountScaledStage(host, DEFAULT_BOARD.width, DEFAULT_BOARD.height, FORGE_PANEL_SCALE);
  const renderer = await createPlinkoRenderer(inner, current, null);

  let stopped = false;
  let restarting = false;
  let frame = 0;

  const loop = (): void => {
    if (stopped) return;
    if (!current.done) {
      for (let i = 0; i < DEMO_TICKS_PER_FRAME && !current.done; i++) advance(current);
      renderer.draw(current);
    } else if (!restarting) {
      restarting = true;
      setTimeout(() => {
        if (stopped) return;
        current = makeDemoPlinkoRun();
        restarting = false;
      }, DEMO_LOOP_HOLD_MS);
    }
    frame = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    renderer.destroy();
  };
}

function makeDemoMatch(): Match {
  const { builds, matchSeed } = buildsForSeed(DEMO_SEED, DEMO_BOT_COUNT);
  return createMatch({
    ...DEFAULT_MATCH,
    arena: GRINDER_ARENA,
    botCount: DEMO_BOT_COUNT,
    seed: matchSeed,
    builds,
  });
}

function mountArenaFallback(host: HTMLElement): () => void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback';
  el.innerHTML = `
    <div class="fallback-arena" aria-hidden="true">
      ${Array.from({ length: 6 }, () => '<span class="fallback-bot"></span>').join('')}
    </div>
    <p class="fallback-note">Three arenas. Last bot standing. Watch it live in a moment.</p>
  `;
  host.appendChild(el);
  return () => el.remove();
}

/** Mounts the miniature battle preview into `host`, restarting from the same fixed
 *  `DEMO_SEED` on every settle, for the same reason `mountForgeLoop` does. */
async function mountArenaLoop(host: HTMLElement): Promise<() => void> {
  if (!canvasSupportsWebGL()) return mountArenaFallback(host);

  let current = makeDemoMatch();
  const nativeWidth = GRINDER_ARENA.cols * GRINDER_ARENA.tileSize;
  const nativeHeight = GRINDER_ARENA.rows * GRINDER_ARENA.tileSize;
  // Deliberately mounted at only the arena's own footprint, not the renderer's wider
  // canvas (which also draws a kill-feed margin) — the stage below is narrower than
  // that full canvas and clips via `overflow: hidden`, cropping the feed out. A
  // sidebar of eliminations has no place on a screen that has not shown a battle yet.
  const inner = mountScaledStage(host, nativeWidth, nativeHeight, ARENA_PANEL_SCALE);
  const renderer = await createArenaRenderer(inner, current, null);

  let stopped = false;
  let restarting = false;
  let frame = 0;

  const loop = (): void => {
    if (stopped) return;
    if (!current.done) {
      for (let i = 0; i < DEMO_TICKS_PER_FRAME && !current.done; i++) advanceMatch(current);
      renderer.draw(current);
    } else if (!restarting) {
      restarting = true;
      setTimeout(() => {
        if (stopped) return;
        current = makeDemoMatch();
        restarting = false;
      }, DEMO_LOOP_HOLD_MS);
    }
    frame = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    renderer.destroy();
  };
}

/**
 * The arenas section's "picture" — the floor key.
 *
 * Swatches take their colours from `FLOOR_KEY`, which takes them from the renderer's own
 * constants, so a legend explaining the floor cannot drift away from the floor it explains.
 * See `floor-key.ts` for what is deliberately left out of it.
 */
function renderFloorKey(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'floor-key';

  wrap.innerHTML = `
    <p class="floor-key__title">The floor itself</p>
    <ul class="floor-key__list">
      ${FLOOR_KEY.map(
        (entry) => `
        <li class="floor-key__item">
          <span class="floor-key__swatch" aria-hidden="true"
                style="background: ${swatchHex(entry.colour)}; box-shadow: inset 0 0 0 4px ${swatchHex(FLOOR_BACKDROP)}"></span>
          <span class="floor-key__body">
            <span class="floor-key__label">${entry.label}</span>
            <span class="floor-key__blurb">${entry.blurb}</span>
          </span>
        </li>
      `,
      ).join('')}
    </ul>
  `;
  return wrap;
}

/** The scoring section's "picture" — the points table, plainly laid out, exactly as the
 *  spec asks for it. Not a chart: the ask here is legibility, not decoration. */
function renderPointsTable(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'points-table-wrap';

  const rows = PLACEMENT_POINTS.map(
    (points, i) => `
      <tr>
        <td class="points-table__place">${ordinal(i + 1)}</td>
        <td class="points-table__points">${points}</td>
      </tr>
    `,
  ).join('');

  wrap.innerHTML = `
    <table class="points-table">
      <caption class="sr-only">Placement points, first through tenth</caption>
      <thead>
        <tr><th scope="col">Place</th><th scope="col">Points</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="points-table__kill-note">+${KILL_POINTS} points per kill, credited to whoever landed it.</p>
  `;
  return wrap;
}

export const whatToExpectScreen: Screen = {
  render(ctx: ScreenContext) {
    const root = document.createElement('section');
    root.className = 'screen screen-what-to-expect';

    root.innerHTML = `
      <div class="expect-header">
        <h1>What to expect</h1>
      </div>
      <div class="expect-rows">
        <div class="expect-row">
          <div class="expect-text">
            <h2>The Forge</h2>
            <p>Six boards, one per part of your bot. Ten balls per board — everyone drops
              at once. Wherever yours lands is what you get: chassis, drive, weapon,
              armour, ability, and how it fights. Nobody picks a build. The ball decides.</p>
          </div>
          <div class="expect-visual" data-panel="forge"></div>
        </div>

        <div class="expect-row expect-row--reverse">
          <div class="expect-text">
            <h2>The battles</h2>
            <p>Ten machines hit the floor at once, and every one of them is hunting.
              Spinners, hammers, flamethrowers — whatever the Forge handed you is what you
              fight with, plus one ability that fires when the damage starts landing,
              whether or not you'd have picked that moment. Saws come up out of the ground.
              Cannons fire across it. Bots get shoved into hazards, into walls, and into
              each other.</p>
            <p><strong class="expect-highlight">Nobody drives. Nobody surrenders. It ends
              when one machine is still moving</strong> — and everyone else is scored
              exactly where they fell.</p>
          </div>
          <div class="expect-visual" data-panel="arena"></div>
        </div>

        <div class="expect-row">
          <div class="expect-text">
            <h2>The arenas</h2>
            <p>Three arenas, three different ways to lose. One pushes you to the middle.
              One turns the floor to ice. One hides its hazards behind buttons you'll
              trip without meaning to.</p>
            <p>And the ground is never just ground — what a bot is standing on decides
              whether it can run, turn, or stop at all.</p>
          </div>
          <div class="expect-visual" data-panel="floors"></div>
        </div>

        <div class="expect-row expect-row--reverse">
          <div class="expect-text">
            <h2>The scoring</h2>
            <p>Where you finish is what pays: ${PLACEMENT_POINTS[0]} points for first,
              ${PLACEMENT_POINTS[PLACEMENT_POINTS.length - 1]} for last. A kill adds
              ${KILL_POINTS} — enough to reward picking a fight, not quite enough to outrun a
              bad placement. <strong class="expect-highlight">Survive to score, fight to score
              more.</strong> Three battles, one running total, and the total decides the draft
              order.</p>
          </div>
          <div class="expect-visual" data-panel="scoring"></div>
        </div>
      </div>
      <div class="expect-footer">
        <button type="button" class="btn btn-primary btn-large" data-role="continue">Enter the Forge</button>
      </div>
    `;

    const forgeHost = root.querySelector<HTMLElement>('[data-panel="forge"]')!;
    const arenaHost = root.querySelector<HTMLElement>('[data-panel="arena"]')!;
    const floorsHost = root.querySelector<HTMLElement>('[data-panel="floors"]')!;
    const scoringHost = root.querySelector<HTMLElement>('[data-panel="scoring"]')!;

    floorsHost.appendChild(renderFloorKey());
    scoringHost.appendChild(renderPointsTable());

    let unmounted = false;
    let forgeTeardown: (() => void) | null = null;
    let arenaTeardown: (() => void) | null = null;

    void mountForgeLoop(forgeHost).then((teardown) => {
      if (unmounted) teardown();
      else forgeTeardown = teardown;
    });
    void mountArenaLoop(arenaHost).then((teardown) => {
      if (unmounted) teardown();
      else arenaTeardown = teardown;
    });

    const continueButton = root.querySelector<HTMLButtonElement>('[data-role="continue"]')!;
    continueButton.addEventListener('click', () => {
      ctx.navigate(nextBeat('what-to-expect')!);
    });

    ctx.container.appendChild(root);

    return () => {
      unmounted = true;
      forgeTeardown?.();
      arenaTeardown?.();
    };
  },
};
