# Event Scoring & Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Forge and the Arena into one recordable *event* — seven Plinko boards, three battles, a running scoreboard, and a final draft order — reproducible from a single integer.

**Architecture:** One master seed derives every sub-seed. An event record is therefore a few hundred bytes: the seed, the roster, and a checksum. Playback re-runs the whole thing and gets identical results, so the website ships no simulation data at all.

**Tech Stack:** TypeScript, Vitest. Existing sim: `rng`, `checksum`, `plinko/*`, `arena/*`.

**Scope:** The simulation side of shipping. The website is a separate plan that follows and consumes `runEvent`.

**Deadline context:** This is on the critical path for a hard end-of-month deadline. Prefer the simple version of every choice.

---

## Background for the implementer

The project decides a fantasy football draft order and publishes it as a website league
members watch. Two events exist and both work:

- **The Bot Forge** — a Plinko board. `runPlinko(config)` drops ten balls and reports which
  slot each landed in.
- **The Arena** — a battle royale. `runMatch(config)` fights ten bots and reports full
  placement order plus every elimination.

They are currently disconnected demos. This plan makes them one event.

**The event shape, decided by the project owner:**

- Seven Plinko boards, one per bot category, each building part of every member's bot
- **Three** battles, with a scoreboard shown between them
- Points per battle by finishing place: **25 / 18 / 15 / 12 / 10 / 8 / 6 / 4 / 2 / 1**
- Draft order is the points total after three battles
- Ties break on **total eliminations caused**, then **total damage dealt**
- Three layout variants of the same arena, one per battle

**Two things to know before starting:**

1. **Damage dealt is not currently tracked anywhere.** Eliminations are (`bot.kills`), but
   the second tiebreaker needs a new accumulator. It must go in before any official
   recording exists, because adding it later changes the simulation and invalidates every
   record made before it.
2. **Bot categories do not exist yet.** The Forge currently produces slot *indices*, not
   named parts, and every bot has identical stats. That is fine: build the event pipeline
   around the slot indices now, and the category mapping drops in later without changing
   the record format.

**Determinism contract, lint-enforced on `src/sim/`.** Banned: `Math.sin/cos/tan/asin/acos/
atan/atan2/pow/hypot/log/exp/cbrt/random`, **the `**` operator**, `Date`, `performance`,
`document`, imports from `../render` or `../shell`. Permitted: `+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`, `Math.max`, `Math.imul`.
Test files and `tools/` are exempt.

**Existing API:**

- `src/sim/rng.ts` — `createRng(seed)` → `{ next(), range(min, max) }`, type `Rng`
- `src/sim/checksum.ts` — `hashNumbers(values)`
- `src/sim/plinko/board.ts` — `DEFAULT_BOARD`, `BoardConfig`
- `src/sim/plinko/plinko.ts` — `DEFAULT_PLINKO`, `runPlinko(config)` → `{ seed, landings: [{ballIndex, slot, tick}], ticks, settled, checksum }`
- `src/sim/arena/arena.ts` — `DEFAULT_ARENA`, `ArenaConfig`, `buildArena`
- `src/sim/arena/match.ts` — `DEFAULT_MATCH`, `runMatch(config)` → `{ seed, placements: [{botId, place}], eliminations: [{botId, cause, tick, byId}], ticks, checksum }`
- `src/sim/arena/combat.ts` — `resolveHit(attacker, target, impactSpeed, tick)` returns damage dealt
- `src/sim/arena/bot.ts` — `Bot` with `kills`, `health`, `maxHealth`

**Commands.** `npm test -- <filter>` (never bare `npm test`, ~3 min), `npm run lint`,
`npx tsc --noEmit`. **Never run `npm run dev`. Never run anything in the background.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/arena/bot.ts` | Gains a `damageDealt` accumulator. |
| `src/sim/arena/combat.ts` | Credits damage to the attacker. |
| `src/sim/event/scoring.ts` | Points table, standings, and the tiebreak chain. |
| `src/sim/event/arenas.ts` | Three layout variants of the arena. |
| `src/sim/event/event.ts` | `runEvent` — the whole show from one seed. |
| `src/sim/event/record.ts` | The official record format, and verification. |
| `tools/record-event.ts` | Admin tool: roll seeds, preview, and save an official record. |

---

## Task 1: Track damage dealt

**Files:** `src/sim/arena/bot.ts`, `src/sim/arena/combat.ts`, `src/sim/arena/combat.test.ts`

- [ ] **Step 1: Add the accumulator**

`Bot` gains:

```ts
  /** Total damage this bot has dealt to others. The final tiebreaker. */
  damageDealt: number;
```

initialised to `0` in `createBot`.

- [ ] **Step 2: Credit it in `resolveHit`**

After `target.health -= dealt`, add `attacker.damageDealt += dealt`.

Credit the **dealt** amount, not the raw damage — a hit that would have done 40 to a bot
with 5 health left counts as 5. Otherwise overkill inflates the tiebreaker and a bot that
finished off three nearly-dead opponents would outrank one that ground down a healthy one.

- [ ] **Step 3: Add tests to `combat.test.ts`**

```ts
describe('damage tracking', () => {
  it('starts at zero', () => {
    expect(at(0, 0, 0).damageDealt).toBe(0);
  });

  it('credits the attacker for what it dealt', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const dealt = resolveHit(attacker, target, 4, 0);
    expect(attacker.damageDealt).toBeCloseTo(dealt, 8);
  });

  it('accumulates across hits', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const first = resolveHit(attacker, target, 4, 0);
    const second = resolveHit(attacker, target, 4, 1000);
    expect(attacker.damageDealt).toBeCloseTo(first + second, 8);
  });

  it('credits only what was actually dealt, not overkill', () => {
    // A bot on 5 health hit for 40 gives the attacker 5, not 40. Otherwise finishing
    // off wounded bots would beat grinding down a healthy one on the tiebreaker.
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.health = 5;
    resolveHit(attacker, target, 100, 0);
    expect(attacker.damageDealt).toBe(5);
  });

  it('credits nothing for a blocked hit', () => {
    const attacker = at(0, 0, 2048); // facing away
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4, 0);
    expect(attacker.damageDealt).toBe(0);
  });
});
```

- [ ] **Step 4: Verify and commit**

`npm test -- combat`, `npm run lint`, `npx tsc --noEmit`.

```bash
git add src/sim/arena/bot.ts src/sim/arena/combat.ts src/sim/arena/combat.test.ts
git commit -m "feat(sim): track damage dealt per bot for the event tiebreaker"
```

---

## Task 2: Scoring and standings

**Files:** Create `src/sim/event/scoring.ts`, `src/sim/event/scoring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PLACEMENT_POINTS, pointsForPlace, buildStandings, type BattleTally } from './scoring';

const tally = (
  memberId: string,
  places: number[],
  eliminations = 0,
  damage = 0,
): BattleTally => ({ memberId, places, eliminations, damage });

describe('PLACEMENT_POINTS', () => {
  it('runs 25 down to 1 across ten places', () => {
    expect(PLACEMENT_POINTS).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
  });

  it('rewards winning far more than second', () => {
    // The gap at the top is deliberately larger than anywhere else, so a battle win
    // is worth chasing rather than settling for a safe second.
    const topGap = PLACEMENT_POINTS[0]! - PLACEMENT_POINTS[1]!;
    const midGap = PLACEMENT_POINTS[4]! - PLACEMENT_POINTS[5]!;
    expect(topGap).toBeGreaterThan(midGap * 3);
  });
});

describe('pointsForPlace', () => {
  it('maps first place to the top score', () => {
    expect(pointsForPlace(1)).toBe(25);
  });

  it('maps last place to one point', () => {
    expect(pointsForPlace(10)).toBe(1);
  });

  it('gives nothing for a place beyond the table', () => {
    expect(pointsForPlace(11)).toBe(0);
    expect(pointsForPlace(0)).toBe(0);
  });
});

describe('buildStandings', () => {
  it('totals points across battles', () => {
    const s = buildStandings([tally('a', [1, 1, 1]), tally('b', [2, 2, 2])]);
    expect(s[0]!.memberId).toBe('a');
    expect(s[0]!.points).toBe(75);
    expect(s[1]!.points).toBe(54);
  });

  it('assigns draft positions in points order', () => {
    const s = buildStandings([tally('a', [3, 3, 3]), tally('b', [1, 1, 1]), tally('c', [5, 5, 5])]);
    expect(s.map((r) => r.memberId)).toEqual(['b', 'a', 'c']);
    expect(s.map((r) => r.draftPosition)).toEqual([1, 2, 3]);
  });

  it('breaks a tie on total eliminations', () => {
    const s = buildStandings([tally('a', [1, 10, 10], 2), tally('b', [1, 10, 10], 7)]);
    expect(s[0]!.memberId).toBe('b');
  });

  it('breaks a deeper tie on damage dealt', () => {
    const s = buildStandings([
      tally('a', [1, 10, 10], 3, 120),
      tally('b', [1, 10, 10], 3, 340),
    ]);
    expect(s[0]!.memberId).toBe('b');
  });

  it('records why a tie was broken, so the site can explain it', () => {
    const s = buildStandings([tally('a', [1], 1, 10), tally('b', [1], 5, 10)]);
    expect(s[0]!.tiebreak).toBe('eliminations');
    expect(s[1]!.tiebreak).toBe('eliminations');
  });

  it('leaves tiebreak null when points alone decided it', () => {
    const s = buildStandings([tally('a', [1]), tally('b', [5])]);
    expect(s[0]!.tiebreak).toBe(null);
  });

  it('is deterministic when everything ties', () => {
    // Never leave the order to sort stability. Fall back to member id so the same
    // inputs always produce the same draft order, on any engine.
    const a = buildStandings([tally('b', [1], 1, 1), tally('a', [1], 1, 1)]);
    const b = buildStandings([tally('a', [1], 1, 1), tally('b', [1], 1, 1)]);
    expect(a.map((r) => r.memberId)).toEqual(b.map((r) => r.memberId));
  });

  it('carries per-battle points through for the scoreboard', () => {
    const s = buildStandings([tally('a', [1, 5, 10])]);
    expect(s[0]!.battlePoints).toEqual([25, 10, 1]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- scoring` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * How a battle placement becomes points, and how three battles become a draft order.
 *
 * The gaps are deliberately irregular. A linear ladder produces frequent ties across
 * three battles; this spread makes them rare, and the large gap at the top means winning
 * a battle is worth chasing rather than settling for a safe second.
 */
export const PLACEMENT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export type Tiebreak = 'eliminations' | 'damage' | 'memberId';

export interface BattleTally {
  memberId: string;
  /** Finishing place in each battle, 1 is best. */
  places: number[];
  /** Eliminations caused across all battles. */
  eliminations: number;
  /** Damage dealt across all battles. */
  damage: number;
}

export interface Standing {
  memberId: string;
  points: number;
  battlePoints: number[];
  eliminations: number;
  damage: number;
  /** 1 drafts first. */
  draftPosition: number;
  /** Which rule separated this member from whoever they tied with, if any. */
  tiebreak: Tiebreak | null;
}

/** Points for a finishing place. Places outside the table score nothing. */
export function pointsForPlace(place: number): number {
  if (place < 1 || place > PLACEMENT_POINTS.length) return 0;
  return PLACEMENT_POINTS[place - 1]!;
}

/**
 * Ranks members into a draft order.
 *
 * Points first, then eliminations, then damage, then member id. The final fallback is not
 * decoration: without it the order would depend on sort stability, and a draft order that
 * could differ between browsers would be worthless.
 */
export function buildStandings(tallies: readonly BattleTally[]): Standing[] {
  const rows = tallies.map((t) => ({
    memberId: t.memberId,
    battlePoints: t.places.map(pointsForPlace),
    points: t.places.reduce((sum, place) => sum + pointsForPlace(place), 0),
    eliminations: t.eliminations,
    damage: t.damage,
    draftPosition: 0,
    tiebreak: null as Tiebreak | null,
  }));

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.eliminations !== a.eliminations) return b.eliminations - a.eliminations;
    if (b.damage !== a.damage) return b.damage - a.damage;
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });

  // Record which rule actually separated each adjacent pair, so the site can say
  // "tied on points, separated by eliminations" rather than presenting a bare order.
  for (let i = 0; i < rows.length; i++) {
    rows[i]!.draftPosition = i + 1;

    const prev = rows[i - 1];
    const next = rows[i + 1];
    for (const other of [prev, next]) {
      if (other === undefined) continue;
      if (other.points !== rows[i]!.points) continue;
      if (other.eliminations !== rows[i]!.eliminations) {
        rows[i]!.tiebreak = 'eliminations';
      } else if (other.damage !== rows[i]!.damage) {
        rows[i]!.tiebreak = 'damage';
      } else {
        rows[i]!.tiebreak = 'memberId';
      }
      break;
    }
  }

  return rows;
}
```

- [ ] **Step 4: Verify and commit**

```bash
git add src/sim/event/scoring.ts src/sim/event/scoring.test.ts
git commit -m "feat(sim): add event scoring, standings, and the tiebreak chain"
```

---

## Task 3: Three arena variants

**Files:** Create `src/sim/event/arenas.ts`, `src/sim/event/arenas.test.ts`

- [ ] **Step 1: Build the variants**

Three `ArenaConfig` objects, all 16 × 12 tiles of 60 units, differing only in where the
pits, surfaces and hazards sit. Arenas are pure data, so this costs almost nothing and
stops battle three feeling like a rerun of battle one.

Export `ARENA_VARIANTS: readonly ArenaConfig[]` with exactly three entries, plus
`ARENA_VARIANT_NAMES` for the scoreboard to label them.

Suggested characters, so each battle reads differently:

- **Variant 1 — "The Grinder."** `DEFAULT_ARENA` as it stands. Central tar, ice corners,
  two wall saws, two flame jets, a cannon, a button-triggered crusher.
- **Variant 2 — "The Gauntlet."** Pits moved to a central cluster, conveyors along the
  long axis feeding into them, saws on the short walls. Positional rather than attritional.
- **Variant 3 — "The Crossfire."** Two cannons and two lasers on opposing walls, minimal
  floor hazards, ice in the middle so bots slide through the firing lanes.

- [ ] **Step 2: Test the invariants**

Every variant must satisfy the same safety properties the single arena already has, or a
battle could hang or be unwinnable:

```ts
describe('every arena variant', () => {
  it('has three variants', () => {
    expect(ARENA_VARIANTS.length).toBe(3);
    expect(ARENA_VARIANT_NAMES.length).toBe(3);
  });

  it('leaves enough solid floor to spawn ten bots away from the walls', () => {
    for (const config of ARENA_VARIANTS) {
      const arena = buildArena(config);
      let interior = 0;
      for (let row = 1; row < config.rows - 1; row++) {
        for (let col = 1; col < config.cols - 1; col++) {
          const size = config.tileSize;
          if (!isOverHole(arena.grid, col * size + size / 2, row * size + size / 2)) interior++;
        }
      }
      expect(interior).toBeGreaterThan(20);
    }
  });

  it('never places a surface on a hole', () => { /* per variant */ });

  it('keeps every zone, emitter and button inside the arena', () => { /* per variant */ });

  it('never references a button that does not exist', () => { /* per variant */ });

  it('produces exactly one survivor across twenty seeds', () => {
    for (const config of ARENA_VARIANTS) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = runMatch({ ...DEFAULT_MATCH, arena: config, seed });
        expect(r.placements.length).toBe(10);
      }
    }
  });
});
```

**If a variant fails the survivor test, report it rather than adjusting the test.** A
layout that can hang is a layout that cannot ship.

- [ ] **Step 3: Verify and commit**

```bash
git add src/sim/event/arenas.ts src/sim/event/arenas.test.ts
git commit -m "feat(sim): add three arena layout variants"
```

---

## Task 4: The event runner

**Files:** Create `src/sim/event/event.ts`, `src/sim/event/event.test.ts`

- [ ] **Step 1: Design notes to follow**

`runEvent(config)` produces the entire show from a **single master seed**:

1. Derive sub-seeds from the master with one `createRng(masterSeed)` — seven Forge board
   seeds, then three battle seeds, drawn in that fixed order. Never call `Math.random`.
2. Run seven Plinko boards, one per bot category. Record each member's landing slot per
   board. (Categories are not built yet; the slot index is the result for now.)
3. Run three battles, one per arena variant, in order.
4. Tally eliminations and damage per member across all three.
5. Build standings.

```ts
export interface EventMember {
  id: string;
  name: string;
  colour: string;
}

export interface EventConfig {
  masterSeed: number;
  members: readonly EventMember[];
}

export interface ForgeBoardResult {
  boardIndex: number;
  seed: number;
  /** Slot each member landed in, indexed to match `members`. */
  slots: number[];
}

export interface BattleResult {
  battleIndex: number;
  seed: number;
  arenaName: string;
  /** Finishing place per member, indexed to match `members`. 1 is the winner. */
  places: number[];
  eliminations: Elimination[];
  ticks: number;
}

export interface EventResult {
  masterSeed: number;
  members: readonly EventMember[];
  forge: ForgeBoardResult[];
  battles: BattleResult[];
  standings: Standing[];
  checksum: string;
}
```

**Member index maps to bot index.** Member 0 is `bot-0` and ball 0. That mapping is
already fair: the Plinko board shuffles release positions and the arena shuffles both
spawn positions and personalities, all from the seeded stream. Do not add another shuffle.

- [ ] **Step 2: Tests**

```ts
describe('runEvent', () => {
  it('runs seven forge boards and three battles', () => { /* lengths 7 and 3 */ });

  it('gives every member a slot on every board', () => { /* slots.length === members.length */ });

  it('gives every member a finishing place in every battle', () => { /* 1..10, all distinct */ });

  it('produces a full draft order', () => {
    // Every member ranked exactly once, positions 1..N with no gaps.
  });

  it('is identical for the same master seed', () => {
    const a = runEvent(config);
    const b = runEvent(config);
    expect(a.checksum).toBe(b.checksum);
    expect(a.standings).toEqual(b.standings);
  });

  it('differs for a different master seed', () => { /* checksums differ */ });

  it('is unaffected by other events running in between', () => { /* re-run and compare */ });

  it('uses a different arena for each battle', () => {
    const r = runEvent(config);
    expect(new Set(r.battles.map((b) => b.arenaName)).size).toBe(3);
  });

  it('gives 100 different master seeds 100 different draft orders', () => {
    // Not strictly guaranteed, but a collision here would mean the seed is barely
    // influencing the outcome, which is worth knowing about.
  });

  it('never awards the same draft position twice', () => { /* across 20 seeds */ });
});
```

- [ ] **Step 3: Verify and commit**

```bash
git add src/sim/event/event.ts src/sim/event/event.test.ts
git commit -m "feat(sim): add the event runner - seven boards, three battles, one seed"
```

---

## Task 5: The official record and the admin tool

**Files:** Create `src/sim/event/record.ts` + test, and `tools/record-event.ts`

- [ ] **Step 1: The record format**

```ts
export interface EventRecord {
  version: 1;
  leagueId: string;
  label: string;
  masterSeed: number;
  members: EventMember[];
  /** Checksum of the result this seed produced when it was recorded. */
  checksum: string;
  recordedAt: string;
}
```

`verifyRecord(record)` re-runs `runEvent` and returns whether the checksum still matches.

This is the whole recording: a few hundred bytes. **The website ships no simulation data**,
it re-runs the event from the seed. That is why determinism has been enforced so hard.

**`recordedAt` is a human-readable timestamp for the admin only.** It must never be read by
the simulation — `Date` is banned in `src/sim/`, so generate it in the tool and pass it in.

- [ ] **Step 2: Tests**

Cover: a fresh record verifies; a record whose checksum is corrupted fails verification; a
record verifies identically on repeat runs; changing the roster changes the checksum
(members are inputs to the event, so a record is only valid for its own roster).

- [ ] **Step 3: The admin tool**

`tools/record-event.ts`, run as `npm run record -- [count]`:

1. Loads the roster from `data/league.json` (create it with ten placeholder members).
2. Rolls `count` random master seeds (`Math.random` is fine — this is a tool, not the sim).
3. Runs each event and prints a summary table: seed, the draft order by name, battle
   lengths, and how many ties needed breaking.
4. `npm run record -- --save <seed>` writes `data/official-event.json`.

The point is that you roll a batch, read the summaries, pick one you like, and save it.

- [ ] **Step 4: Run it**

`npm run record -- 10` and report the output verbatim.

- [ ] **Step 5: Verify and commit**

```bash
git add src/sim/event/record.ts src/sim/event/record.test.ts tools/record-event.ts data/ package.json
git commit -m "feat(sim): add the official event record format and admin recording tool"
```

---

## Definition of done

- [ ] `npm test` passes in full; lint, types and build clean
- [ ] `runEvent` produces the same checksum and the same draft order for the same seed
- [ ] Every member is ranked exactly once, positions 1..N
- [ ] All three arena variants produce exactly one survivor across twenty seeds
- [ ] `npm run record -- 10` prints ten candidate events with their draft orders
- [ ] An official record can be saved and verified

## What this does not include

- The website — the next plan, which consumes `runEvent`
- Bot categories — the Forge reports slot indices for now, and the record format does
  not change when named parts arrive
- Visual polish, sound, more arenas
