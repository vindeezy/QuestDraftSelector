# Sound, VFX, motion and materials — design

**Goal:** make the event feel alive — synthesised sound, arcade-grade visual effects, motion
between beats, and materials on the bots — without changing a single thing the simulation
decides.

**Status of the thing being decorated:** finished. Seed 43000236 is recorded and screened,
all nineteen beats are built, and the site is deployed at
`https://vindeezy.github.io/QuestDraftSelector/`. Everything in this spec is additive. If it
were all abandoned tomorrow the league would still have a watchable draft.

---

## 1. The seam this is built on

`src/sim/arena/effects.ts` already emits eight kinds from seven sites, each carrying
position, a 0–1 normalised intensity, and the bot it concerns:

| kind | raised in | intensity means |
|---|---|---|
| `weaponHit` | `combat.ts` | damage dealt |
| `hazardHit` | `zone.ts`, `projectile.ts` | damage dealt |
| `collision` | `match.ts` | impact speed |
| `elimination` | `match.ts` | always 1 |
| `cannonFire` | `projectile.ts` | always 1 |
| `trapdoor` | `trapdoor.ts` | always 1 |
| `abilityFire` | `ability.ts` | always 1 |

`battle.ts` already drains them into a per-frame buffer and discards it — there is a literal
`void frameEffects;` at the consumption point. **The expensive half of this work is done.**
Sound and VFX are both "read this array and react".

### 1.1 The four rules, which do not bend

The bus's own doc comment states them, and this spec inherits all four:

1. **Derived, never causal.** Nothing in `src/sim/` may read `match.effects` to decide
   anything.
2. **Never checksummed.** The match checksum is built from bot physical state only.
3. **Cleared at the start of each tick**, so a tick's list describes only that tick.
4. **Deterministic**: every value pushed is a pure function of state already computed.

Rule 2 is what makes §1.2 safe, and the golden-record tests are what enforce it.

### 1.2 The one simulation change: `Effect.source`

Weapon and ability character can be derived without touching `src/sim` at all — the effect
carries `botId`, and the consumer already holds every member's build, so a hit from a Saw
Blade and a hit from a Hammer are distinguishable today.

Hazards are not. A `hazardHit` at a position does not say what hit the bot, and inferring it
by testing which zone contains that point is fragile where zones overlap and impossible for
a projectile strike, which lands at the bot rather than at the emitter.

So: **add an optional `source: string` to `Effect`**, populated with the zone or emitter's
own `id` at the `hazardHit`, `cannonFire` and `trapdoor` sites. Both `Zone` and `Emitter`
already carry `id`, and the arena configs name them by type — `flame-12`, `cannon-25`,
`saw-3`, `crusher` — so the audio and VFX layers classify on the prefix.

This adds a field to a structure that is already derived and already uncheckummed. It changes
no decision, no ordering and no arithmetic. **The pinned event checksum must not move**; if it
does, the change was wrong and the golden test will say so before anything ships.

---

## 2. Sound

### 2.1 Synthesised, not sampled

All audio is generated at runtime with the Web Audio API. No files, no library, no licensing.

The reasons are specific to this project rather than general taste:

- **Zero bytes.** Nothing to download, nothing to fail on draft night, works offline.
- **Intensity is already normalised.** The bus hands us 0–1 per event; a synth maps that
  straight onto volume, pitch and decay. A glancing blow and a heavy one are the same sound
  played differently, not two recordings.
- **It never repeats identically.** Ten bots produce hundreds of weapon hits in a battle.
  Samples become a machine-gun of the same clack; a synth varies per event.

Audio may use `Math.random` freely. It is presentation, downstream of the bus, and cannot
reach the simulation.

### 2.2 The sound lab is the first deliverable

Before any sound is wired into a battle, build a dev-only route — `?sounds`, the same
throwaway pattern the seed preview used — offering:

- a button per sound, and per variant where a sound has alternatives to compare
- an intensity slider, so a light hit and a heavy one can be heard back to back
- a **"simulate a brawl"** button firing realistic event density, because the mix is the
  thing that fails, not the individual sounds
- master volume and mute

**This exists because the person writing the code cannot hear.** Every audio decision in this
spec is provisional until heard through the lab and confirmed by the owner. The lab is deleted
before the final deploy, like the seed preview was.

### 2.3 The palette

Starting characters, to be adjusted at the lab rather than in prose. Synthesis primitives in
brackets.

| event | character |
|---|---|
| `weaponHit` | short metallic tick; damage drives pitch, length and brightness *(noise → bandpass → fast decay)* |
| `collision` | dull low thud, quiet — this fires constantly and must sit under everything *(low sine + click)* |
| `hazardHit` | by hazard, see below |
| `elimination` | explosion; the loudest thing in the mix *(noise → downward lowpass sweep)* |
| `cannonFire` | deep boom with a pitch drop, clearly not an elimination *(sine sweep + noise)* |
| `trapdoor` | mechanical clunk then a short rumble |
| `abilityFire` | by ability, see below |

**By weapon** (from `botId` → build): Saw Blade buzzes, Hammer lands a heavy clang, Spinning
Bar and Vertical Spinner whine on contact, Flamethrower whooshes, Ram Plate is a blunt
impact.

**By ability** (from `botId` → build): EMP is an electric zap, Nitro a whoosh, Shockwave a
low boom, Repair a soft rising chime, Oil Slick a wet splat, Smoke Screen a hiss, Adrenaline
a rising tone.

**By hazard** (from `Effect.source` prefix): flame hisses, saw grinds, cannon impact is
percussive, crusher is a heavy slam.

### 2.4 The Forge

The Forge has no effect bus. Add one to `src/sim/plinko/`, mirroring the arena's contract
exactly — derived, uncheckummed, cleared per tick — emitting a ball-on-peg event carrying
the ball's position.

**Pitch is mapped to board position**, so ten balls cascading down the pegs read as a run of
notes rather than a rattle. This is the one place where the sound design might be actively
lovely rather than merely correct, and it costs the same as making it noise.

Peg strikes are dense, so these are very short and quiet, with aggressive voice capping.

### 2.5 Mix discipline

Designed in from the start, not retrofitted when it turns to mush:

- **per-kind voice caps** — at most N of any one sound alive at once
- **same-kind coalescing within a frame** — four simultaneous weapon hits are one sound, not
  four
- **a master limiter**, so a scrum cannot clip
- **stereo pan from event x** across the arena width
- **master volume and mute on the battle screen** — draft night is ten people in a room and
  someone will want it quieter
- **`AudioContext` unlocked on the BEGIN click**, since browsers block audio before a user
  gesture and BEGIN is the natural place

---

## 3. VFX — full arcade

| event | effect |
|---|---|
| `weaponHit` | spark burst, count and spread from intensity; white tint flash on the bot |
| `collision` | dust puff |
| `elimination` | explosion, debris, brief screen shake |
| `hazardHit` | per source — flame lick, saw sparks, electrical arc |
| `cannonFire` | muzzle flash and smoke at the emitter |
| `trapdoor` | dust plume |
| `abilityFire` | per ability — EMP ring, nitro trail, shockwave ring, repair glow |

**Technique:** `ParticleContainer` for sparks and debris, `Graphics` for rings and flashes,
additive blend so effects glow against the dark floor, and a short stage offset for shake.

**Performance budget.** The arena already runs ten bots at 60fps with room to spare — the
silhouette work made drawing cheaper, not dearer. Particles are bounded by a global cap, and
**fullscreen filters are avoided**: a bloom pass per frame costs far more than the effect is
worth. If a glow is wanted it is drawn, not filtered.

**Reduced motion.** `prefers-reduced-motion` disables screen shake and heavy particle bursts.
The site already honours it on the draft-order reveal.

---

## 4. Motion and polish

Governed by `docs/polish-notes.md` and its **26 August cutoff**, using the installed
`impeccable` skill (`animate`, `polish`, `bolder`, `critique`, plus 59 detector rules).

Includes beat-to-beat transitions — the polish note already records that the router's
teardown makes exit animation a small backward-compatible change — plus the accumulated copy,
layout and wording feedback.

---

## 5. Materials

Six or so tileable textures — brushed steel, rust, carbon weave, gold, oiled black — generated
in ChatGPT, trimmed in Photopea or GIMP, applied as fills on the **existing vector shapes**.

Geometry, rotation, member tinting and resolution independence all survive unchanged, because
nothing about the drawing changes except what fills it. A texture that fails to load leaves a
flat colour, which is exactly the site as it ships today.

Armour is the category that gains most: Depleted Uranium, Carbon Fibre and Spiked Composite
should not all be the same flat rim.

---

## 6. Sprite trial — optional, and deliberately fenced

If §2–5 land with time to spare, spend **one hour** generating two or three sprites and
dropping them onto the **build reveal only**.

Scoped there because that screen is the one place every objection to sprites disappears: the
bot is large, static and unrotated, so there is no baked-lighting-rotates problem, no tenfold
scale range, and no tinting requirement. `drawBotPortrait` already takes per-caller options,
so the reveal can diverge from the arena without forking anything.

**The arena keeps vectors.** Replacing them would discard the material work and reintroduce
every problem this spec avoids.

If the sprites look like AI robot soup, the hour is the whole loss.

---

## 7. What must not change

- **`data/official-event.json`** — recorded, screened, deployed. Nothing here re-records it.
- **The pinned golden checksums.** The full suite runs before every commit; a moved checksum
  means a simulation change and stops the work.
- **`src/sim/` behaviour.** The only permitted edit is §1.2's additive `source` field and the
  Forge's new bus, both derived and uncheckummed.
- **The deployed site stays working.** Each workstream is committed separately and only
  pushed after the owner has seen it, exactly as the silhouette work was.

---

## 8. Verification

The automated suite covers the pure parts: synthesis parameter mapping, event→sound
classification, event→effect classification, throttling and coalescing logic, and the
`source` field's population. **None of it can tell you whether the result sounds or looks
good.**

So each workstream ends in a **watch gate**, and the honest constraint is stated plainly: the
author cannot hear audio, and cannot see animation in the available browser pane, because
`requestAnimationFrame` does not fire there. Sound is judged entirely by the owner at the lab;
motion is judged entirely by the owner in a real browser.

---

## 9. Order and deadline

Fourteen days remain to the 26 August polish cutoff, against roughly five days of work.

1. **Sound** — biggest perceptual gain per hour, and the bus is ready
2. **VFX** — second biggest, and it makes combat legible as well as exciting
3. **Motion and polish** — cheap, and long-requested
4. **Materials** — half a day
5. **Sprite trial** — one hour, only if the rest has landed

The slack is the point: it makes the sprite trial a genuine experiment rather than a
commitment, and it leaves room for the thing that always appears once real sound and motion
are on screen.

---

## 10. Risks

**The mix, not the sounds.** Every sound can be right in isolation and the battle still be
noise. Mitigated by the lab's brawl simulator, voice caps and coalescing from the first
commit.

**Arcade VFX obscuring the fight.** Full arcade was chosen deliberately, but the claimed
member's bot must stay findable — that is the entire emotional hook. If effects start hiding
bots, effects lose.

**Scope creep past 26 August.** The cutoff exists because a beautiful site with an unscreened
event is worse than a plain one with a good event. That trade is already banked; nothing here
is worth reopening it.

**Sound fatigue.** Ten minutes of Forge plus three battles is a long time to be hearing the
same tick. Variation is a feature, not a polish item.
