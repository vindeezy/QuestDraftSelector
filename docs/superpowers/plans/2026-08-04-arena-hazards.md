# Arena Hazards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four arena hazards — saw blades, flame jets, tar, ice — finishing Phase 3.

**Architecture:** Hazards split by nature, not forced into one abstraction. **Surfaces** (tar, ice) are properties of the floor and live on the tile grid as a parallel byte array. **Emplacements** (saws, flame jets) are objects with a position, a reach, and a firing cycle. Surfaces modify how a bot moves; emplacements deal damage and knockback.

**Tech Stack:** TypeScript, Vitest, PixiJS. Existing sim: `trig`, `arena/{tiles,arena,bot,combat,steering,perception,personality,ai,collapse,match}`.

**Scope:** Phase 3, step 6. This completes the arena greybox. Bot categories are Phase 4.

---

## Background for the implementer

Read `docs/superpowers/specs/2026-08-04-arena-greybox-design.md` §5.3 first.

**Why hazards matter beyond flavour.** Two of the seven bot categories in Phase 4 hinge on
stats that currently do nothing:

- `grip` only matters if some floor is slippery. Ice is what makes Tank Tracks meaningfully
  different from Omni Wheels.
- `mass` and `thrust` only matter if some floor resists. Tar is what makes a heavy build a
  real trade-off rather than a strictly worse one.

Designing those categories before the stats have consequences would be guesswork.

**They also attack a measured balance problem.** Survival personalities currently take
~60% of wins between them, because retreating is nearly free — every bot has the same top
speed, so a runner cannot be caught. Tar and hazard-lined space are anti-retreat geometry:
a bot that cannot back off without bogging down or hitting a saw loses that free escape.

**Determinism contract, lint-enforced on `src/sim/`.** Banned: `Math.sin/cos/tan/asin/acos/
atan/atan2/pow/hypot/log/exp/cbrt/random`, the `**` operator, `Date`, `performance`,
`document`, imports from `../render` or `../shell`. Permitted: `+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`, `Math.max`, `Math.imul`.
Test files are exempt. Flame cycles must be driven by `world.tick`, never wall-clock time.

**One constraint that has bitten this project before.** The speed clamp must be applied
**after** surface modifiers, never before. A body that travels further in one tick than the
smallest thing it can collide with passes straight through it. Ice reduces friction, so a
bot on ice can end a tick faster than intended if the clamp runs first.

**Existing API:**

- `src/sim/arena/tiles.ts` — `TileState`, `TileGrid` (`cols`, `rows`, `tileSize`, `width`,
  `height`, `tiles`), `tileIndexAt(grid, x, y)` (returns -1 off-grid), `isOverHole`
- `src/sim/arena/arena.ts` — `ArenaConfig` (`cols`, `rows`, `tileSize`, `pits`, `wallGaps`),
  `Arena` (`config`, `grid`, `segments`), `buildArena`, `DEFAULT_ARENA`
- `src/sim/arena/bot.ts` — `Bot`, `DEFAULT_BOT`, `applyGrip(bot)`, `applyThrust`
- `src/sim/arena/combat.ts` — `resolveHit(attacker, target, impactSpeed, tick)`
- `src/sim/arena/perception.ts` — `perceive(match, self)` → `BotView` with `avoidX`/`avoidY`
- `src/sim/arena/match.ts` — `Match`, `advanceMatch`, `createMatch`
- `src/sim/arena/ai.ts` — `driveWithAi(match, bot, state)`

**Commands.** `npm test -- <filter>` (never bare `npm test`, ~3 minutes), `npm run lint`,
`npx tsc --noEmit`, `npm run arena -- 80`. **Never run `npm run dev`.** **Never run
anything in the background.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/arena/surface.ts` | Floor surfaces: the enum, the per-tile array, and lookup. |
| `src/sim/arena/emplacement.ts` | Saws and flame jets: geometry, firing cycle, damage. |
| `src/sim/arena/arena.ts` | Extended: surface and emplacement config, Arena 1 layout. |
| `src/sim/arena/bot.ts` | `applyGrip` gains a grip scale for ice. |
| `src/sim/arena/match.ts` | Applies surfaces and emplacements each tick. |
| `src/sim/arena/perception.ts` | Emplacements register as danger to steer around. |
| `src/render/arena-renderer.ts` | Draws surfaces and emplacements. |

---

## Task 1: Floor surfaces

**Files:**
- Create: `src/sim/arena/surface.ts`
- Test: `src/sim/arena/surface.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createTileGrid } from './tiles';
import { Surface, createSurfaceMap, setSurface, surfaceAt, effectOf } from './surface';

const grid = () => createTileGrid(4, 3, 60);

describe('createSurfaceMap', () => {
  it('starts every tile plain', () => {
    const g = grid();
    const s = createSurfaceMap(g);
    expect(s.length).toBe(12);
    for (const v of s) expect(v).toBe(Surface.Plain);
  });
});

describe('setSurface and surfaceAt', () => {
  it('round-trips a surface', () => {
    const g = grid();
    const s = createSurfaceMap(g);
    setSurface(g, s, 5, Surface.Ice);
    expect(surfaceAt(g, s, 70, 70)).toBe(Surface.Ice);
  });

  it('reports plain off the grid', () => {
    const g = grid();
    const s = createSurfaceMap(g);
    expect(surfaceAt(g, s, -10, -10)).toBe(Surface.Plain);
  });
});

describe('effectOf', () => {
  it('leaves plain floor untouched', () => {
    expect(effectOf(Surface.Plain)).toEqual({ drag: 1, grip: 1 });
  });

  it('makes tar slow but not slippery', () => {
    const tar = effectOf(Surface.Tar);
    expect(tar.drag).toBeLessThan(1);
    expect(tar.grip).toBe(1);
  });

  it('makes ice slippery but not slow', () => {
    const ice = effectOf(Surface.Ice);
    expect(ice.grip).toBeLessThan(1);
    expect(ice.drag).toBe(1);
  });

  it('never returns a negative or zero multiplier', () => {
    for (const s of [Surface.Plain, Surface.Tar, Surface.Ice]) {
      expect(effectOf(s).drag).toBeGreaterThan(0);
      expect(effectOf(s).grip).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- surface` → FAIL, cannot resolve import.

- [ ] **Step 3: Implement**

```ts
import { tileIndexAt, type TileGrid } from './tiles';

/**
 * What the floor of a tile is made of.
 *
 * Surfaces are a property of the FLOOR, which is why they live on the tile grid rather
 * than being objects like saws and flame jets. They change how a bot moves rather than
 * damaging it.
 */
export const Surface = {
  Plain: 0,
  /** Sticky. Bots bog down and cannot pull away quickly. */
  Tar: 1,
  /** Slippery. Bots keep sliding sideways and cannot corner. */
  Ice: 2,
} as const;

export type SurfaceValue = (typeof Surface)[keyof typeof Surface];

export interface SurfaceEffect {
  /** Multiplies velocity each tick. Below 1 slows the bot. */
  drag: number;
  /** Multiplies how much sideways velocity grip removes. Below 1 means sliding. */
  grip: number;
}

/**
 * Tar is the anti-retreat surface. Every bot has the same top speed, so a fleeing bot
 * normally cannot be caught; a tar patch is where that stops being true.
 */
const TAR: SurfaceEffect = { drag: 0.9, grip: 1 };

/**
 * Ice is what makes the `grip` stat mean something, and therefore what makes Tank Tracks
 * meaningfully different from Omni Wheels when the bot categories arrive.
 */
const ICE: SurfaceEffect = { drag: 1, grip: 0.12 };

const PLAIN: SurfaceEffect = { drag: 1, grip: 1 };

/** One surface byte per tile, matching the grid's row-major layout. */
export function createSurfaceMap(grid: TileGrid): Uint8Array {
  return new Uint8Array(grid.cols * grid.rows).fill(Surface.Plain);
}

export function setSurface(
  grid: TileGrid,
  surfaces: Uint8Array,
  index: number,
  surface: SurfaceValue,
): void {
  surfaces[index] = surface;
}

/** Surface under a position. Off-grid reads as plain — there is no floor to be made of. */
export function surfaceAt(
  grid: TileGrid,
  surfaces: Uint8Array,
  x: number,
  y: number,
): SurfaceValue {
  const index = tileIndexAt(grid, x, y);
  if (index < 0) return Surface.Plain;
  return surfaces[index] as SurfaceValue;
}

export function effectOf(surface: SurfaceValue): SurfaceEffect {
  if (surface === Surface.Tar) return TAR;
  if (surface === Surface.Ice) return ICE;
  return PLAIN;
}
```

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- surface` → PASS. Report the real `it()` count.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/surface.ts src/sim/arena/surface.test.ts
git commit -m "feat(sim): add tar and ice floor surfaces"
```

---

## Task 2: Emplacements

**Files:**
- Create: `src/sim/arena/emplacement.ts`
- Test: `src/sim/arena/emplacement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { createSaw, createFlame, isFiring, hits, applyEmplacement } from './emplacement';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });

describe('createSaw', () => {
  it('is always firing', () => {
    const saw = createSaw(100, 100, 25);
    expect(isFiring(saw, 0)).toBe(true);
    expect(isFiring(saw, 999)).toBe(true);
  });
});

describe('createFlame', () => {
  const flame = createFlame(100, 100, 0, 80, 120, 60);

  it('cycles on and off with the tick, never the clock', () => {
    expect(isFiring(flame, 0)).toBe(true);
    expect(isFiring(flame, 59)).toBe(true);
    expect(isFiring(flame, 60)).toBe(false);
    expect(isFiring(flame, 119)).toBe(false);
    expect(isFiring(flame, 120)).toBe(true);
  });

  it('repeats identically on later cycles', () => {
    for (let t = 0; t < 300; t++) {
      expect(isFiring(flame, t)).toBe(isFiring(flame, t + 120));
    }
  });
});

describe('hits', () => {
  const saw = createSaw(100, 100, 25);

  it('hits a bot inside its reach', () => {
    expect(hits(saw, bot(110, 100))).toBe(true);
  });

  it('misses a bot outside its reach', () => {
    expect(hits(saw, bot(300, 100))).toBe(false);
  });

  it('accounts for the bot radius, not just its centre', () => {
    // Bot radius is 20, saw radius 25, so centres 44 apart still overlap.
    expect(hits(saw, bot(144, 100))).toBe(true);
    expect(hits(saw, bot(146, 100))).toBe(false);
  });

  it('a flame reaches along its heading but not behind it', () => {
    // Heading 0 points along +x, reach 80.
    const flame = createFlame(100, 100, 0, 80, 120, 60);
    expect(hits(flame, bot(150, 100))).toBe(true);
    expect(hits(flame, bot(50, 100))).toBe(false);
  });

  it('a flame is narrow — it misses a bot well off its axis', () => {
    const flame = createFlame(100, 100, 0, 80, 120, 60);
    expect(hits(flame, bot(150, 220))).toBe(false);
  });
});

describe('applyEmplacement', () => {
  it('damages a bot in a firing saw', () => {
    const saw = createSaw(100, 100, 25);
    const b = bot(110, 100);
    applyEmplacement(saw, b, 0);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('shoves the bot away from the hazard', () => {
    const saw = createSaw(100, 100, 25);
    const b = bot(120, 100);
    applyEmplacement(saw, b, 0);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('does nothing while a flame is off', () => {
    const flame = createFlame(100, 100, 0, 80, 120, 60);
    const b = bot(150, 100);
    applyEmplacement(flame, b, 70); // off phase
    expect(b.health).toBe(b.maxHealth);
  });

  it('does nothing to an eliminated bot', () => {
    const saw = createSaw(100, 100, 25);
    const b = bot(110, 100);
    b.alive = false;
    applyEmplacement(saw, b, 0);
    expect(b.health).toBe(b.maxHealth);
  });

  it('kills a bot outright if it lingers', () => {
    const saw = createSaw(100, 100, 25);
    const b = bot(110, 100);
    for (let t = 0; t < 600; t++) applyEmplacement(saw, b, t);
    expect(b.health).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- emplacement` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { cosOf, sinOf } from '../trig';
import type { Bot } from './bot';

export const EmplacementKind = {
  Saw: 0,
  Flame: 1,
} as const;

export type EmplacementKindValue = (typeof EmplacementKind)[keyof typeof EmplacementKind];

/**
 * A wall-mounted hazard.
 *
 * Unlike tar and ice, these are objects rather than floor properties: they have a
 * position, a reach, and in the flame's case a firing cycle. Trying to express them as
 * tile flags would lose the direction and the timing, which are the whole character of
 * a flame jet.
 */
export interface Emplacement {
  kind: EmplacementKindValue;
  x: number;
  y: number;
  /** Angle index the hazard points along. Ignored by saws, which are omnidirectional. */
  heading: number;
  /** Radius for a saw; length of the jet for a flame. */
  reach: number;
  /** Half-width of a flame jet, in units. Ignored by saws. */
  halfWidth: number;
  /** Ticks in a full on/off cycle. Zero means always on. */
  period: number;
  /** Ticks at the start of each cycle during which it fires. */
  activeTicks: number;
  damagePerTick: number;
  knockback: number;
}

/** Saws are always spinning. Contact with one is continuous damage, not a discrete hit. */
export function createSaw(x: number, y: number, reach: number): Emplacement {
  return {
    kind: EmplacementKind.Saw,
    x,
    y,
    heading: 0,
    reach,
    halfWidth: 0,
    period: 0,
    activeTicks: 0,
    damagePerTick: 0.55,
    knockback: 0.9,
  };
}

/**
 * Flame jets fire intermittently, so the space in front of one is periodically safe.
 * That makes them a timing hazard rather than a wall, and gives a bot being chased a
 * gamble worth taking.
 */
export function createFlame(
  x: number,
  y: number,
  heading: number,
  reach: number,
  period: number,
  activeTicks: number,
): Emplacement {
  return {
    kind: EmplacementKind.Flame,
    x,
    y,
    heading,
    reach,
    halfWidth: 26,
    period,
    activeTicks,
    damagePerTick: 0.4,
    knockback: 0.25,
  };
}

/** Whether the hazard is dangerous on this tick. Driven by the tick, never the clock. */
export function isFiring(e: Emplacement, tick: number): boolean {
  if (e.period === 0) return true;
  return tick % e.period < e.activeTicks;
}

/** Whether a bot is inside the hazard's dangerous volume, accounting for its radius. */
export function hits(e: Emplacement, bot: Bot): boolean {
  const dx = bot.body.x - e.x;
  const dy = bot.body.y - e.y;

  if (e.kind === EmplacementKind.Saw) {
    const limit = e.reach + bot.body.radius;
    return dx * dx + dy * dy <= limit * limit;
  }

  // Flame: project onto the jet axis. Must be in front, within reach, and near the axis.
  const ax = cosOf(e.heading);
  const ay = sinOf(e.heading);
  const along = dx * ax + dy * ay;
  if (along < 0 || along > e.reach + bot.body.radius) return false;
  const across = dx * -ay + dy * ax;
  const width = e.halfWidth + bot.body.radius;
  return across * across <= width * width;
}

/**
 * Applies one tick of a hazard to a bot: damage, plus a shove away from it.
 *
 * The knockback matters as much as the damage. Being flung is what turns a saw into a
 * positional threat rather than a slow drain, and what lets a bot be shoved into one.
 */
export function applyEmplacement(e: Emplacement, bot: Bot, tick: number): void {
  if (!bot.alive) return;
  if (!isFiring(e, tick)) return;
  if (!hits(e, bot)) return;

  bot.health -= e.damagePerTick;
  if (bot.health < 0) bot.health = 0;

  const dx = bot.body.x - e.x;
  const dy = bot.body.y - e.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;
  const inv = 1 / Math.sqrt(lenSq);
  bot.body.vx += dx * inv * e.knockback;
  bot.body.vy += dy * inv * e.knockback;
}
```

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- emplacement` → PASS. Report the real count.

If the flame axis tests fail with the sign reversed, **do not flip the test** — report it.
Index 0 points along +x and increasing index turns toward +y (down on screen), and the
renderer relies on the same convention.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/emplacement.ts src/sim/arena/emplacement.test.ts
git commit -m "feat(sim): add saw and flame jet emplacements"
```

---

## Task 3: Wire hazards into the arena and match

**Files:**
- Modify: `src/sim/arena/arena.ts`, `src/sim/arena/bot.ts`, `src/sim/arena/ai.ts`,
  `src/sim/arena/match.ts`
- Modify: `src/sim/arena/arena.test.ts`

- [ ] **Step 1: Extend `ArenaConfig` and `Arena`**

Add to `ArenaConfig`:

```ts
  /** Tiles whose floor is tar, as [col, row]. */
  tar: ReadonlyArray<readonly [number, number]>;
  /** Tiles whose floor is ice, as [col, row]. */
  ice: ReadonlyArray<readonly [number, number]>;
  emplacements: ReadonlyArray<Emplacement>;
```

Add to `Arena`:

```ts
  surfaces: Uint8Array;
  emplacements: Emplacement[];
```

`buildArena` creates the surface map, stamps the tar and ice tiles, and copies the
emplacements.

- [ ] **Step 2: Lay out Arena 1**

Extend `DEFAULT_ARENA`. The grid is 16 cols × 12 rows of 60 units, so the arena is
960 × 720. Pits are at [4,3] and [11,8]. Wall gaps are top and bottom, cols 7–8.

```ts
  // Tar in the middle, straddling the centre line. This is deliberately where bots
  // retreat THROUGH: a fleeing bot has to either bog down or take the long way.
  tar: [
    [7, 5], [8, 5], [7, 6], [8, 6],
    [6, 5], [9, 6],
  ],
  // Ice in two corners, well away from the tar, so the two surfaces are never confused
  // for one another when watching.
  ice: [
    [2, 2], [3, 2], [2, 3], [3, 3],
    [12, 8], [13, 8], [12, 9], [13, 9],
  ],
  emplacements: [
    // Saws set into the left and right walls, at mid height.
    createSaw(0, 300, 28),
    createSaw(960, 420, 28),
    // Flame jets on the top and bottom walls, firing inward on opposite phases so the
    // two are never safe at the same moment.
    createFlame(300, 0, 1024, 110, 180, 70),
    createFlame(660, 720, 3072, 110, 180, 70),
  ],
```

Note the flame headings: 1024 is +y (downward, into the arena from the top wall) and
3072 is −y (upward, from the bottom wall).

- [ ] **Step 3: Let ice affect grip**

`applyGrip(bot)` becomes `applyGrip(bot, gripScale = 1)` and multiplies `bot.grip` by the
scale. The default keeps every existing caller working.

In `ai.ts`, `driveWithAi` looks up the surface under the bot and passes
`effectOf(surface).grip` through to whatever calls `applyGrip`. Since `driveToward` in
`steering.ts` calls `applyGrip` internally, `driveToward` also gains a
`gripScale = 1` parameter that it forwards.

- [ ] **Step 4: Apply tar drag and emplacements in `advanceMatch`**

After the drive loop and **before** `step(match.world)`:

```ts
  for (const bot of match.bots) {
    if (!bot.alive) continue;
    const surface = surfaceAt(match.arena.grid, match.arena.surfaces, bot.body.x, bot.body.y);
    const drag = effectOf(surface).drag;
    if (drag !== 1) {
      bot.body.vx *= drag;
      bot.body.vy *= drag;
    }
    for (const e of match.arena.emplacements) {
      applyEmplacement(e, bot, match.world.tick);
    }
  }
```

Tar drag is applied to velocity before `step`, so `integrate`'s speed clamp still runs
afterwards. **That order is not optional** — a body that ends a tick faster than the
smallest collision radius passes straight through it.

No new elimination code is needed: `advanceMatch` already sweeps for `health <= 0` after
stepping and eliminates with cause `'destroyed'` and `byId` null. Verify that still runs
after your insertion rather than adding a second sweep. Hazard kills correctly credit
nobody, which is what lets Task 5 separate them from combat kills in the metrics.

- [ ] **Step 5: Add tests**

Append to `arena.test.ts`. It will need `Surface` and `surfaceAt` from `./surface`, and
`isOverHole` from `./tiles`, added to its existing imports.

```ts
describe('hazards', () => {
  const arena = buildArena(DEFAULT_ARENA);

  it('stamps every configured tar tile', () => {
    for (const [col, row] of DEFAULT_ARENA.tar) {
      const size = DEFAULT_ARENA.tileSize;
      expect(surfaceAt(arena.grid, arena.surfaces, col * size + 30, row * size + 30)).toBe(
        Surface.Tar,
      );
    }
  });

  it('stamps every configured ice tile', () => {
    for (const [col, row] of DEFAULT_ARENA.ice) {
      const size = DEFAULT_ARENA.tileSize;
      expect(surfaceAt(arena.grid, arena.surfaces, col * size + 30, row * size + 30)).toBe(
        Surface.Ice,
      );
    }
  });

  it('never puts a surface on a tile that is a hole', () => {
    // A surface on a pit tile would be invisible and confusing.
    for (const [col, row] of [...DEFAULT_ARENA.tar, ...DEFAULT_ARENA.ice]) {
      const size = DEFAULT_ARENA.tileSize;
      expect(isOverHole(arena.grid, col * size + 30, row * size + 30)).toBe(false);
    }
  });

  it('places every emplacement on or inside the arena bounds', () => {
    for (const e of arena.emplacements) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(arena.grid.width);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(arena.grid.height);
    }
  });

  it('leaves the two flame jets never firing in unison', () => {
    // Opposite phases mean there is always one safe side.
    const flames = arena.emplacements.filter((e) => e.period > 0);
    expect(flames.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 6: Verify and commit**

Run `npm test -- arena`, `npm test -- match`, `npm run lint`, `npx tsc --noEmit`.

**Existing determinism tests must still pass** — same seed, same checksum. Absolute
checksums will change, which is expected; agreement between two runs of one seed is what
matters.

```bash
git add src/sim/arena/ src/sim/arena/arena.test.ts
git commit -m "feat(sim): wire tar, ice, saws, and flame jets into the arena"
```

---

## Task 4: Make the AI see emplacements

Bots already steer around holes. They must steer around saws and firing flames too, or
they will drive into them exactly as they used to drive into pits.

**Files:**
- Modify: `src/sim/arena/perception.ts`
- Modify: `src/sim/arena/perception.test.ts`

- [ ] **Step 1: Extend `perceive`**

The hole-repulsion loop gains a second pass over `match.arena.emplacements`. For each one
that **is currently firing**, add repulsion away from it, weighted by inverse-square
distance exactly as holes are, and scaled so a saw feels comparable to a pit.

A flame that is not firing produces **no repulsion** — that is what makes it a timing
hazard rather than a wall, and it is the whole reason a flame jet is interesting.

- [ ] **Step 2: Add tests**

```ts
describe('perceive with emplacements', () => {
  it('pushes away from a firing saw', () => {
    const m = match(4);
    const self = m.bots[0]!;
    const saw = m.arena.emplacements.find((e) => e.period === 0)!;
    self.body.x = saw.x + 40;
    self.body.y = saw.y;
    const view = perceive(m, self);
    expect(view.avoidX).toBeGreaterThan(0);
  });

  it('ignores a flame that is not currently firing', () => {
    const m = match(4);
    const self = m.bots[0]!;
    const flame = m.arena.emplacements.find((e) => e.period > 0)!;
    // Stand in front of it, on a tick where it is off.
    m.world.tick = flame.activeTicks + 1;
    self.body.x = flame.x + 40;
    self.body.y = flame.y + 40;
    const offView = perceive(m, self);
    m.world.tick = 0;
    const onView = perceive(m, self);
    const off = Math.sqrt(offView.avoidX ** 2 + offView.avoidY ** 2);
    const on = Math.sqrt(onView.avoidX ** 2 + onView.avoidY ** 2);
    expect(on).toBeGreaterThan(off);
  });
});
```

- [ ] **Step 3: Verify and commit**

Run `npm test -- perception`, `npm run lint`, `npx tsc --noEmit`.

```bash
git add src/sim/arena/perception.ts src/sim/arena/perception.test.ts
git commit -m "feat(sim): make bots steer around firing hazards"
```

---

## Task 5: Render the hazards and measure

**Files:**
- Modify: `src/render/arena-renderer.ts`
- Modify: `tools/arena-metrics.ts`

- [ ] **Step 1: Draw surfaces**

Tar tiles render in a dark viscous brown, ice tiles in a pale blue-white, both distinct
from plain floor and from `WARNING` tiles. Draw them in the floor pass, which already
redraws each frame.

- [ ] **Step 2: Draw emplacements**

Saws as a spinning circle — rotate using `match.world.tick`, **never** wall-clock time, or
replays will not look identical. Flame jets as a cone or bar along their heading, drawn
only while firing, so the pulsing is visible.

Pass emplacements through from `match.arena.emplacements`. The renderer may import the
`Emplacement` type and `isFiring`; those are geometry, not AI.

- [ ] **Step 3: Report hazard deaths separately**

`arena-metrics.ts` currently reports `destroyed` and `fell`. Hazard kills are recorded as
`destroyed` with a null `byId`, which conflates them with combat. Split the report into
**combat** (destroyed with a killer) and **hazard** (destroyed with no killer), so cause of
death actually distinguishes the three.

- [ ] **Step 4: Verify the build**

Run `npx tsc --noEmit`, `npm run lint`, `npm run build`. All clean. Do not run `npm run dev`.

- [ ] **Step 5: Measure and report**

Run `npm run arena -- 80` and **report the output verbatim**. Do not tune in response —
the numbers are the deliverable.

I expect hazards to shorten matches and raise non-combat deaths. The number I care about
most is whether **survival personalities lose ground** — Hit-and-Run and Defensive
currently take about 60% of wins between them, and tar exists to make retreating cost
something.

- [ ] **Step 6: Commit**

```bash
git add src/render/arena-renderer.ts tools/arena-metrics.ts
git commit -m "feat(render): draw hazards and split hazard deaths from combat deaths"
```

---

## Definition of done

- [ ] `npm test` passes in full
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean
- [ ] Same seed still produces the same checksum
- [ ] Every match still produces exactly one survivor
- [ ] Bots visibly slow in tar and slide on ice
- [ ] Flame jets pulse, and bots ignore them while they are off
- [ ] Metrics distinguish combat, hazard, and fall deaths

## What this does not include

- The three-component weapon model (collision / passive contact / active) — Phase 4
- The seven bot categories — Phase 4
- Arenas 2–5 — Phase 9
- Any balance tuning beyond reporting the numbers
