import type { Effect, EffectKind } from '../../sim/arena/effects';

/**
 * How much the fight lights the room around it.
 *
 * Pure arithmetic. Turns a frame's effects into two numbers the PAGE can react to, so the
 * venue outside the arena responds to what happens inside it — a flamethrower warms the walls,
 * an elimination throws red across them.
 *
 * **Two numbers, not a colour.** `glow` is how much just happened and `heat` is what kind:
 * 0 is ember, 1 is the red of an elimination. Keeping it to two scalars means the shell can
 * decide what "warm" looks like in CSS without this module knowing anything about the page,
 * and it means the whole feature crosses the boundary as two custom properties.
 *
 * **Restraint is the design.** The standing rule in `vfx/index.ts` is that if effects hide
 * bots, effects lose — and this one lights the area AROUND the arena, where there is nothing
 * to hide, precisely so it can be felt without competing. The ceilings below are low on
 * purpose: at full strength this is a warm suggestion at the edges of vision, not a strobe.
 * Ten people are watching to find their own machine.
 *
 * **Deterministic.** No randomness, no clock — glow decays against the frame's own delta, so
 * a replay of one seed lights the room identically.
 */

/** Ceiling on `glow`. Chosen low: the page is not the arena, and the brightest the room ever
 *  gets should still be dimmer than the thing being lit. */
export const GLOW_CEILING = 0.55;

/** How long a pulse takes to fall away, in seconds. Short — this is a flash on the walls, and
 *  anything that lingers becomes a mood rather than a reaction to a hit. */
export const GLOW_DECAY_SECONDS = 0.42;

/**
 * What each kind of event does to the room.
 *
 * An elimination is the only event that meaningfully changes the COLOUR, because it is the
 * only one that means something ended. Everything else is ember: the room is lit by fire and
 * sparks, and fire is orange.
 *
 * `collision` is deliberately absent. Bots collide roughly eight hundred times a battle, and
 * a room that pulsed on every one of them would be a room with a fault in the wiring.
 */
const CONTRIBUTION: Partial<Record<EffectKind, { glow: number; heat: number }>> = {
  elimination: { glow: 1, heat: 1 },
  hazardHit: { glow: 0.34, heat: 0.15 },
  weaponHit: { glow: 0.22, heat: 0 },
  cannonFire: { glow: 0.26, heat: 0.1 },
  abilityFire: { glow: 0.2, heat: 0 },
};

export interface Atmosphere {
  /** 0-1. How lit the room is by what just happened. */
  glow: number;
  /** 0-1. Ember at 0, elimination red at 1. */
  heat: number;
}

export const CALM: Atmosphere = { glow: 0, heat: 0 };

/**
 * Folds one frame's effects into the room's current state.
 *
 * The strongest event of the frame wins rather than accumulating, matching how `shake` is
 * decided in `arena-renderer.ts` and for the same reason: three eliminations at once is a
 * bigger moment, not three times the light.
 */
export function absorb(current: Atmosphere, effects: readonly Effect[]): Atmosphere {
  let { glow, heat } = current;

  for (const effect of effects) {
    const contribution = CONTRIBUTION[effect.kind];
    if (contribution === undefined) continue;
    const strength = clamp01(effect.intensity) * contribution.glow;
    if (strength > glow) {
      glow = strength;
      heat = contribution.heat;
    }
  }

  return { glow: Math.min(glow, GLOW_CEILING), heat: clamp01(heat) };
}

/**
 * Fades the room back toward dark.
 *
 * `heat` is held rather than decayed: a fading elimination should stay red as it goes out,
 * not cool through orange on its way down, which would read as a second event.
 */
export function fade(current: Atmosphere, seconds: number): Atmosphere {
  if (!Number.isFinite(seconds) || seconds <= 0) return current;
  const glow = Math.max(0, current.glow - seconds / GLOW_DECAY_SECONDS);
  return { glow, heat: glow === 0 ? 0 : current.heat };
}

/**
 * How dark the room goes as a battle empties out.
 *
 * The brief asks for the final combatants to feel more intense, and the honest way to do that
 * is to take light away rather than add it: the venue closes in as the floor empties. Full
 * room at the start, dimmest with two left. Returns a multiplier for the page's own ambient
 * light, never for the arena's.
 */
export function closingIn(living: number, started: number): number {
  if (!Number.isFinite(living) || !Number.isFinite(started) || started <= 2) return 1;
  const remaining = Math.max(0, Math.min(started, living) - 2);
  const span = Math.max(1, started - 2);
  return 0.55 + 0.45 * (remaining / span);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
