# Quest Draft Selector — Design Spec

**Date:** 2026-08-03
**Status:** Approved for planning

## 1. Purpose

Determine the draft order for a 10-member fantasy football league through a series of
pre-recorded, randomly-determined simulation events, and publish those events as a
guided viewing experience on a website that league members watch like a movie.

The outcome is decided once, by the admin, in advance. Members do not play, control,
or influence anything. They watch how it already unfolded.

## 2. Goals

- Produce a draft order nobody can dispute, because every input is random.
- Make the reveal genuinely entertaining to watch — the point is the experience, not the result.
- Let the admin run simulations repeatedly, pick a good one, and lock it in as official.
- Guarantee every member sees the identical event, on any browser, forever.
- Cost $0 in perpetuity. No paid services, no APIs, no subscriptions, no credit card.

## 3. Non-goals

- Real-time multiplayer or member-controlled gameplay.
- Any server-side component, database, or account system.
- Member input into bot design (bots are randomly generated — see §7).
- Mobile-optimized design. Desktop is the primary and optimized target. Mobile must remain
  functional and legible — members will try it — but layout, arena readability, and effect
  density are tuned for desktop.

## 4. Constraints

| Constraint | Detail |
|---|---|
| Budget | $0. Free tiers only. Open-source dependencies only. |
| Hosting | Static site. No backend of any kind. |
| League size | 10 members. Engine must handle 2–12. |
| Reproducibility | Identical playback across browsers, machines, and time. |
| Events | 1 required (Arena). Up to 5 total, with a scoreboard between them. |

## 5. Locked decisions

| Decision | Choice |
|---|---|
| Rendering | PixiJS (WebGL 2D), top-down view |
| Physics | Custom deterministic 2D physics, written in-house |
| Recording | Seed + deterministic replay, verified by checksum |
| Bot creation | Randomly assigned via a Plinko ceremony ("The Bot Forge") |
| Plinko drops | All 10 balls simultaneously, per category round |
| Plinko odds | Natural binomial bell curve; jackpot slots at far edges |
| Plinko scoring | None. Creation only. All points come from the Arena. |
| Art direction | Gritty industrial base, per-member neon accent glow |
| Bot artwork | Blender-modelled, baked to top-down sprite sheets |
| Audio | Full sound design, sourced from CC0 libraries |
| Target device | Desktop primary and optimized; mobile functional but untuned |

## 6. Architecture

Three layers with a strict one-way dependency. This is the constraint everything else rests on.

```
sim/      Pure logic. No pixels, no DOM, no timers. Fixed 60Hz timestep.
          Runs headless at thousands of frames per second.
render/   PixiJS. Reads sim state and draws it. Knows no game rules.
shell/    Page UI, playback controls, member selection, official-record loading.
```

`sim/` must never import from `render/` or `shell/`.

The payoff: we can run 5,000 battles headlessly in seconds to statistically balance
seven interacting categories of trade-offs. Balancing by eyeballing individual matches
is not viable at this complexity, and this is the only affordable way to do it properly.

### 6.1 Determinism contract

Four rules `sim/` obeys without exception:

1. **Single seeded PRNG.** All randomness derives from one xorshift128+ generator seeded
   per event. `Math.random()` is banned in `sim/` and enforced by lint rule.
2. **Fixed timestep.** 60Hz logic ticks. The sim never reads wall-clock time. Viewer
   frame rate affects rendering smoothness only, never outcomes.
3. **No transcendental math.** `Math.sin/cos/tan/atan2/pow` are not guaranteed
   bit-identical across JS engines. `sim/` uses fixed-size lookup tables for trig and
   squared-distance comparisons instead of `sqrt` wherever possible. Also lint-enforced.
4. **Checksum verification.** Every official record carries a hash of its final state.
   A verify step replays the record and confirms the hash matches. Drift is detected
   in development, never during the event.

### 6.2 Official record format

The complete recording of an event:

```json
{
  "event": "arena",
  "version": 1,
  "seed": 8471029,
  "arena": "iceworks",
  "bots": [ { "member": "Vince", "chassis": "tower", "drive": "tracks", ... } ],
  "checksum": "a3f9c1..."
}
```

A few hundred bytes. Playback re-runs the simulation from the seed and reproduces the
event exactly. This buys us crisp rendering at any resolution, and the ability to add
slow-motion on eliminations, camera moves, or visual polish *after* recording without
invalidating the result.

**Fallback:** if cross-browser drift proves unfixable, we export a compressed
frame log (~2–5MB) instead. The record format is versioned to allow this swap.

## 7. Bot model

Each bot is defined by seven categories:

1. Chassis Shape
2. Drive System
3. Front Weapon
4. Top Weapon / Defense
5. Armor Material
6. Driver Personality
7. Special Ability

Every option in every category resolves to modifiers on one shared stat block:

```
mass, maxHealth, armor, topSpeed, acceleration, turnRate, grip,
weaponDamage, weaponArc, attackCooldown, knockback, selfDamage
```

...plus ability hooks and AI personality weights.

**This is the key abstraction.** The arena engine never knows what "Titanium" means —
it only sees numbers. Categories can be redesigned, rebalanced, added, or removed by
editing a data table, without touching combat code.

The specific options within each category, and their individual pros and cons, are
designed collaboratively in Phase 4 (§11). This spec fixes the *structure*, not the values.

## 8. The Bot Forge (Plinko ceremony)

Seven rounds, one per category. All 10 balls drop simultaneously in each round.

- **Release positions:** all 10 balls release across the middle ~20% of the board with
  a small vertical stagger. They cannot share a release point (they would jam).
  Collisions begin immediately, preserving chaos, while keeping the bell curve intact
  and the edges genuinely rare.
- **Slot layout:** common options in the center, stronger options flanking, jackpot
  options at both far edges.
- **Odds:** all slots are equal width. Odds are therefore determined entirely by the
  natural binomial distribution of the peg grid, not by geometry. Center slots are hit
  frequently, outer slots rarely. Row count is the primary tuning dial — more rows sharpen the bell and
  make edges rarer. Target distribution is tuned empirically by running 100,000
  headless drops and reading the actual outcome spread. Rare must be rare, never impossible.
- **Ball identity:** each ball carries its member's color and a name label that tracks it,
  so a 10-way scramble stays readable.
- **Assembly:** between rounds, each member's bot silhouette visibly assembles —
  chassis appears, drive attaches, weapons bolt on. After round 7, ten finished machines.

### 8.1 Pity system (configurable, default off)

Optional rule: a ball's release position on board N+1 shifts outward proportional to how
common its board-N result was. Members who keep landing common get nudged toward the edges.

Trade-off: reduces the chance of one member drawing seven legendaries and steamrolling,
but pulls all bots toward similar power and may flatten the drama. Built as a config flag,
evaluated with the headless harness, decided by data rather than intuition.

## 9. The Arena

Top-down view of the full arena, all bots visible simultaneously. Last bot standing.

### 9.1 Physics

Custom deterministic 2D: circle and polygon bodies, mass-based impulse collision
resolution, friction, and knockback. Ramming genuinely shoves opponents. Flippers apply
real impulse. Arena edges and pits are real physical deaths, not scripted outcomes.

### 9.2 AI

Utility-based state machine. Each bot continuously scores its available actions —
chase nearest, chase weakest, retreat, circle-strafe, use special ability, avoid hazard —
and picks the highest scorer. Driver Personality supplies the scoring weights.

Aggressive weights chase high and retreat near zero. Hit-and-Run weights disengagement
heavily after landing a hit. Same engine, different weight vectors. No bespoke AI per
personality, which keeps behavior tunable from the same data table as everything else.

### 9.3 Damage and elimination

Damage = relative impact velocity × weapon damage × attack-arc alignment, reduced by
target armor. Some weapons inflict self-damage on impact.

A bot is eliminated when health reaches zero, or when it leaves the arena floor
(pushed off an edge or into a pit).

Every simulation resolves to exactly one survivor. The sim records the full placement
order, 10th through 1st, which feeds the scoreboard.

### 9.4 Kill feed

Overlaid on the side. Logs each elimination with the cause (which bot, which weapon,
or which hazard). The viewing member's own line is highlighted.

### 9.5 Arenas

3–5 arenas, each with distinct hazards and layout so that bot builds have situational
advantages. Candidate concepts: an ice arena with low-grip zones, a shifting floor that
opens pits, and a perimeter lined with hazards. Designed in detail in Phase 9.

## 10. Art direction, assets, and audio

A live art-direction study exists at `docs/design/art-direction-study.html`. It is a
non-deterministic Canvas 2D mockup built to establish look and feel, not engine code.
It represents roughly the floor of the target, not the ceiling.

### 10.1 Visual direction

**Gritty industrial base with neon accents.** Dark scorched arena, harsh worklights,
orange sparks, dust haze, oil, and heavy weighted motion. Each member's team color
appears as an emissive glow on their bot's weapons and trim, so ten machines stay
instantly distinguishable in a crowded arena without breaking the grimy tone.

The core principle established by the study: in top-down 2D, perceived quality comes
overwhelmingly from the feedback layer, not model fidelity. Priority order:

1. **Impact language** — spark bursts, shockwave rings, damage flash, screen shake,
   knockback proportional to real impact velocity
2. **Lighting** — bloom, and dynamic point lights so sparks genuinely illuminate the
   floor and nearby bot surfaces
3. **Persistent destruction** — tire scuffs, scrape marks, and scorch craters accumulate
   permanently, so the arena floor tells the story of the fight
4. **Presentation** — slow-motion on eliminations, kill-feed animation, camera moves

### 10.2 Asset pipeline

Bot parts are modelled in Blender (free, open source), rendered from a top-down camera
across 64 rotation angles with real lighting and materials, and exported as sprite sheets.
The engine stays 2D and fully deterministic while the machines read as genuinely
three-dimensional — real bevels, specular highlights on brushed steel, real shadow.

Zero runtime cost, zero dollars, zero determinism risk. Procedurally drawn placeholder
bots are used through Phase 5 so that gameplay and balance are proven before the art
investment is made.

### 10.3 Audio

Full sound design: impact hits, spinner doppler whine, metal grind, elimination stingers,
arena ambience, and a music bed. Sourced from CC0 libraries (freesound.org, Kenney.nl).

Audio lives entirely in the playback layer and cannot affect determinism. Playback must
degrade gracefully when muted or blocked by browser autoplay policy.

## 11. Viewing experience

Static site. Flow:

1. Member picks their league.
2. Member picks their name from a list.
3. Landing page introduces the concept.
4. "Begin" starts the guided experience.
5. Member clicks through: Bot Forge → Bot reveal → Arena → Scoreboard → (further events) → Final draft order.

**Personal highlight.** After selecting their name, that member's Plinko ball and Battle
Bot render with a glow and a persistent name tag, their kill-feed line is emphasized, and
they receive a personal result card at the end.

This is purely a render-layer concern. It never touches `sim/`, cannot affect outcomes,
and cannot break determinism. Every member watches the identical event; one entity is
simply emphasized for them.

**Hosting:** GitHub Pages, Netlify, or Cloudflare Pages. All free permanently for static
sites with no expiry and no card on file. Member selection persists in `localStorage`.
No accounts, no backend, no data collection.

## 12. Build roadmap

| Phase | Deliverable |
|---|---|
| 1 | Deterministic core: seeded PRNG, fixed timestep, 2D physics bodies, headless runner |
| 2 | Bot Forge (Plinko) — proves determinism under maximum chaos |
| 3 | Arena greybox — placeholder art, real combat. Answers "is this fun?" |
| 4 | The seven categories — design every option's pros and cons collaboratively |
| 5 | Balance pass — thousands of headless sims, tune the data tables |
| 6 | Blender asset pipeline — model bot parts, bake 64-angle sprite sheets |
| 7 | PixiJS visual layer — lighting, bloom, particles, post-processing, presentation |
| 8 | Sound design |
| 9 | Arenas 2–5 |
| 10 | Recording pipeline and the viewing website |

Phases 1–5 run on procedurally drawn placeholder art. Art and audio investment
(Phases 6–8) happens only after the simulation is proven fun and balanced.

Plinko is Phase 2 rather than last, despite the Arena being the higher-priority feature,
because ten chaotic bouncing bodies are the harshest possible test of deterministic replay.
If the strategy is going to fail, it fails cheaply on a peg board rather than expensively
after the arena is built.

**The first implementation plan covers Phases 1–2.**

## 13. Testing strategy

- **Determinism tests.** Replay each recorded event N times and assert identical
  checksums. Run in CI across browsers.
- **Physics unit tests.** Momentum conservation, no tunneling at high velocity,
  resting stability, correct pit/edge detection.
- **Balance harness.** Headless batch runner reporting win rates per option, per
  category, and per arena. The primary tool for Phase 5.
- **Golden records.** Committed official records with known checksums, verified on
  every build, so an engine change that would alter a recorded event fails loudly.
- **Lint enforcement.** Rules banning `Math.random` and transcendental math inside `sim/`.

## 14. Deferred decisions

These are intentionally open and will be resolved in the phase noted:

- Specific options within each of the seven categories, and their stat values — Phase 4.
- Whether the pity system (§8.1) ships enabled — Phase 5, decided by measured data.
- Plinko row count and final odds distribution — Phase 5, tuned empirically.
- Arena hazard designs and layouts — Phase 9.
- How placement maps to scoreboard points, and whether events are weighted — Phase 10.
- Which additional events (beyond the Arena) get built, if any — after Phase 10.
