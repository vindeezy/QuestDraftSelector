import { DEFAULT_BOT, type BotStats } from '../arena/bot';
import type { PersonalityName } from '../arena/personality';
import { CATEGORIES, partAt, type AbilityName, type CategoryName, type Part } from './tables';

/** Six slot indices, one per category, chosen by the six Plinko boards. */
export interface BotBuild {
  chassis: number;
  drive: number;
  weapon: number;
  armour: number;
  ability: number;
  personality: number;
}

export interface AssembledBot {
  stats: BotStats;
  ability: AbilityName;
  personality: PersonalityName;
  partLabels: Record<CategoryName, string>;
}

/** The stat keys that `set`, `add` and `scale` may touch. Used to iterate a `Partial<BotStats>`. */
const STAT_KEYS = [
  'radius',
  'mass',
  'maxSpeed',
  'thrust',
  'turnRate',
  'grip',
  'maxHealth',
  'armour',
  'restitution',
  'weaponArc',
  'weaponDamage',
  'weaponKnockback',
  'attackCooldown',
  'frontVulnerability',
  'sideVulnerability',
  'rearVulnerability',
  'damageReflect',
] as const satisfies readonly (keyof BotStats)[];

/**
 * Six slot indices -> one `BotStats`.
 *
 * Order of application is fixed and matters: every part's `set` first, then every part's
 * `add`, then every part's `scale` — never per-part in sequence. Applying one part's `add`
 * before another part's `set`, or interleaving `scale` with `add`, would make the same six
 * tables produce a different bot depending on which category happened to be evaluated
 * first. Fixing the order is what makes assembly deterministic and explicable.
 */
export function assemble(build: BotBuild): AssembledBot {
  const parts: Record<CategoryName, Part> = {
    chassis: partAt('chassis', build.chassis),
    drive: partAt('drive', build.drive),
    weapon: partAt('weapon', build.weapon),
    armour: partAt('armour', build.armour),
    ability: partAt('ability', build.ability),
    personality: partAt('personality', build.personality),
  };

  const stats: BotStats = { ...DEFAULT_BOT };

  for (const category of CATEGORIES) {
    const set = parts[category].set;
    if (!set) continue;
    for (const key of STAT_KEYS) {
      const value = set[key];
      if (value !== undefined) stats[key] = value;
    }
  }

  for (const category of CATEGORIES) {
    const add = parts[category].add;
    if (!add) continue;
    for (const key of STAT_KEYS) {
      const value = add[key];
      if (value !== undefined) stats[key] += value;
    }
  }

  for (const category of CATEGORIES) {
    const scale = parts[category].scale;
    if (!scale) continue;
    for (const key of STAT_KEYS) {
      const value = scale[key];
      if (value !== undefined) stats[key] *= value;
    }
  }

  clampStats(stats);

  const partLabels: Record<CategoryName, string> = {
    chassis: parts.chassis.label,
    drive: parts.drive.label,
    weapon: parts.weapon.label,
    armour: parts.armour.label,
    ability: parts.ability.label,
    personality: parts.personality.label,
  };

  const ability = parts.ability.ability;
  const personality = parts.personality.personality;
  if (!ability) throw new Error(`ability part ${parts.ability.id} carries no ability name`);
  if (!personality) throw new Error(`personality part ${parts.personality.id} carries no personality name`);

  return { stats, ability, personality, partLabels };
}

/**
 * Clamps assembled stats so no build can break the engine.
 *
 * `maxSpeed` must stay strictly below `radius`: a body travelling further in one tick
 * than the smallest thing it can collide with passes straight through it. `maxHealth`,
 * `mass`, `armour` and `grip` must stay above zero, and `radius` must stay above zero so
 * the speed clamp itself has something positive to work against. `attackCooldown` must be
 * at least 1 — zero would mean damage on every tick of contact.
 */
function clampStats(stats: BotStats): void {
  if (stats.radius <= 0) stats.radius = 1;
  if (stats.mass <= 0) stats.mass = 0.01;
  if (stats.maxHealth <= 0) stats.maxHealth = 1;
  if (stats.armour <= 0) stats.armour = 0.01;
  if (stats.grip <= 0) stats.grip = 0.01;
  if (stats.attackCooldown < 1) stats.attackCooldown = 1;

  const speedCap = stats.radius * 0.95;
  if (stats.maxSpeed >= stats.radius) {
    stats.maxSpeed = speedCap < 0.01 ? 0.01 : speedCap;
  }
}
