# Project status

Last updated: 2026-08-06

**Deadline: end of August 2026.** The league needs a working draft-order experience.

## What works today

| Piece | State |
|---|---|
| Deterministic sim core | Done. Seeded PRNG, fixed-tick physics, collision, checksums, lint-enforced determinism. |
| Bot Forge (Plinko) | Done. Six boards, one per category, fair, replays byte-identically from a seed. |
| Bot categories | Done. Six categories, ~74,000 distinct builds, assembled into real stat blocks. |
| Arena | Done. Vehicle movement, directional combat, per-bot armour profiles, seven personalities, launched state, spiral collapse. |
| Hazards | Done. Surfaces, zones, holes, projectiles, buttons, and trapdoors. |
| Abilities | Done. Seven, fired on health thresholds — six activations per life for every build. |
| Event pipeline | Done. Six Forge boards + three battles + scoring + draft order, from one master seed. |
| Recording | Done. `npm run record -- 10` rolls candidates; `--save <seed>` writes the official record. |
| **Arena 1 — The Grinder** | **Done and locked.** Built to spec, measured, balanced. |
| **Arenas 2 and 3** | **Not started.** The Gauntlet and The Crossfire are still their original designs. |
| Website | **Not started. This is the critical path.** |

## Commands

```bash
npm run dev                        # Bot Forge and Arena workbench (arena picker in the Arena view)
npm test                           # ~3 minutes. Includes the golden record tests.
npm run draft -- 100               # Average DRAFT POSITION by part. The number that matters.
npm run arena -- 200 --arena=grinder   # Match-level metrics for one arena
npm run arena -- 500 --ability-ab  # Adrenaline on/off A/B
npm run record -- 10               # Roll ten candidate events and print their draft orders
npm run distribution -- 400        # Plinko slot distribution and per-ball fairness
```

`--arena=` accepts `grinder`, `proving`, or is omitted for the greybox default.

## The rules that must not be broken

**`src/sim/` is deterministic and lint-enforced.** No `Math.random`, no `Date`, no
transcendental math, no `**` operator, no DOM. A recorded event is just a seed; the site
re-runs the simulation to play it back. Anything that differs between browsers silently
changes every recording ever made.

**Golden record tests are the tripwire.** `tests/determinism.test.ts` and the reference
vectors in `rng.test.ts` / `trig.test.ts` pin actual output, not self-consistency. If one
fails, the simulation changed — decide deliberately whether that was intended, and
re-record if so. Never paste in new numbers to make them pass.

**Damage tracking and scoring are frozen once an event is recorded.**

## The most useful thing we know

**Win rate goes as roughly effective HP to the power 3.5.** Measured three times in The
Grinder, 200 matches each:

| EHP ratio | Win-rate ratio | Implied exponent |
|---|---|---|
| 2.78 : 1 | 35.3 : 1 | 3.49 |
| 1.72 : 1 | 7.0 : 1 | 3.57 |
| 1.37 : 1 | 3.01 : 1 | *predicted 3.02* — used predictively, not fitted |

This is why intuition kept failing on the part tables: a range that looks modest in the
data is extreme in outcomes. **Balancing a durability stat is now arithmetic** — pick a
tolerable win spread, take the 3.53rd root, set the band.

The same amplification explains a pattern that repeated four times in one day: flatten one
category and the next-worst becomes visible. There is no natural end to that, which is why
tuning was stopped deliberately rather than because everything was fair.

## Current balance

Average draft position by part, 100 events, fair value 5.5. Spread = best minus worst.

| Category | Spread | Weakest part |
|---|---|---|
| Weapon | 0.80 | Ram Plate 6.02 |
| Ability | 0.90 | Nitro Boost 6.08 |
| Armour | 1.34 | Carbon Fibre 6.23 |
| Personality | 1.45 | Showman 6.19 |
| Chassis | 1.62 | Wedge 6.04 |
| Drive | 1.94 | **Tank Tracks 6.72** |

**These numbers are provisional.** They are measured across one finished arena and two that
are due to be replaced. Expect them to move when arenas 2 and 3 are built.

## Decisions worth knowing

- **Scoring:** 25/18/15/12/10/8/6/4/2/1 per battle, three battles, **plus 5 points per
  elimination**. Ties break on eliminations, then damage, then member id — that last one is
  not decoration; without it the draft order would depend on sort stability and could
  differ between browsers. It has never fired, and must stay.
- **Kill points are event-wide, not per battle**, because the elimination tally is an event
  sum. Per-battle scoreboards therefore show placement points only, so a member can lead the
  battle-2 scoreboard and not lead the final draft. **The site's reveal has to account for
  this.**
- **Ties are common: 13.3% of placements.** The site must be able to explain *why* a tie
  broke, because it will happen in most events.
- **Member index maps to bot index and ball index.** Fairness comes from the seeded shuffles
  inside the Plinko release and the arena spawn assignment, not from the mapping. Do not add
  another shuffle.
- **Bots have no pathfinding.** They steer toward targets. Simple obstacles are fine; mazes
  are not. There are no interior walls — every wall is on the perimeter.

## What we learned the hard way

Recorded because each one cost hours and none is obvious from the code.

- **Hazard density, not pits, was the lever on combat share.** Removing every pit moved
  combat 32.3% → 35.3%; the deaths just became hazard deaths. Cutting hazards to three saws
  moved it to 88%+.
- **Grip is worth close to nothing.** Aluminium was given +0.12 grip with its durability
  held constant, and got *worse* (6.43 → 6.73). Effective HP fixed it immediately. This also
  explains Tank Tracks, whose headline feature is grip 0.60.
- **Geometry cannot fix retreat.** A tar ring built specifically to punish retreating pushed
  Hit-and-Run from 15.4% to 21.3%, because a bot does not need the wall to break off, only
  open floor. Halving its `disengage` weight fixed it in one pass.
- **Scoring eliminations did not fix survival dominance on its own**, because hit-and-run
  *kills* — it strikes and withdraws, so rewarding kills rewarded it too.
- **Repair and Hit-and-Run were the same problem** wearing two hats: both pay a bot for
  disengaging.
- **A "baseline" option with no upside is a trap.** Aluminium was the worst part in the game
  while having more effective HP than Carbon Fibre.

## Known issues, unfixed by choice

- **Tank Tracks at 6.72** is the weakest part. Its selling point is grip, which we measured
  as near-worthless. One-line speed fix available; deliberately not taken, to stop the
  flatten-one-category-and-promote-the-next cycle.
- **Survival builds take 38% of top picks** against a fair 28.6%. Down from 55%.
- **A zone notice margin of 220 units** in `perception.ts` was chosen by eye, never measured.
- **The eliminations tiebreak resolves fewer cases than it used to** now that kills feed
  points directly, but it still fires most often of the three.

## Queued decisions — after the three arenas are locked

Both deliberately deferred, because arena geometry changes the answer to each.

**1. How much is a kill worth?** `KILL_POINTS` is 5, a first-draft number. Compare 1 vs 3
vs 5 and read the effect on draft position and on survival-personality share. The harness
for this is `npm run draft`, which already reports both.

**2. What counts as a kill?** Currently, *only a direct bot-on-bot final blow*. See the
four `eliminate()` call sites in `match.ts`: contact damage credits the other bot; a
`destroyed` death from any zone, projectile or hazard credits nobody, and a `fell` death
credits nobody.

So none of these currently earn a kill, and several are the most watchable moments in the
game:

| Moment | Credited today |
|---|---|
| Shove a bot into a pit or off the edge | **No** |
| Trigger a cannon whose ball lands the killing blow | **No** |
| Shove a bot into a saw | **No** |
| Kill with a Shockwave launch | **No** |
| Kill via Spiked Composite damage reflect | **No** (reflect does not credit damage either) |

This interacts directly with arena design: in The Grinder falls are only 1.8% of deaths so
it barely matters, but an arena built around a trapdoor or ejection gaps would have a large
share of its best moments score nothing. **Decide this before finalising an arena whose
drama depends on pits.**

## What is deliberately cut for this deadline

Blender-baked sprite art, sound design, arenas 4 and 5, the Arena Builder, interior
obstacles, the three-component weapon model. All are next year's.

## Where the reasoning lives

Design specs in `docs/superpowers/specs/`, implementation plans in
`docs/superpowers/plans/`. Commit messages are deliberately detailed — several record
measurements and failed approaches that are not obvious from the code.
