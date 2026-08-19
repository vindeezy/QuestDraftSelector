/**
 * The last elimination of a battle, given the weight it already has.
 *
 * Pure arithmetic — no PixiJS, no match, no DOM. Given how far playback has got and when the
 * final blow lands, this decides how fast the simulation should run and where the camera
 * should be. Something else does the advancing and the drawing.
 *
 * **Why it can anticipate at all.** Reacting to the killing blow is too late: by the time the
 * effect arrives the bot is already gone, and slowing down afterwards is a slow-motion replay
 * of an empty floor. The tick of every elimination is recorded in the battle result, and the
 * event is deterministic, so the exact tick of the last one is known before playback starts.
 * The camera can therefore begin moving BEFORE the blow, and the viewer watches it land.
 *
 * **The simulation is never touched.** Slow motion here means the playback loop advances fewer
 * ticks per rendered frame — the same physics, the same order, the same result, just handed
 * out more slowly. Rendering continues at full rate throughout, so the camera move stays
 * smooth while the fight crawls. Nothing in `src/sim/` knows this exists, and a recorded event
 * replays identically with it on or off.
 *
 * **Reduced motion keeps the pacing and drops the travel.** Slowing down is a rhythm choice
 * and reads as emphasis; a camera push is spatial movement and is exactly what a
 * motion-sensitive viewer asked not to have. So `camera` collapses to a fixed identity while
 * `speed` is left alone.
 */

/** How long before the blow the sequence begins, in simulation ticks. 75 is 1.25s at 60Hz —
 *  long enough to register as deliberate, short enough that it cannot start before the
 *  previous exchange has finished. */
export const LEAD_TICKS = 75;

/** How slowly the simulation runs at the moment of the blow, as a fraction of normal. */
export const SLOWEST = 0.18;

/** How far the camera pushes in. Past about 1.8 the arena's edges enter frame on a wide
 *  window and the bot stops being surrounded by anything. */
export const CLOSEST = 1.6;

/** Real milliseconds to hold on the kill once the match is over, before letting go. */
export const HOLD_MS = 900;

/** Real milliseconds to ease back out to the whole arena. The result is read from the full
 *  board, so the shot has to give it back. */
export const RELEASE_MS = 800;

export interface CameraShot {
  /** World-space point the view is centred on. */
  x: number;
  y: number;
  scale: number;
}

/** Ease-in-out. The push starts and ends gently; a linear zoom reads as a mechanism. */
function ease(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How far into the run-up playback is, 0 before it starts and 1 at the blow.
 *
 * Clamps rather than extrapolating, so a tick past the blow (which happens — the loop may
 * overshoot by a tick at speed) holds at full intensity instead of pushing past it.
 */
export function leadProgress(tick: number, finalTick: number, lead = LEAD_TICKS): number {
  if (!Number.isFinite(tick) || !Number.isFinite(finalTick) || lead <= 0) return 0;
  return clamp01((tick - (finalTick - lead)) / lead);
}

/**
 * Ticks of simulation to run this frame, as a fraction of normal.
 *
 * Never reaches zero. A frozen simulation during the run-up would stop the fight dead before
 * the blow rather than slowing it, and the blow would then never arrive.
 */
export function playbackSpeed(tick: number, finalTick: number, lead = LEAD_TICKS): number {
  const p = ease(leadProgress(tick, finalTick, lead));
  return 1 + (SLOWEST - 1) * p;
}

/**
 * Where the camera should be, given the run-up and the point of interest.
 *
 * `focus` is the doomed bot; `centre` is the middle of the arena. The view slides from one to
 * the other as it pushes in, so the move is a single gesture rather than a cut followed by a
 * zoom.
 */
export function cameraShot(
  tick: number,
  finalTick: number,
  focus: { x: number; y: number },
  centre: { x: number; y: number },
  lead = LEAD_TICKS,
): CameraShot {
  const p = ease(leadProgress(tick, finalTick, lead));
  return {
    x: centre.x + (focus.x - centre.x) * p,
    y: centre.y + (focus.y - centre.y) * p,
    scale: 1 + (CLOSEST - 1) * p,
  };
}

/**
 * The outro, once the match is over: hold, then give the arena back.
 *
 * Wall-clock rather than ticks, because the simulation has stopped by now and there is no
 * tick left to count. Returns how much of the push-in still applies, 1 while holding and
 * falling to 0 as it releases.
 */
export function releaseWeight(msSinceDone: number): number {
  if (!Number.isFinite(msSinceDone) || msSinceDone <= HOLD_MS) return 1;
  const t = (msSinceDone - HOLD_MS) / RELEASE_MS;
  return 1 - ease(t);
}

/** Whether the outro has finished and the screen may move on. */
export function releaseDone(msSinceDone: number): boolean {
  return Number.isFinite(msSinceDone) && msSinceDone >= HOLD_MS + RELEASE_MS;
}

/**
 * Blends a shot back toward the plain view by `weight`.
 *
 * Used by the outro so the release runs through the same camera path as the push-in, rather
 * than being a second animation with its own feel.
 */
export function easeOutShot(shot: CameraShot, centre: { x: number; y: number }, weight: number): CameraShot {
  const w = clamp01(weight);
  return {
    x: centre.x + (shot.x - centre.x) * w,
    y: centre.y + (shot.y - centre.y) * w,
    scale: 1 + (shot.scale - 1) * w,
  };
}
