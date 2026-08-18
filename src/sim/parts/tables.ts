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
  /**
   * Player-facing description, shown alongside the label when a league member sees their
   * bot for the first time. One or two sentences, under ~120 characters, naming the trade
   * the part makes rather than restating the stats already on screen.
   */
  blurb: string;
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
    blurb: "Nearly untouchable head-on. Turn your back and you're paper.",
    set: { frontVulnerability: 0.4, sideVulnerability: 1.4, rearVulnerability: 2.2 },
    add: { maxHealth: -10 },
  },
  {
    id: 'chassis-diamond',
    label: 'Diamond',
    category: 'chassis',
    blurb: "Strong facing forward or backward. Turn side-on and it's the softest spot in the game.",
    set: { frontVulnerability: 0.75, sideVulnerability: 1.7, rearVulnerability: 1.0 },
    add: { turnRate: 8 },
  },
  {
    id: 'chassis-square',
    label: 'Square',
    category: 'chassis',
    blurb: 'No bonus, no penalty — the plain shape every other chassis gets measured against.',
    set: { frontVulnerability: 0.75, sideVulnerability: 1.2, rearVulnerability: 1.7 },
  },
  {
    id: 'chassis-circle',
    label: 'Circle',
    category: 'chassis',
    blurb: 'The only chassis with no weak side, and the easiest one to send flying when hit.',
    // Restitution 0.55 against a 0.3 baseline. A circle has no flat face to absorb an
    // impact, so it is thrown much further by every hit, saw and air blaster. That plus
    // the low mass is the price of uniform armour: averaged across all angles a circle
    // is better protected than a square, so without a cost it would be strictly better.
    set: {
      frontVulnerability: 1.15,
      sideVulnerability: 1.15,
      rearVulnerability: 1.15,
      restitution: 0.55,
    },
    scale: { mass: 0.85 },
  },
  {
    id: 'chassis-box',
    label: 'Box',
    category: 'chassis',
    blurb: 'The most health and the most mass of any chassis — heavy enough that turning costs you.',
    set: { frontVulnerability: 0.7, sideVulnerability: 1.25, rearVulnerability: 1.8 },
    // +15 -> +10 health. Box drafted at 4.12 against a fair 5.5, the best part in the game.
    // Its +20% mass is untouched — that is its real identity, and shoving is not what made
    // it dominant.
    add: { maxHealth: 10, turnRate: -8 },
    scale: { mass: 1.2 },
  },
  {
    id: 'chassis-tower',
    label: 'Tower',
    category: 'chassis',
    blurb: "The smallest target on the floor and the fastest to turn — just don't expect it to take a hit.",
    set: { frontVulnerability: 0.7, sideVulnerability: 1.5, rearVulnerability: 1.9 },
    // -20 -> -6 health. Tower drafted at 7.02, the worst part in the game, because its
    // premise does not survive the arena it now fights in: "survives by not being hit"
    // assumes a lot of misses, and combat is 91% of deaths in The Grinder. Being small and
    // light stopped paying once the floor stopped killing people.
    //
    // Chassis durability is health divided by mean vulnerability, and Box over Tower was
    // 92 to 58.5 — a 1.57:1 ratio, which the measured 3.53 exponent turns into a ~4.9:1
    // advantage. This and the Box change together bring that to 1.28:1.
    add: { maxHealth: -6, turnRate: 12 },
    scale: { radius: 0.75, mass: 0.75 },
  },
];

// --- Category 2: Drive System. Spec §5. ----------------------------------------------
//
// SPEED COMPRESSED, 2026-08-10, from a 3.8-5.6 band (1.47:1) to 4.6-5.5 (1.20:1).
//
// The table's premise was that speed and agility are genuinely opposed, so a drive buys
// top speed with grip and turn rate. Two measurements say that trade was never real:
//
//   Grinder    Hover 24.4%   Tank Tracks 5.0%   Omni Wheels 3.7%   (fair value 10%)
//   Gauntlet   Hover 18.3%   Tank Tracks 7.1%   Omni Wheels 3.7%
//
// The ordering is almost exactly speed order in both. **Omni Wheels holds the best turn
// rate in the table (+25) and the second-best grip (0.55), and is the worst part in the
// game.** Grip has now failed twice — once as Aluminium's identity, once as the design
// axis of an arena that is two-thirds ice — and turn rate looks no better. Both were
// being sold as compensation that does not pay.
//
// The Gauntlet's ice is not inert: it cuts Hover from 24.4% to 18.3%, the only thing that
// has dented it. It simply cannot overcome a 47% speed advantage.
//
// So the fix is here rather than in the arena. Ordering is preserved — Hover still
// fastest, Tank Tracks still slowest — but the spread no longer decides matches on its
// own. Thrust and grip are deliberately untouched, so the drives still FEEL different
// even though they should now win about equally often.
const DRIVE: readonly Part[] = [
  {
    id: 'drive-omni-wheels',
    label: 'Omni Wheels',
    category: 'drive',
    blurb: "The tightest turn in the game — it just won't get you there fast.",
    // 4.2 -> 4.7. The worst part in the game at 3.7% in both arenas.
    set: { maxSpeed: 4.7, thrust: 0.3, grip: 0.55 },
    add: { turnRate: 25 },
  },
  {
    id: 'drive-tank-tracks',
    label: 'Tank Tracks',
    category: 'drive',
    blurb: 'The best grip and the quickest acceleration in the game — also the slowest top speed.',
    // 3.8 -> 4.6. Still the slowest, but 3.8 against Hover's 5.6 was not a trade, it was
    // a penalty: its 0.60 grip is the highest in the table and bought nothing.
    set: { maxSpeed: 4.6, thrust: 0.45, grip: 0.6 },
    add: { turnRate: -10 },
  },
  {
    id: 'drive-4-wheels',
    label: '4 Wheels',
    category: 'drive',
    blurb: 'No strengths, no weaknesses — the default every other drive gets judged against.',
    // 4.5 -> 4.9.
    set: { maxSpeed: 4.9, thrust: 0.35, grip: 0.25 },
    add: { turnRate: 0 },
  },
  {
    id: 'drive-6-wheels',
    label: '6 Wheels',
    category: 'drive',
    blurb: 'A touch more grip than 4 Wheels, a touch less speed to go with it.',
    // 4.3 -> 4.8.
    set: { maxSpeed: 4.8, thrust: 0.38, grip: 0.35 },
    add: { turnRate: -5 },
  },
  {
    id: 'drive-2-wheels',
    label: '2 Wheels',
    category: 'drive',
    blurb: 'One of the fastest drives here, riding on almost no grip at all.',
    // Unchanged. It sat closest to fair in both arenas at 11.6%.
    set: { maxSpeed: 5.2, thrust: 0.32, grip: 0.12 },
    add: { turnRate: 8 },
  },
  {
    id: 'drive-hover',
    label: 'Hover',
    category: 'drive',
    blurb: 'The fastest thing on the floor, and it never quite goes where you point it.',
    // 5.6 -> 5.5. Still the fastest thing on the board; it just no longer wins a quarter
    // of every match on that alone.
    set: { maxSpeed: 5.5, thrust: 0.28, grip: 0.04 },
    add: { turnRate: 5 },
  },
];

// --- Category 3: Front Weapon. Spec §6. Arc values converted from degrees, see above. -
const WEAPON: readonly Part[] = [
  {
    id: 'weapon-vertical-spinner',
    label: 'Vertical Spinner',
    category: 'weapon',
    blurb: "One of the narrowest windows in the game, but nothing launches them further when it lands.",
    set: { weaponArc: 250, weaponDamage: 2.2, attackCooldown: 50, weaponKnockback: 4.0 },
  },
  {
    id: 'weapon-hammer',
    label: 'Hammer',
    category: 'weapon',
    blurb: 'Hits harder than anything else here, then makes you wait for the next swing.',
    set: { weaponArc: 205, weaponDamage: 2.6, attackCooldown: 75, weaponKnockback: 2.2 },
  },
  {
    id: 'weapon-saw-blade',
    label: 'Saw Blade',
    category: 'weapon',
    blurb: "Nothing about it stands out, which is exactly why it's easy to land.",
    set: { weaponArc: 512, weaponDamage: 1.0, attackCooldown: 30, weaponKnockback: 0.5 },
  },
  {
    id: 'weapon-spinning-bar',
    label: 'Spinning Bar',
    category: 'weapon',
    blurb: 'Wide enough to catch what Saw Blade misses, with real shove behind it.',
    set: { weaponArc: 694, weaponDamage: 1.15, attackCooldown: 34, weaponKnockback: 1.4 },
  },
  {
    id: 'weapon-ram-plate',
    label: 'Ram Plate',
    category: 'weapon',
    blurb: "Barely hurts per hit, but it's almost always hitting and always pushing.",
    set: { weaponArc: 899, weaponDamage: 0.6, attackCooldown: 16, weaponKnockback: 2.0 },
  },
  {
    id: 'weapon-flamethrower',
    label: 'Flamethrower',
    category: 'weapon',
    blurb: 'No knockback at all, which means they stay in the fire.',
    set: { weaponArc: 796, weaponDamage: 0.35, attackCooldown: 8, weaponKnockback: 0 },
  },
];

// --- Category 4: Armour Material. Spec §7. --------------------------------------------
//
// ROUND 2 OF COMPRESSION, 2026-08-06. Effective HP now runs 98-134 (1.37:1).
//
// Two measured rounds in The Grinder, 200 matches each, established the relationship this
// table is now tuned against:
//
//   EHP ratio 2.78:1  ->  win-rate ratio 35.3:1   (implied exponent 3.49)
//   EHP ratio 1.72:1  ->  win-rate ratio  7.0:1   (implied exponent 3.57)
//
// Win rate goes as roughly effective HP to the 3.5. That is the single most useful fact
// about balancing this category, and it is why intuition kept failing here: a range that
// looks modest in the table is extreme in outcomes. Two points is a fit, not a law, but
// the exponents agree closely enough to aim with. 1.37:1 predicts about a 3:1 win spread.
//
// Only the four extremes have ever moved. Titanium, Aluminium and Spiked Composite sit
// inside the band already. The reason to compress rather than redesign: Spiked Composite
// won 11.3% on 110 effective HP while Alloy won 8.6% on 121 — beating a tougher material
// says the non-EHP differentiators (here, damage reflect) genuinely work, so the category
// does not need a new mechanic to stay interesting once toughness is levelled.
const ARMOUR: readonly Part[] = [
  {
    id: 'armour-depleted-uranium',
    label: 'Depleted Uranium',
    category: 'armour',
    blurb: 'The toughest armour in the game, and the slowest to turn or get out of the way.',
    // 200 -> 155 -> 134 EHP across two rounds. Still the toughest, heaviest and slowest
    // thing on the board; it just no longer wins four times as often as the field. Its
    // real identity was always +55% mass, which is untouched.
    set: { armour: 1.25, damageReflect: 0 },
    add: { maxHealth: 7, maxSpeed: -0.7, turnRate: -10 },
    scale: { mass: 1.55 },
  },
  {
    id: 'armour-carbon-fibre',
    label: 'Carbon Fibre',
    category: 'armour',
    blurb: 'Barely any protection at all, but nothing else turns or tops out faster wearing it.',
    // 72 -> 90 -> 98 EHP. At 72 it was unplayable (1.1%) and at 90 still near-dead (3.7%),
    // which matters more here than in a normal game: this picks a draft order, so a dead
    // slot on the Forge board tells a league member their result before the fighting
    // starts. The health penalty is gone entirely; -30% mass is price enough, since low
    // mass loses every shoving match and gets launched furthest.
    set: { armour: 0.98, damageReflect: 0 },
    add: { maxHealth: 0, maxSpeed: 0.5, turnRate: 8 },
    scale: { mass: 0.7 },
  },
  {
    id: 'armour-alloy',
    label: 'Alloy',
    category: 'armour',
    blurb: 'A modest step up in protection over the baseline, for a modest step up in weight.',
    // 121 -> 116 EHP, a nudge to keep it below Hardened Steel now the band is narrow.
    set: { armour: 1.12, damageReflect: 0 },
    add: { maxHealth: 4, maxSpeed: -0.1, turnRate: 0 },
    scale: { mass: 1.08 },
  },
  {
    id: 'armour-aluminium',
    label: 'Aluminium',
    category: 'armour',
    blurb: 'No weight penalty, no speed penalty — just steady armour and a bit of extra grip.',
    // Aluminium was the worst part in the game at a 4.2% win rate and an average draft
    // position of 6.43 — below Carbon Fibre, which has LESS effective HP (98 vs 100). So
    // this was never a durability problem. It was the pure baseline: no mass, no speed, no
    // reflect, no penalty, nothing. Every rival buys something, and a do-nothing option
    // turns out to break the table's "no option is strictly better" rule from the far side.
    //
    // Grip alone was tried and FAILED: holding effective HP at 100 and adding +0.12 grip
    // moved Aluminium from 6.43 to 6.73 — it got worse. That was a deliberate experiment
    // and the answer is useful beyond this row: handling is worth close to nothing here.
    // Partly self-inflicted, since The Grinder has no ice at all, so grip only affects
    // cornering.
    //
    // So it gets durability as well: armour 1.00 -> 1.10, putting effective HP at 110,
    // level with Titanium and Spiked Composite but reached without their costs. The grip
    // stays as the thing that distinguishes it — grip runs 0.04 (Hover) to 0.60 (Tank
    // Tracks) across the drive table, so it rescues a slippery drive and barely registers
    // on a grippy one. The band is unchanged at 98-134, so the armour ratio still holds.
    set: { armour: 1.1, damageReflect: 0 },
    add: { maxHealth: 0, maxSpeed: 0, turnRate: 0, grip: 0.12 },
    scale: { mass: 1.0 },
  },
  {
    id: 'armour-titanium',
    label: 'Titanium',
    category: 'armour',
    blurb: 'Less health than most, but lighter, faster, and every hit that lands stings less.',
    // 1.3/-20 -> 1.2/-8: 104 EHP up to 110. Barely moved on paper, but it was winning
    // 5.6% — below Aluminium's baseline despite costing more health for better armour.
    // The health penalty was doing more harm than the armour multiplier was undoing.
    set: { armour: 1.2, damageReflect: 0 },
    add: { maxHealth: -8, maxSpeed: 0.25, turnRate: 4 },
    scale: { mass: 0.85 },
  },
  {
    id: 'armour-hardened-steel',
    label: 'Hardened Steel',
    category: 'armour',
    blurb: 'Second-toughest armour in the game, and the weight shows every time you turn.',
    // 155 -> 138 -> 124 EHP. Second-toughest, as designed, but the gap to the middle of
    // the table was never paid for by -0.35 speed.
    set: { armour: 1.2, damageReflect: 0 },
    add: { maxHealth: 3, maxSpeed: -0.35, turnRate: -5 },
    scale: { mass: 1.25 },
  },
  {
    id: 'armour-spiked-composite',
    label: 'Spiked Composite',
    category: 'armour',
    blurb: 'Every hit they land gives them 35% of it straight back.',
    set: { armour: 1.1, damageReflect: 0.35 },
    add: { maxHealth: 0, maxSpeed: -0.15, turnRate: 0 },
    scale: { mass: 1.1 },
  },
];

// --- Category 5: Special Ability. Spec §8. --------------------------------------------
const ABILITY: readonly Part[] = [
  {
    id: 'ability-emp',
    label: 'EMP Pulse',
    category: 'ability',
    blurb:
      "Seizes every machine near you for two full seconds, enough time to escape or attack. Fires when you've lost enough health to be angry about it.",
    ability: 'emp',
  },
  {
    id: 'ability-nitro',
    label: 'Nitro Boost',
    category: 'ability',
    blurb:
      'Nearly double speed for a second and a half. It triggers on damage, so it arrives exactly when running is the smart idea.',
    ability: 'nitro',
  },
  {
    id: 'ability-oil-slick',
    label: 'Oil Slick',
    category: 'ability',
    blurb:
      "Dumps a slick on the floor a car's length behind you. Whatever's chasing hits it at speed and stops being able to steer.",
    ability: 'oilSlick',
  },
  {
    id: 'ability-shockwave',
    label: 'Shockwave',
    category: 'ability',
    blurb:
      'No damage dealt — just four tiles of hard shove in every direction. Creates room, exactly when you have none.',
    ability: 'shockwave',
  },
  {
    id: 'ability-repair',
    label: 'Repair System',
    category: 'ability',
    blurb:
      "Slowly regenerates health, but only after four full seconds without taking a hit. In a ten-bot brawl, that's the hard part.",
    ability: 'repair',
  },
  {
    id: 'ability-adrenaline',
    label: 'Adrenaline',
    category: 'ability',
    blurb: "Does nothing until you're almost dead, then hits harder and moves faster for as long as you're desperate.",
    ability: 'adrenaline',
  },
  {
    id: 'ability-smoke-screen',
    label: 'Smoke Screen',
    category: 'ability',
    blurb:
      'Deploys a blanket of smoke where nothing on the floor can target you for two seconds. Not invulnerable — just briefly not worth aiming at.',
    ability: 'smokeScreen',
  },
];

// --- Category 6: Driver Personality. Spec §9. Already-built personalities, in the same -
// --- order as `PERSONALITY_NAMES`. ----------------------------------------------------
const PERSONALITY: readonly Part[] = [
  {
    id: 'personality-aggressive',
    label: 'Aggressive',
    category: 'personality',
    blurb: "Attacks whoever's closest and almost never breaks off — there's no plan B.",
    personality: 'aggressive',
  },
  {
    id: 'personality-defensive',
    label: 'Defensive',
    category: 'personality',
    blurb: "Picks off whoever's already hurt, and knows exactly when to back away.",
    personality: 'defensive',
  },
  {
    id: 'personality-hit-and-run',
    label: 'Hit-and-Run',
    category: 'personality',
    blurb: 'Hits hard, breaks off, and comes right back to do it again.',
    personality: 'hitAndRun',
  },
  {
    id: 'personality-third-party',
    label: 'Third Party Predator',
    category: 'personality',
    blurb: 'Ignores clean fights and waits for two other bots to wear each other down first.',
    personality: 'thirdParty',
  },
  {
    id: 'personality-chaos',
    label: 'Agent of Chaos',
    category: 'personality',
    blurb: 'No fixed style at all — it rewrites its own instincts mid-fight.',
    personality: 'chaos',
  },
  {
    id: 'personality-showman',
    label: 'Showman',
    category: 'personality',
    blurb: 'Goes straight for the leader and takes the biggest risks on the floor.',
    personality: 'showman',
  },
  {
    id: 'personality-instigator',
    label: 'Instigator',
    category: 'personality',
    blurb: 'Shoves everyone toward each other and the hazards, then bails before it becomes a fight.',
    personality: 'instigator',
  },
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
