import { createRng, type Rng } from '../../sim/rng';

/**
 * The fireworks over the draft order: shells launched, rising, bursting into sparks that fall.
 *
 * Pure arithmetic — no canvas, no DOM. This owns what is in the air and where it is going;
 * `fireworks-canvas.ts` owns drawing it.
 *
 * **Everything is in normalised coordinates.** `x` and `y` run 0-1 across the viewport, `y = 0`
 * at the top, and every velocity is per second in those same units. Nothing here knows the
 * screen size, which is what lets the physics be tested without a canvas and keeps a burst
 * looking the same shape on a phone as on a monitor.
 *
 * **Seeded, like everything else.** Draft night has ten people watching the same screen and a
 * Replay button. Fireworks that differed between two viewings would be the one thing on the
 * page nobody could account for — and more practically, a bug in a burst would be impossible
 * to reproduce. `createRng` is the same generator the simulation itself runs on.
 */

/** Downward acceleration, in screen-heights per second squared. */
export const GRAVITY = 0.62;

/** Air resistance on sparks. Shells are heavy and ignore it. */
export const DRAG = 1.5;

/**
 * Sparks per burst. Enough to read as a sphere rather than a handful of dots.
 *
 * Started at 78 and looked stringy — with trails this long, too few sparks reads as a bundle of
 * loose threads rather than as one thing that exploded. The count is what fixes that; shortening
 * the trails would have fixed it too, and made the fireworks worse.
 */
export const SPARKS_PER_BURST = 112;

/** How long a spark lives, in seconds, before and after the random spread. */
export const SPARK_LIFE_MIN = 1.1;
export const SPARK_LIFE_MAX = 1.9;

/**
 * Hard ceiling on sparks in flight.
 *
 * The finale fires several shells at once and every one of them is drawn every frame. This is
 * not a memory concern — it is a frame-rate one, and a celebration that stutters is worse than
 * a smaller celebration.
 */
export const MAX_SPARKS = 1500;

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived so far. */
  age: number;
  /** Seconds it gets. */
  life: number;
  rgb: readonly [number, number, number];
  /** Sparks that flicker as they die, rather than fading smoothly. Roughly a third of them. */
  glitter: boolean;
}

export interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rgb: readonly [number, number, number];
  /** How wide the burst throws its sparks, in screen-heights per second. */
  spread: number;
}

export interface Show {
  shells: Shell[];
  sparks: Spark[];
  rng: Rng;
}

export function createShow(seed: number): Show {
  return { shells: [], sparks: [], rng: createRng(seed) };
}

/**
 * Sends up a shell from `fromX` that will burst at about `burstY`.
 *
 * The launch velocity is solved from the target rather than guessed, so a burst lands where it
 * was asked to regardless of gravity being retuned later. The shell starts just off the bottom
 * of the screen, which is why the number it climbs from is greater than 1.
 */
export function launch(
  show: Show,
  options: { fromX: number; burstY: number; rgb: readonly [number, number, number]; spread?: number },
): void {
  const startY = 1.08;
  const rise = Math.max(0.05, startY - options.burstY);

  show.shells.push({
    x: options.fromX,
    y: startY,
    // A little sideways drift so a barrage does not go up as a set of parallel rails.
    vx: show.rng.range(-0.05, 0.05),
    vy: -Math.sqrt(2 * GRAVITY * rise),
    rgb: options.rgb,
    spread: options.spread ?? 0.42,
  });
}

/**
 * Bursts a shell into sparks.
 *
 * The speed is `sqrt` of a uniform random rather than uniform, which is the difference between
 * a hollow ring and a filled sphere. Picking speed uniformly puts equal numbers of sparks in
 * every speed band, but the area a band covers grows with its radius, so the middle ends up
 * sparse and the burst reads as an expanding hoop.
 */
function burst(show: Show, shell: Shell): void {
  for (let i = 0; i < SPARKS_PER_BURST; i++) {
    if (show.sparks.length >= MAX_SPARKS) return;

    const angle = show.rng.range(0, Math.PI * 2);
    const speed = shell.spread * Math.sqrt(show.rng.next());

    show.sparks.push({
      x: shell.x,
      y: shell.y,
      // The shell's own momentum is inherited, so a burst leans the way it was travelling
      // instead of being a perfectly still sphere pasted onto a moving object.
      vx: shell.vx + Math.cos(angle) * speed,
      vy: shell.vy + Math.sin(angle) * speed,
      age: 0,
      life: show.rng.range(SPARK_LIFE_MIN, SPARK_LIFE_MAX),
      rgb: shell.rgb,
      glitter: show.rng.next() < 0.32,
    });
  }
}

/**
 * Advances everything by `seconds`.
 *
 * `dt` is clamped rather than trusted. A backgrounded tab hands back a delta of whole seconds
 * on return, and integrating that in one step would teleport every spark far below the screen
 * and empty the sky in a single frame.
 */
export function step(show: Show, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const dt = Math.min(seconds, 1 / 30);

  for (let i = show.shells.length - 1; i >= 0; i--) {
    const shell = show.shells[i];
    if (!shell) continue;

    shell.vy += GRAVITY * dt;
    shell.x += shell.vx * dt;
    shell.y += shell.vy * dt;

    // Apex. A shell bursts when it stops climbing, which is what puts the flash at the top of
    // the arc where the eye has followed it to.
    if (shell.vy >= 0) {
      burst(show, shell);
      show.shells.splice(i, 1);
    }
  }

  for (let i = show.sparks.length - 1; i >= 0; i--) {
    const spark = show.sparks[i];
    if (!spark) continue;

    spark.age += dt;
    if (spark.age >= spark.life) {
      show.sparks.splice(i, 1);
      continue;
    }

    spark.vy += GRAVITY * dt;
    // Implicit drag: dividing rather than multiplying by `(1 - DRAG * dt)` can never send a
    // spark backwards, which the explicit form does as soon as `DRAG * dt` exceeds 1.
    const damping = 1 / (1 + DRAG * dt);
    spark.vx *= damping;
    spark.vy *= damping;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
  }
}

/** Whether anything is still in the air. */
export function isBusy(show: Show): boolean {
  return show.shells.length > 0 || show.sparks.length > 0;
}

/**
 * A member's colour, lifted to something that can actually burn in the sky.
 *
 * Each pick's burst goes up in that member's own colour, so the fireworks are about the draft
 * rather than being generic celebration. Two roster colours cannot survive that untouched:
 * Tommy's warm charcoal `#3A352E` and Nick Lenker's muted steel `#647793` were both chosen to
 * sit against an arena floor, and a firework painted in either is a smudge nobody sees.
 *
 * The lift is a scale to full channel range, not a lightening toward white. Scaling multiplies
 * all three channels equally, which leaves the ratios between them — and therefore the hue —
 * exactly where they were. Tommy's charcoal comes out a warm white and Nick Lenker's steel a
 * cold one, which is what those colours ARE at firework brightness, and both are colours real
 * fireworks come in. Blending toward white instead would have desaturated everyone.
 */
export function fireworkColour(hex: string): readonly [number, number, number] {
  const parsed = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  // A warm white, so an unparseable colour still produces a firework rather than nothing.
  if (!parsed?.[1]) return [255, 236, 214];

  const value = parseInt(parsed[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  const brightest = Math.max(r, g, b);
  if (brightest === 0) return [255, 236, 214];

  const gain = 255 / brightest;
  return [Math.round(r * gain), Math.round(g * gain), Math.round(b * gain)];
}

/**
 * The colours the finale goes up in: the member who drafts first, plus the gold and white that
 * every firework display in history has finished on.
 *
 * Their colour leads and recurs, so the barrage still says who won rather than becoming an
 * anonymous fountain of sparks.
 */
export function finalePalette(winnerColour: string): ReadonlyArray<readonly [number, number, number]> {
  const winner = fireworkColour(winnerColour);
  return [winner, [255, 214, 122], winner, [255, 246, 232], [255, 178, 74], winner];
}

/**
 * How bright a spark is right now, 0-1.
 *
 * Held near full for the first stretch and dropped away after, rather than fading linearly from
 * the moment it appears — a real spark burns at roughly constant brightness and then goes out.
 * `glitter` sparks flicker on the way down instead, which is what reads as the crackle at the
 * end of a burst.
 */
export function sparkAlpha(spark: Spark, seconds: number): number {
  const t = spark.life <= 0 ? 1 : spark.age / spark.life;
  if (t >= 1) return 0;

  const base = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
  if (!spark.glitter) return base;

  // Deterministic flicker: driven by the clock and the spark's own life, so it needs no
  // per-spark state and no further calls into the generator.
  const flicker = 0.55 + 0.45 * Math.sin(seconds * 41 + spark.life * 90);
  return base * flicker;
}
