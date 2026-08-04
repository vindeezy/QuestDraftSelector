# Arena AI & Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the throwaway chase stub with a utility-scoring AI driving seven distinct driver personalities, add the spiral floor collapse that guarantees a winner, and build the headless harness that measures whether any of it is fun.

**Architecture:** Steering behaviours and perception are separate, testable modules. The AI scores actions each tick and picks the highest; personality is a weight vector, not a code path. Hazard avoidance is a *blended steering vector*, not a competing action, so a bot can chase and dodge at the same time. Action states lock a behaviour in for a fixed duration.

**Tech Stack:** TypeScript, Vitest, PixiJS. Existing sim: `rng`, `vec`, `body`, `collision`, `world`, `checksum`, `trig`, `arena/{tiles,arena,bot,combat,match}`.

**Scope:** Steps 5, 7 and 8 of the Phase 3 build order. **Hazards (saw blades, flame jets, tar, ice) are a separate later plan** — pits, walls and collapsing tiles already provide enough danger for the AI to demonstrate avoidance.

---

## Background for the implementer

Read `docs/superpowers/specs/2026-08-04-arena-greybox-design.md` — sections 8 through 10 in
particular. The current greybox works: ten bots drive, ram, take directional damage, fall
into pits, and get ranked. What it lacks is interesting behaviour and a guaranteed ending.

**Three findings from watching real matches. These are not suggestions.**

1. **Throttle must fall as the target goes off-axis.** A bot at constant full throttle has
   a fixed minimum turn radius of `speed / angular velocity`, about 101 units at these
   stats. Adding throttle modulation cut deaths-by-falling from 45% to 24%, because bots
   stopped overshooting turns into pits.
2. **Steer at an intercept point, never straight at the target.** Pure pursuit against an
   equal-speed target is a stable orbit that never closes. Measured at seed 1: two bots
   circled 140 units apart at full speed for 15,000 ticks with zero contacts. Intercept
   steering took matches resolving before the cap from 40% to 60%.
3. **Bots must switch targets.** The stub locks onto the nearest bot forever, producing
   duels instead of a battle royale.

**Determinism contract, lint-enforced on `src/sim/`.** Banned: `Math.sin/cos/tan/asin/acos/
atan/atan2/pow/hypot/log/exp/cbrt/random`, the `**` operator, `Date`, `performance`,
`document`, imports from `../render` or `../shell`. Permitted: `+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`, `Math.max`, `Math.imul`.
Test files are exempt. All randomness comes from the seeded PRNG.

**Existing API:**

- `src/sim/trig.ts` — `ANGLE_STEPS` (4096), `ANGLE_MASK`, `STEPS_PER_RADIAN`, `cosOf`,
  `sinOf`, `normalizeAngle`
- `src/sim/arena/bot.ts` — `Bot`, `createBot`, `steerToward(bot, dx, dy)`,
  `applyThrust(bot, throttle)`, `applyGrip(bot)`, `DEFAULT_BOT`
- `src/sim/arena/combat.ts` — `arcAlignment`, `damageFrom`, `resolveHit`
- `src/sim/arena/tiles.ts` — `TileState`, `TileGrid`, `tileIndexAt`, `setTileState`,
  `isOverHole`, `solidTileCount`
- `src/sim/arena/match.ts` — `Match`, `MatchConfig`, `DEFAULT_MATCH`, `createMatch`,
  `advanceMatch`, `runMatch`, `Elimination`, `Placement`
- `src/sim/rng.ts` — `createRng(seed)`, type `Rng`

**Commands.** `npm test -- <filter>` (never bare `npm test`, it takes 3 minutes),
`npm run lint`, `npx tsc --noEmit`, `npm run build`. **Never run `npm run dev`** — it
blocks. **Never run anything in the background.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/arena/steering.ts` | Intercept offsets, throttle curve, drive/flee primitives. |
| `src/sim/arena/perception.ts` | What a bot can see: targets, engagements, hole repulsion. |
| `src/sim/arena/personality.ts` | The seven weight vectors and their names. |
| `src/sim/arena/ai.ts` | Action scoring, action states, and the per-tick decision. |
| `src/sim/arena/collapse.ts` | Spiral tile order and the collapse schedule. |
| `tools/arena-metrics.ts` | Headless harness reporting the four metrics. |
| `src/render/arena-renderer.ts` | Extended: warning tiles, personality tags, kill feed. |
| `src/shell/main.ts` | Extended: arena status shows personalities and eliminations. |

---

## Task 1: Steering primitives

Extracts the two fixes from the drive stub into a tested module the AI will build on.

**Files:**
- Create: `src/sim/arena/steering.ts`
- Test: `src/sim/arena/steering.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBot, type Bot } from './bot';
import { MIN_THROTTLE, interceptOffset, throttleFor, driveToward, driveAway } from './steering';

const at = (x: number, y: number, heading: number): Bot =>
  createBot({ id: `${x}_${y}`, x, y, heading });

describe('interceptOffset', () => {
  it('aims straight at a stationary target', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 100, 0, 0, 0, 7);
    expect(o.x).toBeCloseTo(100, 6);
    expect(o.y).toBeCloseTo(0, 6);
  });

  it('leads a target moving across its path', () => {
    // Target 70 away, so lead time is 10 ticks at speed 7. Moving +y at 2 per tick
    // means it will be 20 further down by the time we arrive.
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 70, 0, 0, 2, 7);
    expect(o.x).toBeCloseTo(70, 6);
    expect(o.y).toBeCloseTo(20, 6);
  });

  it('does not lead a target closing head-on', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 70, 0, -2, 0, 7);
    expect(o.y).toBeCloseTo(0, 6);
    expect(o.x).toBeLessThan(70);
  });

  it('handles a target on top of the bot without dividing by zero', () => {
    const bot = at(0, 0, 0);
    const o = interceptOffset(bot, 0, 0, 3, 3, 7);
    expect(Number.isFinite(o.x)).toBe(true);
    expect(Number.isFinite(o.y)).toBe(true);
  });
});

describe('throttleFor', () => {
  it('is full when facing the target', () => {
    expect(throttleFor(at(0, 0, 0), 1, 0)).toBeCloseTo(1, 8);
  });

  it('is the minimum when the target is behind', () => {
    expect(throttleFor(at(0, 0, 0), -1, 0)).toBe(MIN_THROTTLE);
  });

  it('is the minimum when the target is exactly to the side', () => {
    expect(throttleFor(at(0, 0, 0), 0, 1)).toBeCloseTo(MIN_THROTTLE, 8);
  });

  it('falls off smoothly between', () => {
    const straight = throttleFor(at(0, 0, 0), 1, 0);
    const angled = throttleFor(at(0, 0, 0), 1, 1);
    expect(angled).toBeLessThan(straight);
    expect(angled).toBeGreaterThan(MIN_THROTTLE);
  });

  it('never returns zero, so a bot always creeps while rotating', () => {
    for (let h = 0; h < 4096; h += 53) {
      expect(throttleFor(at(0, 0, h), 1, 0)).toBeGreaterThanOrEqual(MIN_THROTTLE);
    }
  });
});

describe('driveToward', () => {
  it('turns and accelerates in one call', () => {
    const bot = at(0, 0, 0);
    driveToward(bot, 0, 1);
    expect(bot.heading).toBe(bot.turnRate);
    expect(bot.body.vx * bot.body.vx + bot.body.vy * bot.body.vy).toBeGreaterThan(0);
  });

  it('converges on a fixed point instead of orbiting it', () => {
    // The regression test for the bug this module exists to fix. A bot repeatedly
    // driving at a stationary point must actually reach it.
    const bot = at(0, 0, 0);
    for (let i = 0; i < 400; i++) {
      driveToward(bot, 400 - bot.body.x, 300 - bot.body.y);
      bot.body.x += bot.body.vx;
      bot.body.y += bot.body.vy;
      bot.body.vx *= 0.985;
      bot.body.vy *= 0.985;
    }
    const dx = bot.body.x - 400;
    const dy = bot.body.y - 300;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(60);
  });
});

describe('driveAway', () => {
  it('accelerates in the opposite direction to the threat', () => {
    const bot = at(0, 0, 2048); // facing -x
    driveAway(bot, 1, 0); // threat is at +x
    expect(bot.body.vx).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- steering` → FAIL, cannot resolve import.

- [ ] **Step 3: Implement**

```ts
import { cosOf, sinOf } from '../trig';
import { applyGrip, applyThrust, steerToward, type Bot } from './bot';
import type { Vec2 } from '../vec';

/**
 * Throttle floor, so a badly misaligned bot still creeps while it rotates rather than
 * standing still. Zero would let a bot stall permanently facing the wrong way.
 */
export const MIN_THROTTLE = 0.15;

/**
 * Where to aim to intercept a moving target, as an offset from the bot.
 *
 * Steering straight at a target moving at the same speed is a stable mutual orbit that
 * never closes — measured at seed 1, two bots circled 140 units apart at full speed for
 * 15,000 ticks with zero contacts. Aiming at where the target will be collapses that
 * orbit into a converging spiral.
 */
export function interceptOffset(
  bot: Bot,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  speed: number,
): Vec2 {
  const dx = targetX - bot.body.x;
  const dy = targetY - bot.body.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const lead = speed === 0 ? 0 : dist / speed;
  return { x: dx + targetVx * lead, y: dy + targetVy * lead };
}

/**
 * Throttle as a function of how squarely the bot faces where it wants to go.
 *
 * Not a refinement — without it, pursuit does not work. A bot at constant full throttle
 * has a fixed minimum turn radius of speed / angular-velocity, about 101 units at these
 * stats, and cannot tighten it. Backing off when misaligned shrinks that radius, exactly
 * as a real driver brakes into a corner. Adding this cut deaths-by-falling from 45% to
 * 24%, because bots stopped overshooting their turns into pits.
 */
export function throttleFor(bot: Bot, dx: number, dy: number): number {
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return MIN_THROTTLE;
  const inv = 1 / Math.sqrt(lenSq);
  const dot = cosOf(bot.heading) * dx * inv + sinOf(bot.heading) * dy * inv;
  if (dot <= 0) return MIN_THROTTLE;
  return MIN_THROTTLE + (1 - MIN_THROTTLE) * dot;
}

/** Steer toward an offset, throttle for the resulting alignment, thrust, and grip. */
export function driveToward(bot: Bot, dx: number, dy: number): void {
  steerToward(bot, dx, dy);
  applyThrust(bot, throttleFor(bot, dx, dy));
  applyGrip(bot);
}

/** Drive directly away from an offset. */
export function driveAway(bot: Bot, dx: number, dy: number): void {
  driveToward(bot, -dx, -dy);
}
```

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- steering` → PASS. Report the real `it()` count.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/steering.ts src/sim/arena/steering.test.ts
git commit -m "feat(sim): extract intercept steering and throttle modulation"
```

---

## Task 2: Perception

What a bot can see. Includes the engagement model that Third Party Predator and Instigator
need, and hole repulsion for hazard avoidance.

**Files:**
- Modify: `src/sim/arena/bot.ts` — add contact memory fields
- Create: `src/sim/arena/perception.ts`
- Test: `src/sim/arena/perception.test.ts`

- [ ] **Step 1: Add contact memory to `Bot`**

In `src/sim/arena/bot.ts`, add to the `Bot` interface:

```ts
  /** Tick of this bot's most recent contact with another bot. -1 if never. */
  lastContactTick: number;
  /** Id of the bot it last touched. Null if never. */
  lastContactId: string | null;
  /** Eliminations this bot has caused. Drives the "leader" target. */
  kills: number;
```

and initialise them in `createBot`:

```ts
    lastContactTick: -1,
    lastContactId: null,
    kills: 0,
```

- [ ] **Step 2: Record contacts and kills in `match.ts`**

Inside `advanceMatch`, in the contact loop where `a` and `b` are resolved bots, before
applying damage:

```ts
    a.lastContactTick = match.world.tick;
    a.lastContactId = b.body.id;
    b.lastContactTick = match.world.tick;
    b.lastContactId = a.body.id;
```

And in `eliminate`, when `byId` is not null, increment that bot's `kills`:

```ts
  if (byId !== null) {
    const killer = match.bots.find((other) => other.body.id === byId);
    if (killer) killer.kills++;
  }
```

Run `npm test -- match` and confirm the existing 15 tests still pass.

- [ ] **Step 3: Write the failing perception test**

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch } from './match';
import { ENGAGE_MEMORY, areEngaged, perceive } from './perception';

const match = (botCount: number) =>
  createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount });

describe('areEngaged', () => {
  it('is false for bots that have never touched', () => {
    const m = match(4);
    expect(areEngaged(m.bots[0]!, m.bots[1]!, 100)).toBe(false);
  });

  it('is true when two bots last touched each other recently', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 100;
    b.lastContactTick = 100;
    expect(areEngaged(a, b, 100)).toBe(true);
  });

  it('is false once the memory window has expired', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 0;
    b.lastContactTick = 0;
    expect(areEngaged(a, b, ENGAGE_MEMORY + 1)).toBe(false);
  });

  it('is false when only one of them is looking at the other', () => {
    const m = match(4);
    const [a, b, c] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    a.lastContactTick = 100;
    b.lastContactId = c.body.id;
    b.lastContactTick = 100;
    expect(areEngaged(a, b, 100)).toBe(false);
  });

  it('ignores eliminated bots', () => {
    const m = match(4);
    const [a, b] = [m.bots[0]!, m.bots[1]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = 100;
    b.lastContactTick = 100;
    b.alive = false;
    expect(areEngaged(a, b, 100)).toBe(false);
  });
});

describe('perceive', () => {
  it('finds the nearest living bot', () => {
    const m = match(4);
    const self = m.bots[0]!;
    m.bots[1]!.body.x = self.body.x + 30;
    m.bots[1]!.body.y = self.body.y;
    m.bots[2]!.body.x = self.body.x + 500;
    const view = perceive(m, self);
    expect(view.nearest?.body.id).toBe(m.bots[1]!.body.id);
  });

  it('never returns the bot itself', () => {
    const m = match(4);
    const view = perceive(m, m.bots[0]!);
    expect(view.nearest?.body.id).not.toBe(m.bots[0]!.body.id);
  });

  it('finds the weakest living bot', () => {
    const m = match(4);
    m.bots[2]!.health = 5;
    expect(perceive(m, m.bots[0]!).weakest?.body.id).toBe(m.bots[2]!.body.id);
  });

  it('finds the leader by kill count', () => {
    const m = match(4);
    m.bots[3]!.kills = 3;
    expect(perceive(m, m.bots[0]!).leader?.body.id).toBe(m.bots[3]!.body.id);
  });

  it('returns no leader when nobody has a kill', () => {
    expect(perceive(match(4), match(4).bots[0]!).leader).toBe(null);
  });

  it('finds a pair engaged with each other', () => {
    const m = match(4);
    const [self, a, b] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = m.world.tick;
    b.lastContactTick = m.world.tick;
    const view = perceive(m, self);
    expect(view.engagedPair).not.toBe(null);
    const ids = [view.engagedPair![0].body.id, view.engagedPair![1].body.id].sort();
    expect(ids).toEqual([a.body.id, b.body.id].sort());
  });

  it('does not report a pair the bot itself is part of', () => {
    const m = match(4);
    const [self, a] = [m.bots[0]!, m.bots[1]!];
    self.lastContactId = a.body.id;
    a.lastContactId = self.body.id;
    self.lastContactTick = m.world.tick;
    a.lastContactTick = m.world.tick;
    expect(perceive(m, self).engagedPair).toBe(null);
  });

  it('produces a repulsion vector pointing away from a nearby hole', () => {
    const m = match(4);
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    // Stand one tile to the left of a pit. Repulsion should push further left.
    self.body.x = (col - 1) * size + size / 2;
    self.body.y = row * size + size / 2;
    const view = perceive(m, self);
    expect(view.avoidX).toBeLessThan(0);
  });

  it('produces no repulsion in open floor', () => {
    const m = match(4);
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    self.body.x = 8 * size + size / 2;
    self.body.y = 5 * size + size / 2;
    const view = perceive(m, self);
    expect(view.avoidX).toBe(0);
    expect(view.avoidY).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npm test -- perception` → FAIL, cannot resolve import.

- [ ] **Step 5: Implement**

```ts
import { TileState, tileIndexAt } from './tiles';
import type { Bot } from './bot';
import type { Match } from './match';

/** How long after a contact two bots still count as fighting each other, in ticks. */
export const ENGAGE_MEMORY = 90;

/** How far, in tiles, a bot looks for holes to steer away from. */
const AVOID_RADIUS_TILES = 2;

export interface BotView {
  nearest: Bot | null;
  nearestDistSq: number;
  weakest: Bot | null;
  leader: Bot | null;
  /** Two other bots currently fighting each other, if any. Never includes self. */
  engagedPair: [Bot, Bot] | null;
  /** Repulsion away from nearby holes. Zero in open floor. */
  avoidX: number;
  avoidY: number;
}

/**
 * True when two bots are fighting each other right now.
 *
 * Requires the relationship to be mutual — each must have the other as its most recent
 * contact. One-sided memory means one of them has already moved on, which is exactly the
 * situation a Third Party Predator should not mistake for a locked-up duel.
 */
export function areEngaged(a: Bot, b: Bot, tick: number): boolean {
  if (!a.alive || !b.alive) return false;
  if (a.lastContactId !== b.body.id || b.lastContactId !== a.body.id) return false;
  return tick - a.lastContactTick <= ENGAGE_MEMORY && tick - b.lastContactTick <= ENGAGE_MEMORY;
}

/**
 * Repulsion away from holes within a couple of tiles.
 *
 * A potential field rather than a path search: each nearby hole pushes, weighted by
 * inverse distance, and the sum is blended into whatever the bot wanted to do. That is
 * what lets a bot chase and dodge at the same time, instead of choosing between them.
 */
function holeRepulsion(match: Match, bot: Bot): { x: number; y: number } {
  const grid = match.arena.grid;
  const size = grid.tileSize;
  const col = Math.floor(bot.body.x / size);
  const row = Math.floor(bot.body.y / size);

  let x = 0;
  let y = 0;

  for (let r = row - AVOID_RADIUS_TILES; r <= row + AVOID_RADIUS_TILES; r++) {
    for (let c = col - AVOID_RADIUS_TILES; c <= col + AVOID_RADIUS_TILES; c++) {
      const cx = c * size + size / 2;
      const cy = r * size + size / 2;
      const index = tileIndexAt(grid, cx, cy);
      // Off-grid counts as a hole: the arena edge is as lethal as a pit.
      const isHole = index < 0 || grid.tiles[index] === TileState.Gone;
      if (!isHole) continue;

      const dx = bot.body.x - cx;
      const dy = bot.body.y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq === 0) continue;
      const dist = Math.sqrt(distSq);
      // Inverse-square falloff, scaled by tile size so the units stay comparable to
      // the chase offsets this gets blended with.
      const strength = (size * size) / distSq;
      x += (dx / dist) * strength;
      y += (dy / dist) * strength;
    }
  }

  return { x, y };
}

export function perceive(match: Match, self: Bot): BotView {
  let nearest: Bot | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;
  let weakest: Bot | null = null;
  let leader: Bot | null = null;

  for (const other of match.bots) {
    if (other === self || !other.alive) continue;

    const dx = other.body.x - self.body.x;
    const dy = other.body.y - self.body.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = other;
    }
    if (weakest === null || other.health < weakest.health) weakest = other;
    if (other.kills > 0 && (leader === null || other.kills > leader.kills)) leader = other;
  }

  let engagedPair: [Bot, Bot] | null = null;
  for (let i = 0; i < match.bots.length && engagedPair === null; i++) {
    const a = match.bots[i]!;
    if (a === self || !a.alive) continue;
    for (let j = i + 1; j < match.bots.length; j++) {
      const b = match.bots[j]!;
      if (b === self || !b.alive) continue;
      if (areEngaged(a, b, match.world.tick)) {
        engagedPair = [a, b];
        break;
      }
    }
  }

  const avoid = holeRepulsion(match, self);

  return {
    nearest,
    nearestDistSq: nearest === null ? Number.POSITIVE_INFINITY : nearestDistSq,
    weakest,
    leader,
    engagedPair,
    avoidX: avoid.x,
    avoidY: avoid.y,
  };
}
```

- [ ] **Step 6: Confirm it passes**

Run: `npm test -- perception` and `npm test -- match`. Both expected to pass. Report the
real `it()` counts.

- [ ] **Step 7: Commit**

```bash
git add src/sim/arena/perception.ts src/sim/arena/perception.test.ts src/sim/arena/bot.ts src/sim/arena/match.ts
git commit -m "feat(sim): add perception with engagement model and hole repulsion"
```

---

## Task 3: Personalities

Seven weight vectors. No behaviour lives here — this file is data.

**Files:**
- Create: `src/sim/arena/personality.ts`
- Test: `src/sim/arena/personality.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PERSONALITIES, PERSONALITY_NAMES, weightsFor } from './personality';

describe('PERSONALITIES', () => {
  it('defines all seven', () => {
    expect(PERSONALITY_NAMES.length).toBe(7);
    expect(PERSONALITY_NAMES).toContain('aggressive');
    expect(PERSONALITY_NAMES).toContain('defensive');
    expect(PERSONALITY_NAMES).toContain('hitAndRun');
    expect(PERSONALITY_NAMES).toContain('thirdParty');
    expect(PERSONALITY_NAMES).toContain('chaos');
    expect(PERSONALITY_NAMES).toContain('showman');
    expect(PERSONALITY_NAMES).toContain('instigator');
  });

  it('gives every personality a full weight vector', () => {
    for (const name of PERSONALITY_NAMES) {
      const w = weightsFor(name);
      for (const value of Object.values(w)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps risk tolerance between 0 and 1', () => {
    for (const name of PERSONALITY_NAMES) {
      expect(weightsFor(name).riskTolerance).toBeGreaterThanOrEqual(0);
      expect(weightsFor(name).riskTolerance).toBeLessThanOrEqual(1);
    }
  });

  it('returns a copy, so a bot cannot mutate the shared table', () => {
    const a = weightsFor('aggressive');
    a.chaseNearest = 999;
    expect(weightsFor('aggressive').chaseNearest).not.toBe(999);
  });

  it('makes aggressive chase harder and retreat less than defensive', () => {
    const agg = weightsFor('aggressive');
    const def = weightsFor('defensive');
    expect(agg.chaseNearest).toBeGreaterThan(def.chaseNearest);
    expect(agg.retreat).toBeLessThan(def.retreat);
    expect(agg.riskTolerance).toBeGreaterThan(def.riskTolerance);
  });

  it('makes hit-and-run the strongest disengager', () => {
    const hr = weightsFor('hitAndRun');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'hitAndRun' || name === 'defensive') continue;
      expect(hr.disengage).toBeGreaterThanOrEqual(weightsFor(name).disengage);
    }
  });

  it('makes third party the strongest at attacking engaged pairs', () => {
    const tp = weightsFor('thirdParty');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'thirdParty') continue;
      expect(tp.attackEngaged).toBeGreaterThanOrEqual(weightsFor(name).attackEngaged);
    }
  });

  it('makes instigator the strongest shover and a poor committer', () => {
    const inst = weightsFor('instigator');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'instigator') continue;
      expect(inst.shove).toBeGreaterThanOrEqual(weightsFor(name).shove);
    }
    expect(inst.chaseNearest).toBeLessThan(weightsFor('aggressive').chaseNearest);
  });

  it('makes showman the strongest charger and celebrator', () => {
    const show = weightsFor('showman');
    for (const name of PERSONALITY_NAMES) {
      if (name === 'showman') continue;
      expect(show.charge).toBeGreaterThanOrEqual(weightsFor(name).charge);
      expect(show.celebrate).toBeGreaterThanOrEqual(weightsFor(name).celebrate);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- personality` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * The seven driver personalities, as weight vectors over the AI's actions.
 *
 * No behaviour lives here. This file is data, and that is the point: a personality is a
 * set of numbers, not a code path, so new ones cost nothing and balance changes are a
 * spreadsheet edit rather than a rewrite.
 */

export interface Weights {
  /** Go after whoever is closest. */
  chaseNearest: number;
  /** Go after whoever has the least health. */
  chaseWeakest: number;
  /** Go after whoever has the most kills. */
  chaseLeader: number;
  /** Attack two bots already fighting each other. */
  attackEngaged: number;
  /** Ram a target from the side that sends it toward a hazard or another bot. */
  shove: number;
  /** Back off to build a run-up, then strike at full speed. */
  charge: number;
  /** Break off after landing a hit. */
  disengage: number;
  /** Flee when hurt. */
  retreat: number;
  /** Circle a target rather than closing. */
  strafe: number;
  /** Showboat after causing an elimination. */
  celebrate: number;
  /**
   * How much danger the bot will drive through, 0 to 1. Scales down the hole-repulsion
   * blend. Governs how much risk it accepts, never whether it can see the hazard.
   */
  riskTolerance: number;
  /** Ticks between target reconsiderations. Lower means more erratic. */
  retargetInterval: number;
}

export const PERSONALITY_NAMES = [
  'aggressive',
  'defensive',
  'hitAndRun',
  'thirdParty',
  'chaos',
  'showman',
  'instigator',
] as const;

export type PersonalityName = (typeof PERSONALITY_NAMES)[number];

const TABLE: Record<PersonalityName, Weights> = {
  // Hellbent on attacking. Rarely backs off, prioritises dealing damage.
  aggressive: {
    chaseNearest: 1.0, chaseWeakest: 0.7, chaseLeader: 0.3, attackEngaged: 0.3,
    shove: 0.2, charge: 0.3, disengage: 0.0, retreat: 0.05, strafe: 0.1,
    celebrate: 0.1, riskTolerance: 0.7, retargetInterval: 180,
  },
  // Avoids trouble but attacks when necessary. Fights an intelligent battle.
  defensive: {
    chaseNearest: 0.3, chaseWeakest: 0.9, chaseLeader: 0.05, attackEngaged: 0.2,
    shove: 0.2, charge: 0.1, disengage: 0.5, retreat: 1.0, strafe: 0.7,
    celebrate: 0.0, riskTolerance: 0.15, retargetInterval: 120,
  },
  // Strike, break off, repeat. Damage followed by self-preservation.
  hitAndRun: {
    chaseNearest: 0.6, chaseWeakest: 0.8, chaseLeader: 0.1, attackEngaged: 0.4,
    shove: 0.1, charge: 0.5, disengage: 1.0, retreat: 0.4, strafe: 0.4,
    celebrate: 0.05, riskTolerance: 0.4, retargetInterval: 90,
  },
  // Hunts bots already locked in a fight, looking for 2-on-1 eliminations.
  thirdParty: {
    chaseNearest: 0.2, chaseWeakest: 0.6, chaseLeader: 0.1, attackEngaged: 1.0,
    shove: 0.3, charge: 0.3, disengage: 0.3, retreat: 0.5, strafe: 0.5,
    celebrate: 0.05, riskTolerance: 0.35, retargetInterval: 100,
  },
  // Completely unpredictable. Rerolls its own weights mid-battle. The values here are
  // only its starting state; ai.ts replaces them periodically.
  chaos: {
    chaseNearest: 0.5, chaseWeakest: 0.5, chaseLeader: 0.5, attackEngaged: 0.5,
    shove: 0.5, charge: 0.5, disengage: 0.5, retreat: 0.5, strafe: 0.5,
    celebrate: 0.5, riskTolerance: 0.5, retargetInterval: 45,
  },
  // Big dramatic hits, fights on the edge of danger, showboats after a kill.
  showman: {
    chaseNearest: 0.7, chaseWeakest: 0.3, chaseLeader: 0.8, attackEngaged: 0.4,
    shove: 0.3, charge: 1.0, disengage: 0.2, retreat: 0.1, strafe: 0.3,
    celebrate: 1.0, riskTolerance: 0.95, retargetInterval: 150,
  },
  // Bumps bots into each other and into hazards. Rarely commits to a fight itself.
  instigator: {
    chaseNearest: 0.25, chaseWeakest: 0.2, chaseLeader: 0.2, attackEngaged: 0.6,
    shove: 1.0, charge: 0.2, disengage: 0.7, retreat: 0.5, strafe: 0.6,
    celebrate: 0.1, riskTolerance: 0.5, retargetInterval: 60,
  },
};

/** Returns a fresh copy, so a bot can mutate its own weights without affecting others. */
export function weightsFor(name: PersonalityName): Weights {
  return { ...TABLE[name] };
}
```

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- personality` → PASS. Report the real count.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/personality.ts src/sim/arena/personality.test.ts
git commit -m "feat(sim): add the seven driver personality weight vectors"
```

---

## Task 4: The AI

Scores actions, holds action states, blends in hazard avoidance, and drives the bot.

**Files:**
- Create: `src/sim/arena/ai.ts`
- Test: `src/sim/arena/ai.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch } from './match';
import { perceive } from './perception';
import { weightsFor } from './personality';
import { createAiState, chooseAction, driveWithAi, CELEBRATE_TICKS } from './ai';

const match = (n = 4) => createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: n });

describe('createAiState', () => {
  it('starts unlocked with its personality weights', () => {
    const s = createAiState('aggressive');
    expect(s.personality).toBe('aggressive');
    expect(s.lockedUntil).toBe(0);
    expect(s.weights.chaseNearest).toBe(weightsFor('aggressive').chaseNearest);
  });
});

describe('chooseAction', () => {
  it('picks an offensive action for an aggressive bot with a target nearby', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    const action = chooseAction(m, self, perceive(m, self), state);
    expect(['chase', 'charge']).toContain(action);
  });

  it('makes a badly hurt defensive bot retreat', () => {
    const m = match();
    const self = m.bots[0]!;
    self.health = 5;
    const state = createAiState('defensive');
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('retreat');
  });

  it('does not make a badly hurt aggressive bot retreat', () => {
    const m = match();
    const self = m.bots[0]!;
    self.health = 5;
    const state = createAiState('aggressive');
    expect(chooseAction(m, self, perceive(m, self), state)).not.toBe('retreat');
  });

  it('sends a third-party bot at an engaged pair', () => {
    const m = match(4);
    const [self, a, b] = [m.bots[0]!, m.bots[1]!, m.bots[2]!];
    a.lastContactId = b.body.id;
    b.lastContactId = a.body.id;
    a.lastContactTick = m.world.tick;
    b.lastContactTick = m.world.tick;
    const state = createAiState('thirdParty');
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('attackEngaged');
  });

  it('honours a locked action state instead of rescoring', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    state.lockedAction = 'celebrate';
    state.lockedUntil = m.world.tick + 30;
    expect(chooseAction(m, self, perceive(m, self), state)).toBe('celebrate');
  });

  it('releases the lock once it expires', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    state.lockedAction = 'celebrate';
    state.lockedUntil = m.world.tick;
    expect(chooseAction(m, self, perceive(m, self), state)).not.toBe('celebrate');
  });

  it('is deterministic — same inputs, same choice', () => {
    const m = match();
    const self = m.bots[0]!;
    const view = perceive(m, self);
    const a = chooseAction(m, self, view, createAiState('showman'));
    const b = chooseAction(m, self, view, createAiState('showman'));
    expect(a).toBe(b);
  });
});

describe('driveWithAi', () => {
  it('moves the bot', () => {
    const m = match();
    const self = m.bots[0]!;
    const state = createAiState('aggressive');
    driveWithAi(m, self, state);
    expect(self.body.vx * self.body.vx + self.body.vy * self.body.vy).toBeGreaterThan(0);
  });

  it('steers a cautious bot away from an adjacent pit', () => {
    const m = match();
    const self = m.bots[0]!;
    const size = DEFAULT_ARENA.tileSize;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    self.body.x = (col - 1) * size + size / 2;
    self.body.y = row * size + size / 2;
    // Put the only target directly beyond the pit, so chasing means driving into it.
    for (const other of m.bots) {
      if (other === self) continue;
      other.alive = false;
    }
    m.bots[1]!.alive = true;
    m.bots[1]!.body.x = (col + 2) * size;
    m.bots[1]!.body.y = row * size + size / 2;

    const cautious = createAiState('defensive');
    driveWithAi(m, self, cautious);
    // A defensive bot must not accelerate straight at the hole.
    expect(self.body.vx).toBeLessThan(0.35);
  });

  it('does nothing for an eliminated bot', () => {
    const m = match();
    const self = m.bots[0]!;
    self.alive = false;
    driveWithAi(m, self, createAiState('aggressive'));
    expect(self.body.vx).toBe(0);
    expect(self.body.vy).toBe(0);
  });
});

describe('CELEBRATE_TICKS', () => {
  it('is a visible but brief window', () => {
    expect(CELEBRATE_TICKS).toBeGreaterThan(30);
    expect(CELEBRATE_TICKS).toBeLessThan(180);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- "arena/ai"` → FAIL.

- [ ] **Step 3: Add a persistent RNG to `Match` first**

The AI draws from the seeded stream (`Math.random` is banned, and a second generator would
be a second source of truth). Before writing `ai.ts`, add `rng: Rng` to the `Match`
interface in `match.ts` and store the generator `createMatch` already builds, instead of
letting it fall out of scope. Also add `nextRetarget` usage — it is already on `AiState`.

Run `npm test -- match` and confirm the existing tests still pass.

- [ ] **Step 4: Implement**

```ts
import { cosOf, sinOf } from '../trig';
import { DEFAULT_BOT, type Bot } from './bot';
import { driveAway, driveToward, interceptOffset } from './steering';
import type { BotView } from './perception';
import { perceive } from './perception';
import { weightsFor, type PersonalityName, type Weights } from './personality';
import type { Match } from './match';

export const ACTIONS = [
  'chase',
  'attackEngaged',
  'shove',
  'charge',
  'disengage',
  'retreat',
  'strafe',
  'celebrate',
] as const;

export type ActionName = (typeof ACTIONS)[number];

/** How long a showboat lasts. A deliberate vulnerability window. */
export const CELEBRATE_TICKS = 75;
/** How long a hit-and-run break-off lasts. */
export const DISENGAGE_TICKS = 90;
/** Beyond this range a charge is a run-up; inside it, back off first. */
const CHARGE_RANGE = 220;
/** Ticks between Agent of Chaos rerolling its own weights. */
const CHAOS_REROLL = 240;
/** Scales hole repulsion into the same units as the chase offsets it blends with. */
const AVOID_BLEND = 260;

export interface AiState {
  personality: PersonalityName;
  weights: Weights;
  lockedAction: ActionName | null;
  lockedUntil: number;
  target: string | null;
  nextRetarget: number;
  nextChaosReroll: number;
}

export function createAiState(personality: PersonalityName): AiState {
  return {
    personality,
    weights: weightsFor(personality),
    lockedAction: null,
    lockedUntil: 0,
    target: null,
    nextRetarget: 0,
    nextChaosReroll: CHAOS_REROLL,
  };
}

/** Locks a bot into a behaviour for a fixed span, suspending normal scoring. */
export function lockAction(state: AiState, action: ActionName, tick: number, ticks: number): void {
  state.lockedAction = action;
  state.lockedUntil = tick + ticks;
}

function health01(bot: Bot): number {
  return bot.health / bot.maxHealth;
}

/**
 * Picks and commits to a target, re-drawn on the personality's retarget interval.
 *
 * Choosing the nearest bot every tick is what made the greybox stub produce duels
 * instead of a battle royale: the nearest bot stays nearest, so a fight never breaks up.
 * Committing to a target for a span and then re-drawing — weighted by personality, drawn
 * from the seeded PRNG — is what makes fights form, break, and reform.
 *
 * The chaseNearest / chaseWeakest / chaseLeader weights select the TARGET here. They are
 * not separate actions; a bot has one `chase` action and these decide who it chases.
 */
function resolveTarget(match: Match, self: Bot, state: AiState): Bot | null {
  const current =
    state.target === null ? null : match.bots.find((b) => b.body.id === state.target) ?? null;

  if (current !== null && current.alive && match.world.tick < state.nextRetarget) return current;

  const candidates = match.bots.filter((b) => b !== self && b.alive);
  if (candidates.length === 0) {
    state.target = null;
    return null;
  }

  const weights: number[] = [];
  let total = 0;
  for (const c of candidates) {
    const dx = c.body.x - self.body.x;
    const dy = c.body.y - self.body.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // The trailing constant keeps every bot reachable, so even an unattractive target
    // is occasionally chosen. That residual is where unpredictability comes from.
    const weight =
      state.weights.chaseNearest / (1 + dist / 300) +
      state.weights.chaseWeakest * (1 - health01(c)) +
      (c.kills > 0 ? state.weights.chaseLeader : 0) +
      0.05;
    weights.push(weight);
    total += weight;
  }

  let roll = match.rng.next() * total;
  let picked = candidates[candidates.length - 1]!;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      picked = candidates[i]!;
      break;
    }
  }

  state.target = picked.body.id;
  state.nextRetarget = match.world.tick + state.weights.retargetInterval;
  return picked;
}

/**
 * Scores every action and returns the winner.
 *
 * Hazard avoidance is deliberately NOT an action here — it is blended into steering in
 * `driveWithAi`. Making it compete would force a bot to choose between chasing and
 * dodging; blending lets it do both, which is what competent driving looks like.
 */
export function chooseAction(
  match: Match,
  self: Bot,
  view: BotView,
  state: AiState,
): ActionName {
  const tick = match.world.tick;

  if (state.lockedAction !== null && tick < state.lockedUntil) return state.lockedAction;
  state.lockedAction = null;

  const w = state.weights;
  const hurt = 1 - health01(self);
  const dist = view.nearest === null ? Number.POSITIVE_INFINITY : Math.sqrt(view.nearestDistSq);
  const closeness = view.nearest === null ? 0 : 1 / (1 + dist / 300);

  let best: ActionName = 'strafe';
  let bestScore = -1;

  const consider = (action: ActionName, score: number): void => {
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  };

  if (view.nearest !== null) {
    // One chase action. WHO it chases is decided by resolveTarget, not by scoring
    // three near-identical actions against each other.
    const chaseDrive =
      (w.chaseNearest * closeness +
        w.chaseWeakest * (view.weakest === null ? 0 : 1 - health01(view.weakest)) +
        (view.leader === null ? 0 : w.chaseLeader)) /
      3;
    consider('chase', chaseDrive);
    consider('strafe', w.strafe * closeness * 0.5);
    consider('shove', w.shove * closeness);
    consider('charge', w.charge * (dist > CHARGE_RANGE ? 1 : 0.35));
  }
  if (view.engagedPair !== null) {
    consider('attackEngaged', w.attackEngaged);
  }
  consider('retreat', w.retreat * hurt);
  consider('disengage', w.disengage * hurt * 0.4);

  return best;
}

/** Where the chosen action wants to go, as an offset from the bot. */
function actionOffset(
  action: ActionName,
  self: Bot,
  view: BotView,
  target: Bot | null,
): { x: number; y: number } {
  const speed = DEFAULT_BOT.maxSpeed;
  const mark = target ?? view.nearest;

  const toward = (other: Bot): { x: number; y: number } =>
    interceptOffset(self, other.body.x, other.body.y, other.body.vx, other.body.vy, speed);

  switch (action) {
    case 'chase':
    case 'charge':
      return mark ? toward(mark) : { x: 0, y: 0 };
    case 'shove': {
      // Not a plain ram. Line up on the far side of the target from where you want it
      // to end up, so the hit sends it there. This is the whole of the Instigator.
      if (!mark) return { x: 0, y: 0 };
      // Push it away from wherever the bot itself is being repelled — that is, toward
      // the danger the bot can see. If nothing is nearby, push it toward the arena edge.
      const pushX = -view.avoidX;
      const pushY = -view.avoidY;
      const len = Math.sqrt(pushX * pushX + pushY * pushY);
      if (len === 0) return toward(mark);
      const standoff = self.body.radius * 2;
      return {
        x: mark.body.x - (pushX / len) * standoff - self.body.x,
        y: mark.body.y - (pushY / len) * standoff - self.body.y,
      };
    }
    case 'attackEngaged': {
      if (view.engagedPair === null) return { x: 0, y: 0 };
      // Aim at the midpoint of the scrum, so it arrives between them.
      const [a, b] = view.engagedPair;
      return {
        x: (a.body.x + b.body.x) / 2 - self.body.x,
        y: (a.body.y + b.body.y) / 2 - self.body.y,
      };
    }
    case 'strafe': {
      if (!view.nearest) return { x: 0, y: 0 };
      // Perpendicular to the line to the target: circle rather than close.
      const dx = view.nearest.body.x - self.body.x;
      const dy = view.nearest.body.y - self.body.y;
      return { x: -dy, y: dx };
    }
    case 'retreat':
    case 'disengage':
      return mark
        ? { x: self.body.x - mark.body.x, y: self.body.y - mark.body.y }
        : { x: 0, y: 0 };
    case 'celebrate':
      // Spin on the spot: aim perpendicular to the current heading so it keeps turning.
      return { x: -sinOf(self.heading), y: cosOf(self.heading) };
  }
}

/**
 * Decides and drives one bot for one tick.
 *
 * Hole repulsion is blended into the chosen direction, scaled by `1 - riskTolerance`.
 * A defensive bot gives a pit a wide berth; a showman drives past it. Personality
 * governs how much risk is accepted, never whether the hazard is visible.
 */
export function driveWithAi(match: Match, self: Bot, state: AiState): void {
  if (!self.alive) return;

  const view = perceive(match, self);
  const tick = match.world.tick;

  if (state.personality === 'chaos' && tick >= state.nextChaosReroll) {
    // Cycles through the other personalities, which is exactly what Agent of Chaos is.
    const others = ['aggressive', 'defensive', 'hitAndRun', 'thirdParty', 'showman', 'instigator'] as const;
    const pick = others[Math.floor(match.rng.next() * others.length)]!;
    state.weights = weightsFor(pick);
    state.nextChaosReroll = tick + CHAOS_REROLL;
  }

  const action = chooseAction(match, self, view, state);
  const target = resolveTarget(match, self, state);

  if (action === 'charge' && target !== null) {
    const dx = target.body.x - self.body.x;
    const dy = target.body.y - self.body.y;
    if (Math.sqrt(dx * dx + dy * dy) < CHARGE_RANGE * 0.5) {
      // Too close to build a run-up. Back off first, then commit on a later tick.
      driveAway(self, dx, dy);
      return;
    }
  }

  const want = actionOffset(action, self, view, target);
  const caution = 1 - state.weights.riskTolerance;

  driveToward(
    self,
    want.x + view.avoidX * caution * AVOID_BLEND,
    want.y + view.avoidY * caution * AVOID_BLEND,
  );
}
```

- [ ] **Step 5: Confirm it passes**

Run: `npm test -- "arena/ai"` → PASS. Report the real count.

**The weight table in `personality.ts` was hand-written, not tuned.** If a scoring test
fails because one action narrowly beats another, report the actual scores rather than
adjusting either the test or the weights — I need to know which way the imbalance runs.

- [ ] **Step 6: Commit**

```bash
git add src/sim/arena/ai.ts src/sim/arena/ai.test.ts src/sim/arena/match.ts
git commit -m "feat(sim): add utility-scoring AI with action states and blended avoidance"
```

---

## Task 5: Wire the AI into matches

Replaces the chase stub. Assigns personalities, triggers celebrate and disengage.

**Files:**
- Modify: `src/sim/arena/match.ts`
- Modify: `src/sim/arena/match.test.ts`

- [ ] **Step 1: Replace the stub**

In `match.ts`:

1. Add `ai: AiState` to each bot's record. Store as a parallel `Map<string, AiState>` on
   `Match` (`aiStates`), so `Bot` stays a pure physics-and-stats type.
2. Assign personalities in `createMatch`: cycle through `PERSONALITY_NAMES` in order, then
   shuffle the assignment with the seeded PRNG so personality never correlates with bot
   index — the same fairness rule the Plinko board and spawn positions needed.
3. Delete `driveStub`, `throttleFor` and the intercept code from `match.ts`; those now live
   in `steering.ts`. Call `driveWithAi(match, bot, state)` instead.
4. On elimination, if `byId` is set, look up the killer's AI state and
   `lockAction(state, 'celebrate', tick, CELEBRATE_TICKS)` — but only when its
   `weights.celebrate` exceeds 0.5, so only showboating personalities do it.
5. When a bot lands damage and its `weights.disengage` exceeds 0.7, lock it into
   `'disengage'` for `DISENGAGE_TICKS`.

- [ ] **Step 2: Add tests**

Append to `match.test.ts`:

```ts
describe('personalities', () => {
  it('assigns a personality to every bot', () => {
    const m = createMatch({ ...config, seed: 1, botCount: 10 });
    for (const bot of m.bots) {
      expect(m.aiStates.get(bot.body.id)).toBeDefined();
    }
  });

  it('does not correlate personality with bot index across seeds', () => {
    const first: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch({ ...config, seed, botCount: 10 });
      first.push(m.aiStates.get(m.bots[0]!.body.id)!.personality);
    }
    // Bot 0 must not always be the same personality.
    expect(new Set(first).size).toBeGreaterThan(3);
  });

  it('uses every personality when there are at least seven bots', () => {
    const m = createMatch({ ...config, seed: 3, botCount: 10 });
    const used = new Set([...m.aiStates.values()].map((s) => s.personality));
    expect(used.size).toBe(7);
  });
});
```

- [ ] **Step 3: Confirm the whole match suite passes**

Run: `npm test -- match` → PASS. Determinism tests must still hold: same seed, same
checksum.

- [ ] **Step 4: Commit**

```bash
git add src/sim/arena/match.ts src/sim/arena/match.test.ts
git commit -m "feat(sim): drive bots with the personality AI instead of the chase stub"
```

---

## Task 6: The spiral collapse

The guaranteed ending. Nothing happens until 2:30, then the floor falls away from the
outside in until only one bot can survive.

**Files:**
- Create: `src/sim/arena/collapse.ts`
- Test: `src/sim/arena/collapse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TileState, createTileGrid } from './tiles';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch, advanceMatch } from './match';
import {
  COLLAPSE_START_TICK,
  COLLAPSE_END_TICK,
  WARNING_TICKS,
  buildSpiralOrder,
  updateCollapse,
} from './collapse';

describe('buildSpiralOrder', () => {
  it('lists every tile exactly once', () => {
    const grid = createTileGrid(4, 3, 60);
    const order = buildSpiralOrder(grid);
    expect(order.length).toBe(12);
    expect(new Set(order).size).toBe(12);
  });

  it('starts on the outer ring', () => {
    const grid = createTileGrid(5, 5, 60);
    const first = buildSpiralOrder(grid)[0]!;
    const row = Math.floor(first / 5);
    const col = first % 5;
    expect(row === 0 || row === 4 || col === 0 || col === 4).toBe(true);
  });

  it('ends near the middle', () => {
    const grid = createTileGrid(5, 5, 60);
    const order = buildSpiralOrder(grid);
    const last = order[order.length - 1]!;
    const row = Math.floor(last / 5);
    const col = last % 5;
    expect(row).toBeGreaterThan(0);
    expect(row).toBeLessThan(4);
    expect(col).toBeGreaterThan(0);
    expect(col).toBeLessThan(4);
  });

  it('is deterministic', () => {
    const grid = createTileGrid(6, 4, 60);
    expect(buildSpiralOrder(grid)).toEqual(buildSpiralOrder(grid));
  });
});

describe('COLLAPSE timings', () => {
  it('starts at two and a half minutes and finishes at five', () => {
    expect(COLLAPSE_START_TICK).toBe(9000);
    expect(COLLAPSE_END_TICK).toBe(18000);
  });

  it('warns for long enough to react but not long enough to be safe', () => {
    expect(WARNING_TICKS).toBeGreaterThan(30);
    expect(WARNING_TICKS).toBeLessThan(200);
  });
});

describe('updateCollapse', () => {
  const match = () => createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed: 1, botCount: 4 });

  it('changes nothing before the start tick', () => {
    const m = match();
    const before = [...m.arena.grid.tiles];
    m.world.tick = COLLAPSE_START_TICK - 1;
    updateCollapse(m);
    expect([...m.arena.grid.tiles]).toEqual(before);
  });

  it('marks tiles WARNING before removing them', () => {
    const m = match();
    m.world.tick = COLLAPSE_START_TICK + 10;
    updateCollapse(m);
    expect([...m.arena.grid.tiles]).toContain(TileState.Warning);
  });

  it('removes every tile by the end tick', () => {
    const m = match();
    for (let t = COLLAPSE_START_TICK; t <= COLLAPSE_END_TICK; t++) {
      m.world.tick = t;
      updateCollapse(m);
    }
    for (const state of m.arena.grid.tiles) {
      expect(state).toBe(TileState.Gone);
    }
  });

  it('never restores a tile that has already gone', () => {
    const m = match();
    for (let t = COLLAPSE_START_TICK; t <= COLLAPSE_END_TICK; t += 7) {
      m.world.tick = t;
      const goneBefore = [...m.arena.grid.tiles].filter((s) => s === TileState.Gone).length;
      updateCollapse(m);
      const goneAfter = [...m.arena.grid.tiles].filter((s) => s === TileState.Gone).length;
      expect(goneAfter).toBeGreaterThanOrEqual(goneBefore);
    }
  });
});

describe('collapse in a real match', () => {
  it('guarantees a single survivor', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed, botCount: 10 });
      while (!m.done) advanceMatch(m);
      expect(m.bots.filter((b) => b.alive).length).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- collapse` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { TileState, setTileState, type TileGrid } from './tiles';
import type { Match } from './match';

/** 2:30 at 60 ticks per second. Nothing happens before this. */
export const COLLAPSE_START_TICK = 9000;
/** 5:00. Every tile is gone by here, which is the hard ceiling on match length. */
export const COLLAPSE_END_TICK = 18000;
/** How long a tile flashes before it drops. */
export const WARNING_TICKS = 90;

/**
 * Tile indices in outside-in spiral order.
 *
 * Removing them in this order shrinks the playable floor from the perimeter toward the
 * middle, squeezing bots together. A ring-at-a-time order would drop whole sides at once;
 * a spiral reads as a continuous wave chasing bots inward.
 */
export function buildSpiralOrder(grid: TileGrid): number[] {
  const order: number[] = [];
  let top = 0;
  let bottom = grid.rows - 1;
  let left = 0;
  let right = grid.cols - 1;

  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) order.push(top * grid.cols + c);
    top++;
    for (let r = top; r <= bottom; r++) order.push(r * grid.cols + right);
    right--;
    if (top <= bottom) {
      for (let c = right; c >= left; c--) order.push(bottom * grid.cols + c);
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) order.push(r * grid.cols + left);
      left++;
    }
  }

  return order;
}

/**
 * Advances the collapse to match the current tick.
 *
 * Written as a function of absolute tick rather than an incremental step, so it is
 * idempotent and cannot drift: calling it twice on the same tick changes nothing, and
 * the schedule is identical regardless of how the match was stepped.
 */
export function updateCollapse(match: Match): void {
  const tick = match.world.tick;
  if (tick < COLLAPSE_START_TICK) return;

  const order = match.collapseOrder;
  const span = COLLAPSE_END_TICK - COLLAPSE_START_TICK;
  const progress = (tick - COLLAPSE_START_TICK) / span;

  const goneCount = Math.min(order.length, Math.floor(progress * order.length));
  const warningCount = Math.min(
    order.length,
    Math.floor(((tick - COLLAPSE_START_TICK + WARNING_TICKS) / span) * order.length),
  );

  for (let i = 0; i < goneCount; i++) {
    setTileState(match.arena.grid, order[i]!, TileState.Gone);
  }
  for (let i = goneCount; i < warningCount; i++) {
    if (match.arena.grid.tiles[order[i]!] !== TileState.Gone) {
      setTileState(match.arena.grid, order[i]!, TileState.Warning);
    }
  }
}
```

- [ ] **Step 4: Wire it into `advanceMatch`**

Add `collapseOrder: number[]` to `Match`, built in `createMatch` via `buildSpiralOrder`.
Call `updateCollapse(match)` at the **start** of `advanceMatch`, before the AI runs, so
bots react to this tick's warnings rather than last tick's.

- [ ] **Step 5: Confirm it passes**

Run: `npm test -- collapse` and `npm test -- match`. Both expected to pass.

**The "guarantees a single survivor" test is the point of this task.** If it fails,
report the seeds and the surviving bot count rather than changing the test.

- [ ] **Step 6: Commit**

```bash
git add src/sim/arena/collapse.ts src/sim/arena/collapse.test.ts src/sim/arena/match.ts
git commit -m "feat(sim): add spiral floor collapse guaranteeing a single winner"
```

---

## Task 7: Metrics harness

The instrument that answers "is this fun?".

**Files:**
- Create: `tools/arena-metrics.ts`
- Modify: `package.json` — add `"arena": "vite-node tools/arena-metrics.ts"`

- [ ] **Step 1: Write the tool**

```ts
/**
 * Measures whether the arena is worth watching.
 *
 * Usage: npm run arena -- [matches]
 *
 * Four numbers matter, in this order:
 *
 * 1. Match length. Target is 2-3 minutes, so 7200-10800 ticks.
 * 2. Elimination pacing. Deaths spread through the match, not all at the start.
 * 3. Cause mix. If most deaths are hazards, the arena is fighting the bots instead of
 *    the bots fighting each other.
 * 4. Win rate by personality. If one wins 60% of matches, the model is broken before a
 *    single bot category exists. This is the number the next phase consumes.
 */
import { DEFAULT_ARENA } from '../src/sim/arena/arena';
import { DEFAULT_MATCH, createMatch, advanceMatch } from '../src/sim/arena/match';
import { PERSONALITY_NAMES, type PersonalityName } from '../src/sim/arena/personality';

const RUNS = Number(process.argv[2] ?? 100);

const ticks: number[] = [];
const causes: Record<string, number> = {};
const wins: Record<string, number> = {};
const appearances: Record<string, number> = {};
/** Elimination ticks bucketed into fifths of the match, to see pacing. */
const quintiles = [0, 0, 0, 0, 0];
let capped = 0;

for (const name of PERSONALITY_NAMES) {
  wins[name] = 0;
  appearances[name] = 0;
}

const started = Date.now();

for (let seed = 1; seed <= RUNS; seed++) {
  const match = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed, botCount: 10 });
  for (const bot of match.bots) {
    appearances[match.aiStates.get(bot.body.id)!.personality]!++;
  }

  while (!match.done) advanceMatch(match);

  ticks.push(match.world.tick);
  if (match.world.tick >= DEFAULT_MATCH.maxTicks) capped++;

  for (const e of match.eliminations) {
    causes[e.cause] = (causes[e.cause] ?? 0) + 1;
    const bucket = Math.min(4, Math.floor((e.tick / Math.max(1, match.world.tick)) * 5));
    quintiles[bucket]!++;
  }

  const winner = match.bots.find((b) => b.alive);
  if (winner) wins[match.aiStates.get(winner.body.id)!.personality]!++;
}

const elapsed = (Date.now() - started) / 1000;
ticks.sort((a, b) => a - b);
const median = ticks[Math.floor(ticks.length / 2)]!;
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;

console.log(`\n  ${RUNS} matches in ${elapsed.toFixed(0)}s\n`);

console.log('  1. MATCH LENGTH   (target 7200-10800 ticks, 2-3 minutes)');
console.log(`     min ${ticks[0]}, median ${median} (${(median / 60).toFixed(0)}s), max ${ticks[ticks.length - 1]}`);
console.log(`     hit the cap: ${capped}\n`);

const totalElims = Object.values(causes).reduce((a, b) => a + b, 0);
console.log('  2. ELIMINATION PACING   (even spread is healthy)');
console.log(`     ${quintiles.map((q) => pct(q, totalElims)).join('  ')}`);
console.log('     ^early                                    late^\n');

console.log('  3. CAUSE OF DEATH   (combat should dominate)');
for (const [cause, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${cause.padEnd(12)} ${pct(n, totalElims).padStart(6)}`);
}

console.log('\n  4. WIN RATE BY PERSONALITY   (even is ~14.3%)');
const rows = PERSONALITY_NAMES.map((name) => ({
  name,
  rate: (wins[name]! / RUNS) * 100,
})).sort((a, b) => b.rate - a.rate);
for (const row of rows) {
  const bar = '#'.repeat(Math.round(row.rate));
  console.log(`     ${row.name.padEnd(12)} ${row.rate.toFixed(1).padStart(5)}%  ${bar}`);
}
const spread = rows[0]!.rate - rows[rows.length - 1]!.rate;
console.log(`\n     spread: ${spread.toFixed(1)} points between best and worst`);
if (spread > 20) console.log('     WARNING: personalities are badly unbalanced');
console.log('');
```

- [ ] **Step 2: Run it**

Run: `npm run arena -- 60`

Report the complete output verbatim. **Do not tune anything in response to it** — the
numbers are the deliverable of this task, and the tuning decision is the human's.

- [ ] **Step 3: Commit**

```bash
git add tools/arena-metrics.ts package.json
git commit -m "feat(tools): add arena metrics harness"
```

---

## Task 8: Renderer and shell

Make the new behaviour visible.

**Files:**
- Modify: `src/render/arena-renderer.ts`
- Modify: `src/shell/main.ts`

- [ ] **Step 1: Extend the renderer**

Additions only — do not restructure:

1. `WARNING` tiles already render in a different colour. Make them **pulse** using
   `match.world.tick` (never wall-clock time) so the collapse wave is obvious.
2. Draw each bot's personality as a three-letter tag below it (`AGG`, `DEF`, `H&R`,
   `3RD`, `CHA`, `SHO`, `INS`). Pass the tags in as a `Map<string, string>` argument
   rather than importing the AI into the renderer — the render layer must not depend on
   AI internals.
3. Draw a kill feed down the right-hand side from `match.eliminations`: most recent first,
   showing the eliminated bot's number and cause.

The renderer canvas is currently exactly the arena size. Widen it by 190px and draw the
kill feed in that margin, leaving the arena drawing untouched.

- [ ] **Step 2: Extend the shell**

The arena status line should show, when the match ends, the winning bot number and its
personality. Keep the existing seed input and buttons.

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit`, `npm run lint`, `npm run build`. All expected clean. **Do not run
`npm run dev`** — the human verifies visually.

- [ ] **Step 4: Commit**

```bash
git add src/render/arena-renderer.ts src/shell/main.ts
git commit -m "feat(render): show personalities, collapse warnings, and a kill feed"
```

---

## Definition of done

- [ ] `npm test` passes in full
- [ ] `npm run lint` and `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] **Every match produces exactly one survivor** — the collapse guarantees it
- [ ] The same seed still produces the same checksum and placements
- [ ] All seven personalities appear in a 10-bot match, and personality does not
      correlate with bot index across seeds
- [ ] `npm run arena -- 60` produces the four metrics

## What this does not include

- Hazards: saw blades, flame jets, tar, ice — a separate later plan
- The three-component weapon model (collision / passive contact / active) — Phase 4,
  alongside the bot categories
- Any balance tuning. Expect the first metrics run to look wrong; that is its job.
- Arenas 2–5
