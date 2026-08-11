# The Website — Design Spec

**Date:** 2026-08-11
**Status:** Awaiting review
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
| 2 | **Name select** | Ten names. Picking yours sets "you" for the rest of the event. |
| 3–8 | **The Forge**, six boards | One per category, in `CATEGORIES` order: chassis, drive, weapon, armour, ability, personality. Ten balls drop at once; when they settle, the board pauses and names what everyone got, with your own result highlighted. |
| 9 | **The build reveal** | Your bot, assembled from its six parts, named. Then the other nine. This is the Forge's payoff and the last calm moment before fighting. |
| 10 | **Battle 1** — The Grinder | |
| 11 | **Standing after battle 1** | Placement points, kill points, total. One screen: with one battle played, the round result *is* the standing. |
| 12 | **Battle 2** — The Gauntlet | |
| 13 | **Battle 2 result** | That battle alone, ordered by who scored most **in it**. |
| 14 | **Standings after two** | Cut to the cumulative board: battle 1 and battle 2 broken out, grand total, ordered by total. |
| 15 | **Battle 3** — The Crossfire | |
| 16 | **Battle 3 result** | That battle alone, ordered by who scored most in it. |
| 17 | **THE DRAFT ORDER** | All three battles broken out, grand total, counted up from tenth to first. The payoff. |
| 18 | **Complete** | Final board persists. Skip navigation unlocks. Rewatchable. |

The order flips between beats 13 and 14, and again between 16 and 17. Someone can win
battle 3 outright and still land sixth overall. **That gap is the drama**, and it comes free
from the format.

Battle 1 gets one screen where 2 and 3 get two. That asymmetry is correct — inventing a
second screen showing identical data would be worse — but it means the walkthrough's rhythm
is not uniform, and the transitions should not pretend otherwise.

### The final reveal

Beat 17 is the whole event's payoff and is built differently from every other board.
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

### Replay, and the check on load

The site holds **one seed**. On load it runs `runEvent(config)` — about 2.5 seconds — which
produces the Forge boards, the three battles, and the standings.

**It then compares the checksum against the recorded one and refuses to continue if they
disagree.** That single check is what guarantees the league sees the event the admin
approved. A mismatch means the simulation changed after recording, and showing a different
draft order would be worse than showing an error.

Visual playback re-runs each simulation locally, tick by tick, so the shell needs the
per-battle seeds exposed alongside the results.

### Beat state and progress

A linear state machine over the beats in §2. Progress — the furthest beat reached — is
stored in `localStorage`, keyed by the event seed so a new recording resets everyone.

**Resume where you left off.** A member who closes the tab at minute ten returns to the next
unwatched beat. They cannot jump forward. After beat 18 the whole event unlocks and any beat
becomes reachable.

Keying by seed matters: if the admin re-records, every member starts fresh rather than
resuming into an event that no longer exists.

## 4. The effect bus — sound and VFX on one wire

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

## 5. Sound

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

## 6. Visual treatment

Gritty base, neon accents. The renderer today draws coloured shapes; the awe-factor comes
from three things, in descending order of value per hour:

1. **Filters and blend modes.** Additive glow is how neon reads as neon. Bloom on
   eliminations, displacement on shockwaves, colour grading per arena.
2. **Particles.** `ParticleContainer` batches thousands cheaply. Sparks on clashes, embers
   from flame jets, debris on elimination.
3. **Textures**, where they earn their place.

### Art is optional and hot-swappable

**The renderer takes textures if present and falls back to its current primitives if not.**
This is deliberate: the site can be built and finished on greybox-plus-effects, with art
dropped in later without blocking anything or forcing a rebuild.

Three asset sets are worth making, in order:

| Asset | Count | Why |
|---|---|---|
| Style guide | 1–2 images | Establishes palette and material feel. Highest leverage — once it exists, filters and primitives can match it without needing art for everything else. |
| Chassis silhouettes | 6 | The most visible build differentiator, and only six files. |
| Arena floor tiles | 3 | Seamless, one per arena. |

Per-part art is **out of scope**. 74,000 combinations cannot be pre-rendered and compositing
six layers per bot is next year's work.

### Constraints on generated art

Four requirements that are easy to miss and expensive to discover late:

- **Top-down orthographic.** Image models default to three-quarter perspective. A bot drawn
  in perspective cannot rotate on a 2D plane — it will look wrong at every heading but one.
- **Greyscale or near-white.** Each member's bot is tinted with their colour at runtime.
  Baked-in colour cannot be tinted, and the per-member identity is lost.
- **No baked glow.** Neon comes from blend modes so it can pulse and react. Glow painted
  into a texture is dead light.
- **Identical canvas size and consistent scale** across the six chassis, or they will not
  sit together.

### Finding yourself

Each member has a colour, and the member who picked their name gets a **persistent
highlight** on their bot — a ring or glow that survives the whole event. Without it, ten
similar shapes in a brawl are unfollowable, and following your own bot is the entire
emotional hook.

## 7. Out of scope

- **Multiple leagues.** One roster this year.
- **An admin UI.** Recording is already done and works: `npm run record -- 10` rolls
  candidates, `--save <seed>` writes the official record.
- **Mobile-first.** Desktop is the target. It should not be *broken* on a phone, but the
  layout is designed for a shared screen.
- **Crowd, announcer, engine audio.**
- **Per-part bot art.**

## 8. Before recording the official event

Aggregate metrics cannot protect a single viewing. A defect appearing in 5% of matches is
statistically invisible across 200 matches and still has roughly a one-in-seven chance of
landing in the three battles the league actually watches. Two real bugs this week — the
cannon lane trap and the wall repulsion — were found by watching one match, after hours of
aggregate measurement missed both.

**So the chosen seed's three battles must be replayed through `npm run replay` and checked
for stall events and a healthy combat timeline before the event is saved.** It takes seconds
and it is the check that catches exactly the thing averages hide.

## 9. Open decisions

- **Font.** Self-hosted so GitHub Pages serves it offline and free. One of the largest levers
  on whether the site reads as designed or generic. Pending the style guide.
- **Palette.** Pending the style guide.
- **Whether beat 9 (the build reveal) shows all ten bots or only yours.** All ten is more
  informative and slower; only yours is punchier. Decide once it can be seen.
