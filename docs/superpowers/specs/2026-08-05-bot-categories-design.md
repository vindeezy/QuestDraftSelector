# Bot Categories — Design Spec (Phase 4)

**Date:** 2026-08-05
**Status:** Approved for planning
**Parent specs:** `2026-08-03-quest-draft-selector-design.md` §7, `2026-08-04-arena-greybox-design.md`

## 1. Purpose

Turn the Bot Forge from a Plinko board that reports slot numbers into one that builds
actual machines. Six boards, one per category, each assigning every member a named part
that changes how their bot fights.

This is the piece that makes the Forge and the Arena one experience rather than two
demos.

## 2. What a choice can change

Every option resolves to modifiers on the stat block the simulation already reads. Nothing
here invents behaviour the engine does not have.

| Stat | Effect |
|---|---|
| `mass` | Who wins a shoving match; how far knockback throws you |
| `radius` | How large a target you are |
| `maxSpeed` | Top speed. Also sets turn radius, since radius = speed ÷ turn rate |
| `thrust` | Acceleration |
| `turnRate` | Rotation per tick |
| `grip` | Cornering, and how badly ice affects you |
| `maxHealth` | Total damage capacity |
| `armour` | Divides all incoming damage |
| `weaponDamage` | Multiplies outgoing damage |
| `weaponArc` | Half-width of the damaging front arc |
| `attackCooldown` | Ticks between blows |
| `front/side/rear vulnerability` | Currently fixed at 0.7 / 1.25 / 1.8. Becomes a chassis property. |

Plus the seven driver personality weight vectors, which already exist and are tested.

## 3. Two design rules

**No option is strictly better than another.** The Forge is random, so a strictly better
option is not a reward for anything — it is one member getting luckier. Every choice
trades something away.

**Slot position is rarity, and that is a design tool.** The Plinko distribution is
centre-weighted, so edge slots are hit roughly half as often as centre slots — measured at
7.7% versus 16% over 4,000 balls. That is a 2:1 ratio, not 10:1, which matters: **edge
options must be distinctive rather than stronger.** A genuinely powerful rare option would
not be adequately protected by a 2:1 rarity.

Balanced options hold the centre. Specialists go to the edges.

## 4. Category 1 — Chassis Shape

Owns **where your armour is**, plus size and mass. This is what turns the rear-vulnerability
mechanic from a global constant into a build decision.

| Slot | Shape | Front / Side / Rear | Other | Character |
|---|---|---|---|---|
| 0 *(rare)* | **Wedge** | **0.40** / 1.4 / 2.2 | −10 health | Nearly immune head-on, glass from behind |
| 1 | **Diamond** | 0.75 / **1.7** / 1.0 | +8 turn rate | Tough front and back, paper flanks |
| 2 *(common)* | **Square** | 0.75 / 1.2 / 1.7 | baseline | The honest all-rounder |
| 3 *(common)* | **Circle** | **1.15 / 1.15 / 1.15** | +restitution, −15% mass | Uniform armour, never punished for position. Bounces badly, cannot shove. |
| 4 | **Box** | 0.7 / 1.25 / 1.8 | +15 health, +20% mass, −8 turn | The tank |
| 5 *(rare)* | **Tower** | 0.7 / 1.5 / 1.9 | −25% radius, −25% mass, −20 health, +12 turn | Survives by not being hit |

Wedge and Tower are opposite answers to the same problem: Wedge survives by facing you,
Tower by not being there.

Circle's uniform armour is deliberately priced. Averaged across all angles it is better
protected than Square, so it pays in restitution and mass — it is the easiest bot on the
board to shove into a pit, and roughly a third of eliminations are falls.

## 5. Category 2 — Drive System

Owns **how you move**. Turn radius equals speed ÷ turn rate, so speed and agility are
genuinely opposed rather than two independent numbers.

| Slot | Drive | Speed / Thrust / Turn / Grip | Character |
|---|---|---|---|
| 0 *(rare)* | **Omni Wheels** | 4.2 / 0.30 / **+25** / **0.55** | Turns on a coin, barely slides, slowest |
| 1 | **Tank Tracks** | 3.8 / **0.45** / −10 / **0.60** | Huge grip and acceleration, poor top speed and turning |
| 2 *(common)* | **4 Wheels** | 4.5 / 0.35 / 0 / 0.25 | The default |
| 3 *(common)* | **6 Wheels** | 4.3 / 0.38 / −5 / 0.35 | Steadier, marginally lazier |
| 4 | **2 Wheels** | **5.2** / 0.32 / +8 / **0.12** | Fast and whippy, slides constantly |
| 5 *(rare)* | **Hover** | **5.6** / 0.28 / +5 / **0.04** | Fastest and frictionless — always on ice |

Omni turns without sliding; Hover slides without turning. Tank Tracks at grip 0.60 barely
notices the ice that leaves a 2-Wheel bot helpless.

## 6. Category 3 — Front Weapon

Owns **how you deal damage** — the window to land it, the force per hit, the rate.
Sustained damage lands between 2.0 and 2.6 per second across all six, so nobody is simply
stronger; what differs is how you get there.

| Slot | Weapon | Arc | Damage | Cooldown | Knockback | Character |
|---|---|---|---|---|---|---|
| 0 *(rare)* | **Vertical Spinner** | ±22° | 2.2 | 50 | **4.0** | Tiny window, launches what it catches |
| 1 | **Hammer** | ±18° | **2.6** | **75** | 2.2 | Biggest single hits, longest waits |
| 2 *(common)* | **Saw Blade** | ±45° | 1.0 | 30 | 0.5 | The reliable baseline |
| 3 *(common)* | **Spinning Bar** | ±61° | 1.15 | 34 | 1.4 | Wider reach, real shove |
| 4 | **Ram Plate** | **±79°** | 0.6 | **16** | 2.0 | Constant chip, pushes hard |
| 5 *(rare)* | **Flamethrower** | ±70° | 0.35 | **8** | **0** | Near-continuous burn, and no knockback means the victim stays in the fire |

Arc is the half-width either side of dead ahead, with smooth falloff — the edge of the arc
does almost nothing. Cooldown is a hard gate at 60 ticks per second, not an average.

**Flamethrower's zero knockback is the subtle one.** Every other weapon shoves its victim
away and ends the contact.

## 7. Category 4 — Armour Material

Owns **how much punishment you absorb and what it costs in weight**. Armour divides
incoming damage; health is the pool; mass decides shoving and how far you are thrown.

Ordered heaviest to lightest, with the oddball at the far edge. Note slots 0 and 1: the
toughest and flimsiest materials are **adjacent**, so a ball drifting one slot short of the
best armour lands on the worst. That is the largest single swing in the Forge.

| Slot | Material | Armour / Health / Mass | Speed / Turn | Effective HP |
|---|---|---|---|---|
| 0 *(rare)* | **Depleted Uranium** | 1.60 / +25 / **+55%** | −0.7 / −10 | **200** |
| 1 | **Carbon Fibre** | 0.85 / −15 / **−30%** | **+0.5 / +8** | **72** |
| 2 *(common)* | **Alloy** | 1.15 / +5 / +8% | −0.1 / 0 | 121 |
| 3 *(common)* | **Aluminium** | 1.00 / 0 / 0% | 0 / 0 | 100 |
| 4 | **Titanium** | **1.30** / **−20** / −15% | **+0.25 / +4** | 104 |
| 5 | **Hardened Steel** | 1.35 / +15 / +25% | −0.35 / −5 | 155 |
| 6 *(rare)* | **Spiked Composite** | 1.10 / 0 / +10% | −0.15 / 0 | 110 |

Titanium and Alloy reach similar survivability by opposite routes — Alloy has more
material, Titanium resists better per blow — but Titanium is lighter and faster, and low
mass means losing shoving matches and being launched further.

**Spiked Composite reflects 35% of damage taken back at the attacker.** It is the only
option in the game that changes the attacker's maths rather than the defender's.

## 8. Category 5 — Special Ability

**Trigger rule: every 15% of max health lost, the ability fires.** Six activations across
a full life, identical for every build — a 200-EHP tank and a 72-EHP sprinter get the same
number. Fixed cooldowns would have handed durable bots more uses; this removes that
advantage for free.

Abilities fire when you are being hurt, which is when something interesting is happening.

| Slot | Ability | Effect | Type |
|---|---|---|---|
| 0 *(rare)* | **EMP Pulse** | Nearby bots lose all control for 2s — no steering, no thrust, no weapon. Momentum carries them, and they can still be shoved. | Triggered |
| 1 | **Nitro Boost** | +80% top speed for 1.5s | Triggered |
| 2 *(common)* | **Oil Slick** | Drops an ice patch behind you | Triggered |
| 3 *(common)* | **Shockwave** | Omnidirectional launch, no damage | Triggered |
| 4 | **Repair System** | Heals steadily, but only after 3s without taking damage | Conditional |
| 5 | **Adrenaline** | Below 30% health: +50% damage, +20% speed | Conditional |
| 6 *(rare)* | **Smoke Screen** | Invisible to enemy targeting for 2s | Triggered |

Repair and Adrenaline are deliberate opposites: one rewards disengaging, the other rewards
staying in.

**The trigger ratchets on lowest-health-reached**, not current health, so anything that
heals cannot pump the same threshold repeatedly. It does not arise today — a bot has one
ability, and Repair is not a triggered one — but building it correctly costs nothing.

## 9. Category 6 — Driver Personality

**Already built, tested and running.** Seven personalities as weight vectors:
Aggressive, Defensive, Hit-and-Run, Third Party Predator, Agent of Chaos, Showman,
Instigator. This board maps slots to existing personalities and needs no new mechanics.

## 10. New mechanics required

| Mechanic | Cost | Used by |
|---|---|---|
| `weaponKnockback` | Small | All front weapons |
| **Launched state** — knockback may briefly exceed a bot's own speed cap, decaying over ~1s | Small | Vertical Spinner, Shockwave |
| `damageReflect` | Small | Spiked Composite |
| Ability framework — health-threshold triggers, ratcheted | Small | All abilities |
| Stun state | Small | EMP Pulse only |
| Six cheap abilities | Small each | Nitro, Oil Slick, Shockwave, Repair, Adrenaline, Smoke |

The launched state exists because knockback is otherwise pointless: `integrate()` clamps
velocity to `maxSpeed` every tick, so a 4.0 knockback on a 4.5-speed bot is flattened
back immediately. Being thrown should be different from driving.

**EMP was initially priced as moderate and earmarked for cutting. That was wrong.** The
mistake was imagining a general status-effect system; what is actually needed is one
boolean on the bot and two conditions — skip the AI, and deal no damage.

Freezing a bot outright would be slightly harder AND worse. Stopping the physics means
setting , which makes the victim unpushable — so the stun would protect them
from being shoved into a pit, removing the best thing about EMP. Drag already handles the
appearance: a stunned bot retains about 16% of its speed after two seconds, so it visibly
coasts to a halt without any of that being written.

Every mechanic in this spec is now small. Nothing here is earmarked for cutting.

## 11. Deferred decisions

- **Adrenaline's numbers (30% / +50% / +20%) were chosen by intuition, not measurement.**
  Every other tuning decision in this project was measured. Before recording an official
  event, run 500 matches with Adrenaline forced on versus off and read the win-rate delta.
- All values in every table are first drafts. They live in one data table per category
  precisely so that tuning after watching real battles is a one-line change plus a metrics
  run.
- Whether six boards is the right ceremony length for the viewing experience — decided
  once the guided walkthrough exists.

## 12. Scale

Six boards of 6, 6, 6, 7, 7 and 7 options give roughly **74,000 distinct bots**. No two
league members will share a build.
