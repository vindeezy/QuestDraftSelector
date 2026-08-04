# Arena Greybox — Design Spec (Phase 3)

**Date:** 2026-08-04
**Status:** Approved for planning
**Parent spec:** `2026-08-03-quest-draft-selector-design.md` (§9 Arena)

## 1. Purpose

Build the Battle Bot arena as a playable, watchable simulation with placeholder art, in
order to answer one question: **is this fun to watch?**

A second, equally important outcome: learn **which stats actually dominate combat**. The
seven bot categories in Phase 4 are trade-offs between mass, speed, grip, armour, and
weapon damage. Designing those trade-offs before we know whether mass beats speed is
guesswork. This phase replaces the guess with measurement.

## 2. Scope

In: movement, combat, elimination, seven driver personalities, one arena with its full
hazard set, the collapse endgame, and a headless metrics harness.

**Not in scope** (deliberately deferred):

- The seven bot categories and their options — Phase 4. Bots here use a small set of
  hand-written stat blocks.
- Real visuals, lighting, particles, sound — Phases 6–8. Rendering is flat shapes.
- Arenas 2–5 — Phase 9.
- Top weapons, special abilities, armour materials. Greybox combat is ramming plus a
  directional front weapon, which is the minimum that makes positioning matter.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Target match length | 2–3 minutes typical, 5 minutes hard maximum |
| Endgame | Spiral floor collapse, starts 2:30, complete by 5:00 |
| Combat scope | Ramming + directional front weapon |
| Movement | Vehicle model — thrust along heading, limited turn rate, grip |
| Arena 1 | Boxed, 16×12 tiles, walls with saws / flame jets / gaps, pits, tar, ice |
| Arena size | Moderate — room to manoeuvre |
| Collapse telegraph | ~1.5s warning before a tile drops |
| Hazard awareness | All bots aware; weighted by personality |
| Playback | Fixed 1x, real time |
| Personalities | Seven (§9.3) |

## 4. Deterministic trigonometry

Bots have headings, which needs trig, which `src/sim/` bans — `Math.sin`/`Math.cos` are
implementation-approximated and not bit-identical across JavaScript engines.

**Heading is stored as an integer index, not an angle.** 4096 steps around the circle
(0.088° resolution). Turning is integer addition with wraparound, so it accumulates
*zero* error, unlike repeatedly rotating a float vector.

Direction vectors come from a 4096-entry table built at module load using a minimax
polynomial approximation of sine over a reduced range, composed only of `+`, `-`, `*`,
`/`. IEEE 754 mandates exact results for those, so the table is identical on every
engine. Quadrant reduction is exact integer arithmetic on the index.

Like the PRNG, this ships with a **locked golden vector** — a hardcoded set of expected
table values, verified to fail when the polynomial is perturbed. Self-comparative tests
cannot detect a changed approximation.

## 5. Arena representation

### 5.1 Tiles

A 16×12 grid of 60-unit tiles: a 960×720 arena. Bots are roughly 40 units across, so one
comfortably occupies a tile.

Each tile is `SOLID`, `WARNING`, or `GONE`.

**One rule governs falling: a bot whose centre is over a `GONE` tile is eliminated.**

That single rule provides three features:

- **Death pits** — tiles that start `GONE`
- **Wall gaps** — a missing wall segment with `GONE` tiles beyond it
- **The collapse** — tiles becoming `GONE` over time

Centre-based rather than footprint-based support is deliberate: it is simple, exactly
deterministic, and at a 60-unit tile against a 40-unit bot the visual overhang is small.

### 5.2 Walls

The arena perimeter is a list of segments, reusing the existing `resolveCircleSegment`.
Gaps are simply segments that are absent.

### 5.3 Hazards

A hazard is a region plus an effect. All four share one interface, so a new arena is a
different hazard list rather than new code.

| Hazard | Effect |
|---|---|
| Saw blade | Continuous damage and knockback while in contact. Wall-mounted. |
| Flame jet | Damage within a short cone, on a fixed on/off cycle. Wall-mounted. |
| Tar | Multiplies drag — bots bog down and lose speed. |
| Ice | Multiplies grip — bots slide and cannot turn effectively. |

Flame cycles are driven by the tick counter, never by wall-clock time.

## 6. Bot model and movement

Bots extend the existing `Body` with heading, turn rate, grip, health, weapon, and
personality.

**Movement is a vehicle model, not omnidirectional:**

1. Thrust is applied along the current heading.
2. Heading turns toward the desired heading at a limited rate per tick.
3. Grip resists lateral velocity — the component perpendicular to heading is damped.

A bot that turns sharply at speed drifts. On ice, grip drops and it drifts badly.

This is the decision that makes drive systems meaningful in Phase 4. Omnidirectional
movement was the alternative — simpler, but it makes tank tracks and omni wheels
mechanically identical and renders ice pointless. Under the vehicle model, omni wheels
become a high-grip, high-turn-rate build rather than a special case.

**Speed ceiling.** As in Phase 1, a body must never travel further in one tick than the
smallest collision radius it could pass through, or it tunnels. With a bot radius near 20,
the ceiling is 20 — and since tar and ice change effective speed, the clamp must be
applied after those modifiers, not before. This is worth a dedicated test: a
high-speed bot driven at a wall, at a thin hazard, and across a one-tile pit.

## 7. Combat

On bot-to-bot contact:

```
damage = impactSpeed × weaponDamage × arcAlignment ÷ targetArmour
```

`arcAlignment` measures how close the contact point is to the attacker's front, computed
from the heading index. Contact within the front arc does full damage; a side or rear
contact does little.

**Both bots resolve damage independently against the same contact.** A head-on collision
hurts both. A clean flank attack is one-sided. That asymmetry is the single most
important thing to validate in this phase — it is what makes positioning matter, and
everything in Phase 4 depends on it working.

Health reaching zero eliminates a bot. So does falling (§5.1).

## 8. Engagement model

Each tick the simulation derives a lightweight picture of who is fighting whom. Two bots
are **engaged** if they are within a short distance of each other and have exchanged
contact within roughly the last 1.5 seconds.

From this the AI can ask: who is engaged, who is isolated, who is weakened, who has the
most kills.

This exists because three personalities need to reason about *relationships between other
bots* rather than just positions. It is built once and read by all of them — and it also
makes Defensive smarter (avoid the scrum) and Hit-and-Run smarter (strike someone already
busy).

## 9. AI

### 9.1 Utility scoring

Each tick, a bot scores its available actions and takes the highest:

- chase nearest / chase weakest / chase leader
- retreat / disengage
- circle-strafe
- avoid danger (pits, hazards, `WARNING` tiles)
- attack an engaged pair
- shove a target toward a hazard or another bot
- charge — back off to build a run-up, then strike at speed
- celebrate

Personality is a weight vector over these. Danger avoidance being scored like any other
action is what makes hazard awareness personality-dependent without special cases.

### 9.2 Action states

Some behaviours must persist rather than be re-scored every tick. An **action state**
locks a bot into a behaviour for a fixed number of ticks, suspending normal scoring.

Two consumers:

- **Disengage** — Hit-and-Run locks into retreat for a period after landing a hit.
- **Celebrate** — a short flashy routine after causing an elimination, during which the
  bot neither pursues nor defends. It is a deliberate vulnerability window.

### 9.3 The seven personalities

| Personality | Behaviour |
|---|---|
| **Aggressive** | Hellbent on attacking, rarely backs off, prioritises dealing damage. Low danger weighting. |
| **Defensive** | Avoids trouble but attacks when necessary. Fights an intelligent battle — high danger weighting, prefers isolated or weakened targets. |
| **Hit-and-Run** | Strikes, then disengages via action state, then repeats. Damage followed by self-preservation. |
| **Third Party Predator** | Seeks two bots already engaged and attacks them mid-fight, hunting 2-on-1 eliminations. |
| **Agent of Chaos** | Completely unpredictable. Periodically rerolls its own weight vector from the seeded PRNG, cycling through the other personalities during a battle. |
| **Showman** | Charges from distance for big dramatic hits, fights on the edge of danger, and performs a flashy celebration after eliminations — briefly prioritising looking cool over attacking or surviving. |
| **Instigator** | Bumps bots into each other and steers them into hazards, interrupting fights to redirect aggression. Rarely commits to a full fight itself. |

**Balance expectation:** Third Party Predator and Instigator are parasitic strategies and
are the two most likely to be badly balanced on the first pass — either dominant, because
others do the damage for them, or useless, because they never commit hard enough to
secure a kill. This is expected. The win-rate metric (§11) is how we find out.

## 10. The collapse

Nothing happens before **tick 9,000 (2:30)**.

From then, tiles become `GONE` in an outside-in spiral, one at a time, so that all tiles
are gone by **tick 18,000 (5:00)**. With 192 tiles that is roughly one every 47 ticks.

A tile enters `WARNING` about 90 ticks (1.5s) before dropping. Since the drop interval is
shorter than the warning, roughly two tiles are flashing at once, which reads as a wave
chasing bots inward rather than isolated squares blinking.

The collapse is a hard 5-minute ceiling on match length.

## 11. Termination and tiebreaks

The match ends when one bot remains.

If the floor runs out entirely, every surviving bot falls. Ranking is then: **last to fall
wins**; if the same tick, highest remaining health; if still tied, lowest bot index.

Ugly, but fully deterministic and incapable of hanging.

The simulation records the complete placement order, 10th through 1st, plus the cause of
each elimination.

## 12. Metrics — how we answer "is it fun?"

A headless harness runs hundreds of matches and reports:

- **Match length distribution** — are we hitting 2–3 minutes?
- **Elimination pacing** — spread evenly, or six deaths in twenty seconds then a
  four-minute standoff?
- **Cause of death mix** — combat vs hazard vs pit vs collapse. If most deaths are
  hazards, the arena is fighting the bots instead of the bots fighting each other.
- **Win rate by personality** — the most valuable number here. If one personality wins
  60% of matches, the model is broken before a single category exists.

Win rate by personality is what Phase 4 consumes: it tells us which stats dominate, and
therefore what the category trade-offs actually need to trade against.

## 13. Build order

1. Deterministic trig + golden vector
2. Bot movement — thrust, turn, grip. No combat. **Watch before continuing.**
3. Arena tiles + falling
4. Combat, health, elimination. **Watch before continuing.**
5. AI:
   - 5a — utility core + Aggressive, Defensive, Hit-and-Run
   - 5b — engagement model + Third Party Predator + Instigator
   - 5c — action states + Showman + Agent of Chaos
6. Hazards — saws, flame jets, tar, ice
7. The collapse
8. Headless harness and the four metrics
9. Renderer and viewer page

Agent of Chaos is last by necessity — it cycles through the other personalities, so they
must exist first.

## 14. Deferred decisions

- Concrete stat values for the placeholder bots — set during step 4, tuned during step 8.
- Whether parasitic personalities need rebalancing — after step 8, decided by data.
- Arena 1's exact hazard placement — during step 6, informed by watching step 4.
- Whether 1x playback holds up over a full 5-minute match — after step 9, by watching one.
- Arenas 2–5 — Phase 9.
