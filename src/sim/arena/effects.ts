/**
 * The effect bus: the simulation's way of saying "something worth reacting to just
 * happened", for the renderer and the audio layer to read.
 *
 * Four rules, all load-bearing:
 *
 * 1. Derived, never causal. Nothing in `src/sim/` may ever READ `match.effects` to make
 *    a decision — every emit site below is a plain push alongside behaviour that already
 *    existed, never a new input to it.
 * 2. Never checksummed. `runMatch`'s checksum is built from bot physical state only
 *    (see `match.ts`); it never touches `effects`. Adding an effect kind must not move
 *    `src/sim/event/event.test.ts`'s pinned `'2bcb9b13'`.
 * 3. Cleared at the START of each tick (`advanceMatch`, before anything else runs), so a
 *    tick's list describes only that tick.
 * 4. Deterministic: every value pushed here is a pure function of simulation state
 *    already computed for other reasons. No `Math.random`, no `Date`, no `**`, no
 *    transcendental math, no DOM.
 */

export type EffectKind =
  | 'weaponHit'
  | 'hazardHit'
  | 'collision'
  | 'elimination'
  | 'trapdoor'
  | 'cannonFire'
  | 'abilityFire';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  /** 0-1. Normalised per kind — see the reference constants and comments below. */
  intensity: number;
  /** The bot this is about, where there is one. */
  botId: string | null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Pushes one effect. A thin wrapper so every emit site builds the object the same way,
 *  rather than six slightly different object literals drifting apart over time. */
export function pushEffect(
  effects: Effect[],
  kind: EffectKind,
  x: number,
  y: number,
  intensity: number,
  botId: string | null,
): void {
  effects.push({ kind, x, y, intensity, botId });
}

// --- weaponHit --------------------------------------------------------------------------
//
// 1.0 = roughly a Warhammer-class weapon (weaponDamage 2.6, the highest in the weapon
// table — see src/sim/parts/tables.ts) landing dead-on (alignment 1) at a solid ~4
// units/tick closing speed against front armour: about 10 damage in one hit.
//
// Checked against real matches (eight seeded matches, 10,760 landed hits sampled via
// each bot's damageDealt delta): median landed-hit damage is ~0.15 (fast light weapons —
// Saw Blade-style spinners — chipping constantly), p90 ~1.9, p99 ~8.4, max observed
// ~20.4 (a heavy weapon catching a bot's soft rear armour, which clamps to 1.0 here).
// That the median sits so low is correct, not a bug: a glancing spinner tick and a
// Hammer landing flush are supposed to sound and look nothing alike.
export const WEAPON_HIT_REFERENCE_DAMAGE = 10;

export function weaponHitIntensity(damageDealt: number): number {
  return clamp01(damageDealt / WEAPON_HIT_REFERENCE_DAMAGE);
}

// --- hazardHit --------------------------------------------------------------------------
//
// 1.0 = a direct Cannon hit (18 damage), the hardest single hazard blow on the table
// (see src/sim/arena/hazards.ts) — Laser deals 9. Zone damage-per-tick tops out far
// lower (Crusher's 1.4/tick is the heaviest, most zones are 0.35-0.55/tick): a zone is a
// continuous grind applied every tick a bot stands in it, not one blast, so its
// per-tick effects correctly read as a steady patter of low-intensity hits rather than
// one loud one — that is the right feel for standing in a saw blade versus eating a
// cannon shot, and it is shared by both hazard sites (`zone.ts` and `projectile.ts`) on
// purpose, so a consumer never has to know which site produced a given `hazardHit`.
export const HAZARD_HIT_REFERENCE_DAMAGE = 18;

export function hazardHitIntensity(damageDealt: number): number {
  return clamp01(damageDealt / HAZARD_HIT_REFERENCE_DAMAGE);
}

// --- collision ----------------------------------------------------------------------------
//
// Every bot pair in contact generates a `Contact` (see `world.ts`) every tick they
// touch, most of which are two bots resting or jostling against each other rather than
// anything worth a sound or a screen shake. Sampled bot-vs-bot contact speeds across
// eight real matches (251,346 contacts, `contact.b !== 'segment'`): median 0.27
// units/tick, p90 0.65, p95 0.98, p99 3.11, max 10.47.
//
// COLLISION_MIN_SPEED keeps only the top ~3% of contacts (>=1.5) — the ones that
// actually read as an impact rather than background jostle. COLLISION_REFERENCE_SPEED
// (10) sits just under the real-match maximum observed, so 1.0 intensity means "about as
// hard as bots in this game are ever actually seen to hit each other."
export const COLLISION_MIN_SPEED = 1.5;
export const COLLISION_REFERENCE_SPEED = 10;

export function collisionIntensity(speed: number): number {
  return clamp01(speed / COLLISION_REFERENCE_SPEED);
}
