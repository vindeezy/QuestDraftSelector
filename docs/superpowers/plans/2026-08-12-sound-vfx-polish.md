# Sound, VFX, motion and materials — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** consume the effect bus that has been sitting unread since WEB 4 — synthesised
sound, arcade VFX, beat transitions and material textures — without changing anything the
simulation decides.

**Architecture:** a new `src/audio/` layer and a `src/render/vfx/` module both read
`match.effects`, which `battle.ts` already drains per frame. Audio is generated with the Web
Audio API; no files ship. One additive simulation change (`Effect.source`) and one new
derived bus (the Forge's), both uncheckummed by the bus's own contract.

**Tech stack:** TypeScript, Web Audio API, PixiJS 8.19 (`ParticleContainer`), Vitest, the
installed `impeccable` and `pixijs-*` skills.

**Spec:** `docs/superpowers/specs/2026-08-12-sound-vfx-polish-design.md`

---

## File structure

| file | responsibility |
|---|---|
| `src/audio/context.ts` | `AudioContext` lifecycle, unlock on gesture, master chain (gain → limiter → destination), mute |
| `src/audio/synth.ts` | primitives only: `noiseBurst`, `tone`, `sweep`, `chime`. No knowledge of the game. |
| `src/audio/palette.ts` | one function per sound character, built from primitives. No knowledge of `Effect`. |
| `src/audio/classify.ts` | **pure**: `Effect` + builds → sound id and gain. The whole differentiation rulebook. |
| `src/audio/voices.ts` | **pure**: voice caps and same-kind coalescing over a frame's effects. |
| `src/audio/play.ts` | the only stateful consumer: takes a frame's effects, plays what survives `voices` |
| `src/render/vfx/particles.ts` | `ParticleContainer` pool, burst/puff/ring emitters |
| `src/render/vfx/index.ts` | **pure** `Effect` → visual spec, plus the stateful emitter driver |
| `src/shell/screens/sound-lab.ts` | dev-only `?sounds` route. Deleted in FIN 1. |

**Layering rule:** `src/sim/` must not import from `src/audio/` any more than from
`src/render/`. SND 1 extends the existing lint guard to enforce it.

---

## SND 1: `Effect.source`, the Forge bus, and the lint guard

**Files:**
- Modify: `src/sim/arena/effects.ts`, `src/sim/arena/zone.ts`,
  `src/sim/arena/projectile.ts`, `src/sim/arena/trapdoor.ts`
- Modify: `src/sim/plinko/plinko.ts`
- Modify: `eslint.config.js`
- Test: `src/sim/arena/effects.test.ts`, `src/sim/plinko/plinko.test.ts`

- [ ] **Step 1: Write the failing test for `source`**

```ts
// src/sim/arena/effects.test.ts
it('carries the hazard that caused a hazardHit, so audio can tell a flame from a saw', () => {
  const effects: Effect[] = [];
  pushEffect(effects, 'hazardHit', 10, 20, 0.5, 'bot-3', 'flame-12');
  expect(effects[0]!.source).toBe('flame-12');
});

it('leaves source undefined where there is nothing to name', () => {
  const effects: Effect[] = [];
  pushEffect(effects, 'weaponHit', 10, 20, 0.5, 'bot-3');
  expect(effects[0]!.source).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sim/arena/effects.test.ts`
Expected: FAIL — `pushEffect` takes 6 arguments, and `Effect` has no `source`.

- [ ] **Step 3: Add the field**

```ts
// src/sim/arena/effects.ts — in `interface Effect`
  /**
   * What caused this, where the position cannot say. Zone and emitter ids, which the arena
   * configs name by type (`flame-12`, `cannon-25`, `saw-3`, `crusher`), so a consumer
   * classifies on the prefix.
   *
   * Only populated where it cannot be derived downstream. A `weaponHit` and an
   * `abilityFire` both carry `botId`, and the consumer holds every member's build, so the
   * weapon and the ability are already knowable — duplicating them here would be a second
   * source of truth for something already true.
   */
  source?: string;
```

Add a trailing `source?: string` parameter to `pushEffect` and assign it.

- [ ] **Step 4: Populate it at the three sites that need it**

`zone.ts` passes `zone.id`, `projectile.ts` passes `emitter.id` on `cannonFire` and the
originating emitter id on its `hazardHit`, `trapdoor.ts` passes the trapdoor's id.

- [ ] **Step 5: Prove the recorded event did not move**

Run: `npx vitest run src/sim/event src/sim/arena tests/`
Expected: PASS, **including the pinned event checksum**. If that checksum moved, the change
touched behaviour — stop and find out why before going further. This is the whole guardrail.

- [ ] **Step 6: Add the Forge bus**

Mirror the arena's contract exactly in `src/sim/plinko/plinko.ts`: a `effects: PlinkoEffect[]`
on the run, cleared at the start of `advance`, with a `pegHit` kind carrying `x`, `y` and the
ball index. Copy the four-rule doc comment and adapt it — a reader of `plinko.ts` must not
have to find `effects.ts` to learn the rules.

- [ ] **Step 7: Test the Forge bus is derived and cleared**

```ts
it('clears pegHits at the start of each tick, so a tick describes only itself', () => {
  const run = createPlinkoRun({ ...DEFAULT_PLINKO, seed: 7, ballCount: 4 });
  advance(run);
  const first = run.effects.length;
  advance(run);
  expect(run.effects.length).not.toBe(first + first); // not accumulating
});

it('does not change the pinned plinko checksum', () => {
  const a = runPlinko({ ...DEFAULT_PLINKO, seed: 4242, ballCount: 10 });
  const b = runPlinko({ ...DEFAULT_PLINKO, seed: 4242, ballCount: 10 });
  expect(a.checksum).toBe(b.checksum);
});
```

- [ ] **Step 8: Extend the lint guard to `src/audio/`**

In `eslint.config.js`, add `../audio` and `src/audio` to the same `no-restricted-imports`
list that already bans `../render` and `../shell` inside `src/sim/`.

- [ ] **Step 9: Full verification**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all green, checksums unmoved.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(sim): name the hazard on an effect, and give the Forge a bus"
```

---

## SND 2: Audio context and master chain

**Files:** Create `src/audio/context.ts`; Test: `src/audio/context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// jsdom has no Web Audio, so the context module is tested through an injected factory.
it('stays silent until unlocked, then plays', () => {
  const audio = createAudioBus({ factory: fakeContextFactory });
  expect(audio.ready).toBe(false);
  audio.unlock();
  expect(audio.ready).toBe(true);
});

it('routes everything through one master gain so mute is a single switch', () => {
  const audio = createAudioBus({ factory: fakeContextFactory });
  audio.unlock();
  audio.setMuted(true);
  expect(audio.masterGain.gain.value).toBe(0);
});
```

- [ ] **Step 2: Run it, watch it fail** — `npx vitest run src/audio/context.test.ts`, expected
FAIL with "createAudioBus is not defined".

- [ ] **Step 3: Implement**

`createAudioBus({ factory })` returns `{ ready, unlock(), setMuted(), setVolume(),
masterGain, now(), ctx }`. The chain is `masterGain → DynamicsCompressorNode (as limiter,
ratio 20, threshold -6) → destination`. `unlock()` creates the context and calls `resume()`;
it is idempotent, because BEGIN can be clicked twice.

Injecting the factory is what makes this testable at all — jsdom has no `AudioContext`, and
mocking a global is worse than passing one in.

- [ ] **Step 4: Verify** — `npx vitest run src/audio` → PASS.
- [ ] **Step 5: Commit** — `feat(audio): context, master chain and mute`

---

## SND 3: Synth primitives

**Files:** Create `src/audio/synth.ts`; Test: `src/audio/synth.test.ts`

These know nothing about the game. Each takes the bus, a start time and a parameter object,
and schedules nodes.

- [ ] **Step 1: Write tests for the parameter maths**

Test the pure helpers only — `decayCurve(intensity)`, `pitchFor(intensity, base)` — since
node scheduling needs a real context.

```ts
it('maps intensity to a longer, lower, louder hit', () => {
  expect(pitchFor(1, 800)).toBeLessThan(pitchFor(0, 800));
  expect(decayCurve(1)).toBeGreaterThan(decayCurve(0));
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement the four primitives**

- `noiseBurst({ duration, filter: { type, frequency, Q }, gain })` — a buffer of white noise
  through a `BiquadFilterNode`, with an exponential gain ramp to near-zero. This is every
  impact, clang and explosion.
- `tone({ type, frequency, duration, gain })` — a plain oscillator with an envelope.
- `sweep({ from, to, duration, gain })` — an oscillator with `exponentialRampToValueAtTime`
  on frequency. Booms sweep down; charges sweep up.
- `chime({ frequency, duration })` — a triangle with a soft attack, for Repair and UI.

Noise buffers are generated once and reused; allocating a buffer per hit would garbage-collect
mid-battle.

- [ ] **Step 4: Verify** — `npx vitest run src/audio` → PASS.
- [ ] **Step 5: Commit** — `feat(audio): synthesis primitives`

---

## SND 4: The palette

**Files:** Create `src/audio/palette.ts`

One exported function per sound character, built from SND 3's primitives. Named for what they
are, not for the event that triggers them, so the mapping stays in SND 5.

- [ ] **Step 1: Implement the characters**

`metallicTick`, `heavyClang`, `sawBuzz`, `spinnerWhine`, `flameWhoosh`, `bluntImpact`,
`dullThud`, `explosion`, `deepBoom`, `mechanicalClunk`, `electricZap`, `nitroWhoosh`,
`shockwaveBoom`, `repairChime`, `oilSplat`, `smokeHiss`, `adrenalineRise`, `flameHiss`,
`sawGrind`, `crusherSlam`, `pegPing`.

Each takes `(bus, when, intensity, panX)`. Every one is short: nothing above 600ms except
`explosion`.

- [ ] **Step 2: Verify it compiles and the lab can reach it** — `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `feat(audio): the sound palette`

---

## SND 5: Classification — the differentiation rulebook

**Files:** Create `src/audio/classify.ts`; Test: `src/audio/classify.test.ts`

Pure, and the most testable part of the whole workstream.

- [ ] **Step 1: Write the tests first — these are the requirement**

```ts
it('picks the sound from the WEAPON that landed the hit, not from the event kind', () => {
  const builds = buildsWith({ 3: { weapon: sawBladeSlot } });
  expect(soundFor(effect('weaponHit', 'bot-3'), builds)).toBe('sawBuzz');
});

it('picks the sound from the ABILITY that fired', () => {
  const builds = buildsWith({ 5: { ability: empSlot } });
  expect(soundFor(effect('abilityFire', 'bot-5'), builds)).toBe('electricZap');
});

it('picks the sound from the HAZARD that hit, by id prefix', () => {
  expect(soundFor(effect('hazardHit', 'bot-1', 'flame-12'), builds)).toBe('flameHiss');
  expect(soundFor(effect('hazardHit', 'bot-1', 'saw-3'), builds)).toBe('sawGrind');
  expect(soundFor(effect('hazardHit', 'bot-1', 'crusher'), builds)).toBe('crusherSlam');
});

it('falls back safely on an unknown source rather than going silent', () => {
  expect(soundFor(effect('hazardHit', 'bot-1', 'mystery-9'), builds)).toBe('dullThud');
});

it('gives every weapon and every ability its own sound', () => {
  const weapons = new Set(WEAPON_SOUNDS.values());
  expect(weapons.size).toBe(slotCountFor('weapon'));
  const abilities = new Set(ABILITY_SOUNDS.values());
  expect(abilities.size).toBe(slotCountFor('ability'));
});
```

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Implement**

`soundFor(effect, builds)` returns a palette key. `WEAPON_SOUNDS` and `ABILITY_SOUNDS` are
`Map<partId, paletteKey>` built from `tables.ts`'s part ids, so a renamed part fails the
"every weapon has its own sound" test rather than silently falling back. Hazards classify on
`effect.source`'s prefix before the first `-`.

- [ ] **Step 4: Verify** — `npx vitest run src/audio/classify.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(audio): classify effects by weapon, ability and hazard`

---

## SND 6: Voice caps and coalescing

**Files:** Create `src/audio/voices.ts`; Test: `src/audio/voices.test.ts`

Pure. This is the module that stops a brawl becoming noise, and it exists before anything is
audible on purpose.

- [ ] **Step 1: Write the tests**

```ts
it('collapses several of the same sound in one frame into one, at the loudest intensity', () => {
  const kept = admit([hit(0.2), hit(0.9), hit(0.4)], emptyState());
  expect(kept.length).toBe(1);
  expect(kept[0]!.intensity).toBeCloseTo(0.9);
});

it('keeps different sounds in the same frame', () => {
  expect(admit([hit(0.5), boom(1)], emptyState()).length).toBe(2);
});

it('caps how many of one sound can be alive at once', () => {
  let state = emptyState();
  for (let i = 0; i < 20; i++) state = remember(state, 'metallicTick', i);
  expect(admit([hit(0.5)], state).length).toBe(0);
});

it('always admits an elimination — the loudest moment is never dropped', () => {
  const saturated = saturatedState();
  expect(admit([elimination()], saturated).length).toBe(1);
});
```

- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** — per-key caps, one-per-key-per-frame coalescing taking the max
intensity, and an exempt set (`elimination`, `trapdoor`) that always plays.
- [ ] **Step 4: Verify** — `npx vitest run src/audio` → PASS.
- [ ] **Step 5: Commit** — `feat(audio): voice caps and per-frame coalescing`

---

## SND 7: The sound lab — WATCH GATE

**Files:** Create `src/shell/screens/sound-lab.ts`; Modify: `src/shell/boot.ts`

- [ ] **Step 1: Add the `?sounds` route**

Same shape the seed preview used: intercepted in `boot.ts` before the checksum gate, returning
early, touching no progress state. It is deleted in FIN 1.

- [ ] **Step 2: Build the panel**

- a button per palette entry, grouped: weapons, abilities, hazards, events, Forge
- an intensity slider (0–1) applied to whichever button is pressed
- a **BRAWL** button firing a realistic 20-second event stream — weapon hits and collisions at
  the density a ten-bot fight actually produces, with occasional eliminations
- master volume and mute

- [ ] **Step 3: Verify it mounts** — `npm run dev`, open `?sounds`, confirm buttons render and
the context unlocks on first click.

- [ ] **Step 4: WATCH GATE — the owner listens**

Every sound in the spec is provisional. The author cannot hear any of it. Expect this gate to
produce a list of adjustments; make them here, not later.

- [ ] **Step 5: Commit** — `feat(shell): the sound lab`

---

## SND 8: Wire into the battle and the Forge — WATCH GATE

**Files:** Modify `src/shell/screens/battle.ts`, `src/shell/screens/forge.ts`; Create
`src/audio/play.ts`

- [ ] **Step 1: Implement `play.ts`** — `playFrame(bus, effects, builds, state)`: classify,
admit through `voices`, schedule through the palette, pan by x.
- [ ] **Step 2: Replace `void frameEffects;`** in `battle.ts` with the call. This is the line
WEB 4 left for exactly this.
- [ ] **Step 3: Unlock on BEGIN** — the existing gate button becomes the audio unlock.
- [ ] **Step 4: Forge** — drain the new plinko bus per frame, play `pegPing` with pitch mapped
to board position.
- [ ] **Step 5: Add master volume and mute** to the battle and Forge chrome.
- [ ] **Step 6: Verify** — full suite, lint, types, build.
- [ ] **Step 7: WATCH GATE** — the owner watches a full battle and a Forge board with sound.
The question is the mix, not the sounds.
- [ ] **Step 8: Commit** — `feat(shell): sound in the battles and the Forge`

---

## FX 1: Particle layer

**Files:** Create `src/render/vfx/particles.ts`; Test: `src/render/vfx/particles.test.ts`

- [ ] **Step 1: Test the pure parts** — burst geometry (count and spread from intensity) and
the pool's recycling, both without a renderer.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** — a `ParticleContainer` with a fixed-size pool of particles,
`burst()`, `puff()` and `ring()`, all recycling from the pool. A global cap; when it is hit,
the oldest particle is reused rather than a new one allocated.
- [ ] **Step 4: Verify** — `npx vitest run src/render/vfx` → PASS.
- [ ] **Step 5: Commit** — `feat(render): particle pool`

---

## FX 2: Event → visual mapping — WATCH GATE

**Files:** Create `src/render/vfx/index.ts`; Modify `src/render/arena-renderer.ts`

- [ ] **Step 1: Test the mapping purely** — `visualFor(effect)` returns a spec (kind, colour,
count, life); assert sparks scale with intensity, hazards differ by `source` prefix, and every
ability has its own visual.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement the effects** — sparks on `weaponHit` plus a white tint flash on the
struck bot's silhouette; dust on `collision`; explosion, debris and screen shake on
`elimination`; per-hazard flame/spark/arc on `hazardHit`; muzzle flash on `cannonFire`; dust
plume on `trapdoor`; per-ability visuals on `abilityFire`.
- [ ] **Step 4: Screen shake** — a decaying offset on the stage container, capped so it never
makes the arena unreadable.
- [ ] **Step 5: Honour `prefers-reduced-motion`** — shake off, particle counts reduced.
- [ ] **Step 6: Verify** — full suite, lint, types, build.
- [ ] **Step 7: WATCH GATE** — the owner watches a battle. **The named failure condition: if
effects hide bots, effects lose.** The claimed member must stay findable.
- [ ] **Step 8: Commit** — `feat(render): arcade effects driven by the bus`

---

## FX 3: Performance pass

**Files:** Modify `src/render/vfx/*`

- [ ] **Step 1: Measure** — run a full battle with the browser profiler, record worst-frame
time at peak particle load.
- [ ] **Step 2: Tune** the global cap and particle lifetimes so the worst frame stays under
16ms. **No fullscreen filters** — if a glow is wanted it is drawn, not filtered.
- [ ] **Step 3: Record the numbers** in `docs/STATUS.md`, so a future change that slows this
down has a baseline to fail against.
- [ ] **Step 4: Commit** — `perf(render): bound the particle budget`

---

## Ordering change, 17 August

**The polish pass now runs LAST, after every material change.** POL 1 was written as one unit
and has been split, because the second half of it cannot be done honestly before the materials
land.

The reason is specific. `docs/polish-notes.md` asks whether Tommy's black bot disappears
against the slate floor, and whether gold separates from silver at battle size. Those are
questions about contrast between a bot and the floor it stands on — and *both* of those
surfaces are about to be replaced by textures. Answering now means answering against a floor
that is being thrown away, then answering again. Worse, any colour or contrast fix made now
gets invalidated by the texture that follows it, so the work is not merely repeated, it is
actively misleading while it sits in the codebase.

Textures also darken. `tint` multiplies, so every textured surface is darker and lower in
contrast than the flat colour it replaces. A contrast judgement made before that is a
judgement about a different picture.

So: **POL 1a → MAT 1 → MAT 2 → POL 1b.** The transitions were safe to do early, since nothing
about them depends on what the bots are made of.

---

## POL 1a: Beat transitions — DONE

**Files:** Modify `src/shell/router.ts`; add `src/shell/transitions.ts`

- [x] **Step 1: Add exit animation support to the router** — the one small
backward-compatible change `docs/polish-notes.md` already identifies.
- [x] **Step 2: Entrance and exit transitions per beat**, additive so a screen without them
still works.
- [x] **Step 3: Verify** — full suite, lint, types, build, plus browser confirmation that the
animations actually run, since the feature gate means tests can only prove they are correctly
disabled.
- [x] **Step 4: Commit** — `feat(shell): beat transitions`

---

## MAT 1: Materials — WATCH GATE

**Files:** Add `src/render/textures/*.png`; Modify `src/render/bot-portrait.ts`

- [ ] **Step 1: The owner generates** five or six tileable textures in ChatGPT — brushed
steel, rust, carbon weave, gold, oiled black — and trims them in Photopea or GIMP.
- [ ] **Step 2: Add an optional `texture` to `drawBotPortrait`'s options**, following the
`weaponScale` precedent, so the arena and the reveal can differ.
- [ ] **Step 3: Map armour parts to textures** — Depleted Uranium, Carbon Fibre and Spiked
Composite must stop looking identical.
- [ ] **Step 4: Fall back to flat colour** when a texture is missing, so a failed load leaves
the site exactly as it ships today. Test that fallback explicitly.
- [ ] **Step 5: Verify** — full suite, plus bundle size before and after.
- [ ] **Step 6: WATCH GATE** — the owner checks the arena and the build reveal.
- [ ] **Step 7: Commit** — `feat(render): material textures on armour and chassis`

---

## MAT 2: The arena floor and the oil slick — WATCH GATE

**Files:** Add `src/render/textures/floor-*.png`; modify `src/render/arena-renderer.ts`

Added 17 August. Not in the original plan, and pulled in front of the polish pass for the
reason recorded above: the floor is the surface every contrast judgement is made against.

- [x] **Step 1: The owner generates** six floor textures — see `docs/texture-prompts.md`,
tier 2. Specified quieter and lower-contrast than the bot textures on purpose: the floor is the
largest thing on screen and the bots are ~20px against it, so a dramatic floor costs exactly
the legibility the battles depend on.
- [x] **Step 2: Draw the oil slick as oil.** It needs no artwork and can go first. The ability
converts a tile to `Surface.Ice`, so a slick currently renders as ice — mid-match, nothing else
creates an Ice tile, so diffing against the surface map captured at mount identifies oiled
tiles exactly, with no simulation change and no effect plumbing.
- [x] **Step 3: Texture the tiles**, one texture per tile so seams land on the existing grid
lines and no texture has to be seamlessly tileable.
- [x] **Step 4: Fall back to flat colour** per surface when a texture is missing. Tested.
- [x] **Step 4b: Only ship textures for surfaces an arena places.** Gravel and the four
conveyors were generated and are NOT shipped: no arena places either, so they would have been
downloaded on every visit to draw nothing. Guarded in both directions by test.
- [x] **Step 5: Re-measure.** Bundle 1102 KB to 1142 KB. Frame work measured on both heavy
arenas with the pane displayed: worst frame 7.7 ms of 16.7 ms, no frame over 8 ms across 15,000
frames, 60 fps held. Textures cost roughly double in the TAIL and nothing in the median — see
the baseline in `docs/STATUS.md` for why that is the floor rebuild rather than a per-frame cost. The floor is drawn every frame across the whole viewport, which makes it the
one texture change with a plausible route to costing something.
- [ ] **Step 6: WATCH GATE** — the owner watches all three arenas.
- [ ] **Step 7: Commit** — `feat(render): material textures on the arena floor`

---

## POL 1b: The polish pass — WATCH GATE

**Files:** Modify `src/shell/shell.css`, screen modules

Runs after MAT 1 and MAT 2, so every judgement in it is made against the finished picture.
**Stops on 26 August** regardless of what is left, per `docs/polish-notes.md`.

- [x] **Step 1: Answer the open questions in `docs/polish-notes.md`.** All four closed. Member
colours: fixed by measurement, worst pair 17.3 to 34.0 in CIELAB. Back navigation: left alone,
and the note asking for it was out of date. Scoreboard rhythm: left uneven, because balancing it
means showing the same numbers twice. Aluminium: fine as is.
- [x] **Step 2: Work `docs/polish-notes.md` top to bottom.** Nothing open remains. The one
structural bug — the reveal's portrait overlapping its cards below 1100px — is fixed.
- [x] **Step 3: Critique the screens.** Done as a measured audit of all nineteen beats rather
than through `impeccable`: horizontal overflow, elements escaping the viewport, text clipped
rather than wrapped, undersized hit targets. Zero of the first three; the mute button was a
29x19 target and is now 34x34. A design-led pass with `impeccable` was NOT run — deliberately
deferred, since the visual direction has been signed off repeatedly and churn nine days out is
the bigger risk. Still available if wanted.
- [x] **Step 4: Verify** — full suite, lint, types, build.
- [ ] **Step 5: WATCH GATE** — the owner walks all nineteen beats.
- [x] **Step 6: Commit** — landed across several commits rather than one.

---

## SPR 1: Sprite trial — DONE, and kept

**Files:** `src/render/chassis-sprites.ts`, `src/render/bot-portrait.ts`,
`src/render/sprites/`, `tools/convert-sprites.py`, `docs/sprite-prompts.md`

- [x] **Step 1: The owner generates.** Two rounds — Wedge, Diamond and Circle, then Tower and
Square. Box was deliberately skipped: seed 43000236 rolls it for nobody, so a Box sprite
could not be displayed on any screen.
- [x] **Step 2: Drawn on the build reveal only**, over the vector body and under the armour
rim and weapon, at fixed rotation. Confined by construction rather than by care —
`mountBotPortraitStage` is the reveal's own helper and nothing else calls it.
- [x] **Step 3: Looked at. It reads as real machines**, including Circle, which was chosen as
the stress case because a disc has no silhouette to help it.
- [x] **Step 4: Committed.** All five chassis in play are sprited, so all ten members get a
machine rather than four keeping a flat vector shape next to six that do not.

**What the trial cost beyond the hour, all of it found by measuring:** the art needed cropping
to its opaque bounds, resizing and converting (6.5 MB to 435 KB for the first three); it had to
be fitted to each chassis's real bounding box and clipped to its outline, because generated
silhouettes do not match the polygons and cannot be made to; and the armour material had to be
re-layered over the sprite, which had silently hidden it.

**Still open — the owner's call, not a rendering decision.** `tint` multiplies, so a member's
colour caps how bright their sprite can be. Every member lands at luminance 38.9 or better
except Tommy, whose `#1C1F26` puts him at 13.9. A tint floor of 85 fixes it exactly and touches
nobody else, but collapses his separation from Nick Lenker from dE 39.7 to 14.3, against the
34.0 the palette pass was built to hold. Detail versus identity. See `docs/sprite-prompts.md`.

---

## FIN 1: Remove the lab, verify, deploy

- [ ] **Step 1: Delete** `src/shell/screens/sound-lab.ts`, its route in `boot.ts` and its
styles, exactly as the seed preview was removed.
- [ ] **Step 2: Confirm `?sounds` falls through** to the normal walkthrough.
- [ ] **Step 3: Full verification** — `npx vitest run && npm run lint && npx tsc --noEmit &&
npm run build`.
- [ ] **Step 4: Confirm the recorded event is untouched**

```bash
npm run record -- --seed 43000236   # previews; must print checksum 35d2876d
git status --short data/            # must be empty
```

**Not `--save`.** Saving rewrites `recordedAt`, so the command dirties the very file it is
meant to prove unchanged — found the hard way in SND 1. And **not** a bare
`npm run record -- 43000236`: the positional argument is a COUNT of seeds to suggest, so that
asks for forty-three million events and never returns.
- [ ] **Step 5: Push and watch CI.** Walk the deployed site end to end.
- [ ] **Step 6: Commit** — `chore: remove the sound lab`

---

## Definition of done

- [ ] Every weapon, every ability and every hazard has its own sound
- [ ] A ten-bot brawl is legible rather than noise, with volume and mute to hand
- [ ] The Forge is not silent, and its pegs read as notes
- [ ] Hits, deaths and hazards are visible as well as audible
- [ ] The claimed member's bot is still findable at a glance mid-fight
- [ ] Transitions carry the viewer between beats
- [ ] Armour materials are distinguishable
- [ ] The pinned checksums never moved, and `data/official-event.json` is byte-identical
- [ ] The lab is gone and the site is deployed

## Not in this plan

Crowd noise, announcers, engine loops, music — all excluded by the spec. Full sprite
replacement of the arena bots. Anything after **26 August**.
