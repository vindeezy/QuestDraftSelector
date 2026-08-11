# The Website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed site where ten league members watch a recorded event end to end — Forge, three battles, scoreboards, draft order — and never see a result before its moment.

**Architecture:** A linear beat state machine in `src/shell/` drives screens. The simulation stays untouched and deterministic; the shell replays it and the renderer draws it. An effect bus carries impact events out of the sim for sound and VFX to consume.

**Tech Stack:** TypeScript, Vite, PixiJS 8.19, Vitest, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-11-website-design.md`

**Scope:** This plan reaches a complete, navigable, deployed event on greybox visuals. Sound, VFX and art integration are a second plan — deliberately, so there is a working event before there is a pretty one.

---

## Task 1: The roster config

**Files:** Create `src/config/roster.ts` and its test.

Ten members: `id`, `name`, `initials`, `colour`. This does not exist today — members live only in test fixtures — and everything else depends on it.

- [ ] Define the roster type and the ten members
- [ ] **Validate on load and throw loudly:** exactly ten members, unique ids, unique initials, unique colours, initials exactly two characters. Two members sharing initials would render two identical labels and be invisible as a bug.
- [ ] Tests: each rule fails when violated; the real roster passes
- [ ] Commit

## Task 2: Preview a specific seed

**Files:** Modify `tools/record-event.ts`.

- [ ] Add `npm run record -- --seed <n>`: run that one master seed and print its draft order, per-member builds, and battle lengths
- [ ] Reject anything outside 1–2,147,483,647 with a clear message
- [ ] Tests: a known seed prints a stable draft order; out-of-range is rejected
- [ ] Commit

## Task 3: Part descriptions

**Files:** Modify `src/sim/parts/tables.ts` and its test.

- [ ] Add a `blurb` field to `Part` — one short, punchy sentence on what the part does
- [ ] Write all **39**: 6 chassis, 6 drives, 6 weapons, 7 armour, 7 abilities, 7 personalities. Say what it does for you, not what its numbers are.
- [ ] Test: every part in every category has a non-empty blurb under a sane length
- [ ] Commit

## Task 4: The effect bus

**Files:** Modify `src/sim/arena/match.ts`, `combat.ts`, `zone.ts`, `projectile.ts`, `ability.ts`, `trapdoor.ts`.

The cross-cutting piece. Build it before any playback, because retrofitting it later is expensive.

- [ ] Add `Effect` and `match.effects`, cleared at the **start** of each tick
- [ ] Emit at the existing damage and event sites: `weaponHit`, `hazardHit`, `collision`, `elimination`, `trapdoor`, `cannonFire`, `abilityFire`, each with position and a 0–1 `intensity`
- [ ] **The checksum must not change.** Verify against the pinned value in `event.test.ts`; if it moves, stop and report.
- [ ] Tests: effects are emitted at each site; the list is empty at tick start; a full match produces a plausible mix; determinism holds
- [ ] Commit

## Task 5: Beat state and progress

**Files:** Create `src/shell/beats.ts`, `src/shell/progress.ts` and tests.

- [ ] The 19 beats from spec §2 as an ordered machine
- [ ] `localStorage`, keyed by event seed. **Two separate values:** sticky `hasCompletedOnce`, resettable current watch (claimed member + furthest beat).
- [ ] Rules: cannot advance past the furthest reached; can always go back; after completion any beat is reachable; "watch as someone else" clears only the current watch
- [ ] Tests: no forward skipping before completion; resume lands on the right beat; re-watching as someone else keeps the unlock; a changed seed resets progress
- [ ] Commit

## Task 6: Landing, name select, what to expect — WATCH GATE

**Files:** Create `src/shell/screens/`, modify `src/shell/main.ts`.

- [ ] Landing: title, tone, Begin. Begin also resumes the AudioContext, the one gesture guaranteed before anything makes noise.
- [ ] Name select: ten members in their colours; picking one sets the claimed member
- [ ] What to expect: three sections — Forge, battles, scoring — **each with words and a live visual side by side**. Two live panels reuse the existing renderers.
- [ ] **The demo panels must use a fixed demo seed, never the official one.** A test must assert they differ.
- [ ] The event checksum is verified on load; a mismatch blocks the site with an explicit error rather than showing a different draft order
- [ ] **WATCH GATE:** owner reviews the first three screens in the browser before proceeding

## Task 7: The Forge walkthrough — WATCH GATE

**Files:** Create `src/shell/screens/forge.ts`, modify the Plinko renderer.

- [ ] Six boards in `CATEGORIES` order, driven by the beat machine
- [ ] Balls tinted per member; **initials rendered on each ball** via `BitmapText`
- [ ] Right-hand results panel revealing each member's landing **progressively, as their ball settles**
- [ ] Per-board pause, then advance
- [ ] Tests: six boards in category order; the panel reveals exactly the members whose balls have settled
- [ ] **WATCH GATE**

## Task 8: The build reveal

**Files:** Create `src/shell/screens/build-reveal.ts`.

- [ ] The claimed member's bot full-screen, all six parts labelled with result and blurb
- [ ] A selector to view the other nine members' bots
- [ ] **Viewing another member must not change the claimed member.** Test this directly — it is the easiest thing here to get wrong.
- [ ] Commit

## Task 9: Battle playback — WATCH GATE

**Files:** Create `src/shell/screens/battle.ts`, modify `src/render/arena-renderer.ts`.

- [ ] Replay a battle from its seed at true speed, advancing the sim and drawing each frame
- [ ] Bots tinted per member, initials on each, **persistent glow on the claimed member's bot**
- [ ] Drain `match.effects` after each `advanceMatch` into a per-frame buffer — dropped frames must not swallow events
- [ ] Kill feed
- [ ] Tests: playback reaches the same final standings as `runEvent`; the highlight follows the claimed member
- [ ] **WATCH GATE**

## Task 10: The scoreboards

**Files:** Create `src/shell/screens/scoreboard.ts`.

Three tiers, per spec §2.

- [ ] After battle 1: placement, kills, total — one screen
- [ ] After battles 2 and 3: that battle alone ordered by its own points, then cut to the cumulative board
- [ ] **Show eliminations, not just kill points** — "3 kills — 9 pts" reads better than a bare 9
- [ ] **Show why a tie broke** whenever one applies. It will happen in most events.
- [ ] Tests: per-battle ordering differs from cumulative ordering on a seed where it should; tie explanations render
- [ ] Commit

## Task 11: The draft order reveal — WATCH GATE

**Files:** Modify `src/shell/screens/scoreboard.ts`.

- [ ] All three battles broken out, grand total, **counted up from tenth to first**, slow
- [ ] Marks `hasCompletedOnce` and unlocks navigation
- [ ] Tests: the revealed order matches `runEvent`'s standings exactly; completion sets the unlock
- [ ] **WATCH GATE:** this is the payoff — review it properly

## Task 12: Record, screen, deploy

**Files:** Modify `.github/workflows/deploy.yml` if needed.

- [ ] Full suite, lint, types, build
- [ ] Owner picks a seed via `--seed`, **screens all three battles through `npm run replay`** for stalls and a healthy combat timeline, then `--save`
- [ ] Deploy to GitHub Pages
- [ ] Walk the deployed site end to end as a first-time viewer
- [ ] Commit

---

## Definition of done

- [ ] A member can open the link, pick their name, and watch all 19 beats through to the draft order
- [ ] Nothing is reachable before its moment; reload resumes without spoiling
- [ ] "Watch again as someone else" works and never re-locks
- [ ] The claimed member's bot is findable at a glance in every battle
- [ ] The site refuses to run if the event checksum does not match the record
- [ ] Ties explain themselves
- [ ] Deployed and walked end to end

## Not in this plan

Sound, particles, filters, art integration, and the four generated-asset sets. All of it lands on top of a working event rather than in place of one — which is also what makes it safe to cut if the deadline tightens.
