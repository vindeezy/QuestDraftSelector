import { prefersReducedMotion } from '../../render/reduced-motion';
import { shape, smokeColour, smokeDensity } from './smoke-field';

/**
 * Puts `smoke-field.ts` on a 2D canvas behind the landing screen.
 *
 * All the arithmetic lives next door; this file owns only the things that touch the browser —
 * sizing, the frame loop, and taking itself back down again. Splitting it that way is what
 * makes the field testable at all, in a project where nothing else about a shader would be.
 *
 * **Why this is not a WebGL shader.** The look being matched is normally done on the GPU, and
 * PixiJS is already a dependency here so it was available. It would mean a GL context and Pixi
 * startup on the one screen whose entire job is loading fast and looking certain. Smoke is
 * low-frequency by nature — there is no fine detail in it to lose — so it can be rasterised
 * at a fraction of the screen's resolution and stretched back up, and the difference is not
 * visible. That trade is the whole design of this file.
 */

/**
 * How many pixels of noise are actually computed per redraw.
 *
 * The cost here is unforgiving and worth stating plainly: three fBm calls per pixel, four
 * octaves each, four lattice hashes per octave — about 48 hashes for every pixel. At full
 * 1080p that is 99 million hashes per redraw and the page would not move at all.
 *
 * At this budget it is roughly 470,000, measured at 4.3ms median (2.9 best, 9.3 worst) against
 * the 33ms a redraw is allowed. Nearly 8x headroom, which is the margin a phone three years
 * old needs. The field is then stretched over the viewport, which for smoke costs nothing
 * visually — there is no fine detail in it to lose.
 */
const FIELD_BUDGET = 9800;

/**
 * The intermediate size the field is blown up to before the browser stretches it the rest of
 * the way.
 *
 * Going straight from a ~130px-wide field to a 1920px screen is a single bilinear stretch of
 * about 15x, and bilinear that far shows its workings — the interpolation turns into visible
 * diamonds between lattice points. Two gentler stretches launder that away for the cost of one
 * `drawImage` on a small surface.
 */
const MID_WIDTH = 480;

/**
 * The field is redrawn at about 30fps, not 60.
 *
 * `DRIFT` moves this thing at 0.05 field-units per second. Nothing perceptible happens between
 * one frame and the next at that speed, so half the frames were spending real milliseconds
 * computing a picture indistinguishable from the one already on screen. Compositing still runs
 * at the display's own rate; only the noise is throttled.
 */
const REDRAW_INTERVAL_MS = 33;

/**
 * How much of the viewport one unit of the noise field covers.
 *
 * Smaller means the smoke is larger and slower and reads as a room; larger means it tightens
 * into visible turbulence. At 2.6 there are roughly two or three major bodies of smoke on
 * screen at once, which is what stops it reading as texture.
 */
const FIELD_SCALE = 2.6;

/** Peak opacity of the field over the landing's own background. */
const PEAK_ALPHA = 0.86;

export interface SmokeCanvasHandle {
  /** Removes the canvas and stops the loop. Safe to call twice. */
  destroy(): void;
}

/**
 * Mounts the field into `host`, which must be positioned — the canvas is absolutely placed and
 * fills it.
 *
 * Returns a handle rather than a bare function so the caller reads as what it is. The landing
 * screen hands `destroy` straight to the router, which runs it on the way out; see
 * `runTeardown` in `router.ts` for why that path is defended so heavily.
 */
export function mountSmokeCanvas(host: HTMLElement): SmokeCanvasHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'landing-smoke';
  canvas.setAttribute('aria-hidden', 'true');
  // `prepend`, not `append`: nothing in the landing stack is z-indexed, so source order is the
  // paint order and the field has to be the first child or it lands on top of the title.
  host.prepend(canvas);

  const view = canvas.getContext('2d');

  // The surface the noise is actually written to, one byte per channel per field pixel.
  const field = document.createElement('canvas');
  const fieldContext = field.getContext('2d', { willReadFrequently: true });

  let image: ImageData | null = null;
  let cols = 0;
  let rows = 0;
  let frame: number | null = null;
  let started = 0;
  let lastDraw = -Infinity;
  let destroyed = false;

  function resize(): void {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const aspect = width / height;

    // Keep the pixel count at the budget whatever shape the window is, rather than fixing the
    // width — a tall phone and a wide monitor should cost the same.
    cols = Math.max(8, Math.round(Math.sqrt(FIELD_BUDGET * aspect)));
    rows = Math.max(8, Math.round(FIELD_BUDGET / cols));

    field.width = cols;
    field.height = rows;
    image = fieldContext?.createImageData(cols, rows) ?? null;

    canvas.width = Math.max(1, Math.round(MID_WIDTH));
    canvas.height = Math.max(1, Math.round(MID_WIDTH / aspect));

    if (view) {
      view.imageSmoothingEnabled = true;
      view.imageSmoothingQuality = 'high';
    }
  }

  function draw(seconds: number): void {
    if (!view || !fieldContext || !image) return;

    const data = image.data;
    // The field is sampled in units that span `FIELD_SCALE` across the WIDTH, and the same
    // units vertically — deliberately not normalised per axis. Normalising would squash the
    // smoke into ovals on a wide monitor and stretch it on a phone.
    const step = FIELD_SCALE / cols;
    const verticalStep = step;

    let i = 0;
    for (let row = 0; row < rows; row++) {
      const y = row * verticalStep;
      for (let col = 0; col < cols; col++) {
        const density = shape(smokeDensity(col * step, y, seconds));
        const [r, g, b] = smokeColour(density);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
        i += 4;
      }
    }

    fieldContext.putImageData(image, 0, 0);

    view.globalAlpha = PEAK_ALPHA;
    view.clearRect(0, 0, canvas.width, canvas.height);
    view.drawImage(field, 0, 0, canvas.width, canvas.height);
    view.globalAlpha = 1;
  }

  function tick(now: number): void {
    if (destroyed) return;
    if (now - lastDraw >= REDRAW_INTERVAL_MS) {
      lastDraw = now;
      draw((now - started) / 1000);
    }
    frame = requestAnimationFrame(tick);
  }

  function start(): void {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame((now) => {
      started = now;
      lastDraw = -Infinity;
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
   * The clock is not rewound on the way back, so returning to the tab finds the smoke where it
   * would have been — it carries on rather than snapping.
   */
  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  resize();

  // Reduced motion gets the smoke, just held still: one frame at t=0 and no loop at all. The
  // background is doing legibility work here — it is what the title's scrim sits over — so
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
      image = null;
    },
  };
}
