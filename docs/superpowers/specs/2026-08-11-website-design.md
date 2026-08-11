# The Website — Design Spec

**Date:** 2026-08-11
**Status:** Approved
**Parent specs:** `2026-08-03-quest-draft-selector-design.md`, `2026-08-05-bot-categories-design.md`
**Deadline:** end of August 2026

## 1. What this is

The thing the league actually touches. Everything built so far — the deterministic core, the
Forge, three arenas, six part categories, scoring — exists to be watched through this.

Ten members open a link, pick their name, and watch a twelve-to-fifteen minute event that
ends with the draft order. Nothing is decided while they watch; the event was recorded
beforehand and is replayed from a single seed. The experience is a reveal, not a game.

**It must never spoil itself.** A member who reloads, opens dev tools, or arrives late must
not see a result before the moment it is meant to land.

## 2. The shape of the experience

One league this year: a single ten-member roster in a config file. No league picker.

Battles play at true speed. The pacing was tuned for it — 81.6% of eliminations land after
the one-minute mark, and that build only reads at 1×.

### The beats, in order

| # | Beat | What happens |
|---|---|---|
| 1 | **Landing** | Title, tone, one button: Begin. |
| 2 | **Name select** | Ten names. Picking yours sets the member you follow. |
| 3 | **What to expect** | The orientation. Three things explained fast: the Forge, the battles, the scoring. Ends with the button that truly starts the event. See §2.1. |
| 4–9 | **The Forge**, six boards | One per category, in `CATEGORIES` order: chassis, drive, weapon, armour, ability, personality. Ten balls drop at once. A panel on the right reveals each member's result **progressively, as their ball settles** — the trickle is better television than a dump at the end. |
| 10 | **The build reveal** | Your bot full-screen, every part labelled. Scout the other nine. See §5.3. |
| 11 | **Battle 1** — The Grinder | |
| 12 | **Standing after battle 1** | Placement points, kill points, total. One screen: with one battle played, the round result *is* the standing. |
| 13 | **Battle 2** — The Gauntlet | |
| 14 | **Battle 2 result** | That battle alone, ordered by who scored most **in it**. |
| 15 | **Standings after two** | Cut to the cumulative board: battles 1 and 2 broken out, grand total, ordered by total. |
| 16 | **Battle 3** — The Crossfire | |
| 17 | **Battle 3 result** | That battle alone, ordered by who scored most in it. |
| 18 | **THE DRAFT ORDER** | All three battles broken out, grand total, counted up from tenth to first. The payoff. |
| 19 | **Complete** | Final board persists. Skip navigation unlocks. Rewatchable. |

The order flips between beats 14 and 15, and again between 17 and 18. Someone can win
battle 3 outright and still land sixth overall. **That gap is the drama**, and it comes free
from the format.

Battle 1 gets one screen where 2 and 3 get two. That asymmetry is correct — inventing a
second screen showing identical data would be worse — but it means the walkthrough's rhythm
is not uniform, and the transitions should not pretend otherwise.

### 2.1 What to expect — the orientation

Beat 3 is the true start of the experience. Name select is admin; this is where the excitement
is manufactured. It has to be punchy, quick to read, and fun to look at, and it ends with the
button that begins the event proper.

Three things, in this order, because that is the order they happen:

**The Forge.** Six boards. Ten balls. Nobody chooses anything — the ball decides which chassis
you get, which weapon, which armour. Everyone gets a bot; nobody gets to pick it.

**The battles.** Three arenas, each built to punish something different. Last bot standing.

**The scoring.** Where you finish scores points. Kills score more. Three battles added
together decide the draft order. The honest one-liner is **"survive to score, fight to score
more"** — at 3 points a kill, kills sharpen a placement but rarely overturn it, and the copy
should not oversell them.

**Do not tell the viewer the event is pre-recorded.** It is, and the architecture depends on
it, but saying so drains the wonder. The site should feel live. That is a copy decision, not
an engineering one — the mechanics in §3 and §4 are unchanged, they simply are not announced.

### Words and pictures, side by side

Each of the three gets **both** a short written description **and** a live visual beside it.
Neither alone does the job: the visuals make it exciting, the words make it understood, and a
viewer who grasps the scoring before battle 1 gets far more out of every scoreboard that
follows.

| Section | Words | Picture |
|---|---|---|
| The Forge | What the boards are, that the ball decides, that nobody picks | A short looping ball drop |
| The battles | Three arenas, each punishing something different, last bot standing | A miniature live arena |
| The scoring | Placement points, kill points, three battles totalled | The points table, plainly laid out |

The renderer already exists, so the two live panels are nearly free.

**Any demo loop must use a seed that is not the official one.** Rendering the real Forge or a
real battle here would spoil the event on its own orientation screen. The demo seed is a fixed
constant, unrelated to the record, and that constraint is not optional.

Skippable after the unlock, like every other beat.

### The final reveal

Beat 18 is the whole event's payoff and is built differently from every other board.
Positions resolve from **tenth up to first**, one at a time, slow enough to be unbearable.
Everything else — the per-battle boards, the cumulative boards — simply appears.

### Ties must explain themselves

**13.3% of placements need a tiebreak**, so most events will have at least one, and it will
usually land on the final board. Two members on identical totals with no explanation reads
as a bug. Every board shows the reason when one applies:

> tied on 61 — **Dave** wins on eliminations, 7 to 4

The chain is points → eliminations → damage → member id. The `memberId` fallback has never
fired in measurement and must never be shown; if it ever does, that is a defect, not a
result.

## 3. Architecture

Three layers, and the boundary between them is the determinism contract:

```
src/sim/     pure, deterministic, lint-enforced. Knows nothing above it.
src/render/  PixiJS. Draws simulation state. May use wall-clock time.
src/shell/   The site. Screens, state, routing, audio, progress.
```

### Beat state, progress, and re-watching

A linear state machine over the beats in §2. Two **separate** pieces of stored state, and
keeping them separate is what makes re-watching work:

| Stored | Lifetime | Purpose |
|---|---|---|
| `hasCompletedOnce` | Sticky | The unlock. Once the event has been watched through, skip navigation stays available forever. |
| Current watch: claimed member + furthest beat | Resettable | Where this viewing is up to, and whose bot is highlighted. |

**Resume where you left off.** A member who closes the tab at minute ten returns to the next
unwatched beat and cannot jump forward.

**"Watch again as someone else" clears only the current watch.** Pick a different name, see
the whole event from their side — and because `hasCompletedOnce` survives, you are never
re-locked. Nobody is stuck with their first choice.

Both are keyed by the event seed, so a re-recording resets everyone rather than resuming
them into an event that no longer exists.

## 4. The seed and the official record

**One master seed decides everything.** `deriveSubSeeds(masterSeed)` draws all six Forge
seeds and all three battle seeds from a single stream in fixed order. There is no per-board
or per-battle seed to choose.

**Valid range: 1 to 2,147,483,647.**

The admin flow is a shortlist, not a lottery:

```bash
npm run record -- 10            # roll ten random candidates, print their draft orders
npm run record -- --seed <n>    # preview ONE specific seed        [TO BUILD]
npm run replay -- <battle-seed> # screen a battle for stalls
npm run record -- --save <n>    # write it as the official record
```

`--seed <n>` does not exist yet and is a prerequisite (§8). It exists so a seed can be handed
over, inspected, watched in the browser, and only then committed.

### The check on load

On load the site runs `runEvent(config)` — about 2.5 seconds — producing the Forge boards,
the three battles and the standings. **It then compares the checksum against the recorded one
and refuses to continue if they disagree.**

That single check is what guarantees the league sees the event the admin approved. A mismatch
means the simulation changed after recording, and showing a different draft order would be
worse than showing an error.

Visual playback re-runs each simulation locally, tick by tick, so the per-battle seeds must
be exposed alongside the results.

## 5. Identity — how you find yourself

Ten similar shapes in a brawl are unfollowable. Three mechanisms, doing three different jobs.

### 5.1 A distinct colour per member

Every member owns one colour, used for **both** their Plinko ball and their bot. This is what
makes a ten-way fight legible at a glance.

**Status: specified, not built.** `EventMember` carries a `colour` field and the test
fixtures use a ten-colour palette, but no roster config exists and nothing wires member colour
through to bot tint or ball tint. It is real work.

**Do not inherit the test palette unexamined.** It contains pairs that are risky in motion at
small size — magenta `#f032e6` against pink `#fabebe`, yellow `#ffe119` against lime
`#bcf60c`. Ten moving targets is the hardest case for colour discrimination. Pick the palette
deliberately, alongside the style guide, and check it at actual bot size rather than as
swatches.

### 5.2 Initials on every ball and bot

Two characters — first initial, last initial — rendered small and unobtrusive on each ball
and bot. Colour answers "which one is mine" at a glance; initials answer "who is that" when
two colours are momentarily confusable.

`BitmapText` is the right primitive: it updates per frame cheaply, which `Text` does not.

**The roster config must validate that initials are unique** and fail loudly if two members
collide, rather than silently rendering two identical labels.

### 5.3 The highlight, and the build reveal

The member you claimed gets a **persistent glow** on their bot for the whole event. Colour and
initials identify everyone; the glow identifies *you*.

Beat 10 shows **your bot full-screen**, with every one of its six parts labelled — the result
plus a short, punchy line on what it does. A selector lets you browse the other nine members'
bots and scout the competition.

**Browsing never changes who you claimed.** Looking at someone else's build is scouting, not
switching; the highlight in battle stays on your own bot regardless of who you last viewed.
(Changing allegiance is a deliberate act, and it lives in "watch again as someone else" — §3.)

This needs **39 part descriptions** written as a new field in `tables.ts` — 6 chassis, 6
drives, 6 weapons, 7 armour, 7 abilities, 7 personalities. A writing task, not a config
toggle.

## 6. The effect bus — sound and VFX on one wire

The single most important architectural decision here, because it is expensive to retrofit.

The simulation already knows every moment worth reacting to: `resolveHit` knows a weapon
landed and how hard, zones know when they burn someone, `resolveCircleCircle` knows every
impact speed, eliminations are already recorded. What it lacks is a way to say so.

`Match` gains an effect list, cleared at the start of each tick and appended to at the
existing damage sites — the same shape `match.eliminations` already has:

```ts
type EffectKind =
  | 'weaponHit' | 'hazardHit' | 'collision' | 'elimination'
  | 'trapdoor'  | 'cannonFire' | 'abilityFire';

interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  /** 0–1. Impact speed, damage dealt, or knockback, normalised per kind. */
  intensity: number;
  botId: string | null;
}
```

**Both sound and visual effects read from this one list.** Sparks on a weapon clash, a flash
on a hazard hit, screen shake on a heavy collision — all of it wants the same question
answered: what hit what, where, and how hard.

### Determinism rules for the bus

- Effects are **derived**, never causal. Nothing in `src/sim/` may read them.
- They are **not** part of the checksum. Adding an effect kind must never change a recorded
  event.
- They are cleared at the **start** of a tick, so a tick's list describes only that tick.
- The shell may advance several ticks in one frame. It drains effects **after each**
  `advanceMatch` into a per-frame buffer, or dropped frames silently swallow events.

## 7. Sound

Deliberately narrow: **weapon clashes, hazard contact, collisions, eliminations.** No crowd,
no announcer, no engine noise.

Web Audio API, a small set of CC0 samples (Kenney's impact and sci-fi packs are public
domain, no attribution). Four to five distinct sounds: weapon hit light, weapon hit heavy,
hazard contact, hard collision, elimination.

- **Volume scales with `intensity`.** A glancing Saw Blade tick and a Hammer landing flush
  should not sound the same.
- **Pan by x position.** Nearly free, and it makes a 960-wide arena feel wide.
- **A mute control**, always reachable.

### Throttling is the hard part

Ten bots, a Flamethrower on an 8-tick cooldown, Ram Plates on 16 — a busy match generates
comfortably fifty contact events per second. Played naively that is not sound design, it is
white noise, and it is the specific thing that makes browser game audio feel cheap.

Required: a **per-kind minimum interval**, a **global voice cap**, and priority so an
elimination is never starved by chip damage. Expect to tune it by ear; the first numbers
will be wrong.

### Browsers block audio until a gesture

The AudioContext must be resumed from a user interaction. **The Begin button on the landing
screen is that gesture** — which is convenient, because it is the one click guaranteed to
happen before anything makes noise.

## 8. Visual treatment

Gritty base, neon accents. The renderer today draws coloured shapes; the awe-factor comes
from three things, in descending order of value per hour:

1. **Filters and blend modes.** Additive glow is how neon reads as neon. Bloom on
   eliminations, displacement on shockwaves, colour grading per arena.
2. **Particles.** `ParticleContainer` batches thousands cheaply. Sparks on clashes, embers
   from flame jets, debris on elimination.
3. **Textures**, where they earn their place.

### Art is optional and hot-swappable

**The renderer takes textures if present and falls back to its current primitives if not.**
The site can be built, finished and deployed on greybox-plus-effects, with art dropped in
later without blocking anything. If the art never comes together, there is still a working
event.

### Four visual channels, four jobs

Art is worth making for **three** categories: chassis shape, armour material, front weapon.
The other three are correctly excluded — driver personality is a behaviour not a look,
special ability is about what happens rather than what it looks like, and drive system is
barely visible from directly above.

But 6 chassis × 7 armour × 6 weapons is **252 combinations**, so they cannot be pre-rendered
together. They must composite, which means each has to own a **different visual channel** or
they will fight for the same pixels:

| Channel | Carries | Why |
|---|---|---|
| **Silhouette** | chassis shape | The strongest read at a glance, and the most distinctive spec difference |
| **Fill colour** | member identity | Must win. Following your own bot is the entire emotional hook |
| **Rim / edge treatment** | armour material | Heavy dark rim for Depleted Uranium, visible spikes for Spiked Composite, a thin bright edge for Carbon Fibre |
| **Front attachment** | weapon | A separate sprite, mounted and animated |

**Armour as edge rather than fill is the key move.** If armour claimed the fill it would
collide with member colour, and member colour cannot lose that fight.

Each chassis therefore needs a **weapon mount point** — six coordinates saying where the
weapon attaches. Small, but it must exist before weapon art is usable.

### Weapon animation

Everything needed already exists in the simulation. Two kinds:

**Continuous** — Vertical Spinner, Saw Blade and Spinning Bar simply spin. Purely cosmetic,
driven by the ticker, never touching simulation state.

**Triggered** — the Hammer winds up and swings. `bot.nextAttackTick` is already on the bot,
so the renderer knows when the next attack lands and can start the windup *before* it, then
the `weaponHit` effect confirms the connection. **Anticipation for free, with no new
simulation data.**

Ram Plate gets a shove flash rather than a moving part. Flamethrower emits a jet cone off its
hits — at an 8-tick cooldown that reads as near-continuous fire.

### Constraints on generated art

Four requirements that are easy to miss and expensive to discover late:

- **Top-down orthographic.** Image models default to three-quarter perspective. A bot drawn
  in perspective cannot rotate on a 2D plane — it will look wrong at every heading but one.
- **Greyscale or near-white.** Bots are tinted with member colour at runtime. Baked-in colour
  cannot be tinted, and the per-member identity is lost.
- **No baked glow.** Neon comes from blend modes so it can pulse and react. Glow painted into
  a texture is dead light.
- **Identical canvas size and consistent scale** across the six chassis, or they will not sit
  together.

## 9. Prerequisites that do not exist yet

Found while checking this spec against the code. All small, all blocking:

| Missing | Needed for |
|---|---|
| **A roster config file** | Everything. Members currently exist only in test fixtures. Needs id, name, initials, colour — with uniqueness validation on initials. |
| **`npm run record -- --seed <n>`** | Previewing a specific seed before committing to it |
| **A `blurb` field on all 39 parts** | The build reveal (§5.3) |
| **Weapon mount points per chassis** | Weapon art and animation (§8) |

## 10. Out of scope

- **Multiple leagues.** One roster this year.
- **An admin UI.** Recording is a CLI flow and stays one.
- **Mobile-first.** Desktop is the target. It should not be *broken* on a phone, but the
  layout is designed for a shared screen.
- **Crowd, announcer, engine audio.**
- **Art for drive system, ability, or personality.**

## 11. Before recording the official event

Aggregate metrics cannot protect a single viewing. A defect appearing in 5% of matches is
statistically invisible across 200 matches and still has roughly a one-in-seven chance of
landing in the three battles the league actually watches. Two real bugs this week — the
cannon lane trap and the wall repulsion — were found by watching one match, after hours of
aggregate measurement missed both.

**So the chosen seed's three battles must be replayed through `npm run replay` and checked
for stall events and a healthy combat timeline before the event is saved.** It takes seconds
and it is the check that catches exactly the thing averages hide.

## 12. Open decisions

- **Font.** Self-hosted so GitHub Pages serves it offline and free. One of the largest levers
  on whether the site reads as designed or generic. Pending the style guide.
- **Palette.** Ten colours, checked at bot size in motion, not as swatches. Pending the style
  guide.
- **How the build-reveal (beat 10) member selector is presented** — dropdown, icon row, or something
  else. Decide once it can be seen.
