import type { Bot } from './bot';

/**
 * The launched state.
 *
 * `integrate()` clamps a body's velocity to its speed cap every tick, so a knockback
 * impulse on its own is flattened back to normal on the very next tick — a 4.0
 * knockback on a 4.5-speed bot would read as a nudge, not a throw. This module lets a
 * hit briefly raise a bot's own cap so knockback can actually move it, then fades that
 * raised cap back to normal over about a second rather than cutting it off abruptly.
 */

/** Ticks a launch lasts. At 60 ticks per second, this is about one second. */
export const LAUNCH_TICKS = 60;

/**
 * Multiplicative decay applied to the raised cap every tick it is active. Values close
 * to 1 hold the boost longer; this fades the excess to a small fraction of its starting
 * value well before `LAUNCH_TICKS` elapses, so the hard reset at `launchUntil` reads as
 * the tail of a fade rather than a snap.
 */
const LAUNCH_DECAY = 0.85;

/**
 * Throws a bot: adds an impulse along the given direction and briefly raises its speed
 * cap so that impulse is not immediately clamped away.
 *
 * A bot already flying is not launched twice as far — relaunching takes the higher of
 * the current and new caps rather than stacking them, and refreshes the duration.
 */
export function launch(bot: Bot, dirX: number, dirY: number, force: number, tick: number): void {
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq === 0 || force <= 0) return;

  const inv = 1 / Math.sqrt(lenSq);
  bot.body.vx += dirX * inv * force;
  bot.body.vy += dirY * inv * force;

  const cap = bot.maxSpeed + force;
  if (cap > bot.launchSpeed) bot.launchSpeed = cap;
  bot.launchUntil = tick + LAUNCH_TICKS;
}

/**
 * Advances a bot's launched state by one tick.
 *
 * While `tick < launchUntil`, holds `body.maxSpeed` at the current (decaying)
 * `launchSpeed` for `integrate` to clamp to, then decays `launchSpeed` a step further
 * toward normal for next time. Once the window closes, snaps both back to `maxSpeed`
 * exactly, so a bot never lingers arbitrarily close to its old cap forever.
 *
 * Call once per bot per tick, before `step(world)` runs, so the cap is already in place
 * for that tick's integration.
 */
export function updateLaunch(bot: Bot, tick: number): void {
  if (tick < bot.launchUntil) {
    bot.body.maxSpeed = bot.launchSpeed;
    bot.launchSpeed = bot.maxSpeed + (bot.launchSpeed - bot.maxSpeed) * LAUNCH_DECAY;
  } else {
    bot.launchSpeed = bot.maxSpeed;
    bot.body.maxSpeed = bot.maxSpeed;
  }
}
