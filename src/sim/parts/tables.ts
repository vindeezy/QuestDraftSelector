import type { BotStats } from '../arena/bot';
import type { PersonalityName } from '../arena/personality';

/**
 * The six category tables, as data.
 *
 * Pure data, on purpose: no part has behaviour of its own. `assemble()` (Task 5) folds
 * six slot indices into one `BotStats`; everything the choices actually change lives in
 * the engine already. Tuning a value later is a one-line edit here, not a rewrite.
 *
 * Every number below is copied exactly from
 * `docs/superpowers/specs/2026-08-05-bot-categories-design.md`, sections 4-9. Where that
 * spec gives a value in a different unit (weapon arc is degrees; here it is angle
 * steps), the conversion is noted at the call site.
 */

export const CATEGORIES = ['chassis', 'drive', 'weapon', 'armour', 'ability', 'personality'] as const;
export type CategoryName = (typeof CATEGORIES)[number];

/**
 * The seven abilities. Behaviour lives in `arena/ability.ts` (Task 6, not yet built);
 * this table only needs to know the names exist so ability parts can carry one.
 */
export type AbilityName =
  | 'emp'
  | 'nitro'
  | 'oilSlick'
  | 'shockwave'
  | 'repair'
  | 'adrenaline'
  | 'smokeScreen';

export interface Part {
  id: string;
  label: string;
  category: CategoryName;
  /** Absolute stat overrides. Applied first, in `assemble()`. */
  set?: Partial<BotStats>;
  /** Additive modifiers. Applied after every `set`. */
  add?: Partial<BotStats>;
  /** Multiplicative modifiers. Applied last. */
  scale?: Partial<BotStats>;
  /** Ability parts carry a name instead of stats. */
  ability?: AbilityName;
  /** Personality parts carry a name instead of stats. */
  personality?: PersonalityName;
}

/**
 * Degrees to angle steps, where 4096 steps is a full circle: 4096 / 360 = 512 / 45,
 * about 11.378 steps per degree. Spec §6 gives every weapon arc in degrees; the values
 * below are that conversion, rounded to the nearest whole step.
 *
 *   22° -> 11264 / 45 = 250.31 -> 250
 *   18° ->  9216 / 45 = 204.80 -> 205
 *   45° -> 23040 / 45 = 512.00 -> 512
 *   61° -> 31232 / 45 = 694.04 -> 694
 *   79° -> 40448 / 45 = 898.84 -> 899
 *   70° -> 35840 / 45 = 796.44 -> 796
 */

// --- Category 1: Chassis Shape. Spec §4. ---------------------------------------------
//
// NOTE: Circle (slot 3) is specified as "+restitution, -15% mass" but the spec gives no
// numeric value for the restitution change anywhere in the document. Rather than invent
// one, Circle's `add`/`scale` here covers only the mass change; restitution is left at
// the chassis default. Flagged for the project owner — see the implementation report.
const CHASSIS: readonly Part[] = [
  {
    id: 'chassis-wedge',
    label: 'Wedge',
    category: 'chassis',
    set: { frontVulnerability: 0.4, sideVulnerability: 1.4, rearVulnerability: 2.2 },
    add: { maxHealth: -10 },
  },
  {
    id: 'chassis-diamond',
    label: 'Diamond',
    category: 'chassis',
    set: { frontVulnerability: 0.75, sideVulnerability: 1.7, rearVulnerability: 1.0 },
    add: { turnRate: 8 },
  },
  {
    id: 'chassis-square',
    label: 'Square',
    category: 'chassis',
    set: { frontVulnerability: 0.75, sideVulnerability: 1.2, rearVulnerability: 1.7 },
  },
  {
    id: 'chassis-circle',
    label: 'Circle',
    category: 'chassis',
    set: { frontVulnerability: 1.15, sideVulnerability: 1.15, rearVulnerability: 1.15 },
    scale: { mass: 0.85 },
  },
  {
    id: 'chassis-box',
    label: 'Box',
    category: 'chassis',
    set: { frontVulnerability: 0.7, sideVulnerability: 1.25, rearVulnerability: 1.8 },
    add: { maxHealth: 15, turnRate: -8 },
    scale: { mass: 1.2 },
  },
  {
    id: 'chassis-tower',
    label: 'Tower',
    category: 'chassis',
    set: { frontVulnerability: 0.7, sideVulnerability: 1.5, rearVulnerability: 1.9 },
    add: { maxHealth: -20, turnRate: 12 },
    scale: { radius: 0.75, mass: 0.75 },
  },
];

// --- Category 2: Drive System. Spec §5. ----------------------------------------------
const DRIVE: readonly Part[] = [
  {
    id: 'drive-omni-wheels',
    label: 'Omni Wheels',
    category: 'drive',
    set: { maxSpeed: 4.2, thrust: 0.3, grip: 0.55 },
    add: { turnRate: 25 },
  },
  {
    id: 'drive-tank-tracks',
    label: 'Tank Tracks',
    category: 'drive',
    set: { maxSpeed: 3.8, thrust: 0.45, grip: 0.6 },
    add: { turnRate: -10 },
  },
  {
    id: 'drive-4-wheels',
    label: '4 Wheels',
    category: 'drive',
    set: { maxSpeed: 4.5, thrust: 0.35, grip: 0.25 },
    add: { turnRate: 0 },
  },
  {
    id: 'drive-6-wheels',
    label: '6 Wheels',
    category: 'drive',
    set: { maxSpeed: 4.3, thrust: 0.38, grip: 0.35 },
    add: { turnRate: -5 },
  },
  {
    id: 'drive-2-wheels',
    label: '2 Wheels',
    category: 'drive',
    set: { maxSpeed: 5.2, thrust: 0.32, grip: 0.12 },
    add: { turnRate: 8 },
  },
  {
    id: 'drive-hover',
    label: 'Hover',
    category: 'drive',
    set: { maxSpeed: 5.6, thrust: 0.28, grip: 0.04 },
    add: { turnRate: 5 },
  },
];

// --- Category 3: Front Weapon. Spec §6. Arc values converted from degrees, see above. -
const WEAPON: readonly Part[] = [
  {
    id: 'weapon-vertical-spinner',
    label: 'Vertical Spinner',
    category: 'weapon',
    set: { weaponArc: 250, weaponDamage: 2.2, attackCooldown: 50, weaponKnockback: 4.0 },
  },
  {
    id: 'weapon-hammer',
    label: 'Hammer',
    category: 'weapon',
    set: { weaponArc: 205, weaponDamage: 2.6, attackCooldown: 75, weaponKnockback: 2.2 },
  },
  {
    id: 'weapon-saw-blade',
    label: 'Saw Blade',
    category: 'weapon',
    set: { weaponArc: 512, weaponDamage: 1.0, attackCooldown: 30, weaponKnockback: 0.5 },
  },
  {
    id: 'weapon-spinning-bar',
    label: 'Spinning Bar',
    category: 'weapon',
    set: { weaponArc: 694, weaponDamage: 1.15, attackCooldown: 34, weaponKnockback: 1.4 },
  },
  {
    id: 'weapon-ram-plate',
    label: 'Ram Plate',
    category: 'weapon',
    set: { weaponArc: 899, weaponDamage: 0.6, attackCooldown: 16, weaponKnockback: 2.0 },
  },
  {
    id: 'weapon-flamethrower',
    label: 'Flamethrower',
    category: 'weapon',
    set: { weaponArc: 796, weaponDamage: 0.35, attackCooldown: 8, weaponKnockback: 0 },
  },
];

// --- Category 4: Armour Material. Spec §7. --------------------------------------------
const ARMOUR: readonly Part[] = [
  {
    id: 'armour-depleted-uranium',
    label: 'Depleted Uranium',
    category: 'armour',
    set: { armour: 1.6, damageReflect: 0 },
    add: { maxHealth: 25, maxSpeed: -0.7, turnRate: -10 },
    scale: { mass: 1.55 },
  },
  {
    id: 'armour-carbon-fibre',
    label: 'Carbon Fibre',
    category: 'armour',
    set: { armour: 0.85, damageReflect: 0 },
    add: { maxHealth: -15, maxSpeed: 0.5, turnRate: 8 },
    scale: { mass: 0.7 },
  },
  {
    id: 'armour-alloy',
    label: 'Alloy',
    category: 'armour',
    set: { armour: 1.15, damageReflect: 0 },
    add: { maxHealth: 5, maxSpeed: -0.1, turnRate: 0 },
    scale: { mass: 1.08 },
  },
  {
    id: 'armour-aluminium',
    label: 'Aluminium',
    category: 'armour',
    set: { armour: 1.0, damageReflect: 0 },
    add: { maxHealth: 0, maxSpeed: 0, turnRate: 0 },
    scale: { mass: 1.0 },
  },
  {
    id: 'armour-titanium',
    label: 'Titanium',
    category: 'armour',
    set: { armour: 1.3, damageReflect: 0 },
    add: { maxHealth: -20, maxSpeed: 0.25, turnRate: 4 },
    scale: { mass: 0.85 },
  },
  {
    id: 'armour-hardened-steel',
    label: 'Hardened Steel',
    category: 'armour',
    set: { armour: 1.35, damageReflect: 0 },
    add: { maxHealth: 15, maxSpeed: -0.35, turnRate: -5 },
    scale: { mass: 1.25 },
  },
  {
    id: 'armour-spiked-composite',
    label: 'Spiked Composite',
    category: 'armour',
    set: { armour: 1.1, damageReflect: 0.35 },
    add: { maxHealth: 0, maxSpeed: -0.15, turnRate: 0 },
    scale: { mass: 1.1 },
  },
];

// --- Category 5: Special Ability. Spec §8. --------------------------------------------
const ABILITY: readonly Part[] = [
  { id: 'ability-emp', label: 'EMP Pulse', category: 'ability', ability: 'emp' },
  { id: 'ability-nitro', label: 'Nitro Boost', category: 'ability', ability: 'nitro' },
  { id: 'ability-oil-slick', label: 'Oil Slick', category: 'ability', ability: 'oilSlick' },
  { id: 'ability-shockwave', label: 'Shockwave', category: 'ability', ability: 'shockwave' },
  { id: 'ability-repair', label: 'Repair System', category: 'ability', ability: 'repair' },
  { id: 'ability-adrenaline', label: 'Adrenaline', category: 'ability', ability: 'adrenaline' },
  { id: 'ability-smoke-screen', label: 'Smoke Screen', category: 'ability', ability: 'smokeScreen' },
];

// --- Category 6: Driver Personality. Spec §9. Already-built personalities, in the same -
// --- order as `PERSONALITY_NAMES`. ----------------------------------------------------
const PERSONALITY: readonly Part[] = [
  { id: 'personality-aggressive', label: 'Aggressive', category: 'personality', personality: 'aggressive' },
  { id: 'personality-defensive', label: 'Defensive', category: 'personality', personality: 'defensive' },
  { id: 'personality-hit-and-run', label: 'Hit-and-Run', category: 'personality', personality: 'hitAndRun' },
  { id: 'personality-third-party', label: 'Third Party Predator', category: 'personality', personality: 'thirdParty' },
  { id: 'personality-chaos', label: 'Agent of Chaos', category: 'personality', personality: 'chaos' },
  { id: 'personality-showman', label: 'Showman', category: 'personality', personality: 'showman' },
  { id: 'personality-instigator', label: 'Instigator', category: 'personality', personality: 'instigator' },
];

const TABLE: Record<CategoryName, readonly Part[]> = {
  chassis: CHASSIS,
  drive: DRIVE,
  weapon: WEAPON,
  armour: ARMOUR,
  ability: ABILITY,
  personality: PERSONALITY,
};

export function partsFor(category: CategoryName): readonly Part[] {
  return TABLE[category];
}

export function slotCountFor(category: CategoryName): number {
  return TABLE[category].length;
}

/** Out-of-range slots clamp to the nearest valid one rather than returning undefined. */
export function partAt(category: CategoryName, slot: number): Part {
  const parts = TABLE[category];
  const clamped = slot < 0 ? 0 : slot > parts.length - 1 ? parts.length - 1 : slot;
  return parts[clamped]!;
}
