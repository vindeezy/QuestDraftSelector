/**
 * How a weapon moves, as arithmetic.
 *
 * Pure — no PixiJS, no containers, no time. Each function takes a phase and returns a pose,
 * so the shape of every motion can be asserted instead of squinted at. The renderer's job is
 * only to apply what these return.
 *
 * The whole file exists because of the camera. This is a TOP-DOWN view, and two of the five
 * weapons move mostly along the axis pointing at the viewer, where nothing can be seen
 * directly. A vertical spinner's disc and a hammer's head both do their real work in the one
 * direction the camera cannot resolve, so both have to be projected into what that motion
 * looks like from above rather than animated literally.
 */

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

/**
 * A hammer's pose partway through its crush, from `progress` 0 (just triggered) to 1 (rest).
 *
 * A hammer rises and then smashes down. From directly above, neither of those is a movement
 * across the screen — the head goes up, toward the camera, and comes back down. What a viewer
 * can actually see is the projection of that:
 *
 * - **Reach shortens as it lifts, almost to nothing.** A haft rotating up out of the floor
 *   plane is foreshortened, and a haft standing straight up projects to a POINT. So the arm
 *   does not merely shorten, it very nearly vanishes — and the head, which sits at the end of
 *   it, slides back over the pivot and hides what is left. The arm going away is not a trick
 *   layered on top of the projection; it is what the projection says happens.
 * - **The head grows as it lifts.** It is nearer the camera. This is the cue that actually
 *   sells "up" — foreshortening alone reads as the hammer retracting.
 *
 * Which means the two have to be drawn as separate pieces. Scale them together and
 * foreshortening shrinks the HEAD too, so a hammer rearing up reads as a hammer getting
 * smaller and further away — the exact opposite of the intent.
 * - **Both reverse fast on the way down**, because a crush is not symmetrical: the lift is a
 *   wind-up and the fall is a drop.
 * - **It squashes on landing**, briefly smaller than rest, which is what makes the bottom of
 *   the stroke read as an impact rather than as the end of an animation.
 */
export interface HammerPose {
  /** Scale along the haft. Below 1 is foreshortened — the head drawn back toward the bot. */
  reach: number;
  /** Overall scale. Above 1 is nearer the camera, below 1 is the squash on landing. */
  size: number;
}

/** Fraction of the stroke spent winding up. Longer than the fall: hammers drop faster than
 *  they lift, and matching the two makes the whole thing read as a wobble. */
const LIFT_END = 0.45;

/** Where the head lands. Between `LIFT_END` and here, it is falling. */
const IMPACT = 0.62;

/**
 * How far the arm foreshortens at the top of the lift.
 *
 * `1 - 0.86` leaves an eighth of the arm showing, which is a couple of pixels at arena scale
 * and sits entirely underneath the head. Not 1.0 exactly: a zero scale is a degenerate
 * transform, and there is nothing to gain from one when the remainder is already invisible.
 */
const FORESHORTEN = 0.86;

/** How much bigger the head looks at the top, being nearer the camera. */
const RISE_SCALE = 0.42;

/** How far it squashes on landing. */
const SQUASH = 0.14;

export function hammerPose(progress: number): HammerPose {
  const p = clamp01(progress);

  // Height above the floor, 0 at rest and 1 at the top of the wind-up.
  let lift: number;
  if (p < LIFT_END) {
    // Eases out: fast off the mark, slowing as it reaches the top.
    lift = Math.sin((p / LIFT_END) * (Math.PI / 2));
  } else if (p < IMPACT) {
    // Eases in: the drop accelerates into the blow.
    lift = Math.cos(((p - LIFT_END) / (IMPACT - LIFT_END)) * (Math.PI / 2));
  } else {
    lift = 0;
  }

  // The landing squash, purely on the way out of the impact.
  const settle = p < IMPACT ? 0 : 1 - (p - IMPACT) / (1 - IMPACT);
  const squash = SQUASH * Math.sin(clamp01(settle) * Math.PI);

  return {
    reach: 1 - FORESHORTEN * lift,
    size: 1 + RISE_SCALE * lift - squash,
  };
}

/**
 * Where a hammer is in its stroke, from how many ticks remain until it may strike again.
 *
 * Anticipation rather than reaction, and that distinction is the whole reason this exists.
 * Driving the crush from the hit effect means the head begins to LIFT at the instant the blow
 * lands, so the smash arrives about a sixth of a second after its own sound. The simulation
 * already says when the next blow is due -- `nextAttackTick` -- so the animation can be
 * positioned to land ON it instead of chasing it.
 *
 * It also needs no "is this bot fighting" flag, which is worth more than it sounds. A bot only
 * has a strike pending in the FUTURE just after it landed one; sit idle and `ticksToStrike`
 * goes negative, the stroke completes, and it rests. So a hammer swings once more after its
 * last connected blow and then stops, instead of pumping up and down in an empty corner
 * forever -- which is exactly what a gate would have been written to prevent.
 *
 * The first blow of an engagement is unanticipated and shows no impact, because nothing knew
 * it was coming. It still gets its sparks, its shake and its sound; every blow after it is on
 * time.
 */
export function hammerProgress(ticksToStrike: number, strokeTicks: number): number {
  if (!Number.isFinite(ticksToStrike) || !Number.isFinite(strokeTicks) || strokeTicks <= 0) {
    return 1;
  }
  // Offset so that `IMPACT` -- the frame the head lands -- falls exactly on the strike.
  return clamp01(IMPACT - ticksToStrike / strokeTicks);
}

/**
 * A spinning blade's angle at a given tick.
 *
 * Driven off the simulation's tick rather than wall-clock time, so a replay of the same seed
 * shows the blade at the same angle every time. Wrapped rather than accumulated: a
 * three-minute battle would otherwise reach several thousand radians, where float precision
 * starts to visibly quantise the angle.
 *
 * `radiansPerTick` is deliberately far below a real blade's speed. At anything like true rpm a
 * 60Hz sampler is a stroboscope — the blade reads as stationary, or as turning slowly
 * backwards.
 */
export function spinAngle(tick: number, radiansPerTick: number): number {
  if (!Number.isFinite(tick)) return 0;
  return (tick * radiansPerTick) % (Math.PI * 2);
}

/**
 * A vertical spinner's apparent width at a given tick.
 *
 * Its disc turns about a HORIZONTAL axis, so from above it never rotates — it thins to an edge
 * and swells back to its face twice per revolution. Spinning it in the plane would be the easy
 * thing to do and would read as a completely different machine.
 *
 * Never reaches zero: a disc exactly edge-on for one frame is a weapon that flickers out of
 * existence, and at this size that reads as a rendering fault.
 */
export function edgeScale(tick: number, radiansPerTick: number): number {
  if (!Number.isFinite(tick)) return 1;
  return 0.18 + 0.82 * Math.abs(Math.cos(tick * radiansPerTick));
}
