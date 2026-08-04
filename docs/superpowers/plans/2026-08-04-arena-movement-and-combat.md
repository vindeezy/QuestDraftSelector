# Arena Movement & Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic trigonometry, a tiled arena, vehicle-model bot movement, and directional combat — enough to watch ten bots drive, ram each other, and be eliminated.

**Architecture:** Extends the existing `src/sim/` core. Heading is an integer index into a load-time trig table, so turning accumulates zero error. The arena is a tile grid where one rule — *centre over a missing tile means elimination* — provides pits, wall gaps, and the later collapse. Rendering stays in `src/render/`, which the sim never imports.

**Tech Stack:** TypeScript, Vite, Vitest, PixiJS. Existing sim modules: `rng`, `vec`, `body`, `collision`, `world`, `checksum`.

**Scope:** Steps 1–4 of the Phase 3 build order. AI, hazards, the collapse, and the metrics harness are a later plan. Bots here are driven by a trivial "chase the nearest bot" stub so movement and combat can be watched — that stub is throwaway.

---

## Background for the implementer

Read `docs/superpowers/specs/2026-08-04-arena-greybox-design.md` sections 4–7 before
starting. The parent project spec is `2026-08-03-quest-draft-selector-design.md`.

**The determinism contract still applies and is lint-enforced on `src/sim/`.** Banned:
`Math.sin/cos/tan/asin/acos/atan/atan2/pow/hypot/log/exp/cbrt/random`, the `**` operator,
`Date`, `performance`, `document`, and imports from `../render` or `../shell`. Permitted:
`+`, `-`, `*`, `/`, `Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`,
`Math.max`, `Math.imul`.

**Why this matters:** a recorded event is stored as an integer seed and replayed in league
members' browsers. Anything that differs between JavaScript engines silently changes
every recording. This project has already been bitten three times by tests that passed
against wrong behaviour, so several tasks below include a deliberate-perturbation step:
break the thing, watch the test fail, revert. **A test that has never been observed to
fail is not evidence of anything.**

**Existing API you will build on:**

- `src/sim/vec.ts` — `Vec2`, `lengthSq(x, y)`, `length(x, y)`, `clampLength(x, y, max)`
- `src/sim/body.ts` — `Body` (`id`, `x`, `y`, `vx`, `vy`, `radius`, `invMass`,
  `restitution`), `createBody(init)`, `integrate(body, gravity, maxSpeed, drag)`
- `src/sim/collision.ts` — `Segment`, `resolveCircleCircle(a, b)` and
  `resolveCircleSegment(body, seg)`, both returning impact speed or 0
- `src/sim/world.ts` — `Contact` (`a`, `b`, `x`, `y`, `speed`), `World`, `createWorld`,
  `step(world)`, `isSettled(world, threshold)`
- `src/sim/rng.ts` — `createRng(seed)` giving `next()` and `range(min, max)`

**Commands.** `npm test` (~3 min, the Plinko determinism suite is slow), `npm run lint`,
`npx tsc --noEmit`, `npm run build`, `npm run dev`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/trig.ts` | Integer-indexed angles and the direction table. |
| `src/sim/arena/tiles.ts` | Tile grid, tile states, and the over-a-hole test. |
| `src/sim/arena/arena.ts` | Arena config, wall segments, and the default arena. |
| `src/sim/arena/bot.ts` | Bot state and the vehicle movement model. |
| `src/sim/arena/combat.ts` | Front-arc alignment and damage resolution. |
| `src/sim/arena/match.ts` | Runs a match: bodies, tiles, eliminations, placement. |
| `src/render/arena-renderer.ts` | Draws a match. No rules. |
| `src/shell/main.ts` | Gains a Forge / Arena view switch. |

`src/sim/` never imports from `src/render/` or `src/shell/`.

---

## Task 1: Deterministic trigonometry

Heading is an integer index, not a float angle. Turning is integer addition with
wraparound, which accumulates exactly zero error — unlike repeatedly rotating a float
vector, which drifts and denormalises.

The table is built at load time from a Taylor series using only `+`, `-`, `*`, `/`.
Quadrant reduction is exact integer arithmetic on the index.

**Files:**
- Create: `src/sim/trig.ts`
- Test: `src/sim/trig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/trig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ANGLE_STEPS,
  ANGLE_MASK,
  STEPS_PER_RADIAN,
  cosOf,
  sinOf,
  normalizeAngle,
} from './trig';

const TAU = 6.283185307179586;

describe('angle indices', () => {
  it('uses 4096 steps', () => {
    expect(ANGLE_STEPS).toBe(4096);
    expect(ANGLE_MASK).toBe(4095);
  });

  it('normalizes out-of-range indices by wrapping', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(4096)).toBe(0);
    expect(normalizeAngle(4097)).toBe(1);
    expect(normalizeAngle(-1)).toBe(4095);
    expect(normalizeAngle(-4096)).toBe(0);
    expect(normalizeAngle(99999)).toBeGreaterThanOrEqual(0);
    expect(normalizeAngle(99999)).toBeLessThan(4096);
  });

  it('wraps indices passed to cosOf and sinOf', () => {
    expect(cosOf(4096)).toBe(cosOf(0));
    expect(sinOf(-1)).toBe(sinOf(4095));
  });
});

describe('direction table', () => {
  it('gives the four cardinal directions exactly enough', () => {
    // Index 0 is +x. Index increases toward +y, which is DOWN in screen space.
    expect(cosOf(0)).toBeCloseTo(1, 12);
    expect(sinOf(0)).toBeCloseTo(0, 12);
    expect(cosOf(1024)).toBeCloseTo(0, 9);
    expect(sinOf(1024)).toBeCloseTo(1, 12);
    expect(cosOf(2048)).toBeCloseTo(-1, 12);
    expect(sinOf(2048)).toBeCloseTo(0, 9);
    expect(cosOf(3072)).toBeCloseTo(0, 9);
    expect(sinOf(3072)).toBeCloseTo(-1, 12);
  });

  it('produces unit vectors at every index', () => {
    for (let i = 0; i < ANGLE_STEPS; i++) {
      const len = Math.sqrt(cosOf(i) * cosOf(i) + sinOf(i) * sinOf(i));
      expect(len).toBeCloseTo(1, 9);
    }
  });

  it('matches the platform trig closely enough for gameplay', () => {
    // Math.sin is banned in src/sim, but a TEST may use it as an oracle. This
    // confirms the polynomial is actually correct rather than merely consistent.
    for (let i = 0; i < ANGLE_STEPS; i += 7) {
      const angle = (i * TAU) / ANGLE_STEPS;
      expect(cosOf(i)).toBeCloseTo(Math.cos(angle), 8);
      expect(sinOf(i)).toBeCloseTo(Math.sin(angle), 8);
    }
  });

  it('is symmetric about the axes', () => {
    for (let i = 0; i < ANGLE_STEPS; i += 13) {
      expect(sinOf(-i)).toBeCloseTo(-sinOf(i), 12);
      expect(cosOf(-i)).toBeCloseTo(cosOf(i), 12);
    }
  });

  it('exposes a steps-per-radian conversion', () => {
    expect(STEPS_PER_RADIAN).toBeCloseTo(ANGLE_STEPS / TAU, 9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- trig`
Expected: FAIL, cannot resolve import './trig'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/trig.ts`:

```ts
/**
 * Integer-indexed trigonometry for the simulation.
 *
 * `Math.sin` and `Math.cos` are implementation-approximated and are NOT guaranteed to
 * return identical bits across JavaScript engines, which would silently change every
 * recorded event. This module replaces them.
 *
 * Two decisions make it exact:
 *
 * 1. A heading is an integer index in [0, 4096), not a float angle. Turning is integer
 *    addition with wraparound, so it accumulates exactly zero error. Repeatedly rotating
 *    a float vector instead would drift and denormalise.
 *
 * 2. The table is built from a Taylor series using only +, -, * and /, which IEEE 754
 *    specifies exactly. Quadrant reduction is integer arithmetic on the index.
 *
 * There is deliberately no atan2 replacement. Steering does not need one — see
 * `steerToward` in `arena/bot.ts`, which uses cross and dot products instead.
 */

export const ANGLE_STEPS = 4096;
export const ANGLE_MASK = ANGLE_STEPS - 1;

const TAU = 6.283185307179586;
export const STEPS_PER_RADIAN = ANGLE_STEPS / TAU;

/** Radians per index step. */
const STEP_RADIANS = TAU / ANGLE_STEPS;
/** Indices per quadrant. 4096 / 4. */
const QUADRANT = ANGLE_STEPS / 4;

/**
 * Taylor series for sine on [0, PI/2], in Horner form.
 *
 * Terms through x^15 leave an error near 1e-12 at the top of the range — far finer than
 * gameplay needs. Accuracy is not actually the point: identical output on every engine
 * is. Accuracy only ensures a bot pointed at 45 degrees really travels at 45 degrees.
 */
function polySin(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  );
}

/** Taylor series for cosine on [0, PI/2], in Horner form. */
function polyCos(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600))))))
  );
}

const COS = new Float64Array(ANGLE_STEPS);
const SIN = new Float64Array(ANGLE_STEPS);

for (let i = 0; i < ANGLE_STEPS; i++) {
  // Exact integer reduction into a quadrant, then evaluate the polynomial on the
  // remainder only. This keeps the polynomial argument inside [0, PI/2), where the
  // series converges fastest.
  const quadrant = (i / QUADRANT) | 0;
  const remainder = i - quadrant * QUADRANT;
  const x = remainder * STEP_RADIANS;
  const s = polySin(x);
  const c = polyCos(x);

  if (quadrant === 0) {
    COS[i] = c;
    SIN[i] = s;
  } else if (quadrant === 1) {
    COS[i] = -s;
    SIN[i] = c;
  } else if (quadrant === 2) {
    COS[i] = -c;
    SIN[i] = -s;
  } else {
    COS[i] = s;
    SIN[i] = -c;
  }
}

/** Wraps any integer into [0, ANGLE_STEPS). */
export function normalizeAngle(index: number): number {
  return index & ANGLE_MASK;
}

/** Cosine of an angle index. Index 0 points along +x. */
export function cosOf(index: number): number {
  return COS[index & ANGLE_MASK]!;
}

/** Sine of an angle index. Increasing index turns toward +y, which is DOWN on screen. */
export function sinOf(index: number): number {
  return SIN[index & ANGLE_MASK]!;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- trig`
Expected: PASS, 8 tests passed.

- [ ] **Step 5: Lock a reference vector**

Every test above except the `Math.cos` oracle compares the table against itself or against
general properties. The oracle test would catch a badly wrong polynomial, but not a subtle
change that stays within 1e-8 — and a subtle change is exactly what silently rewrites
recordings. Lock the actual values.

Write a throwaway script under `tools/` that prints `cosOf(i)` and `sinOf(i)` at full
precision for i = 1, 137, 1023, 1025, 3000. Run it with `npx vite-node`, paste the
measured values below, then delete the script.

```ts
it('matches the locked reference table', () => {
  // These pin the polynomial. Recorded events replay through this exact table, so
  // changing these numbers invalidates every recording.
  // If this fails, the table changed. Revert it. DO NOT paste in new values.
  for (const [index, cos, sin] of [
    [1, 0, 0],       // replace with measured values
    [137, 0, 0],
    [1023, 0, 0],
    [1025, 0, 0],
    [3000, 0, 0],
  ] as const) {
    expect(cosOf(index)).toBe(cos);
    expect(sinOf(index)).toBe(sin);
  }
});
```

- [ ] **Step 6: Prove the lock bites**

Temporarily change the last Taylor coefficient in `polySin` from `1 / 6227020800` to
`1 / 6227020801`.

Run: `npm test -- trig`
Expected: the locked reference test FAILS. The unit-vector, symmetry, and `Math.cos`
oracle tests all still PASS — which is exactly why the lock is needed.

Revert and re-run. Expected: all 9 pass. Confirm with `git diff src/sim/trig.ts` showing
no output.

- [ ] **Step 7: Commit**

```bash
git add src/sim/trig.ts src/sim/trig.test.ts
git commit -m "feat(sim): add deterministic integer-indexed trigonometry"
```

---

## Task 2: Arena tiles

**Files:**
- Create: `src/sim/arena/tiles.ts`
- Test: `src/sim/arena/tiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/arena/tiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TileState,
  createTileGrid,
  tileIndexAt,
  tileStateAt,
  setTileState,
  isOverHole,
  solidTileCount,
} from './tiles';

const grid = () => createTileGrid(4, 3, 60);

describe('createTileGrid', () => {
  it('starts every tile solid', () => {
    const g = grid();
    expect(g.tiles.length).toBe(12);
    expect(solidTileCount(g)).toBe(12);
  });

  it('records its pixel dimensions', () => {
    const g = grid();
    expect(g.width).toBe(240);
    expect(g.height).toBe(180);
  });
});

describe('tileIndexAt', () => {
  it('maps a position to a tile index in row-major order', () => {
    const g = grid();
    expect(tileIndexAt(g, 10, 10)).toBe(0);
    expect(tileIndexAt(g, 70, 10)).toBe(1);
    expect(tileIndexAt(g, 10, 70)).toBe(4);
    expect(tileIndexAt(g, 230, 170)).toBe(11);
  });

  it('returns -1 outside the grid', () => {
    const g = grid();
    expect(tileIndexAt(g, -1, 10)).toBe(-1);
    expect(tileIndexAt(g, 10, -1)).toBe(-1);
    expect(tileIndexAt(g, 240, 10)).toBe(-1);
    expect(tileIndexAt(g, 10, 180)).toBe(-1);
  });

  it('puts a boundary exactly on the higher tile', () => {
    const g = grid();
    expect(tileIndexAt(g, 60, 0)).toBe(1);
    expect(tileIndexAt(g, 0, 60)).toBe(4);
  });
});

describe('setTileState and tileStateAt', () => {
  it('round-trips a state change', () => {
    const g = grid();
    setTileState(g, 5, TileState.Gone);
    expect(tileStateAt(g, 70, 70)).toBe(TileState.Gone);
    expect(solidTileCount(g)).toBe(11);
  });

  it('counts WARNING tiles as still solid', () => {
    const g = grid();
    setTileState(g, 5, TileState.Warning);
    expect(solidTileCount(g)).toBe(12);
  });
});

describe('isOverHole', () => {
  it('is false over a solid tile', () => {
    expect(isOverHole(grid(), 10, 10)).toBe(false);
  });

  it('is false over a warning tile — it has not dropped yet', () => {
    const g = grid();
    setTileState(g, 0, TileState.Warning);
    expect(isOverHole(g, 10, 10)).toBe(false);
  });

  it('is true over a gone tile', () => {
    const g = grid();
    setTileState(g, 0, TileState.Gone);
    expect(isOverHole(g, 10, 10)).toBe(true);
  });

  it('is true anywhere outside the grid — leaving the arena is falling', () => {
    const g = grid();
    expect(isOverHole(g, -5, 10)).toBe(true);
    expect(isOverHole(g, 1000, 10)).toBe(true);
    expect(isOverHole(g, 10, -5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tiles`
Expected: FAIL, cannot resolve import './tiles'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/arena/tiles.ts`:

```ts
/**
 * The arena floor as a grid of tiles.
 *
 * One rule drives three features: a bot whose centre is over a missing tile is
 * eliminated. Death pits are tiles that start missing, wall gaps are missing wall
 * segments with missing tiles beyond them, and the endgame collapse is tiles going
 * missing over time. Building a new arena means writing a different tile pattern, not
 * new code.
 *
 * Support is tested at the bot's centre rather than its footprint. That is deliberate:
 * it is simple and exactly deterministic, and with 60-unit tiles against 40-unit bots
 * the visual overhang is small.
 */

export const TileState = {
  Solid: 0,
  /** About to collapse. Still supports a bot. */
  Warning: 1,
  Gone: 2,
} as const;

export type TileStateValue = (typeof TileState)[keyof typeof TileState];

export interface TileGrid {
  cols: number;
  rows: number;
  tileSize: number;
  width: number;
  height: number;
  /** Row-major. One TileState per tile. */
  tiles: Uint8Array;
}

export function createTileGrid(cols: number, rows: number, tileSize: number): TileGrid {
  return {
    cols,
    rows,
    tileSize,
    width: cols * tileSize,
    height: rows * tileSize,
    tiles: new Uint8Array(cols * rows).fill(TileState.Solid),
  };
}

/** Row-major tile index containing a position, or -1 if outside the grid. */
export function tileIndexAt(grid: TileGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  const col = Math.floor(x / grid.tileSize);
  const row = Math.floor(y / grid.tileSize);
  return row * grid.cols + col;
}

export function tileStateAt(grid: TileGrid, x: number, y: number): TileStateValue {
  const index = tileIndexAt(grid, x, y);
  if (index < 0) return TileState.Gone;
  return grid.tiles[index] as TileStateValue;
}

export function setTileState(grid: TileGrid, index: number, state: TileStateValue): void {
  grid.tiles[index] = state;
}

/**
 * True when a body at this position has nothing under it.
 *
 * Outside the grid counts as a hole, so being shoved through a wall gap and leaving the
 * arena is the same code path as falling into a pit.
 */
export function isOverHole(grid: TileGrid, x: number, y: number): boolean {
  return tileStateAt(grid, x, y) === TileState.Gone;
}

/** Tiles that would still support a bot. WARNING tiles count — they have not dropped. */
export function solidTileCount(grid: TileGrid): number {
  let count = 0;
  for (let i = 0; i < grid.tiles.length; i++) {
    if (grid.tiles[i] !== TileState.Gone) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tiles`
Expected: PASS, 12 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/
git commit -m "feat(sim): add arena tile grid with unified falling rule"
```

---

## Task 3: Arena geometry

**Files:**
- Create: `src/sim/arena/arena.ts`
- Test: `src/sim/arena/arena.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/arena/arena.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TileState, isOverHole, solidTileCount } from './tiles';
import { DEFAULT_ARENA, buildArena } from './arena';

describe('buildArena', () => {
  const arena = buildArena(DEFAULT_ARENA);

  it('builds the configured grid', () => {
    expect(arena.grid.cols).toBe(DEFAULT_ARENA.cols);
    expect(arena.grid.rows).toBe(DEFAULT_ARENA.rows);
    expect(arena.grid.width).toBe(DEFAULT_ARENA.cols * DEFAULT_ARENA.tileSize);
  });

  it('punches the configured pits out of the floor', () => {
    expect(DEFAULT_ARENA.pits.length).toBeGreaterThan(0);
    for (const [col, row] of DEFAULT_ARENA.pits) {
      const size = DEFAULT_ARENA.tileSize;
      const x = col * size + size / 2;
      const y = row * size + size / 2;
      expect(isOverHole(arena.grid, x, y)).toBe(true);
    }
  });

  it('removes floor for pits AND for the tiles behind wall gaps', () => {
    // Wall gaps remove floor too, otherwise a bot shoved through one would hover
    // outside the arena instead of falling.
    const total = DEFAULT_ARENA.cols * DEFAULT_ARENA.rows;
    const gapTiles = DEFAULT_ARENA.wallGaps.reduce((sum, g) => sum + (g.to - g.from), 0);
    expect(solidTileCount(arena.grid)).toBe(total - DEFAULT_ARENA.pits.length - gapTiles);
  });

  it('creates wall segments on all four sides', () => {
    expect(arena.segments.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves a gap in the walls for every configured gap', () => {
    // A gap is an absent segment, so more gaps means the walls are split into more
    // pieces. With gaps configured, there must be more than the 4 plain sides.
    expect(DEFAULT_ARENA.wallGaps.length).toBeGreaterThan(0);
    expect(arena.segments.length).toBeGreaterThan(4);
  });

  it('places every wall segment on the arena boundary', () => {
    for (const s of arena.segments) {
      const onVertical = s.x1 === s.x2 && (s.x1 === 0 || s.x1 === arena.grid.width);
      const onHorizontal = s.y1 === s.y2 && (s.y1 === 0 || s.y1 === arena.grid.height);
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it('marks the tiles behind each wall gap as gone, so bots pushed out fall', () => {
    for (const gap of DEFAULT_ARENA.wallGaps) {
      const size = DEFAULT_ARENA.tileSize;
      for (let i = gap.from; i < gap.to; i++) {
        const isVertical = gap.side === 'left' || gap.side === 'right';
        const col = isVertical ? (gap.side === 'left' ? 0 : DEFAULT_ARENA.cols - 1) : i;
        const row = isVertical ? i : gap.side === 'top' ? 0 : DEFAULT_ARENA.rows - 1;
        const x = col * size + size / 2;
        const y = row * size + size / 2;
        expect(isOverHole(arena.grid, x, y)).toBe(true);
      }
    }
  });
});

describe('DEFAULT_ARENA', () => {
  it('is 16 by 12 tiles of 60 units', () => {
    expect(DEFAULT_ARENA.cols).toBe(16);
    expect(DEFAULT_ARENA.rows).toBe(12);
    expect(DEFAULT_ARENA.tileSize).toBe(60);
  });

  it('leaves tiles comfortably larger than a bot', () => {
    // Bot radius is 20, so diameter 40 against a 60-unit tile.
    expect(DEFAULT_ARENA.tileSize).toBeGreaterThan(40);
  });

  it('keeps pits and gaps from consuming too much floor', () => {
    const total = DEFAULT_ARENA.cols * DEFAULT_ARENA.rows;
    expect(DEFAULT_ARENA.pits.length).toBeLessThan(total * 0.1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- arena`
Expected: FAIL, cannot resolve import './arena'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/arena/arena.ts`:

```ts
import type { Segment } from '../collision';
import { TileState, createTileGrid, setTileState, type TileGrid } from './tiles';

export type WallSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * A missing run of wall. `from` and `to` are tile indices along that side, treated as a
 * half-open range. The floor behind a gap is removed too, so a bot shoved through it
 * falls rather than hovering outside the arena.
 */
export interface WallGap {
  side: WallSide;
  from: number;
  to: number;
}

export interface ArenaConfig {
  cols: number;
  rows: number;
  tileSize: number;
  /** Tiles that start missing, as [col, row]. */
  pits: ReadonlyArray<readonly [number, number]>;
  wallGaps: ReadonlyArray<WallGap>;
}

export interface Arena {
  config: ArenaConfig;
  grid: TileGrid;
  segments: Segment[];
}

/**
 * Arena 1. Moderate size — room to manoeuvre without dead air.
 *
 * 16 x 12 tiles of 60 units is 960 x 720. A bot is 40 across, so it sits comfortably on
 * one tile. Crossing the arena at full speed takes a little over two seconds.
 */
export const DEFAULT_ARENA: ArenaConfig = {
  cols: 16,
  rows: 12,
  tileSize: 60,
  // Four pits, offset from the centre so no single safe spot exists.
  pits: [
    [4, 3],
    [11, 3],
    [4, 8],
    [11, 8],
  ],
  // Two gaps on opposite sides, so knockback in either direction can eject a bot.
  wallGaps: [
    { side: 'top', from: 7, to: 9 },
    { side: 'bottom', from: 7, to: 9 },
  ],
};

/** Builds the wall segments for one side, split around its gaps. */
function buildSide(
  side: WallSide,
  config: ArenaConfig,
  gaps: ReadonlyArray<WallGap>,
): Segment[] {
  const size = config.tileSize;
  const count = side === 'top' || side === 'bottom' ? config.cols : config.rows;
  const blocked = new Set<number>();
  for (const gap of gaps) {
    if (gap.side !== side) continue;
    for (let i = gap.from; i < gap.to; i++) blocked.add(i);
  }

  const segments: Segment[] = [];
  let runStart: number | null = null;

  const emit = (from: number, to: number): void => {
    const a = from * size;
    const b = to * size;
    if (side === 'top') segments.push({ x1: a, y1: 0, x2: b, y2: 0 });
    else if (side === 'bottom') {
      segments.push({ x1: a, y1: config.rows * size, x2: b, y2: config.rows * size });
    } else if (side === 'left') segments.push({ x1: 0, y1: a, x2: 0, y2: b });
    else segments.push({ x1: config.cols * size, y1: a, x2: config.cols * size, y2: b });
  };

  for (let i = 0; i <= count; i++) {
    const open = i < count && !blocked.has(i);
    if (open && runStart === null) runStart = i;
    if (!open && runStart !== null) {
      emit(runStart, i);
      runStart = null;
    }
  }

  return segments;
}

export function buildArena(config: ArenaConfig): Arena {
  const grid = createTileGrid(config.cols, config.rows, config.tileSize);

  for (const [col, row] of config.pits) {
    setTileState(grid, row * config.cols + col, TileState.Gone);
  }

  // Remove the floor behind each gap, so being shoved out is the same code path as
  // falling into a pit.
  for (const gap of config.wallGaps) {
    for (let i = gap.from; i < gap.to; i++) {
      const isVertical = gap.side === 'left' || gap.side === 'right';
      const col = isVertical ? (gap.side === 'left' ? 0 : config.cols - 1) : i;
      const row = isVertical ? i : gap.side === 'top' ? 0 : config.rows - 1;
      setTileState(grid, row * config.cols + col, TileState.Gone);
    }
  }

  const segments: Segment[] = [];
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    segments.push(...buildSide(side, config, config.wallGaps));
  }

  return { config, grid, segments };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- arena`
Expected: PASS, 11 tests passed.

- [ ] **Step 5: Verify lint and types**

Run: `npm run lint` and `npx tsc --noEmit`. Both expected clean.

- [ ] **Step 6: Commit**

```bash
git add src/sim/arena/arena.ts src/sim/arena/arena.test.ts
git commit -m "feat(sim): add arena geometry with walls, gaps, and pits"
```

---

## Task 4: Bot model and vehicle movement

Bots drive, they do not float. Thrust is applied along the heading, the heading turns at a
limited rate, and grip resists sideways slide. This is what will make drive systems and
ice meaningful later.

**Files:**
- Create: `src/sim/arena/bot.ts`
- Test: `src/sim/arena/bot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/arena/bot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ANGLE_STEPS, cosOf, sinOf } from '../trig';
import { createBot, steerToward, applyThrust, applyGrip, DEFAULT_BOT, type Bot } from './bot';

const bot = (over: Partial<Bot> = {}): Bot => {
  const b = createBot({ id: 'b', x: 0, y: 0, heading: 0 });
  return Object.assign(b, over);
};

describe('createBot', () => {
  it('starts alive at full health', () => {
    const b = bot();
    expect(b.alive).toBe(true);
    expect(b.health).toBe(b.maxHealth);
  });

  it('wraps its starting heading into range', () => {
    expect(createBot({ id: 'b', x: 0, y: 0, heading: ANGLE_STEPS + 5 }).heading).toBe(5);
  });
});

describe('steerToward', () => {
  it('turns toward a target to its right', () => {
    // Index 0 points along +x. +y is DOWN, so a target below is a positive turn.
    const b = bot({ heading: 0 });
    steerToward(b, 0, 1);
    expect(b.heading).toBe(b.turnRate);
  });

  it('turns toward a target to its left', () => {
    const b = bot({ heading: 0 });
    steerToward(b, 0, -1);
    expect(b.heading).toBe(ANGLE_STEPS - b.turnRate);
  });

  it('does not turn when already facing the target', () => {
    const b = bot({ heading: 0 });
    steerToward(b, 1, 0);
    expect(b.heading).toBe(0);
  });

  it('never turns more than turnRate in one tick', () => {
    const b = bot({ heading: 0 });
    for (const [dx, dy] of [[-1, 0.001], [-1, -0.001], [0, 1], [0, -1]] as const) {
      const before = createBot({ id: 'x', x: 0, y: 0, heading: 0 });
      Object.assign(before, { turnRate: b.turnRate });
      steerToward(before, dx, dy);
      const delta = Math.min(
        (before.heading - 0 + ANGLE_STEPS) % ANGLE_STEPS,
        (0 - before.heading + ANGLE_STEPS) % ANGLE_STEPS,
      );
      expect(delta).toBeLessThanOrEqual(before.turnRate);
    }
  });

  it('turns at full rate toward a target directly behind it', () => {
    // The small-angle approximation would read a near-zero cross product here. The
    // dot-product check must override it, or the bot would sit facing backwards.
    const b = bot({ heading: 0 });
    steerToward(b, -1, 0);
    expect(b.heading).toBe(b.turnRate);
  });

  it('converges on the target heading without oscillating', () => {
    const b = bot({ heading: 0 });
    const tx = cosOf(700);
    const ty = sinOf(700);
    for (let i = 0; i < 200; i++) steerToward(b, tx, ty);
    const off = Math.min(
      (b.heading - 700 + ANGLE_STEPS) % ANGLE_STEPS,
      (700 - b.heading + ANGLE_STEPS) % ANGLE_STEPS,
    );
    expect(off).toBeLessThanOrEqual(1);
  });

  it('ignores a zero-length direction', () => {
    const b = bot({ heading: 123 });
    steerToward(b, 0, 0);
    expect(b.heading).toBe(123);
  });
});

describe('applyThrust', () => {
  it('accelerates along the heading, not toward the target', () => {
    const b = bot({ heading: 0 });
    applyThrust(b, 1);
    expect(b.body.vx).toBeCloseTo(b.thrust, 10);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });

  it('scales with throttle', () => {
    const b = bot({ heading: 0 });
    applyThrust(b, 0.5);
    expect(b.body.vx).toBeCloseTo(b.thrust * 0.5, 10);
  });

  it('pushes along a rotated heading', () => {
    const b = bot({ heading: 1024 });
    applyThrust(b, 1);
    expect(b.body.vy).toBeCloseTo(b.thrust, 8);
    expect(b.body.vx).toBeCloseTo(0, 8);
  });
});

describe('applyGrip', () => {
  it('leaves velocity aligned with the heading untouched', () => {
    const b = bot({ heading: 0 });
    b.body.vx = 5;
    applyGrip(b);
    expect(b.body.vx).toBeCloseTo(5, 10);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });

  it('damps velocity perpendicular to the heading', () => {
    const b = bot({ heading: 0, grip: 0.25 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(3, 10);
  });

  it('with grip 0 lets a bot slide freely, like ice', () => {
    const b = bot({ heading: 0, grip: 0 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(4, 10);
  });

  it('with grip 1 removes all sideways drift instantly', () => {
    const b = bot({ heading: 0, grip: 1 });
    b.body.vy = 4;
    applyGrip(b);
    expect(b.body.vy).toBeCloseTo(0, 10);
  });
});

describe('DEFAULT_BOT', () => {
  it('keeps max speed below the bot radius so it cannot tunnel', () => {
    expect(DEFAULT_BOT.maxSpeed).toBeLessThan(DEFAULT_BOT.radius);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- bot`
Expected: FAIL, cannot resolve import './bot'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/arena/bot.ts`:

```ts
import { createBody, type Body } from '../body';
import { ANGLE_MASK, STEPS_PER_RADIAN, cosOf, sinOf, normalizeAngle } from '../trig';

export interface Bot {
  body: Body;
  /** Integer angle index. Index 0 points along +x; increasing turns toward +y (down). */
  heading: number;
  /** Maximum heading change per tick, in angle steps. */
  turnRate: number;
  /** Acceleration per tick applied along the heading. */
  thrust: number;
  /** Fraction of sideways velocity removed per tick. 0 slides freely, 1 never drifts. */
  grip: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Half-width of the damaging front arc, in angle steps. */
  weaponArc: number;
  weaponDamage: number;
  armour: number;
}

export interface BotInit {
  id: string;
  x: number;
  y: number;
  heading: number;
}

/**
 * Placeholder stats for the greybox. Phase 4 replaces these with values derived from the
 * seven bot categories — nothing here is tuned yet.
 *
 * `maxSpeed` must stay below `radius`: a body that travels further in one tick than the
 * smallest thing it can collide with will pass straight through it. Tar and ice change
 * effective speed, so the clamp must be applied AFTER those modifiers, never before.
 */
export const DEFAULT_BOT = {
  radius: 20,
  mass: 1,
  maxSpeed: 7,
  thrust: 0.35,
  /** 45 steps of 4096 is about 4 degrees per tick, or 237 degrees per second. */
  turnRate: 45,
  grip: 0.25,
  maxHealth: 100,
  /** 512 steps is 45 degrees either side of dead ahead. */
  weaponArc: 512,
  weaponDamage: 1.6,
  armour: 1,
  restitution: 0.3,
} as const;

export function createBot(init: BotInit): Bot {
  return {
    body: createBody({
      id: init.id,
      x: init.x,
      y: init.y,
      radius: DEFAULT_BOT.radius,
      mass: DEFAULT_BOT.mass,
      restitution: DEFAULT_BOT.restitution,
    }),
    heading: normalizeAngle(init.heading),
    turnRate: DEFAULT_BOT.turnRate,
    thrust: DEFAULT_BOT.thrust,
    grip: DEFAULT_BOT.grip,
    health: DEFAULT_BOT.maxHealth,
    maxHealth: DEFAULT_BOT.maxHealth,
    alive: true,
    weaponArc: DEFAULT_BOT.weaponArc,
    weaponDamage: DEFAULT_BOT.weaponDamage,
    armour: DEFAULT_BOT.armour,
  };
}

/**
 * Turns the bot toward a direction, at most `turnRate` steps.
 *
 * There is deliberately no atan2 here. The cross product of the heading with the desired
 * direction gives both the turn direction (its sign) and, for small offsets, the angle
 * itself — since cross equals sin(theta), and sin(theta) approximates theta near zero.
 * That is exactly the regime where fine control matters, so the approximation is accurate
 * where it counts and irrelevant elsewhere, because larger turns are clamped anyway.
 *
 * The dot product handles the one case the approximation gets wrong: a target directly
 * behind gives a near-zero cross product, which would read as "already aligned". A
 * negative dot means the target is behind, so turn at full rate regardless.
 *
 * `dx, dy` need not be normalised; only the sign and relative magnitude matter.
 */
export function steerToward(bot: Bot, dx: number, dy: number): void {
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;

  const inv = 1 / Math.sqrt(lenSq);
  const nx = dx * inv;
  const ny = dy * inv;

  const hx = cosOf(bot.heading);
  const hy = sinOf(bot.heading);

  const cross = hx * ny - hy * nx;
  const dot = hx * nx + hy * ny;

  let steps: number;
  if (dot < 0) {
    // Behind. Commit to a full-rate turn, picking a consistent side when exactly
    // opposite so the result stays deterministic.
    steps = cross >= 0 ? bot.turnRate : -bot.turnRate;
  } else {
    steps = cross * STEPS_PER_RADIAN;
    if (steps > bot.turnRate) steps = bot.turnRate;
    else if (steps < -bot.turnRate) steps = -bot.turnRate;
  }

  bot.heading = (bot.heading + Math.round(steps)) & ANGLE_MASK;
}

/** Accelerates along the current heading. `throttle` is 0 to 1. */
export function applyThrust(bot: Bot, throttle: number): void {
  const accel = bot.thrust * throttle;
  bot.body.vx += cosOf(bot.heading) * accel;
  bot.body.vy += sinOf(bot.heading) * accel;
}

/**
 * Removes part of the velocity perpendicular to the heading.
 *
 * This is what makes a bot a vehicle rather than a floating puck. A sharp turn at speed
 * leaves residual sideways velocity, which reads as a drift. Ice lowers grip, so bots
 * slide; a high-grip build corners cleanly.
 */
export function applyGrip(bot: Bot): void {
  const hx = cosOf(bot.heading);
  const hy = sinOf(bot.heading);
  const along = bot.body.vx * hx + bot.body.vy * hy;
  const lateralX = bot.body.vx - along * hx;
  const lateralY = bot.body.vy - along * hy;
  bot.body.vx -= lateralX * bot.grip;
  bot.body.vy -= lateralY * bot.grip;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- bot`
Expected: PASS, 15 tests passed.

If the two `steerToward` direction tests fail with the sign reversed, do **not** flip the
test. Report it — the sign convention is pinned in the doc comment and in the renderer,
and flipping one without the other produces bots that drive backwards.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/bot.ts src/sim/arena/bot.test.ts
git commit -m "feat(sim): add bot vehicle movement with heading, thrust, and grip"
```

---

## Task 5: Combat

**Files:**
- Create: `src/sim/arena/combat.ts`
- Test: `src/sim/arena/combat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/arena/combat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { arcAlignment, damageFrom, resolveHit } from './combat';

const at = (x: number, y: number, heading: number) =>
  createBot({ id: `${x},${y}`, x, y, heading });

describe('arcAlignment', () => {
  it('is 1 when the target is dead ahead', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, 100, 0)).toBeCloseTo(1, 8);
  });

  it('is 0 when the target is directly behind', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, -100, 0)).toBe(0);
  });

  it('is 0 when the target is directly to the side', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, 0, 100)).toBe(0);
  });

  it('falls off across the arc rather than cutting off sharply', () => {
    const a = at(0, 0, 0);
    const dead = arcAlignment(a, 100, 0);
    const halfway = arcAlignment(a, 100, 41); // ~22 degrees, half the 45 degree arc
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(dead);
  });

  it('never returns a negative value', () => {
    const a = at(0, 0, 0);
    for (let angle = 0; angle < 4096; angle += 37) {
      const b = at(0, 0, angle);
      expect(arcAlignment(b, 100, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('damageFrom', () => {
  it('scales with impact speed', () => {
    const a = at(0, 0, 0);
    const slow = damageFrom(a, 1, 1);
    const fast = damageFrom(a, 4, 1);
    expect(fast).toBeCloseTo(slow * 4, 8);
  });

  it('scales with alignment', () => {
    const a = at(0, 0, 0);
    expect(damageFrom(a, 3, 0)).toBe(0);
    expect(damageFrom(a, 3, 1)).toBeGreaterThan(0);
  });

  it('is reduced by target armour', () => {
    const a = at(0, 0, 0);
    const soft = damageFrom(a, 3, 1, 1);
    const hard = damageFrom(a, 3, 1, 2);
    expect(hard).toBeCloseTo(soft / 2, 8);
  });
});

describe('resolveHit', () => {
  it('damages the target when the attacker connects head-on', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4);
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it('does no damage when the attacker is facing away', () => {
    const attacker = at(0, 0, 2048); // facing -x, target is at +x
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4);
    expect(target.health).toBe(target.maxHealth);
  });

  it('hurts both bots in a head-on collision', () => {
    const a = at(0, 0, 0);
    const b = at(40, 0, 2048);
    resolveHit(a, b, 4);
    resolveHit(b, a, 4);
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('is one-sided when one bot catches the other in the flank', () => {
    // This asymmetry is the whole reason positioning matters.
    const attacker = at(0, 0, 0);
    const victim = at(40, 0, 1024); // facing +y, so attacker is on its flank
    resolveHit(attacker, victim, 4);
    resolveHit(victim, attacker, 4);
    expect(victim.health).toBeLessThan(victim.maxHealth);
    expect(attacker.health).toBe(attacker.maxHealth);
  });

  it('reports the damage it dealt', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const dealt = resolveHit(attacker, target, 4);
    expect(dealt).toBeCloseTo(target.maxHealth - target.health, 8);
  });

  it('does not take a dead bot below zero health', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.health = 0.5;
    resolveHit(attacker, target, 10);
    expect(target.health).toBe(0);
  });

  it('does nothing when either bot is already eliminated', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.alive = false;
    expect(resolveHit(attacker, target, 4)).toBe(0);
    expect(target.health).toBe(target.maxHealth);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- combat`
Expected: FAIL, cannot resolve import './combat'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/arena/combat.ts`:

```ts
import { cosOf, sinOf } from '../trig';
import type { Bot } from './bot';

/**
 * How squarely a bot is facing a point, from 0 to 1.
 *
 * 1 is dead ahead. It falls to 0 at the edge of the weapon arc and stays there beyond it,
 * so a bot caught side-on or from behind takes nothing. The falloff is smooth rather than
 * a hard cutoff, which keeps glancing blows meaningful and avoids a discontinuity that
 * the AI would otherwise learn to sit exactly on.
 */
export function arcAlignment(bot: Bot, targetX: number, targetY: number): number {
  const dx = targetX - bot.body.x;
  const dy = targetY - bot.body.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 1;

  const inv = 1 / Math.sqrt(lenSq);
  const dot = cosOf(bot.heading) * dx * inv + sinOf(bot.heading) * dy * inv;
  if (dot <= 0) return 0;

  // cos of the arc half-width. Inside the arc, rescale dot to run 0..1 across it.
  const arcCos = cosOf(bot.weaponArc);
  if (dot <= arcCos) return 0;
  return (dot - arcCos) / (1 - arcCos);
}

/** Damage for one hit. Kept separate from `resolveHit` so it can be tested directly. */
export function damageFrom(
  attacker: Bot,
  impactSpeed: number,
  alignment: number,
  targetArmour = 1,
): number {
  return (impactSpeed * attacker.weaponDamage * alignment) / targetArmour;
}

/**
 * Applies one bot's hit on another and returns the damage dealt.
 *
 * Callers invoke this once per direction, so a head-on collision hurts both bots and a
 * flank attack is one-sided. That asymmetry is what makes positioning matter.
 */
export function resolveHit(attacker: Bot, target: Bot, impactSpeed: number): number {
  if (!attacker.alive || !target.alive) return 0;

  const alignment = arcAlignment(attacker, target.body.x, target.body.y);
  if (alignment === 0) return 0;

  const damage = damageFrom(attacker, impactSpeed, alignment, target.armour);
  const dealt = damage > target.health ? target.health : damage;
  target.health -= dealt;
  if (target.health < 0) target.health = 0;
  return dealt;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- combat`
Expected: PASS, 15 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/combat.ts src/sim/arena/combat.test.ts
git commit -m "feat(sim): add directional arc-based combat damage"
```

---

## Task 6: The match runner

Combines world physics, arena tiles, bots, and combat into a running match. The AI here is
a deliberate throwaway stub — chase the nearest living bot — so movement and combat can be
watched before the real AI is designed.

**Files:**
- Create: `src/sim/arena/match.ts`
- Test: `src/sim/arena/match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/arena/match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch, advanceMatch, runMatch } from './match';

const config = { ...DEFAULT_MATCH, arena: DEFAULT_ARENA };

describe('createMatch', () => {
  it('places the requested number of bots', () => {
    const m = createMatch({ ...config, seed: 1, botCount: 10 });
    expect(m.bots.length).toBe(10);
    expect(m.bots.every((b) => b.alive)).toBe(true);
  });

  it('starts every bot on solid floor and inside the arena', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch({ ...config, seed, botCount: 10 });
      for (const bot of m.bots) {
        expect(bot.body.x).toBeGreaterThan(0);
        expect(bot.body.y).toBeGreaterThan(0);
        expect(bot.body.x).toBeLessThan(m.arena.grid.width);
        expect(bot.body.y).toBeLessThan(m.arena.grid.height);
      }
    }
  });

  it('does not start any two bots overlapping', () => {
    const m = createMatch({ ...config, seed: 7, botCount: 10 });
    for (let i = 0; i < m.bots.length; i++) {
      for (let j = i + 1; j < m.bots.length; j++) {
        const a = m.bots[i]!.body;
        const b = m.bots[j]!.body;
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        expect(dist).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });
});

describe('advanceMatch', () => {
  it('advances the tick counter', () => {
    const m = createMatch({ ...config, seed: 2, botCount: 4 });
    advanceMatch(m);
    advanceMatch(m);
    expect(m.world.tick).toBe(2);
  });

  it('eliminates a bot pushed over a hole', () => {
    const m = createMatch({ ...config, seed: 3, botCount: 4 });
    const victim = m.bots[0]!;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    victim.body.x = col * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;
    victim.body.y = row * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;
    advanceMatch(m);
    expect(victim.alive).toBe(false);
    expect(m.eliminations.some((e) => e.botId === victim.body.id && e.cause === 'fell')).toBe(true);
  });

  it('eliminates a bot whose health reaches zero', () => {
    const m = createMatch({ ...config, seed: 4, botCount: 4 });
    const victim = m.bots[0]!;
    victim.health = 0;
    advanceMatch(m);
    expect(victim.alive).toBe(false);
    expect(m.eliminations.some((e) => e.botId === victim.body.id && e.cause === 'destroyed')).toBe(
      true,
    );
  });

  it('is a no-op once the match is over', () => {
    const m = createMatch({ ...config, seed: 5, botCount: 2 });
    while (!m.done) advanceMatch(m);
    const tick = m.world.tick;
    advanceMatch(m);
    advanceMatch(m);
    expect(m.world.tick).toBe(tick);
  });

  it('never lets a bot leave the arena bounds while alive', () => {
    const m = createMatch({ ...config, seed: 6, botCount: 10 });
    while (!m.done) {
      advanceMatch(m);
      for (const bot of m.bots) {
        if (!bot.alive) continue;
        expect(Number.isFinite(bot.body.x)).toBe(true);
        expect(bot.body.x).toBeGreaterThan(-bot.body.radius);
        expect(bot.body.x).toBeLessThan(m.arena.grid.width + bot.body.radius);
      }
    }
  });
});

describe('runMatch', () => {
  it('ranks every bot even when the match reaches the tick limit', () => {
    // A single survivor is NOT guaranteed yet: the spiral collapse that forces an
    // ending is a later task, and the chase stub happily circles forever. What must
    // hold now is that every bot gets exactly one place regardless.
    for (let seed = 1; seed <= 30; seed++) {
      const r = runMatch({ ...config, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
      expect(r.placements[0]!.place).toBe(1);
      expect(new Set(r.placements.map((p) => p.botId)).size).toBe(10);
    }
  });

  it('ranks every bot exactly once', () => {
    const r = runMatch({ ...config, seed: 11, botCount: 10 });
    const places = r.placements.map((p) => p.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('records a cause for every elimination', () => {
    const r = runMatch({ ...config, seed: 12, botCount: 10 });
    for (const e of r.eliminations) {
      expect(['destroyed', 'fell']).toContain(e.cause);
    }
  });

  it('produces identical results for the same seed', () => {
    const a = runMatch({ ...config, seed: 4242, botCount: 10 });
    const b = runMatch({ ...config, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('produces different results for different seeds', () => {
    const a = runMatch({ ...config, seed: 1, botCount: 10 });
    const b = runMatch({ ...config, seed: 2, botCount: 10 });
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('terminates within the tick limit', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = runMatch({ ...config, seed, botCount: 10 });
      expect(r.ticks).toBeLessThanOrEqual(config.maxTicks);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- match`
Expected: FAIL, cannot resolve import './match'.

- [ ] **Step 3: Write the implementation**

Create `src/sim/arena/match.ts`:

```ts
import { createRng, type Rng } from '../rng';
import { createWorld, step, type World } from '../world';
import { hashNumbers } from '../checksum';
import { ANGLE_STEPS } from '../trig';
import { buildArena, type Arena, type ArenaConfig } from './arena';
import { isOverHole } from './tiles';
import { applyGrip, applyThrust, createBot, steerToward, DEFAULT_BOT, type Bot } from './bot';
import { resolveHit } from './combat';

export type EliminationCause = 'destroyed' | 'fell';

export interface Elimination {
  botId: string;
  cause: EliminationCause;
  tick: number;
  /** Bot that dealt the killing blow, when there was one. */
  byId: string | null;
}

export interface Placement {
  botId: string;
  /** 1 is the winner. */
  place: number;
}

export interface MatchConfig {
  seed: number;
  arena: ArenaConfig;
  botCount: number;
  maxTicks: number;
  drag: number;
}

export interface Match {
  config: MatchConfig;
  arena: Arena;
  world: World;
  bots: Bot[];
  eliminations: Elimination[];
  done: boolean;
}

export interface MatchResult {
  seed: number;
  placements: Placement[];
  eliminations: Elimination[];
  ticks: number;
  checksum: string;
}

/**
 * Match defaults for the greybox.
 *
 * `maxTicks` is 18000, which is five minutes at 60 ticks per second — the hard ceiling
 * from the design. The spiral collapse that normally forces an ending before then is a
 * later task, so until it exists some matches will run to the limit.
 */
export const DEFAULT_MATCH: Omit<MatchConfig, 'arena' | 'seed'> = {
  botCount: 10,
  maxTicks: 18000,
  drag: 0.985,
};

/** Spawns bots on solid floor, spread out, without overlapping. */
function spawnBots(arena: Arena, count: number, rng: Rng): Bot[] {
  const bots: Bot[] = [];
  const size = arena.config.tileSize;

  // Candidate tiles: solid, and not on the outer ring so nobody starts against a wall.
  const candidates: Array<readonly [number, number]> = [];
  for (let row = 1; row < arena.config.rows - 1; row++) {
    for (let col = 1; col < arena.config.cols - 1; col++) {
      const x = col * size + size / 2;
      const y = row * size + size / 2;
      if (!isOverHole(arena.grid, x, y)) candidates.push([col, row]);
    }
  }

  // Shuffle with the seeded PRNG so spawn position never correlates with bot index —
  // the same fairness rule the Plinko board needed.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = swap;
  }

  for (let i = 0; i < count; i++) {
    const [col, row] = candidates[i]!;
    bots.push(
      createBot({
        id: `bot-${i}`,
        x: col * size + size / 2,
        y: row * size + size / 2,
        heading: Math.floor(rng.next() * ANGLE_STEPS),
      }),
    );
  }

  return bots;
}

export function createMatch(config: MatchConfig): Match {
  const arena = buildArena(config.arena);
  const rng = createRng(config.seed);

  const world = createWorld({
    gravity: 0,
    maxSpeed: DEFAULT_BOT.maxSpeed,
    drag: config.drag,
    iterations: 2,
  });
  world.segments.push(...arena.segments);

  const bots = spawnBots(arena, config.botCount, rng);
  for (const bot of bots) world.bodies.push(bot.body);

  return { config, arena, world, bots, eliminations: [], done: false };
}

/**
 * Placeholder AI: drive at the nearest living bot.
 *
 * Deliberately throwaway. It exists so movement and combat can be watched before the
 * real utility-based AI is designed. Do not build on it.
 */
function driveStub(match: Match, bot: Bot): void {
  let targetX = 0;
  let targetY = 0;
  let bestSq = Number.POSITIVE_INFINITY;
  let found = false;

  for (const other of match.bots) {
    if (other === bot || !other.alive) continue;
    const dx = other.body.x - bot.body.x;
    const dy = other.body.y - bot.body.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestSq) {
      bestSq = distSq;
      targetX = dx;
      targetY = dy;
      found = true;
    }
  }

  if (!found) return;
  steerToward(bot, targetX, targetY);
  applyThrust(bot, 1);
  applyGrip(bot);
}

function eliminate(match: Match, bot: Bot, cause: EliminationCause, byId: string | null): void {
  bot.alive = false;
  bot.body.invMass = 0;
  bot.body.vx = 0;
  bot.body.vy = 0;
  match.eliminations.push({ botId: bot.body.id, cause, tick: match.world.tick, byId });
}

export function advanceMatch(match: Match): void {
  if (match.done) return;

  for (const bot of match.bots) {
    if (bot.alive) driveStub(match, bot);
  }

  step(match.world);

  // Combat. `world.step` already resolved the physical collisions and reported them;
  // this converts those contacts into damage, once per direction so a head-on hurts
  // both and a flank attack is one-sided.
  for (const contact of match.world.contacts) {
    if (contact.b === 'segment') continue;
    const a = match.bots.find((bot) => bot.body.id === contact.a);
    const b = match.bots.find((bot) => bot.body.id === contact.b);
    if (!a || !b || !a.alive || !b.alive) continue;

    if (resolveHit(a, b, contact.speed) > 0 && b.health === 0) {
      eliminate(match, b, 'destroyed', a.body.id);
    }
    if (b.alive && resolveHit(b, a, contact.speed) > 0 && a.health === 0) {
      eliminate(match, a, 'destroyed', b.body.id);
    }
  }

  for (const bot of match.bots) {
    if (!bot.alive) continue;
    if (bot.health <= 0) {
      eliminate(match, bot, 'destroyed', null);
    } else if (isOverHole(match.arena.grid, bot.body.x, bot.body.y)) {
      eliminate(match, bot, 'fell', null);
    }
  }

  const living = match.bots.filter((bot) => bot.alive).length;
  if (living <= 1 || match.world.tick >= match.config.maxTicks) {
    match.done = true;
  }
}

/** Ranks bots: survivors first, then eliminated in reverse order of death. */
function buildPlacements(match: Match): Placement[] {
  const order: string[] = [];
  const survivors = match.bots.filter((bot) => bot.alive);

  // Ties among survivors at the tick limit break on remaining health, then bot index.
  survivors.sort((a, b) => {
    if (b.health !== a.health) return b.health - a.health;
    return a.body.id < b.body.id ? -1 : 1;
  });
  for (const bot of survivors) order.push(bot.body.id);

  for (let i = match.eliminations.length - 1; i >= 0; i--) {
    order.push(match.eliminations[i]!.botId);
  }

  return order.map((botId, index) => ({ botId, place: index + 1 }));
}

export function runMatch(config: MatchConfig): MatchResult {
  const match = createMatch(config);
  while (!match.done) advanceMatch(match);

  const values: number[] = [];
  for (const bot of match.bots) {
    values.push(bot.body.x, bot.body.y, bot.body.vx, bot.body.vy, bot.heading, bot.health);
  }
  values.push(match.world.tick);

  return {
    seed: config.seed,
    placements: buildPlacements(match),
    eliminations: match.eliminations,
    ticks: match.world.tick,
    checksum: hashNumbers(values),
  };
}
```

Note that `world.step` already resolves the physical collisions and reports them as
contacts, so `match.ts` never calls `resolveCircleCircle` itself. It only converts those
contacts into damage.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- match`
Expected: PASS, 15 tests passed.

**If matches routinely hit `maxTicks` with several bots still alive, that is expected** —
the chase stub produces bots that circle each other, and the collapse that forces an
ending does not exist yet. Report the actual tick counts rather than tuning anything.

- [ ] **Step 5: Verify lint, types, and the full suite**

Run `npm run lint`, `npx tsc --noEmit`, and `npm test`. All expected clean.

- [ ] **Step 6: Commit**

```bash
git add src/sim/arena/match.ts src/sim/arena/match.test.ts
git commit -m "feat(sim): add arena match runner with elimination and placement"
```

---

## Task 7: Arena renderer

**Files:**
- Create: `src/render/arena-renderer.ts`

- [ ] **Step 1: Write the renderer**

Create `src/render/arena-renderer.ts`:

```ts
import { Application, Container, Graphics, Text } from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { cosOf, sinOf } from '../sim/trig';
import type { Match } from '../sim/arena/match';

const BOT_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

export interface ArenaRenderer {
  draw(match: Match): void;
  destroy(): void;
}

export async function createArenaRenderer(
  parent: HTMLElement,
  match: Match,
  highlightIndex: number | null,
): Promise<ArenaRenderer> {
  const { width, height } = match.arena.grid;

  const app = new Application();
  await app.init({
    width,
    height,
    background: 0x0b0f16,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  parent.appendChild(app.canvas);

  const floor = new Graphics();
  app.stage.addChild(floor);
  const dynamic = new Graphics();
  app.stage.addChild(dynamic);

  const labels = new Container();
  app.stage.addChild(labels);
  const labelTexts = match.bots.map((bot, index) => {
    const text = new Text({
      text: String(index + 1),
      style: { fontSize: 12, fill: 0x0b0f16, fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const drawFloor = (current: Match): void => {
    floor.clear();
    const grid = current.arena.grid;
    const size = grid.tileSize;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const state = grid.tiles[row * grid.cols + col];
        if (state === TileState.Gone) continue;
        const color = state === TileState.Warning ? 0x4a2318 : 0x161d27;
        floor.rect(col * size + 1, row * size + 1, size - 2, size - 2).fill(color);
      }
    }
    for (const seg of current.arena.segments) {
      floor.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 4, color: 0x35424f });
    }
  };

  const draw = (current: Match): void => {
    drawFloor(current);
    dynamic.clear();

    current.bots.forEach((bot, index) => {
      const label = labelTexts[index]!;
      if (!bot.alive) {
        label.visible = false;
        return;
      }
      label.visible = true;

      const color = BOT_COLORS[index % BOT_COLORS.length]!;
      const { x, y } = bot.body;
      const r = bot.body.radius;

      if (index === highlightIndex) {
        dynamic.circle(x, y, r + 6).fill({ color: 0xffffff, alpha: 0.16 });
      }

      dynamic.circle(x, y, r).fill(color);

      // Heading spike, so facing is readable at a glance. This is why combat feels
      // directional rather than random.
      const hx = cosOf(bot.heading);
      const hy = sinOf(bot.heading);
      dynamic
        .moveTo(x + hx * r * 0.4, y + hy * r * 0.4)
        .lineTo(x + hx * (r + 12), y + hy * (r + 12))
        .stroke({ width: 5, color: 0xffffff, alpha: 0.85 });

      // Health bar above the bot.
      const frac = bot.health / bot.maxHealth;
      dynamic.rect(x - r, y - r - 10, r * 2, 4).fill({ color: 0x000000, alpha: 0.5 });
      dynamic.rect(x - r, y - r - 10, r * 2 * frac, 4).fill(frac < 0.3 ? 0xff4a4a : color);

      label.x = x;
      label.y = y;
    });
  };

  draw(match);

  return { draw, destroy: () => app.destroy(true, { children: true }) };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/render/arena-renderer.ts
git commit -m "feat(render): add greybox arena renderer"
```

---

## Task 8: Shell view switch

**Files:**
- Modify: `src/shell/main.ts`

- [ ] **Step 1: Restructure the shell into two views**

`src/shell/main.ts` currently builds the Plinko workbench directly at module scope.
Refactor it so both views can coexist. Do not change any Forge behaviour — the dials,
their defaults, and the 1x playback all stay exactly as they are.

Add these imports:

```ts
import { DEFAULT_ARENA } from '../sim/arena/arena';
import { DEFAULT_MATCH, advanceMatch, createMatch } from '../sim/arena/match';
import { createArenaRenderer, type ArenaRenderer } from '../render/arena-renderer';
```

The refactor contract:

1. Move all existing Forge setup into `function mountForge(container: HTMLElement): () => void`.
   It builds its UI inside `container` and returns a teardown function that cancels its
   animation frame and destroys its renderer.
2. Add `function mountArena(container: HTMLElement): () => void` with the same shape.
3. Replace the module-scope bootstrap with the switcher below.

```ts
const app = document.getElementById('app')!;

const nav = document.createElement('div');
nav.style.cssText = 'display:flex; gap:8px; margin-bottom:14px;';
nav.innerHTML = `
  <button id="viewForge" class="primary">Bot Forge</button>
  <button id="viewArena">Arena</button>
`;

const viewHost = document.createElement('div');
app.append(nav, viewHost);

let teardown: (() => void) | null = null;

function show(view: 'forge' | 'arena'): void {
  teardown?.();
  teardown = null;
  viewHost.innerHTML = '';
  nav.querySelector('#viewForge')!.classList.toggle('primary', view === 'forge');
  nav.querySelector('#viewArena')!.classList.toggle('primary', view === 'arena');
  teardown = view === 'forge' ? mountForge(viewHost) : mountArena(viewHost);
}

nav.querySelector('#viewForge')!.addEventListener('click', () => show('forge'));
nav.querySelector('#viewArena')!.addEventListener('click', () => show('arena'));

show('forge');
```

Calling `teardown` before clearing `viewHost` is what stops canvases and animation loops
accumulating. A destroyed Pixi `Application` still holds a WebGL context until
`destroy()` runs, and browsers cap the number of live contexts — leak enough and the page
silently stops rendering.

`mountArena` mirrors `mountForge`:

```ts
async function startArenaRun(seed: number): Promise<void> {
  cancelAnimationFrame(arenaFrame);
  arenaRenderer?.destroy();
  arenaStage.innerHTML = '';

  const match = createMatch({ ...DEFAULT_MATCH, arena: DEFAULT_ARENA, seed });
  arenaRenderer = await createArenaRenderer(arenaStage, match, 0);

  const loop = (): void => {
    // 1x: one simulation tick per animation frame, matching the Forge.
    if (!match.done) advanceMatch(match);

    arenaRenderer!.draw(match);
    const alive = match.bots.filter((b) => b.alive).length;
    arenaStatus.textContent = match.done
      ? `finished at tick ${match.world.tick} — ${alive} left standing`
      : `tick ${match.world.tick} — ${alive} alive`;

    if (!match.done) arenaFrame = requestAnimationFrame(loop);
  };

  loop();
}
```

Requirements:

- A seed input and Run and Random-seed buttons, matching the Forge's controls.
- Switching views must call `destroy()` on the outgoing renderer and
  `cancelAnimationFrame` on its loop, so canvases and loops do not accumulate.
- Only one canvas may exist at a time. Verify with
  `document.querySelectorAll('canvas').length` in the browser console after switching
  back and forth several times.

- [ ] **Step 2: Verify the build**

Run `npx tsc --noEmit`, `npm run lint`, and `npm run build`. All expected clean.

- [ ] **Step 3: Watch it**

Run: `npm run dev` and open the page. Switch to the Arena view and watch a match.

Expected: ten numbered bots drive at each other, turn to face their targets rather than
sliding sideways, drift slightly when cornering hard, take damage on impact, lose health
bars, and get eliminated. Some fall into pits or are shoved out through the wall gaps.

**Report what you actually observe, including anything that looks wrong.** This is one of
the two deliberate stop-and-look points in this phase. Specifically say whether:

- Bots visibly turn to face their target rather than strafing
- Head-on collisions hurt both, while flank hits are visibly one-sided
- Drift on hard cornering is visible but not excessive
- Bots ever pass through a wall or a bot (they must not)
- The match ends in a reasonable time, or stalls with bots circling

- [ ] **Step 4: Commit**

```bash
git add src/shell/main.ts
git commit -m "feat(shell): add arena view alongside the Bot Forge"
```

---

## Definition of done

- [ ] `npm test` passes
- [ ] `npm run lint` and `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] The trig reference vector exists and was observed to fail when the polynomial was
      perturbed
- [ ] A match with the same seed produces the same checksum and placements every time
- [ ] Every match produces exactly one ranking per bot, places 1 through 10
- [ ] No bot ever passes through a wall or another bot
- [ ] The Arena view runs and was watched end to end

## What this does not include

Deliberately deferred to the next plan:

- The real utility-based AI and the seven personalities — the chase stub is throwaway
- The engagement model
- Hazards: saw blades, flame jets, tar, ice
- The spiral floor collapse and its telegraph
- The headless metrics harness
- Any tuning of bot stats
