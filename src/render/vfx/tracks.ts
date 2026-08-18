/**
 * Tyre marks left by a bot that has driven through oil.
 *
 * Pure arithmetic — no PixiJS, no drawing. A mark is a position, a heading and an age, and the
 * only interesting decisions are when to lay one and when to stop.
 *
 * **Spaced by DISTANCE, not by time.** A mark every N ticks would bunch up when a bot is
 * crawling and stretch into dashes when it boosts, so the trail would encode speed rather than
 * path. Every N units of travel puts marks down evenly regardless, which is what tyres do.
 *
 * Which means filling in the GAP between one frame and the next, not just testing it. Laying at
 * most one mark per call looks equivalent and is not: at eight units a tick against a ten-unit
 * spacing, marks land every sixteen units instead of ten, so a bot under Nitro leaves a sparser
 * trail than a crawling one. Exactly backwards, and measured rather than reasoned about — the
 * test that claimed speed-independence failed until the gap was walked.
 *
 * **Bounded, oldest recycled.** The same discipline as the particle pool, for the same reason:
 * ten bots can be oily at once, and an unbounded list would hand the garbage collector work at
 * exactly the busiest moment.
 *
 * **No randomness anywhere.** Everything here is driven off simulation positions and the tick,
 * so a replay of one seed lays identical marks. That is not decoration — the site has a Replay
 * button, and a fight that left different tracks the second time would undermine the claim the
 * whole event rests on.
 */

/** How long a mark lasts, in ticks. Long enough to read as a trail, short enough that a
 *  four-minute battle does not end with the floor uniformly black. */
export const TRACK_LIFE_TICKS = 75;

/** World units between marks. Roughly half a bot's width, so a trail reads as continuous
 *  without laying so many that they merge into a stripe. */
export const TRACK_SPACING = 10;

/**
 * How long a bot keeps marking after it leaves the oil.
 *
 * The entire point of the effect. Marks only ON the slick would say nothing that the slick does
 * not already say; marks LEADING AWAY from it are what show that a bot drove through something
 * and carried it.
 */
export const OIL_CARRY_TICKS = 110;

export interface TrackMark {
  active: boolean;
  x: number;
  y: number;
  /** Radians. The direction the bot was travelling, so the mark lies along its path. */
  heading: number;
  /** Ticks since it was laid. */
  age: number;
}

export interface TrackField {
  /** The whole pool, live and dead. Exposed for the renderer and the tests to walk. */
  readonly marks: readonly TrackMark[];
  /**
   * Lays a mark for `bot` if it has travelled far enough since its last one.
   *
   * Returns whether a mark was actually laid, which is what the tests assert on — the spacing
   * rule is the behaviour worth pinning, not the buffer mechanics.
   */
  lay(bot: number, x: number, y: number, heading: number): boolean;
  /**
   * Forgets where `bot` last marked, WITHOUT removing the marks it already laid.
   *
   * Must be called the moment a bot's wheels are clean, and the reason is the gap filling. A
   * bot that oiled up, dried off, and hit a second slick across the arena had its next mark
   * bridged from wherever it last marked -- drawing a line along a path it may never have
   * driven, so marks appeared BEHIND it before it ever reached the oil. Gap filling is right
   * within one continuous run and wrong across two.
   */
  forget(bot: number): void;
  /** Ages every mark by one tick and retires the expired ones. */
  advance(): void;
  /** Forgets everything, including where each bot last marked. */
  clear(): void;
}

export interface TrackFieldOptions {
  capacity?: number;
  spacing?: number;
  life?: number;
}

/**
 * How many marks may exist at once.
 *
 * A bot at combat speed lays roughly one every three ticks, so it carries about 25 live marks
 * across their lifetime. Four oily bots at once is the realistic busy case; 160 covers that with
 * room, and the pool degrades by dropping the oldest rather than by refusing to draw.
 */
export const TRACK_CAPACITY = 160;

/**
 * How many marks one call may lay while filling a gap.
 *
 * A bound rather than a limit anybody should reach: at the game's top speed of 4.5 units a tick,
 * or 8.1 under Nitro, a bot covers less than one ten-unit spacing per frame, so this never
 * binds. It exists so that a teleport -- a respawn, a shockwave launch, a future arena that
 * moves a bot bodily -- cannot ask this loop to stripe a line across the whole arena.
 */
export const MAX_MARKS_PER_CALL = 8;

export function createTrackField(options: TrackFieldOptions = {}): TrackField {
  const capacity = Math.max(1, Math.floor(options.capacity ?? TRACK_CAPACITY));
  const spacing = options.spacing ?? TRACK_SPACING;
  const life = options.life ?? TRACK_LIFE_TICKS;

  const marks: TrackMark[] = Array.from({ length: capacity }, () => ({
    active: false,
    x: 0,
    y: 0,
    heading: 0,
    age: 0,
  }));

  /** Where each bot last laid a mark. Absent until its first. */
  const lastAt = new Map<number, { x: number; y: number }>();
  let cursor = 0;

  /** A free slot, or the oldest live one when there are none. */
  function claim(): TrackMark {
    for (let i = 0; i < capacity; i++) {
      const candidate = marks[(cursor + i) % capacity]!;
      if (!candidate.active) {
        cursor = (cursor + i + 1) % capacity;
        return candidate;
      }
    }
    let oldest = marks[0]!;
    for (const candidate of marks) if (candidate.age > oldest.age) oldest = candidate;
    return oldest;
  }

  return {
    marks,

    lay(bot, x, y, heading) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(heading)) return false;

      const place = (mx: number, my: number, mh: number): void => {
        const mark = claim();
        mark.active = true;
        mark.x = mx;
        mark.y = my;
        mark.heading = mh;
        mark.age = 0;
      };

      const previous = lastAt.get(bot);
      if (previous === undefined) {
        lastAt.set(bot, { x, y });
        place(x, y, heading);
        return true;
      }

      const dx = x - previous.x;
      const dy = y - previous.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < spacing) return false;

      // Along the direction actually TRAVELLED, not the direction the bot is facing. A bot
      // sliding across ice is pointing one way and moving another, and the marks belong under
      // the wheels.
      const travel = Math.atan2(dy, dx);
      const steps = Math.min(MAX_MARKS_PER_CALL, Math.floor(distance / spacing));
      for (let i = 1; i <= steps; i++) {
        const t = (i * spacing) / distance;
        place(previous.x + dx * t, previous.y + dy * t, travel);
      }

      // Anchored on the LAST mark rather than the bot, so spacing stays exact instead of
      // drifting by whatever fraction of a step was left over.
      const used = (steps * spacing) / distance;
      lastAt.set(bot, { x: previous.x + dx * used, y: previous.y + dy * used });
      return true;
    },

    forget(bot) {
      lastAt.delete(bot);
    },

    advance() {
      for (const mark of marks) {
        if (!mark.active) continue;
        mark.age += 1;
        if (mark.age >= life) mark.active = false;
      }
    },

    clear() {
      for (const mark of marks) mark.active = false;
      lastAt.clear();
    },
  };
}

/**
 * How dark a mark is at `age`, 0-1.
 *
 * Holds near full for the first half of its life and then fades, rather than fading from the
 * moment it is laid. Oil on a floor does not start disappearing immediately — it sits, and then
 * it is driven over and smeared away. A linear fade from full makes every trail look like it is
 * already vanishing, which reads as a rendering artefact rather than as a mark.
 */
export function trackAlpha(age: number, life = TRACK_LIFE_TICKS): number {
  if (!Number.isFinite(age) || age < 0 || life <= 0) return 0;
  const t = age / life;
  if (t >= 1) return 0;
  if (t <= 0.5) return 1;
  return 1 - (t - 0.5) / 0.5;
}
