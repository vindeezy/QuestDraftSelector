import { prefersReducedMotion } from '../../render/reduced-motion';
import {
  WAVE_LINES,
  WAVE_SAMPLES,
  lineAlpha,
  lineBase,
  waveOffset,
} from './wave-field';

/**
 * Puts `wave-field.ts` on a 2D canvas behind the landing screen.
 *
 * All the arithmetic lives next door; this file owns only the things that touch the browser —
 * sizing, the frame loop, and taking itself back down again. Splitting it that way is what
 * makes the field testable at all: `wave-field.test.ts` runs 14 assertions against the maths
 * without ever needing a canvas.
 */

/** Warm core. The ember the whole site is lit by. */
const WARM: [number, number, number] = [255, 106, 31];

/**
 * Cool edge. `--accent`, the steel already used for the arena lighting.
 *
 * Two hues rather than one because a lamp over a room IS two hues — hot at the filament,
 * cold at the throw. They never mix into mud here, because the warm lines are the middle
 * band and the cool ones are the extremes, and `lineAlpha` has faded both to nothing by the
 * time they would meet.
 */
const COOL: [number, number, number] = [157, 195, 222];

/**
 * Peak opacity of the brightest line.
 *
 * This is the stroke's alpha, NOT the field's — `lighter` means crossings add. The first
 * attempt used the same 0.22 with far more lines and reached 0.71 under the tagline, which is
 * how the contrast problem got in. `WAVE_LINES` now keeps the crossings apart well enough that
 * the measured peak under the type is 0.22 exactly: one line, never a pile.
 *
 * Going brighter is the obvious temptation and the wrong one — this is a room the title sits
 * in, not a thing to look at.
 */
const PEAK_ALPHA = 0.22;

/** Device pixel ratio is capped: past 2 the extra pixels are invisible and the fill cost is not. */
const MAX_DPR = 2;

export interface WaveCanvasHandle {
  /** Removes the canvas and stops the loop. Safe to call twice. */
  destroy(): void;
}

/**
 * Mounts the field into `host`, which must be positioned — the canvas is absolutely placed
 * and fills it.
 *
 * Returns a handle rather than a bare function so the caller reads as what it is at the call
 * site. The landing screen hands `destroy` straight to the router, which runs it on the way
 * out; see `runTeardown` in `router.ts` for why that path is defended so heavily.
 */
export function mountWaveCanvas(host: HTMLElement): WaveCanvasHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'landing-waves';
  canvas.setAttribute('aria-hidden', 'true');
  // `prepend`, not `append`: nothing here is z-indexed, so source order is the paint order and
  // the field has to be the first child or it lands on top of the title.
  host.prepend(canvas);

  const context = canvas.getContext('2d');

  let frame: number | null = null;
  let started = 0;
  let destroyed = false;
  let width = 0;
  let height = 0;

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

    context.clearRect(0, 0, width, height);
    context.lineWidth = 1;
    // `lighter` so overlapping lines build up where the field bunches, the way stacked light
    // does. With `source-over` the crossings read as flat paint and the whole thing goes dead.
    context.globalCompositeOperation = 'lighter';

    for (let line = 0; line < WAVE_LINES; line++) {
      const weight = lineAlpha(line);
      if (weight <= 0.004) continue;

      const base = lineBase(line) * height;
      context.beginPath();
      for (let sample = 0; sample <= WAVE_SAMPLES; sample++) {
        const x = sample / WAVE_SAMPLES;
        const y = base + waveOffset(x, line, seconds) * height;
        if (sample === 0) context.moveTo(0, y);
        else context.lineTo(x * width, y);
      }
      context.strokeStyle = strokeFor(weight);
      context.stroke();
    }

    context.globalCompositeOperation = 'source-over';
  }

  /** Warm through the middle, cooling outward, dimming to nothing at both ends. */
  function strokeFor(weight: number): string {
    const r = Math.round(COOL[0] + (WARM[0] - COOL[0]) * weight);
    const g = Math.round(COOL[1] + (WARM[1] - COOL[1]) * weight);
    const b = Math.round(COOL[2] + (WARM[2] - COOL[2]) * weight);
    return `rgb(${r} ${g} ${b} / ${(weight * PEAK_ALPHA).toFixed(4)})`;
  }

  function tick(now: number): void {
    if (destroyed) return;
    draw((now - started) / 1000);
    frame = requestAnimationFrame(tick);
  }

  function start(): void {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame((now) => {
      started = now;
      tick(now);
    });
  }

  function stop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  /**
   * A landing screen left open in a background tab should not be burning a core.
   *
   * The clock is not rewound on the way back, so returning to the tab finds the field where
   * it would have been — it carries on rather than snapping.
   */
  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  resize();

  // Reduced motion gets the field, just held still: one frame at t=0 and no loop at all. The
  // background is doing legibility work here (it is what the title's scrim sits over), so
  // removing it entirely would leave that viewer with a different screen, not a calmer one.
  if (prefersReducedMotion()) {
    draw(0);
  } else {
    start();
    document.addEventListener('visibilitychange', onVisibility);
  }

  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          resize();
          // Redraw immediately when held still; the loop covers the animated case on its own.
          if (frame === null) draw(0);
        })
      : null;
  observer?.observe(host);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
    },
  };
}
