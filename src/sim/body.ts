import { clampLength } from './vec';

/**
 * A circular physics body.
 *
 * All velocities are in units per tick. There is no delta time — one `integrate()`
 * call is exactly one tick, which removes variable-timestep float noise entirely.
 */
export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 1 / mass. Zero means static (infinite mass). */
  invMass: number;
  /** Bounciness, 0 to 1. */
  restitution: number;
  /**
   * This body's own speed cap, in units per tick. When set, `integrate` clamps to it
   * instead of the `maxSpeed` argument it is called with. Without this, every body in
   * a `World` was flattened to one shared cap — a Hover bot and a Tank Tracks bot would
   * reach identical top speeds. Left undefined for bodies that do not need one of their
   * own (Plinko pegs and balls), which keep falling back to the caller-supplied value
   * exactly as before.
   */
  maxSpeed?: number;
}

export interface BodyInit {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Zero means static. */
  mass: number;
  vx?: number;
  vy?: number;
  restitution?: number;
  maxSpeed?: number;
}

export function createBody(init: BodyInit): Body {
  return {
    id: init.id,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    radius: init.radius,
    invMass: init.mass === 0 ? 0 : 1 / init.mass,
    restitution: init.restitution ?? 0.4,
    maxSpeed: init.maxSpeed,
  };
}

/**
 * Advances a body by one tick using semi-implicit Euler.
 *
 * `drag` provides air resistance — it decays velocity exponentially every tick.
 *
 * `maxSpeed` is a separate hard clamp, and doubles as the tunnelling guard: a body can
 * never travel further in one tick than `maxSpeed`, so as long as that stays below the
 * smallest collision radius in the world, nothing can pass through anything.
 *
 * The order below is load-bearing. Gravity, then drag, then the clamp, then position —
 * so position always advances by the *clamped* velocity. Clamping after moving would
 * reintroduce tunnelling; dragging after clamping would make the clamp the dominant
 * speed control and drag nearly irrelevant.
 *
 * `maxSpeed` is the argument's name but not always the value used: when `body.maxSpeed`
 * is set, it wins. That lets each body carry its own cap (a per-bot drive stat, or a
 * temporarily raised one while launched — see `arena/launch.ts`) while callers that
 * only ever had one shared cap, like the Plinko board, keep working unchanged.
 */
export function integrate(body: Body, gravity: number, maxSpeed: number, drag: number): void {
  if (body.invMass === 0) return;

  body.vy += gravity;
  body.vx *= drag;
  body.vy *= drag;

  const cap = body.maxSpeed ?? maxSpeed;
  const clamped = clampLength(body.vx, body.vy, cap);
  body.vx = clamped.x;
  body.vy = clamped.y;

  body.x += body.vx;
  body.y += body.vy;
}
