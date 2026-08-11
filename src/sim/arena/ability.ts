import { cosOf, sinOf } from '../trig';
import { partsFor, type AbilityName } from '../parts/tables';
import type { Bot } from './bot';
import { launch } from './launch';
import { setSurface, Surface } from './surface';
import { tileIndexAt } from './tiles';
import type { Match } from './match';
import { pushEffect } from './effects';

/**
 * The ability framework.
 *
 * Every 15% of max health lost, a bot's ability fires — six activations across a full
 * life, for every build, regardless of health pool. Fixed cooldowns would have handed a
 * durable bot more uses than a fragile one for surviving longer; normalising on health
 * lost instead removes that advantage for free.
 *
 * `emp`, `nitro`, `oilSlick`, `shockwave` and `smokeScreen` are TRIGGERED: they fire once
 * per threshold crossed. `repair` and `adrenaline` are CONDITIONAL: they are evaluated
 * every tick against the bot's current state rather than ever consuming a threshold.
 */

/** The seven ability names, in table order. Derived from the parts table rather than
 *  duplicated here, so there is exactly one place that lists them. */
export const ABILITY_NAMES: readonly AbilityName[] = partsFor('ability').map((p) => {
  if (!p.ability) throw new Error(`ability part ${p.id} carries no ability name`);
  return p.ability;
});

const TRIGGERED: ReadonlySet<AbilityName> = new Set([
  'emp',
  'nitro',
  'oilSlick',
  'shockwave',
  'smokeScreen',
]);

/** Fraction of max health lost between activations. */
const TRIGGER_FRACTION = 0.15;
/** Six activations across a full life — see the module doc comment. */
const MAX_TRIGGERS = 6;

/** EMP: how long a stunned bot loses control for. 2s at 60 ticks/second. */
const STUN_TICKS = 120;
/**
 * EMP: how far the pulse reaches. Not given a number in the spec (§8 only specifies the
 * stun duration); this is a first-draft value, roughly 3.7 tiles at the default 60-unit
 * tile size, flagged for the project owner same as the Circle chassis restitution gap.
 */
const EMP_RANGE = 220;

/** Nitro: top-speed multiplier while active. */
const NITRO_MULTIPLIER = 1.8;
/** Nitro: how long the boost lasts. 1.5s. */
const NITRO_TICKS = 90;

/**
 * Oil Slick: how far behind the bot the ice patch is dropped. Not given a number in the
 * spec; one tile length is a reasonable first draft, flagged for the project owner.
 */
const OIL_SLICK_DISTANCE = 60;

/**
 * Shockwave: reach and launch force. Neither is given a number in the spec beyond "no
 * damage" and "omnidirectional" — these first-draft values are flagged for the project
 * owner. The force is comparable to a Vertical Spinner's knockback (4.0, the highest in
 * the weapon table) since this is a whole ability slot rather than a per-hit effect.
 */
const SHOCKWAVE_RANGE = 240;
const SHOCKWAVE_FORCE = 3.5;

/**
 * Repair: only heals once this many ticks have passed since the bot last took damage. 4s.
 *
 * Raised from 3s along with the rate cut below. The delay is the more interesting of the
 * two levers: it prices the act of *breaking off*, not the healing itself, so a bot that
 * stays in a fight is untouched by it and only one that runs away pays.
 */
const REPAIR_DELAY_TICKS = 240;
/**
 * Repair: heal per tick, as a fraction of max health. Set by measurement, not by the
 * spec, and now twice.
 *
 * The first-draft 0.0015 (9 HP/sec) had Repair winning 26.6% against a fair value of 10%.
 * Cutting it to 1 HP/sec barely helped — 27.3% — because match length had roughly doubled
 * by then, so a slower trickle ran for twice as long. Now 0.5 HP/sec (0.0000833).
 *
 * Repair and the Hit-and-Run personality were the two largest outliers in the game and
 * they are the same problem wearing two hats: both pay a bot for disengaging. That is
 * also why adding points for eliminations did not dent either — a bot can strike, break
 * off, heal, and still collect the kill credit.
 *
 * Kept as a fraction of max health rather than a flat number so it stays build-neutral: a
 * 134-EHP tank and a 98-EHP sprinter heal the same proportion of their pool per second.
 */
const REPAIR_HEAL_FRACTION = 0.0000833;

/** Adrenaline: health fraction below which it activates. Exported so the metrics
 *  harness's on/off A/B (`tools/arena-metrics.ts`) can detect a "comeback" without
 *  duplicating the number. */
export const ADRENALINE_THRESHOLD = 0.3;
/** Adrenaline: weapon damage multiplier while active. */
const ADRENALINE_DAMAGE_MULT = 1.5;
/** Adrenaline: top speed multiplier while active. */
const ADRENALINE_SPEED_MULT = 1.2;

/** Smoke Screen: how long a bot is hidden from other bots' target selection. 2s. */
const SMOKE_TICKS = 120;

export interface AbilityState {
  name: AbilityName;
  /** Lowest health reached so far. The ratchet: healing never raises this back up, so a
   *  bot that heals and is hurt again cannot re-fire a threshold it already spent. */
  floor: number;
  /** How many thresholds have fired. Capped at `MAX_TRIGGERS`. */
  fired: number;
  /** Ability-specific expiry tick (Nitro's boost window, mirrored by `bot.stunnedUntil`
   *  / `bot.untargetableUntil` for EMP and Smoke Screen, which live on the bot itself
   *  because other systems — combat, the AI, perception — need to read them too). */
  activeUntil: number;
  /** Tick this bot most recently took damage. Drives Repair's cooldown. */
  lastDamageTick: number;
  /**
   * Health as of the previous tick's `updateAbility` call. Not part of the plan's
   * original shape, but needed to detect "this bot took damage this tick" for
   * `lastDamageTick`: damage can arrive from combat, a zone, or a projectile, and
   * comparing consecutive snapshots here is the one place that catches all three
   * without hooking every damage source individually. Healing only ever raises this,
   * so it never registers as a damage event.
   */
  prevHealth: number;
  /**
   * This bot's weaponDamage and maxSpeed as built, captured once at creation. Also not
   * part of the plan's original shape. Adrenaline and Nitro both scale off these bases
   * rather than off the live value, so re-applying an active effect tick after tick
   * multiplies the same base every time instead of compounding on its own output.
   */
  baseWeaponDamage: number;
  baseMaxSpeed: number;
}

export function createAbilityState(name: AbilityName, bot: Bot): AbilityState {
  return {
    name,
    floor: bot.health,
    fired: 0,
    activeUntil: 0,
    lastDamageTick: -1,
    prevHealth: bot.health,
    baseWeaponDamage: bot.weaponDamage,
    baseMaxSpeed: bot.maxSpeed,
  };
}

/** How many thresholds SHOULD have fired by now, given the ratcheted floor. Capped. */
function thresholdsCrossed(floor: number, maxHealth: number): number {
  if (maxHealth <= 0) return 0;
  const lost = maxHealth - floor;
  if (lost <= 0) return 0;
  const count = Math.floor(lost / (maxHealth * TRIGGER_FRACTION));
  return count > MAX_TRIGGERS ? MAX_TRIGGERS : count;
}

/** Other living bots within `range` of `self`. */
function nearbyBots(match: Match, self: Bot, range: number): Bot[] {
  const found: Bot[] = [];
  for (const other of match.bots) {
    if (other === self || !other.alive) continue;
    const dx = other.body.x - self.body.x;
    const dy = other.body.y - self.body.y;
    if (dx * dx + dy * dy <= range * range) found.push(other);
  }
  return found;
}

/** Fires one activation of a triggered ability. Called once per threshold crossed. */
function fireTrigger(match: Match, bot: Bot, state: AbilityState, tick: number): void {
  // abilityFire: 1.0 always, one per activation — same "fire on the trigger, not every
  // tick it's live" shape as `cannonFire`. Pushed once here rather than in every branch
  // below, so a ninth ability added later cannot forget to wire it.
  pushEffect(match.effects, 'abilityFire', bot.body.x, bot.body.y, 1, bot.body.id);

  switch (state.name) {
    case 'emp':
      for (const other of nearbyBots(match, bot, EMP_RANGE)) {
        other.stunnedUntil = tick + STUN_TICKS;
      }
      return;
    case 'nitro':
      state.activeUntil = tick + NITRO_TICKS;
      return;
    case 'oilSlick': {
      const x = bot.body.x - cosOf(bot.heading) * OIL_SLICK_DISTANCE;
      const y = bot.body.y - sinOf(bot.heading) * OIL_SLICK_DISTANCE;
      const index = tileIndexAt(match.arena.grid, x, y);
      if (index >= 0) setSurface(match.arena.surfaces, index, Surface.Ice);
      return;
    }
    case 'shockwave':
      for (const other of nearbyBots(match, bot, SHOCKWAVE_RANGE)) {
        launch(other, other.body.x - bot.body.x, other.body.y - bot.body.y, SHOCKWAVE_FORCE, tick);
      }
      return;
    case 'smokeScreen':
      bot.untargetableUntil = tick + SMOKE_TICKS;
      return;
    default:
      // repair, adrenaline: conditional, never triggered.
      return;
  }
}

/** Runs the per-tick continuous logic for Nitro's decay, Repair and Adrenaline. */
function applyConditional(bot: Bot, state: AbilityState, tick: number): void {
  switch (state.name) {
    case 'nitro': {
      const active = tick < state.activeUntil;
      bot.maxSpeed = active ? state.baseMaxSpeed * NITRO_MULTIPLIER : state.baseMaxSpeed;
      return;
    }
    case 'repair': {
      if (tick - state.lastDamageTick > REPAIR_DELAY_TICKS && bot.health < bot.maxHealth) {
        bot.health += bot.maxHealth * REPAIR_HEAL_FRACTION;
        if (bot.health > bot.maxHealth) bot.health = bot.maxHealth;
      }
      return;
    }
    case 'adrenaline': {
      const active = bot.health < bot.maxHealth * ADRENALINE_THRESHOLD;
      bot.weaponDamage = active ? state.baseWeaponDamage * ADRENALINE_DAMAGE_MULT : state.baseWeaponDamage;
      bot.maxSpeed = active ? state.baseMaxSpeed * ADRENALINE_SPEED_MULT : state.baseMaxSpeed;
      return;
    }
    default:
      return;
  }
}

/**
 * Advances one bot's ability by one tick.
 *
 * Call once per living bot per tick, after damage has been resolved and before the next
 * tick's AI runs, so a bot that just crossed a threshold acts on it immediately.
 */
export function updateAbility(match: Match, bot: Bot, state: AbilityState): void {
  const tick = match.world.tick;

  // The ratchet: only ever moves down. Healing (Repair, or anything else) can raise
  // `bot.health` freely without ever pumping a spent threshold back up.
  if (bot.health < state.floor) state.floor = bot.health;

  // A drop since the last time we looked is a damage event, whatever caused it — combat,
  // a zone, or a projectile. Repair's own healing only ever raises health, so it can
  // never be mistaken for one.
  if (bot.health < state.prevHealth) state.lastDamageTick = tick;
  state.prevHealth = bot.health;

  if (!bot.alive) return;

  applyConditional(bot, state, tick);

  if (!TRIGGERED.has(state.name)) return;

  const target = thresholdsCrossed(state.floor, bot.maxHealth);
  while (state.fired < target) {
    state.fired++;
    fireTrigger(match, bot, state, tick);
  }
}
