import { prefersReducedMotion } from '../../render/reduced-motion';
import {
  createShow,
  finalePalette,
  fireworkColour,
  isBusy,
  launch,
  sparkAlpha,
  step,
  type Show,
} from './fireworks';

/**
 * Draws the fireworks over the draft order.
 *
 * The physics lives in `fireworks.ts`; this owns the canvas, the frame loop, and taking itself
 * back down. Same split as the landing's smoke, for the same reason — it is what lets 23 tests
 * run against the shells and sparks without a canvas anywhere near them.
 */

/**
 * How much of the previous frame is erased each time, 0-1.
 *
 * This is what draws the trails, and it is why the canvas is never cleared. Painting a
 * translucent hole through the whole surface each frame leaves what was drawn before, dimmer —
 * so a spark smears into a streak behind itself rather than being a dot that teleports. At 1.0
 * every frame stands alone and the fireworks look like static.
 *
 * `destination-out` rather than a black fill, because this canvas sits over the board: filling
 * with black would stack up into a sheet that hid the table.
 */
const TRAIL_FADE = 0.17;

/** Device pixel ratio is capped: the whole-canvas fade every frame is the cost that scales. */
const MAX_DPR = 2;

/**
 * Where bursts are allowed to happen, as a fraction of the screen height.
 *
 * Deliberately the top third. The board is opaque and occupies the middle of the screen, and
 * the sparks are behind it — bursting level with the table hides most of the sphere and leaves
 * only stray trails poking out around the edges. Bursting above it puts the flash in open
 * space and lets the sparks rain down behind the board, which is the shape the eye expects
 * anyway.
 */
const BURST_HIGH = 0.09;
const BURST_LOW = 0.32;

/** Shells in the first-pick barrage, and the gap between them. */
export const FINALE_SHELLS = 9;
export const FINALE_STAGGER_MS = 260;

export interface FireworksHandle {
  /** One shell, in this member's colour. Called as each pick is uncovered. */
  celebrate(memberColour: string): void;
  /** The barrage for first pick. */
  finale(winnerColour: string): void;
  /** Stops everything and removes the canvas. Safe to call twice. */
  destroy(): void;
}

/**
 * Mounts the fireworks into `host`, which must be positioned.
 *
 * `seed` is the event seed, so the same draft night produces the same show twice — see
 * `createShow`.
 *
 * Reduced motion gets a working handle that draws nothing. Unlike the landing's smoke, these
 * are pure decoration carrying no information, so honouring the setting means leaving them out
 * rather than holding them still. Every method stays callable so the reveal never has to ask.
 */
export function mountFireworks(host: HTMLElement, seed: number): FireworksHandle {
  if (prefersReducedMotion()) {
    return { celebrate: () => {}, finale: () => {}, destroy: () => {} };
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'draft-fireworks';
  canvas.setAttribute('aria-hidden', 'true');
  // First child: nothing in this screen is z-indexed, so source order is the paint order and
  // the sparks must go behind the board rather than over the names.
  host.prepend(canvas);

  const context = canvas.getContext('2d');
  const show: Show = createShow(seed);

  let frame: number | null = null;
  let last = 0;
  let width = 0;
  let height = 0;
  let destroyed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(seconds: number): void {
    if (!context) return;

    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
    context.fillRect(0, 0, width, height);

    // `lighter` so crossing sparks build up the way real light does. On a burst this is what
    // makes the core read as hot and the edges as embers, from one flat colour.
    context.globalCompositeOperation = 'lighter';

    for (const shell of show.shells) {
      const [r, g, b] = shell.rgb;
      context.fillStyle = `rgb(${r} ${g} ${b} / 0.9)`;
      context.fillRect(shell.x * width - 1.5, shell.y * height - 1.5, 3, 3);
    }

    for (const spark of show.sparks) {
      const alpha = sparkAlpha(spark, seconds);
      if (alpha <= 0.01) continue;
      const [r, g, b] = spark.rgb;
      context.fillStyle = `rgb(${r} ${g} ${b} / ${alpha.toFixed(3)})`;
      // `fillRect`, not `arc`. At up to 1500 sparks a frame the path setup for a circle costs
      // several times what the fill does, and at two pixels nobody can tell them apart.
      context.fillRect(spark.x * width - 1, spark.y * height - 1, 2.2, 2.2);
    }

    context.globalCompositeOperation = 'source-over';
  }

  function tick(now: number): void {
    if (destroyed) return;
    const dt = (now - last) / 1000;
    last = now;

    step(show, dt);
    draw(now / 1000);

    if (isBusy(show)) {
      frame = requestAnimationFrame(tick);
      return;
    }

    // Nothing left in the air. Wipe the last of the trails and stop — an idle screen should
    // not be holding a frame loop open for a sky with nothing in it.
    frame = null;
    context?.clearRect(0, 0, width, height);
  }

  function wake(): void {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame((now) => {
      last = now;
      tick(now);
    });
  }

  function celebrate(memberColour: string): void {
    if (destroyed) return;
    launch(show, {
      fromX: show.rng.range(0.16, 0.84),
      burstY: show.rng.range(BURST_HIGH, BURST_LOW),
      rgb: fireworkColour(memberColour),
    });
    wake();
  }

  function finale(winnerColour: string): void {
    if (destroyed) return;
    const palette = finalePalette(winnerColour);

    for (let i = 0; i < FINALE_SHELLS; i++) {
      // Staggered rather than simultaneous. Nine shells bursting at once is one big flash;
      // nine over two seconds is a finale.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (destroyed) return;
        launch(show, {
          fromX: show.rng.range(0.1, 0.9),
          burstY: show.rng.range(BURST_HIGH, BURST_LOW),
          rgb: palette[i % palette.length] ?? [255, 236, 214],
          spread: show.rng.range(0.4, 0.58),
        });
        wake();
      }, i * FINALE_STAGGER_MS);
      timers.add(timer);
    }
  }

  resize();

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(host);

  return {
    celebrate,
    finale,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      observer?.disconnect();
      canvas.remove();
    },
  };
}
