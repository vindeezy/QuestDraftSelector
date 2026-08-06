# Bot Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Forge build real machines. Six Plinko boards assign named parts; those parts assemble into a stat block; that stat block drives the bot in the Arena.

**Architecture:** Every part is a row in a data table. A build is six slot indices; assembly folds them into one `BotStats` object that `createBot` consumes. No part has behaviour of its own — behaviour lives in the engine, parts are numbers. The one exception is abilities, which need a small framework of their own.

**Tech Stack:** TypeScript, Vitest. Existing sim: `arena/*`, `event/*`, `plinko/*`.

**Scope:** Phase 4. The website is a separate plan. Deadline is end of August — prefer the simple version of every choice.

**Spec:** `docs/superpowers/specs/2026-08-05-bot-categories-design.md`. Read it first; every table in this plan comes from there.

---

## Background for the implementer

Ten members. Six Plinko boards build their bots. Three battles decide the draft order.
Everything replays from one integer seed.

**Today every bot is identical.** `DEFAULT_BOT` is a frozen constant and `createBot` reads
it directly. The Forge reports slot *numbers*. This plan connects the two.

**Determinism contract, lint-enforced on `src/sim/`.** Banned: `Math.sin/cos/tan/asin/acos/
atan/atan2/pow/hypot/log/exp/cbrt/random`, **the `**` operator**, `Date`, `performance`,
`document`, imports from `../render` or `../shell`. Permitted: `+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`, `Math.max`, `Math.imul`.
Test files and `tools/` are exempt.

**This plan changes the simulation, so it invalidates any existing recording.** That is
expected and fine — `data/official-event.json` currently holds a placeholder. Re-record
after this lands, and never before.

**Existing API:**

- `src/sim/arena/bot.ts` — `Bot`, `BotInit`, `DEFAULT_BOT`, `createBot(init)`, `applyThrust`, `applyGrip`, `steerToward`
- `src/sim/arena/combat.ts` — `arcAlignment`, `damageFrom`, `vulnerability(target, fromX, fromY)`, `resolveHit(attacker, target, impactSpeed, tick)`
- `src/sim/arena/match.ts` — `Match`, `createMatch`, `advanceMatch`, `runMatch`, `aiStates`
- `src/sim/arena/personality.ts` — `PERSONALITY_NAMES` (7), `weightsFor(name)`
- `src/sim/arena/surface.ts` — `Surface`, `setSurface`, `surfaceAt`
- `src/sim/event/event.ts` — `runEvent(config)`, seven Forge boards and three battles

**Commands.** `npm test -- <filter>` (never bare `npm test`, ~3 min), `npm run lint`,
`npx tsc --noEmit`, `npm run arena -- 80`, `npm run record -- 10`.
**Never run `npm run dev`. Never run anything in the background.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/arena/bot.ts` | `BotStats`; `createBot` accepts one; per-bot vulnerability and reflect. |
| `src/sim/arena/combat.ts` | Reads per-bot vulnerability; applies knockback and reflect. |
| `src/sim/arena/launch.ts` | The launched state — knockback that briefly exceeds the speed cap. |
| `src/sim/parts/tables.ts` | The six category tables, as data. |
| `src/sim/parts/assemble.ts` | Six slot indices → one `BotStats`. |
| `src/sim/arena/ability.ts` | Health-threshold triggers and the seven abilities. |
| `src/sim/event/event.ts` | Forge boards produce parts; battles use assembled bots. |

---

## Task 1: The bot stat block

Everything else depends on this. `createBot` currently hardcodes `DEFAULT_BOT`; it needs to
take a stat block so different bots can differ.

**Files:** `src/sim/arena/bot.ts`, `src/sim/arena/bot.test.ts`

- [ ] **Step 1: Define `BotStats` and rework `createBot`**

```ts
export interface BotStats {
  radius: number;
  mass: number;
  maxSpeed: number;
  thrust: number;
  turnRate: number;
  grip: number;
  maxHealth: number;
  armour: number;
  restitution: number;
  weaponArc: number;
  weaponDamage: number;
  weaponKnockback: number;
  attackCooldown: number;
  /** Damage multipliers by where a hit lands. Chassis shape owns these. */
  frontVulnerability: number;
  sideVulnerability: number;
  rearVulnerability: number;
  /** Fraction of damage taken that is returned to the attacker. */
  damageReflect: number;
}
```

`DEFAULT_BOT` becomes a `BotStats` with today's values, so nothing changes for existing
callers. `createBot(init, stats = DEFAULT_BOT)` copies every stat onto the `Bot`.

Add to `Bot`: `weaponKnockback`, `frontVulnerability`, `sideVulnerability`,
`rearVulnerability`, `damageReflect`, and `stunnedUntil: number` (used in Task 6).

- [ ] **Step 2: Tests**

- `createBot` with no stats produces today's values exactly
- `createBot` with custom stats reflects every field
- Two bots built from different stats do not share state
- Health starts at `maxHealth`, whatever that is

- [ ] **Step 3: Verify and commit**

`npm test -- bot`, `npm run lint`, `npx tsc --noEmit`.

```bash
git commit -m "feat(sim): make bot stats a per-bot block rather than a constant"
```

---

## Task 2: Per-bot vulnerability, knockback and reflect

**Files:** `src/sim/arena/combat.ts`, `src/sim/arena/combat.test.ts`

- [ ] **Step 1: Read vulnerability from the bot**

`vulnerability()` currently interpolates between two module constants. It now interpolates
between `target.frontVulnerability` and `target.rearVulnerability`, using
`sideVulnerability` at the midpoint.

Use a two-segment interpolation, not a straight line between front and rear — otherwise
side vulnerability would be ignored entirely. Facing above 0 blends front↔side; below 0
blends side↔rear.

- [ ] **Step 2: Apply knockback and reflect in `resolveHit`**

After damage is dealt:

```ts
  attacker.damageDealt += dealt;
  attacker.nextAttackTick = tick + attacker.attackCooldown;

  // Reflect. Spiked Composite is the only thing that changes the ATTACKER's maths.
  if (target.damageReflect > 0) {
    const back = dealt * target.damageReflect;
    attacker.health -= back > attacker.health ? attacker.health : back;
    if (attacker.health < 0) attacker.health = 0;
  }
```

Knockback needs the launched state from Task 3, so wire it there.

**Reflect does not credit `damageDealt`.** The tiebreaker measures damage you went out and
inflicted, not damage that happened to bounce off you.

- [ ] **Step 3: Tests**

- A bot with a 0.40 front and 2.2 rear takes over five times as much from behind
- Side vulnerability is actually used, not skipped
- A bot with `damageReflect: 0.35` returns 35% of what it took
- Reflect cannot take the attacker below zero
- Reflect does not increase the target's `damageDealt`
- A bot with zero reflect returns nothing

- [ ] **Step 4: Verify and commit**

```bash
git commit -m "feat(sim): per-bot armour profile and damage reflection"
```

---

## Task 3: The launched state

**Files:** Create `src/sim/arena/launch.ts` + test; modify `body.ts`, `combat.ts`, `match.ts`

- [ ] **Step 1: Why this exists**

`integrate()` clamps velocity to `maxSpeed` every tick, so a 4.0 knockback on a 4.5-speed
bot is flattened back immediately and a Vertical Spinner's launch would look like a nudge.
Being *thrown* has to be different from *driving*.

- [ ] **Step 2: Implement**

Add `launchUntil: number` and `launchSpeed: number` to `Bot`. While `tick < launchUntil`,
`integrate` clamps to `launchSpeed` instead of `maxSpeed`. `launchSpeed` decays toward
`maxSpeed` so the effect fades over roughly a second rather than ending abruptly.

```ts
/** Throws a bot, briefly letting it exceed its own speed limit. */
export function launch(bot: Bot, dirX: number, dirY: number, force: number, tick: number): void {
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq === 0 || force <= 0) return;
  const inv = 1 / Math.sqrt(lenSq);
  bot.body.vx += dirX * inv * force;
  bot.body.vy += dirY * inv * force;

  // A bot already flying is not launched twice as far; the cap takes the higher value.
  const cap = bot.maxSpeed + force;
  if (cap > bot.launchSpeed) bot.launchSpeed = cap;
  bot.launchUntil = tick + LAUNCH_TICKS;
}
```

`integrate` needs the effective cap. Rather than teach `body.ts` about bots, pass the cap
in — `integrate(body, gravity, maxSpeed, drag)` already takes `maxSpeed`, so the match loop
passes the launched value when one is active.

- [ ] **Step 3: Tests**

- A launched bot exceeds its normal `maxSpeed` immediately after the hit
- It returns to normal within about a second
- Launching an already-launched bot does not stack indefinitely
- Zero force does nothing
- **A launched bot travels measurably further than an unlaunched one given the same
  impulse** — this is the regression test for the whole feature

- [ ] **Step 4: Wire into `resolveHit`**

A successful hit calls `launch(target, awayFromAttacker, attacker.weaponKnockback, tick)`.

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat(sim): add the launched state so knockback can throw bots"
```

---

## Task 4: The six category tables

Pure data. Every value comes from the spec — copy them exactly.

**Files:** Create `src/sim/parts/tables.ts` + test

- [ ] **Step 1: Shape**

```ts
export const CATEGORIES = ['chassis', 'drive', 'weapon', 'armour', 'ability', 'personality'] as const;
export type CategoryName = (typeof CATEGORIES)[number];

export interface Part {
  id: string;
  label: string;
  category: CategoryName;
  /** Absolute stat overrides. */
  set?: Partial<BotStats>;
  /** Additive modifiers, applied after all `set`s. */
  add?: Partial<BotStats>;
  /** Multiplicative modifiers, applied last. */
  scale?: Partial<BotStats>;
  /** Ability and personality carry a name rather than stats. */
  ability?: AbilityName;
  personality?: PersonalityName;
}

export function partsFor(category: CategoryName): readonly Part[];
export function partAt(category: CategoryName, slot: number): Part;
export function slotCountFor(category: CategoryName): number;
```

Slot counts: chassis 6, drive 6, weapon 6, armour 7, ability 7, personality 7.

- [ ] **Step 2: Tests**

- Every category has the expected slot count
- No duplicate part ids anywhere
- `partAt` clamps out-of-range slots rather than returning undefined
- Every part has a non-empty label
- Ability parts carry an `ability`; personality parts carry a `personality`; neither carries stats
- **Every chassis defines all three vulnerability values** — a partial armour profile would
  silently inherit whatever the previous part set

- [ ] **Step 3: Verify and commit**

```bash
git commit -m "feat(sim): add the six bot category tables as data"
```

---

## Task 5: Assembly

**Files:** Create `src/sim/parts/assemble.ts` + test

- [ ] **Step 1: Implement**

```ts
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

export function assemble(build: BotBuild): AssembledBot;
```

Order of application is fixed and matters: start from `DEFAULT_BOT`, apply every part's
`set`, then every `add`, then every `scale`. Applying multiplicatively before additively
would make identical tables produce different bots.

Clamp the result: `maxSpeed` must stay below `radius` or bots tunnel through walls, and
`grip`, `armour`, `mass` and `maxHealth` must stay above zero.

- [ ] **Step 2: Tests**

- The all-common build (middle slot everywhere) produces sensible values
- A Wedge chassis produces a 0.40 front vulnerability
- Depleted Uranium plus Box is heavier than Carbon Fibre plus Tower
- Order is stable — assembling twice gives identical output
- **No build in the entire space produces `maxSpeed >= radius`.** Enumerate all
  6×6×6×7×7×7 = 74,088 combinations and assert it. This is the tunnelling guard, and it is
  cheap to check exhaustively.
- No build produces a negative or zero `maxHealth`, `mass`, `armour` or `grip`

- [ ] **Step 3: Verify and commit**

```bash
git commit -m "feat(sim): assemble six part choices into one bot stat block"
```

---

## Task 6: Abilities

**Files:** Create `src/sim/arena/ability.ts` + test; modify `match.ts`

- [ ] **Step 1: The trigger**

Every 15% of max health lost, the ability fires. **Ratcheted on lowest-health-reached**, not
current health, so anything that heals cannot pump the same threshold repeatedly.

```ts
export interface AbilityState {
  name: AbilityName;
  /** Lowest health reached so far. The ratchet. */
  floor: number;
  /** How many thresholds have fired. */
  fired: number;
  /** Ability-specific expiry ticks. */
  activeUntil: number;
  lastDamageTick: number;
}
```

Six activations across a full life for every build, regardless of health pool.

- [ ] **Step 2: The seven abilities**

| Ability | Effect |
|---|---|
| `emp` | Bots within range get `stunnedUntil = tick + 120`. Stunned bots skip the AI and deal no damage; momentum and shoveability are unaffected. |
| `nitro` | `maxSpeed × 1.8` for 90 ticks |
| `oilSlick` | Writes `Surface.Ice` to the tile behind the bot |
| `shockwave` | `launch()` every bot within range, away, no damage |
| `repair` | Heals per tick, only if `tick - lastDamageTick > 180` |
| `adrenaline` | Below 30% health: damage ×1.5, speed ×1.2 |
| `smokeScreen` | `untargetableUntil = tick + 120`; `perceive` skips such bots when choosing targets |

- [ ] **Step 3: Tests**

- Fires at exactly six thresholds across a full life, for both a 72-health and a 200-health bot
- Does not fire twice at the same threshold
- The ratchet holds: healing then re-taking damage does not re-fire a spent threshold
- A stunned bot does not steer or thrust
- A stunned bot deals no damage on contact
- **A stunned bot can still be shoved** — this is the point of stunning rather than freezing
- Repair does not heal within 3s of taking damage, and does heal after
- Adrenaline applies below 30% and not above
- Smoke Screen removes a bot from others' target selection, and it returns afterwards

- [ ] **Step 4: Wire into `advanceMatch`**

Update abilities after damage resolution, before the next tick's AI. Stun is checked in the
drive loop and the damage loop.

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat(sim): add the ability framework and seven abilities"
```

---

## Task 7: Wire the Forge to the Arena

**Files:** `src/sim/event/event.ts` and its test

- [ ] **Step 1: Change what the Forge produces**

Seven boards become **six**, one per category, with each board's slot count taken from
`slotCountFor(category)`. Each member's landing slot becomes their part for that category.

`ForgeBoardResult` gains `category` and each member's `partId` and `partLabel` alongside
the slot. The website needs the labels; the sim only needs the slots.

`EventResult` gains a per-member `build: BotBuild` and `partLabels`.

- [ ] **Step 2: Battles use assembled bots**

`createMatch` accepts an optional array of `AssembledBot`, one per bot, and uses each one's
stats and personality instead of `DEFAULT_BOT` and the shuffled personality assignment.

**When builds are supplied, personality comes from the build, not the shuffle.** The Forge
already assigned it fairly.

- [ ] **Step 3: Tests**

- Six boards, matching the six categories in order
- Every member gets a part from every category
- Every member's `build` has six valid slot indices
- Bots in the battles actually differ — assert at least two distinct `maxHealth` values
- Same master seed still produces an identical checksum and identical standings
- Every member still ranked exactly once

- [ ] **Step 4: Verify and commit**

```bash
git commit -m "feat(sim): the Forge now builds real bots that fight in the Arena"
```

---

## Task 8: Measure

**Files:** `tools/arena-metrics.ts`, `tools/record-event.ts`

- [ ] **Step 1: Report by part, not just personality**

The metrics harness currently reports win rate by personality. With builds live, add win
rate by **chassis**, **drive**, **weapon** and **armour**, so a dominant part is visible.

- [ ] **Step 2: Settle Adrenaline**

Its numbers (30% / +50% / +20%) were chosen by intuition and the spec records that. Add
`npm run arena -- 500 --ability-ab` which runs the field with Adrenaline forced on for
everyone versus off for everyone, and reports the win-rate delta.

**Report the number. Do not tune in response** — that decision is the project owner's.

- [ ] **Step 3: Run and report**

Run `npm run arena -- 200` and `npm run record -- 10` and report both verbatim. The record
output will now show real part names per member.

- [ ] **Step 4: Verify and commit**

```bash
git commit -m "feat(tools): report win rate by part and measure Adrenaline"
```

---

## Definition of done

- [ ] `npm test` passes; lint, types and build clean
- [ ] Same master seed produces the same checksum and the same draft order
- [ ] Bots in a battle visibly differ in health, speed and weapon behaviour
- [ ] **No build in the 74,088-combination space can tunnel** (Task 5 asserts this exhaustively)
- [ ] Every ability fires exactly six times across a full life, for every health pool
- [ ] A stunned bot can still be shoved
- [ ] `npm run record -- 10` shows real part names per member

## What this does not include

- The website — a separate plan, and the remaining critical path
- Balance tuning beyond reporting the numbers. Every table is a first draft and lives in
  one file precisely so tuning later is a one-line change.
- Visual differentiation of parts. Bots still render as coloured shapes; making a Wedge
  look like a wedge is Phase 6+ and is explicitly cut for this deadline.
