# Deterministic Core & Bot Forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic 2D physics simulation core and use it to run the Bot Forge — a 10-ball Plinko board whose results are reproducible byte-for-byte from a single integer seed.

**Architecture:** A pure `src/sim/` layer with no DOM, no pixels, and no wall-clock time, stepped at a fixed rate and driven entirely by a seeded PRNG. A separate `src/render/` layer draws sim state with PixiJS and knows no rules. Determinism is enforced by lint rules and proven by a test that replays the same seed many times and compares state checksums.

**Tech Stack:** TypeScript, Vite, Vitest, PixiJS, ESLint. Node 24 / npm 11.

---

## Background for the implementer

You are building the foundation for a fantasy-football draft-order website. The full
design is in `docs/superpowers/specs/2026-08-03-quest-draft-selector-design.md` — read
section 6 (Architecture) and section 8 (The Bot Forge) before starting.

**The one rule that matters:** the `src/sim/` directory must produce identical results on
every machine, in every browser, forever. A recorded event is stored as just a seed, and
playback re-runs the simulation. If the sim drifts, recorded events change and the whole
project fails.

Three things make this achievable:

1. **All randomness comes from a seeded PRNG** built on 32-bit integer operations
   (`|0`, `>>>`, `Math.imul`). These are exactly specified by ECMAScript, so they are
   bit-identical everywhere.
2. **Only `+`, `-`, `*`, `/`, and `Math.sqrt` are used for real-number math.** IEEE 754
   mandates exact results for the four basic operations. `Math.sin`, `Math.cos`,
   `Math.atan2`, `Math.pow`, and `Math.hypot` are *implementation-approximated* and may
   differ between browsers — they are banned in `src/sim/` by lint rule (Task 8).
   `Math.sqrt` is technically also implementation-approximated in the spec, but every
   real engine compiles it to the hardware instruction, which is correctly rounded. The
   determinism test in Task 11 is what catches it if that ever stops being true.
3. **Time is counted in integer ticks, not seconds.** The sim never reads the clock. One
   `step()` call is one tick. Velocities are expressed in units-per-tick, so there is no
   `dt` multiplication anywhere and no float noise from variable frame timing.

**Escape hatch, if determinism ever fails:** convert the sim to integer fixed-point math.
Do not do this preemptively — it costs readability and we have no evidence it's needed.

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/rng.ts` | Seeded PRNG. The only source of randomness in the project. |
| `src/sim/vec.ts` | 2D vector helpers. Pure functions, no allocation concerns at this scale. |
| `src/sim/body.ts` | The physics body type and its integration step. |
| `src/sim/collision.ts` | Circle-circle and circle-segment collision detection and response. |
| `src/sim/world.ts` | Holds bodies and segments, runs one fixed tick. |
| `src/sim/checksum.ts` | Hashes world state so two runs can be compared exactly. |
| `src/sim/plinko/board.ts` | Generates peg grid, walls, dividers, and slot geometry. |
| `src/sim/plinko/plinko.ts` | Runs a full Plinko drop and reports which slot each ball landed in. |
| `src/render/plinko-renderer.ts` | Draws a Plinko world with PixiJS. Knows no rules. |
| `src/shell/main.ts` | Wires the page: run a seed, render it, show results. |
| `tools/distribution.ts` | Headless harness: run N drops, report the slot distribution. |

`src/sim/` never imports from `src/render/` or `src/shell/`.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/sim/smoke.test.ts` (deleted at the end of this task)

- [ ] **Step 1: Initialize the project and install dependencies**

```bash
npm init -y
npm install pixi.js
npm install -D typescript vite vitest @types/node eslint typescript-eslint @eslint/js
```

- [ ] **Step 2: Replace `package.json` scripts**

Open `package.json` and replace the `"scripts"` block, and add `"type": "module"`:

```json
{
  "name": "quest-draft-selector",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "distribution": "vite-node tools/distribution.ts"
  }
}
```

- [ ] **Step 3: Install `vite-node` for the headless tools**

```bash
npm install -D vite-node
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tools", "tests", "*.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```ts
// Imported from 'vitest/config', not 'vite' — that is what types the `test` block.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>The Bot Forge</title>
    <style>
      body { margin: 0; background: #07090d; color: #c9d2de;
             font: 14px ui-sans-serif, system-ui, sans-serif; }
      #app { display: flex; justify-content: center; padding: 20px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/shell/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write a smoke test to prove the toolchain runs**

Create `src/sim/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run the smoke test**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 9: Delete the smoke test and commit**

```bash
rm src/sim/smoke.test.ts
git add -A
git commit -m "chore: scaffold TypeScript, Vite, and Vitest toolchain"
```

---

## Task 2: Seeded PRNG

The sim's only source of randomness. Uses `sfc32` (128-bit state, long period) seeded by
`splitmix32`. Both are built purely from 32-bit integer operations, which ECMAScript
specifies exactly — so the output sequence is bit-identical on every engine.

**Files:**
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range() stays within bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it('has a roughly uniform distribution', () => {
    const rng = createRng(4242);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) {
      buckets[Math.floor(rng.next() * 10)]!++;
    }
    // Each bucket should hold ~10% of samples. Allow 8%-12%.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n * 0.08);
      expect(count).toBeLessThan(n * 0.12);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- rng`
Expected: FAIL, "Failed to resolve import './rng'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/rng.ts`:

```ts
/**
 * The only source of randomness in the simulation.
 *
 * Built entirely from 32-bit integer operations (`|0`, `>>>`, `Math.imul`), which
 * ECMAScript specifies exactly. The output sequence is therefore bit-identical on
 * every JavaScript engine, which is what makes seed-based replay possible.
 */
export interface Rng {
  /** Next value in [0, 1). */
  next(): number;
  /** Next value in [min, max). */
  range(min: number, max: number): number;
}

/** Expands a single integer seed into well-distributed 32-bit values. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const gen = splitmix32(seed);
  let a = gen(), b = gen(), c = gen(), d = gen();

  const next = (): number => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Discard the first values so the initial state is well mixed.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + next() * (max - min),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- rng`
Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/rng.ts src/sim/rng.test.ts
git commit -m "feat(sim): add seeded PRNG built on exact 32-bit integer operations"
```

---

## Task 3: Vector helpers

**Files:**
- Create: `src/sim/vec.ts`
- Test: `src/sim/vec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/vec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lengthSq, length, clampLength } from './vec';

describe('vec', () => {
  it('lengthSq avoids sqrt', () => {
    expect(lengthSq(3, 4)).toBe(25);
  });

  it('length computes magnitude', () => {
    expect(length(3, 4)).toBe(5);
  });

  it('clampLength leaves short vectors untouched', () => {
    expect(clampLength(3, 4, 10)).toEqual({ x: 3, y: 4 });
  });

  it('clampLength scales long vectors down to the maximum', () => {
    const r = clampLength(30, 40, 5);
    expect(r.x).toBeCloseTo(3, 10);
    expect(r.y).toBeCloseTo(4, 10);
    expect(length(r.x, r.y)).toBeCloseTo(5, 10);
  });

  it('clampLength handles the zero vector without dividing by zero', () => {
    expect(clampLength(0, 0, 5)).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- vec`
Expected: FAIL, "Failed to resolve import './vec'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/vec.ts`:

```ts
/**
 * 2D vector helpers for the simulation.
 *
 * Only +, -, *, / and Math.sqrt are used. Prefer `lengthSq` over `length` in
 * comparisons — it skips the square root entirely.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function lengthSq(x: number, y: number): number {
  return x * x + y * y;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Returns (x, y) scaled down so its magnitude is at most `max`. */
export function clampLength(x: number, y: number, max: number): Vec2 {
  const lenSq = x * x + y * y;
  if (lenSq <= max * max || lenSq === 0) return { x, y };
  const scale = max / Math.sqrt(lenSq);
  return { x: x * scale, y: y * scale };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- vec`
Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/vec.ts src/sim/vec.test.ts
git commit -m "feat(sim): add 2D vector helpers"
```

---

## Task 4: Physics body and integration

Bodies move in units-per-tick. There is no `dt` — one `integrate()` call is one tick.
Speed is clamped to `maxSpeed`, which serves as air resistance *and* guarantees a body
can never move further in one tick than the smallest collision radius, which is what
prevents tunnelling through pegs.

**Files:**
- Create: `src/sim/body.ts`
- Test: `src/sim/body.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/body.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBody, integrate, type Body } from './body';

const ball = (over: Partial<Body> = {}): Body =>
  createBody({ id: 'b', x: 0, y: 0, radius: 10, mass: 1, ...over });

describe('createBody', () => {
  it('computes inverse mass', () => {
    expect(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 4 }).invMass).toBe(0.25);
  });

  it('treats mass 0 as static (infinite mass)', () => {
    expect(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 0 }).invMass).toBe(0);
  });
});

describe('integrate', () => {
  it('applies gravity to velocity', () => {
    const b = ball();
    integrate(b, 0.5, 100, 1);
    expect(b.vy).toBe(0.5);
  });

  it('moves the body by its velocity', () => {
    const b = ball({ vx: 2, vy: 3 });
    integrate(b, 0, 100, 1);
    expect(b.x).toBe(2);
    expect(b.y).toBe(3);
  });

  it('applies drag to velocity', () => {
    const b = ball({ vx: 10 });
    integrate(b, 0, 100, 0.9);
    expect(b.vx).toBeCloseTo(9, 10);
  });

  it('clamps speed to maxSpeed', () => {
    const b = ball({ vx: 100, vy: 0 });
    integrate(b, 0, 7, 1);
    expect(b.vx).toBeCloseTo(7, 10);
  });

  it('never exceeds maxSpeed no matter how long gravity acts', () => {
    const b = ball();
    for (let i = 0; i < 5000; i++) integrate(b, 0.5, 9, 1);
    expect(Math.sqrt(b.vx * b.vx + b.vy * b.vy)).toBeLessThanOrEqual(9.0000001);
  });

  it('does not move static bodies', () => {
    const b = createBody({ id: 'peg', x: 5, y: 5, radius: 4, mass: 0 });
    integrate(b, 0.5, 100, 1);
    expect(b).toMatchObject({ x: 5, y: 5, vx: 0, vy: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- body`
Expected: FAIL, "Failed to resolve import './body'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/body.ts`:

```ts
import { clampLength } from './vec';

/**
 * A circular physics body.
 *
 * All velocities are in units per tick. There is no delta time — one `integrate()`
 * call is exactly one tick, which removes variable-timestep float noise entirely.
 */
export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 1 / mass. Zero means static (infinite mass). */
  invMass: number;
  /** Bounciness, 0 to 1. */
  restitution: number;
}

export interface BodyInit {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Zero means static. */
  mass: number;
  vx?: number;
  vy?: number;
  restitution?: number;
}

export function createBody(init: BodyInit): Body {
  return {
    id: init.id,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    radius: init.radius,
    invMass: init.mass === 0 ? 0 : 1 / init.mass,
    restitution: init.restitution ?? 0.4,
  };
}

/**
 * Advances a body by one tick using semi-implicit Euler.
 *
 * `maxSpeed` doubles as air resistance and as the tunnelling guard: a body can never
 * travel further in one tick than `maxSpeed`, so as long as that stays below the
 * smallest collision radius in the world, nothing can pass through anything.
 */
export function integrate(body: Body, gravity: number, maxSpeed: number, drag: number): void {
  if (body.invMass === 0) return;

  body.vy += gravity;
  body.vx *= drag;
  body.vy *= drag;

  const clamped = clampLength(body.vx, body.vy, maxSpeed);
  body.vx = clamped.x;
  body.vy = clamped.y;

  body.x += body.vx;
  body.y += body.vy;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- body`
Expected: PASS, 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/body.ts src/sim/body.test.ts
git commit -m "feat(sim): add physics body with tick-based integration and speed clamp"
```

---

## Task 5: Collision detection and response

Two collision types are needed: circle-circle (ball against ball, ball against peg) and
circle-segment (ball against walls, slot dividers, and the floor).

**Files:**
- Create: `src/sim/collision.ts`
- Test: `src/sim/collision.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/collision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { resolveCircleCircle, resolveCircleSegment, type Segment } from './collision';

describe('resolveCircleCircle', () => {
  it('returns 0 and does nothing when bodies do not overlap', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 100, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleCircle(a, b)).toBe(0);
    expect(a.x).toBe(0);
  });

  it('separates overlapping bodies', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 6, y: 0, radius: 5, mass: 1 });
    resolveCircleCircle(a, b);
    // Overlap is 4. SEPARATION_BIAS (0.8) corrects 3.2 of it, split evenly by
    // inverse mass, leaving them 9.2 apart rather than a full 10. The remaining
    // overlap is corrected over subsequent ticks, which keeps resting stacks stable
    // instead of making them explode apart.
    expect(b.x - a.x).toBeCloseTo(9.2, 8);
  });

  it('pushes only the dynamic body when the other is static', () => {
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 5, mass: 1 });
    const peg = createBody({ id: 'peg', x: 6, y: 0, radius: 5, mass: 0 });
    resolveCircleCircle(ball, peg);
    expect(peg.x).toBe(6);
    // The ball absorbs the whole 3.2 correction because the peg cannot move.
    expect(ball.x).toBeCloseTo(-3.2, 8);
  });

  it('transfers velocity on a perfectly elastic head-on impact', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: 0, restitution: 1 });
    resolveCircleCircle(a, b);
    // Equal masses, fully elastic: the velocities swap.
    expect(a.vx).toBeCloseTo(0, 8);
    expect(b.vx).toBeCloseTo(4, 8);
  });

  it('bounces a ball back off a static peg', () => {
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 5, mass: 1, vx: 4, restitution: 1 });
    const peg = createBody({ id: 'peg', x: 9, y: 0, radius: 5, mass: 0, restitution: 1 });
    resolveCircleCircle(ball, peg);
    expect(ball.vx).toBeCloseTo(-4, 8);
    expect(peg.vx).toBe(0);
  });

  it('reports impact speed', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 4 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleCircle(a, b)).toBeCloseTo(4, 8);
  });

  it('conserves momentum between two equal dynamic bodies', () => {
    const a = createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 6, restitution: 1 });
    const b = createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1, vx: -2, restitution: 1 });
    const before = a.vx + b.vx;
    resolveCircleCircle(a, b);
    expect(a.vx + b.vx).toBeCloseTo(before, 8);
  });

  it('separates bodies resting at exactly the same point', () => {
    const a = createBody({ id: 'a', x: 10, y: 10, radius: 5, mass: 1 });
    const b = createBody({ id: 'b', x: 10, y: 10, radius: 5, mass: 1 });
    resolveCircleCircle(a, b);
    const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    expect(dist).toBeGreaterThan(0);
    expect(Number.isNaN(dist)).toBe(false);
  });
});

describe('resolveCircleSegment', () => {
  const floor: Segment = { x1: -100, y1: 50, x2: 100, y2: 50 };

  it('does nothing when the body is clear of the segment', () => {
    const b = createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.y).toBe(0);
  });

  it('pushes a body out of a segment it has sunk into', () => {
    const b = createBody({ id: 'b', x: 0, y: 48, radius: 5, mass: 1, vy: 3 });
    resolveCircleSegment(b, floor);
    expect(b.y).toBeCloseTo(45, 8);
  });

  it('reflects velocity off the segment', () => {
    const b = createBody({ id: 'b', x: 0, y: 48, radius: 5, mass: 1, vy: 3, restitution: 0.5 });
    resolveCircleSegment(b, floor);
    expect(b.vy).toBeCloseTo(-1.5, 8);
  });

  it('collides against a segment endpoint', () => {
    const wall: Segment = { x1: 0, y1: 0, x2: 0, y2: 20 };
    const b = createBody({ id: 'b', x: 2, y: 22, radius: 5, mass: 1 });
    expect(resolveCircleSegment(b, wall)).toBeGreaterThanOrEqual(0);
    const dist = Math.sqrt((b.x - 0) ** 2 + (b.y - 20) ** 2);
    expect(dist).toBeGreaterThanOrEqual(4.999);
  });

  it('ignores static bodies', () => {
    const b = createBody({ id: 'peg', x: 0, y: 48, radius: 5, mass: 0 });
    expect(resolveCircleSegment(b, floor)).toBe(0);
    expect(b.y).toBe(48);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- collision`
Expected: FAIL, "Failed to resolve import './collision'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/collision.ts`:

```ts
import type { Body } from './body';

/** A static line segment: walls, slot dividers, and floors. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Positional correction applied per contact. Below 1 to keep resting contacts stable. */
const SEPARATION_BIAS = 0.8;

/**
 * Resolves a collision between two circular bodies.
 *
 * Separates them and exchanges impulse along the contact normal.
 * Returns the closing speed at the moment of impact, or 0 if they were not touching.
 * The caller uses that value to decide how much damage or how many sparks to produce.
 */
export function resolveCircleCircle(a: Body, b: Body): number {
  if (a.invMass === 0 && b.invMass === 0) return 0;

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const minDist = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return 0;

  let dist = Math.sqrt(distSq);
  if (dist === 0) {
    // Perfectly coincident. Pick an arbitrary but deterministic axis so the two
    // bodies can separate instead of producing NaN.
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const invMassSum = a.invMass + b.invMass;

  // Positional separation, distributed by inverse mass.
  const overlap = (minDist - dist) * SEPARATION_BIAS;
  a.x -= nx * overlap * (a.invMass / invMassSum);
  a.y -= ny * overlap * (a.invMass / invMassSum);
  b.x += nx * overlap * (b.invMass / invMassSum);
  b.y += ny * overlap * (b.invMass / invMassSum);

  // Impulse along the normal.
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel > 0) return 0; // already separating

  const restitution = a.restitution < b.restitution ? a.restitution : b.restitution;
  const j = (-(1 + restitution) * rel) / invMassSum;

  a.vx -= j * nx * a.invMass;
  a.vy -= j * ny * a.invMass;
  b.vx += j * nx * b.invMass;
  b.vy += j * ny * b.invMass;

  return -rel;
}

/**
 * Resolves a collision between a dynamic body and a static segment.
 *
 * Returns the closing speed at impact, or 0 if there was no contact.
 */
export function resolveCircleSegment(body: Body, seg: Segment): number {
  if (body.invMass === 0) return 0;

  const ex = seg.x2 - seg.x1;
  const ey = seg.y2 - seg.y1;
  const lenSq = ex * ex + ey * ey;

  // Project the body centre onto the segment, clamped to its endpoints.
  let t = lenSq === 0 ? 0 : ((body.x - seg.x1) * ex + (body.y - seg.y1) * ey) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const closestX = seg.x1 + ex * t;
  const closestY = seg.y1 + ey * t;

  let dx = body.x - closestX;
  let dy = body.y - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= body.radius * body.radius) return 0;

  let dist = Math.sqrt(distSq);
  if (dist === 0) {
    // Centre exactly on the segment. Push out perpendicular to it.
    dx = -ey;
    dy = ex;
    dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return 0;
  }

  const nx = dx / dist;
  const ny = dy / dist;

  body.x += nx * (body.radius - dist);
  body.y += ny * (body.radius - dist);

  const rel = body.vx * nx + body.vy * ny;
  if (rel > 0) return 0;

  const j = -(1 + body.restitution) * rel;
  body.vx += j * nx;
  body.vy += j * ny;

  return -rel;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- collision`
Expected: PASS, 13 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/collision.ts src/sim/collision.test.ts
git commit -m "feat(sim): add circle-circle and circle-segment collision resolution"
```

---

## Task 6: The world and its fixed step

**Files:**
- Create: `src/sim/world.ts`
- Test: `src/sim/world.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/world.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { createWorld, step, isSettled } from './world';

describe('createWorld', () => {
  it('starts at tick 0', () => {
    expect(createWorld({ gravity: 0.4 }).tick).toBe(0);
  });
});

describe('step', () => {
  it('advances the tick counter', () => {
    const w = createWorld({ gravity: 0 });
    step(w);
    step(w);
    expect(w.tick).toBe(2);
  });

  it('drops a body under gravity', () => {
    const w = createWorld({ gravity: 0.5 });
    const b = createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1 });
    w.bodies.push(b);
    step(w);
    expect(b.y).toBeGreaterThan(0);
  });

  it('records contacts produced during the tick', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 3 }));
    w.bodies.push(createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 }));
    step(w);
    expect(w.contacts.length).toBe(1);
    expect(w.contacts[0]!.speed).toBeGreaterThan(0);
  });

  it('clears contacts at the start of each tick', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'a', x: 0, y: 0, radius: 5, mass: 1, vx: 3 }));
    w.bodies.push(createBody({ id: 'b', x: 9, y: 0, radius: 5, mass: 1 }));
    step(w);
    for (let i = 0; i < 200; i++) step(w);
    expect(w.contacts.length).toBe(0);
  });

  it('never lets a body tunnel through a static peg', () => {
    const w = createWorld({ gravity: 0.6, maxSpeed: 6 });
    w.bodies.push(createBody({ id: 'peg', x: 0, y: 400, radius: 6, mass: 0 }));
    const ball = createBody({ id: 'ball', x: 0, y: 0, radius: 10, mass: 1 });
    w.bodies.push(ball);
    for (let i = 0; i < 300; i++) {
      step(w);
      // The ball must never end a tick on the far side of the peg.
      if (ball.y > 420) throw new Error(`tunnelled at tick ${w.tick}`);
    }
    expect(ball.y).toBeLessThanOrEqual(420);
  });

  it('produces no NaN values over a long run', () => {
    const w = createWorld({ gravity: 0.4 });
    for (let i = 0; i < 30; i++) {
      w.bodies.push(createBody({ id: `p${i}`, x: i * 7, y: 100, radius: 5, mass: 0 }));
    }
    for (let i = 0; i < 10; i++) {
      w.bodies.push(createBody({ id: `b${i}`, x: 40 + i, y: 0, radius: 8, mass: 1 }));
    }
    w.segments.push({ x1: -200, y1: 300, x2: 400, y2: 300 });
    for (let i = 0; i < 2000; i++) step(w);
    for (const b of w.bodies) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.y)).toBe(true);
      expect(Number.isFinite(b.vx)).toBe(true);
      expect(Number.isFinite(b.vy)).toBe(true);
    }
  });
});

describe('isSettled', () => {
  it('is false while bodies are moving', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1, vx: 5 }));
    expect(isSettled(w, 0.05)).toBe(false);
  });

  it('is true when every dynamic body is nearly still', () => {
    const w = createWorld({ gravity: 0 });
    w.bodies.push(createBody({ id: 'b', x: 0, y: 0, radius: 5, mass: 1, vx: 0.001 }));
    w.bodies.push(createBody({ id: 'peg', x: 50, y: 0, radius: 5, mass: 0 }));
    expect(isSettled(w, 0.05)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- world`
Expected: FAIL, "Failed to resolve import './world'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/world.ts`:

```ts
import { integrate, type Body } from './body';
import { resolveCircleCircle, resolveCircleSegment, type Segment } from './collision';
import { lengthSq } from './vec';

/** A collision that happened during a tick. Consumed by the renderer for effects. */
export interface Contact {
  a: string;
  b: string;
  x: number;
  y: number;
  speed: number;
}

export interface World {
  bodies: Body[];
  segments: Segment[];
  contacts: Contact[];
  gravity: number;
  maxSpeed: number;
  drag: number;
  /** Extra collision passes per tick. More passes means stabler stacks. */
  iterations: number;
  tick: number;
}

export interface WorldInit {
  gravity: number;
  maxSpeed?: number;
  drag?: number;
  iterations?: number;
}

export function createWorld(init: WorldInit): World {
  return {
    bodies: [],
    segments: [],
    contacts: [],
    gravity: init.gravity,
    maxSpeed: init.maxSpeed ?? 6,
    drag: init.drag ?? 0.995,
    iterations: init.iterations ?? 2,
    tick: 0,
  };
}

/**
 * Advances the world by exactly one tick.
 *
 * Collision detection is brute force. At this scale (roughly 150 pegs and 10 balls)
 * that is a few thousand comparisons per tick, which is far cheaper than the
 * bookkeeping a spatial partition would cost.
 */
export function step(world: World): void {
  world.contacts.length = 0;

  for (const body of world.bodies) {
    integrate(body, world.gravity, world.maxSpeed, world.drag);
  }

  for (let pass = 0; pass < world.iterations; pass++) {
    const record = pass === 0;

    for (let i = 0; i < world.bodies.length; i++) {
      const a = world.bodies[i]!;
      for (let j = i + 1; j < world.bodies.length; j++) {
        const b = world.bodies[j]!;
        const speed = resolveCircleCircle(a, b);
        if (speed > 0 && record) {
          world.contacts.push({
            a: a.id,
            b: b.id,
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
            speed,
          });
        }
      }
    }

    for (const body of world.bodies) {
      for (const seg of world.segments) {
        const speed = resolveCircleSegment(body, seg);
        if (speed > 0 && record) {
          world.contacts.push({ a: body.id, b: 'segment', x: body.x, y: body.y, speed });
        }
      }
    }
  }

  world.tick++;
}

/** True when every dynamic body is moving slower than `threshold` units per tick. */
export function isSettled(world: World, threshold: number): boolean {
  const limitSq = threshold * threshold;
  for (const body of world.bodies) {
    if (body.invMass === 0) continue;
    if (lengthSq(body.vx, body.vy) > limitSq) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- world`
Expected: PASS, 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts src/sim/world.test.ts
git commit -m "feat(sim): add world container with fixed-tick stepping and contact reporting"
```

---

## Task 7: State checksum

**Files:**
- Create: `src/sim/checksum.ts`
- Test: `src/sim/checksum.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/checksum.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBody } from './body';
import { createWorld, step } from './world';
import { hashWorld, hashNumbers } from './checksum';

describe('hashNumbers', () => {
  it('is stable for the same input', () => {
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
  });

  it('differs for different input', () => {
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 4]));
  });

  it('detects a tiny floating point difference', () => {
    expect(hashNumbers([0.1])).not.toBe(hashNumbers([0.1 + Number.EPSILON]));
  });

  it('returns an 8-character hex string', () => {
    expect(hashNumbers([42])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('hashWorld', () => {
  it('matches for two identically-stepped worlds', () => {
    const build = () => {
      const w = createWorld({ gravity: 0.4 });
      w.bodies.push(createBody({ id: 'peg', x: 0, y: 60, radius: 6, mass: 0 }));
      w.bodies.push(createBody({ id: 'ball', x: 1, y: 0, radius: 9, mass: 1 }));
      for (let i = 0; i < 400; i++) step(w);
      return w;
    };
    expect(hashWorld(build())).toBe(hashWorld(build()));
  });

  it('differs when a body starts in a different place', () => {
    const build = (startX: number) => {
      const w = createWorld({ gravity: 0.4 });
      w.bodies.push(createBody({ id: 'peg', x: 0, y: 60, radius: 6, mass: 0 }));
      w.bodies.push(createBody({ id: 'ball', x: startX, y: 0, radius: 9, mass: 1 }));
      for (let i = 0; i < 400; i++) step(w);
      return w;
    };
    expect(hashWorld(build(1))).not.toBe(hashWorld(build(1.0001)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- checksum`
Expected: FAIL, "Failed to resolve import './checksum'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/checksum.ts`:

```ts
import type { World } from './world';

/**
 * FNV-1a over the raw IEEE 754 bits of each number.
 *
 * Hashing the actual bits rather than a rounded string means the smallest possible
 * divergence between two runs is caught. That is the entire point: this is the
 * tripwire that tells us seed-based replay has stopped being trustworthy.
 */
export function hashNumbers(values: Iterable<number>): string {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  let hash = 0x811c9dc5;

  for (const value of values) {
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) {
      hash ^= view.getUint8(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Hashes every body position and velocity, plus the tick count. */
export function hashWorld(world: World): string {
  const values: number[] = [];
  for (const body of world.bodies) {
    values.push(body.x, body.y, body.vx, body.vy);
  }
  values.push(world.tick);
  return hashNumbers(values);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- checksum`
Expected: PASS, 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/checksum.ts src/sim/checksum.test.ts
git commit -m "feat(sim): add bit-exact world state checksum"
```

---

## Task 8: Lint guard on the sim layer

Makes the determinism rules mechanical instead of a matter of discipline.

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 1: Create the ESLint config**

Create `eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Math functions that are implementation-approximated and may differ across engines. */
const BANNED_MATH = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
                     'pow', 'hypot', 'log', 'exp', 'cbrt', 'random'];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/**'],
  },
  {
    // The determinism contract. See docs/superpowers/specs — section 6.1.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...BANNED_MATH.map((name) => ({
          object: 'Math',
          property: name,
          message:
            `Math.${name} is implementation-approximated and may differ between ` +
            `JavaScript engines, which would break deterministic replay. ` +
            `Only +, -, *, / and Math.sqrt are permitted in src/sim/.`,
        })),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'src/sim/ must never read wall-clock time.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='performance']",
          message: 'src/sim/ must never read wall-clock time.',
        },
        {
          selector: "MemberExpression[object.name='document']",
          message: 'src/sim/ must never touch the DOM.',
        },
        {
          selector: "ImportDeclaration[source.value=/^\\.\\.\\/(render|shell)/]",
          message: 'src/sim/ must not import from the render or shell layers.',
        },
      ],
    },
  },
  {
    // Tests and headless tools live outside the determinism contract. They are
    // allowed to time things, use Math.random to pick seeds, and reach anywhere.
    files: ['**/*.test.ts', 'tools/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
```

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 3: Prove the guard actually fires**

Temporarily add this line to the top of `src/sim/vec.ts`:

```ts
export const broken = Math.random();
```

Run: `npm run lint`
Expected: FAIL with the message "Math.random is implementation-approximated...".

Now delete that line and run `npm run lint` again.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "chore: enforce the sim determinism contract with lint rules"
```

---

## Task 9: Plinko board geometry

**Files:**
- Create: `src/sim/plinko/board.ts`
- Test: `src/sim/plinko/board.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/plinko/board.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD, buildBoard, slotForX } from './board';

describe('buildBoard', () => {
  const board = buildBoard(DEFAULT_BOARD);

  it('creates staggered peg rows', () => {
    expect(board.pegs.length).toBeGreaterThan(50);
  });

  it('makes every peg static', () => {
    for (const peg of board.pegs) expect(peg.invMass).toBe(0);
  });

  it('keeps every peg inside the board', () => {
    for (const peg of board.pegs) {
      expect(peg.x).toBeGreaterThanOrEqual(0);
      expect(peg.x).toBeLessThanOrEqual(DEFAULT_BOARD.width);
    }
  });

  it('offsets alternating rows by half the peg spacing', () => {
    const firstRowY = board.pegs[0]!.y;
    const rowOne = board.pegs.filter((p) => p.y === firstRowY).map((p) => p.x).sort((a, b) => a - b);
    const secondRowY = board.pegs.find((p) => p.y > firstRowY)!.y;
    const rowTwo = board.pegs.filter((p) => p.y === secondRowY).map((p) => p.x).sort((a, b) => a - b);
    expect(rowTwo[0]! - rowOne[0]!).toBeCloseTo(DEFAULT_BOARD.pegSpacingX / 2, 6);
  });

  it('creates two outer walls, one interior divider per slot boundary, and a floor', () => {
    const walls = 2;
    const dividers = DEFAULT_BOARD.slotCount - 1;
    const floor = 1;
    expect(board.segments.length).toBe(walls + dividers + floor);
  });

  it('produces exactly slotCount slots spanning the full width', () => {
    expect(board.slots.length).toBe(DEFAULT_BOARD.slotCount);
    expect(board.slots[0]!.minX).toBeCloseTo(0, 6);
    expect(board.slots.at(-1)!.maxX).toBeCloseTo(DEFAULT_BOARD.width, 6);
  });
});

describe('slotForX', () => {
  const board = buildBoard(DEFAULT_BOARD);

  it('maps the far left to slot 0', () => {
    expect(slotForX(board, 1)).toBe(0);
  });

  it('maps the far right to the last slot', () => {
    expect(slotForX(board, DEFAULT_BOARD.width - 1)).toBe(DEFAULT_BOARD.slotCount - 1);
  });

  it('clamps values outside the board', () => {
    expect(slotForX(board, -500)).toBe(0);
    expect(slotForX(board, 99999)).toBe(DEFAULT_BOARD.slotCount - 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- board`
Expected: FAIL, "Failed to resolve import './board'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/plinko/board.ts`:

```ts
import { createBody, type Body } from '../body';
import type { Segment } from '../collision';

export interface BoardConfig {
  width: number;
  height: number;
  /** Number of staggered peg rows. The primary dial for how rare the outer slots are. */
  rows: number;
  pegSpacingX: number;
  pegSpacingY: number;
  pegRadius: number;
  /** Y of the first peg row. Balls fall freely above this. */
  pegTopY: number;
  /** Y where the slot dividers begin. */
  slotTopY: number;
  slotCount: number;
  pegRestitution: number;
}

export interface Slot {
  index: number;
  minX: number;
  maxX: number;
}

export interface Board {
  config: BoardConfig;
  pegs: Body[];
  segments: Segment[];
  slots: Slot[];
}

/**
 * Starting values, tuned for a 10-ball drop into 9 slots.
 *
 * `rows` is the dial that controls rarity: more rows sharpen the binomial distribution
 * and make the outer jackpot slots rarer. Phase 5 tunes this against measured data from
 * `npm run distribution` — do not guess at it here.
 */
export const DEFAULT_BOARD: BoardConfig = {
  width: 760,
  height: 760,
  rows: 14,
  pegSpacingX: 60,
  pegSpacingY: 34,
  pegRadius: 6,
  pegTopY: 140,
  slotTopY: 640,
  slotCount: 9,
  pegRestitution: 0.32,
};

export function buildBoard(config: BoardConfig): Board {
  const pegs: Body[] = [];

  for (let row = 0; row < config.rows; row++) {
    const y = config.pegTopY + row * config.pegSpacingY;
    // Alternate rows shift right by half a spacing, which is what makes a ball
    // deflect left or right at each row and produces the binomial distribution.
    const offset = (row % 2) * (config.pegSpacingX / 2);
    const count = Math.floor((config.width - offset) / config.pegSpacingX) + 1;

    for (let col = 0; col < count; col++) {
      const x = offset + col * config.pegSpacingX;
      if (x < 0 || x > config.width) continue;
      pegs.push(
        createBody({
          id: `peg-${row}-${col}`,
          x,
          y,
          radius: config.pegRadius,
          mass: 0,
          restitution: config.pegRestitution,
        }),
      );
    }
  }

  const slotWidth = config.width / config.slotCount;
  const slots: Slot[] = [];
  for (let i = 0; i < config.slotCount; i++) {
    slots.push({ index: i, minX: i * slotWidth, maxX: (i + 1) * slotWidth });
  }

  const segments: Segment[] = [];

  // Outer walls, running the full height.
  segments.push({ x1: 0, y1: 0, x2: 0, y2: config.height });
  segments.push({ x1: config.width, y1: 0, x2: config.width, y2: config.height });

  // Slot dividers. The outer two are already covered by the walls above, so only
  // the interior boundaries need one.
  for (let i = 1; i < config.slotCount; i++) {
    const x = i * slotWidth;
    segments.push({ x1: x, y1: config.slotTopY, x2: x, y2: config.height });
  }

  // Floor.
  segments.push({ x1: 0, y1: config.height, x2: config.width, y2: config.height });

  return { config, pegs, segments, slots };
}

/** Returns the slot index containing `x`, clamped to the board. */
export function slotForX(board: Board, x: number): number {
  const slotWidth = board.config.width / board.config.slotCount;
  let index = Math.floor(x / slotWidth);
  if (index < 0) index = 0;
  if (index > board.config.slotCount - 1) index = board.config.slotCount - 1;
  return index;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- board`
Expected: PASS, 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/plinko/
git commit -m "feat(sim): add Plinko board geometry generation"
```

---

## Task 10: The Plinko simulation

**Files:**
- Create: `src/sim/plinko/plinko.ts`
- Test: `src/sim/plinko/plinko.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/plinko/plinko.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD } from './board';
import { DEFAULT_PLINKO, runPlinko, createPlinkoRun, advance } from './plinko';

const config = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };

describe('runPlinko', () => {
  it('lands every ball in a slot', () => {
    const result = runPlinko({ ...config, seed: 4242, ballCount: 10 });
    expect(result.landings.length).toBe(10);
    for (const landing of result.landings) {
      expect(landing.slot).toBeGreaterThanOrEqual(0);
      expect(landing.slot).toBeLessThan(DEFAULT_BOARD.slotCount);
    }
  });

  it('preserves ball identity in landing order', () => {
    const result = runPlinko({ ...config, seed: 77, ballCount: 10 });
    const ids = result.landings.map((l) => l.ballIndex).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('terminates well before the tick limit', () => {
    const result = runPlinko({ ...config, seed: 5, ballCount: 10 });
    expect(result.settled).toBe(true);
    expect(result.ticks).toBeLessThan(config.maxTicks);
  });

  it('produces identical results for the same seed', () => {
    const a = runPlinko({ ...config, seed: 31337, ballCount: 10 });
    const b = runPlinko({ ...config, seed: 31337, ballCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.landings).toEqual(b.landings);
  });

  it('produces different results for different seeds', () => {
    const a = runPlinko({ ...config, seed: 1, ballCount: 10 });
    const b = runPlinko({ ...config, seed: 2, ballCount: 10 });
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('handles a single ball', () => {
    expect(runPlinko({ ...config, seed: 9, ballCount: 1 }).landings.length).toBe(1);
  });

  it('handles twelve balls', () => {
    expect(runPlinko({ ...config, seed: 9, ballCount: 12 }).landings.length).toBe(12);
  });

  it('never produces a NaN position', () => {
    const run = createPlinkoRun({ ...config, seed: 808, ballCount: 10 });
    while (!run.done) {
      advance(run);
      for (const ball of run.balls) {
        expect(Number.isFinite(ball.body.x)).toBe(true);
        expect(Number.isFinite(ball.body.y)).toBe(true);
      }
    }
  });
});

describe('advance', () => {
  it('reaches the same result as runPlinko when stepped manually', () => {
    const run = createPlinkoRun({ ...config, seed: 2024, ballCount: 10 });
    while (!run.done) advance(run);
    const direct = runPlinko({ ...config, seed: 2024, ballCount: 10 });
    expect(run.landings).toEqual(direct.landings);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- plinko`
Expected: FAIL, "Failed to resolve import './plinko'".

- [ ] **Step 3: Write the implementation**

Create `src/sim/plinko/plinko.ts`:

```ts
import { createBody, type Body } from '../body';
import { createRng } from '../rng';
import { createWorld, step, isSettled, type World } from '../world';
import { hashWorld } from '../checksum';
import { slotForX, buildBoard, type Board, type BoardConfig } from './board';

export interface PlinkoConfig {
  seed: number;
  board: BoardConfig;
  ballCount: number;
  ballRadius: number;
  ballRestitution: number;
  /** Fraction of board width the balls are released across. 0.2 = middle 20%. */
  releaseSpread: number;
  /** Vertical gap between successive balls at release. */
  releaseStagger: number;
  gravity: number;
  maxSpeed: number;
  drag: number;
  /** Speed below which a ball counts as stopped. */
  settleThreshold: number;
  /** Consecutive settled ticks required before the run ends. */
  settleTicks: number;
  maxTicks: number;
}

export interface Landing {
  ballIndex: number;
  slot: number;
  /** Tick at which this ball was recorded as landed. */
  tick: number;
}

export interface PlinkoBall {
  index: number;
  body: Body;
}

export interface PlinkoResult {
  seed: number;
  landings: Landing[];
  ticks: number;
  settled: boolean;
  checksum: string;
}

export interface PlinkoRun {
  config: PlinkoConfig;
  board: Board;
  world: World;
  balls: PlinkoBall[];
  landings: Landing[];
  done: boolean;
  settledFor: number;
}

/**
 * Starting values. Ball radius must stay comfortably above `maxSpeed` when added to
 * the peg radius, or a ball can pass through a peg in a single tick. See the
 * tunnelling test in `src/sim/world.test.ts`.
 */
export const DEFAULT_PLINKO: Omit<PlinkoConfig, 'board' | 'seed'> = {
  ballCount: 10,
  ballRadius: 13,
  ballRestitution: 0.34,
  releaseSpread: 0.2,
  releaseStagger: 34,
  gravity: 0.24,
  maxSpeed: 5.5,
  drag: 0.997,
  // Must sit above the residual jitter of a ball at rest. A resting ball never
  // truly reaches zero: gravity adds `gravity` each tick and the bounce returns
  // `restitution` of it, settling into a steady wobble of about
  // restitution * gravity / (1 + restitution) — roughly 0.06 at these values.
  // A threshold below that means the run never terminates.
  settleThreshold: 0.3,
  settleTicks: 30,
  maxTicks: 20000,
};

export function createPlinkoRun(config: PlinkoConfig): PlinkoRun {
  const board = buildBoard(config.board);
  const rng = createRng(config.seed);

  const world = createWorld({
    gravity: config.gravity,
    maxSpeed: config.maxSpeed,
    drag: config.drag,
    iterations: 2,
  });
  world.bodies.push(...board.pegs);
  world.segments.push(...board.segments);

  // Balls release across the middle band of the board. They cannot share a release
  // point or they would jam, so each gets its own slice of the band plus a small
  // seeded jitter. This jitter is the ONLY randomness in the whole simulation —
  // everything after it is pure deterministic physics.
  const bandWidth = config.board.width * config.releaseSpread;
  const bandLeft = (config.board.width - bandWidth) / 2;
  const slice = bandWidth / config.ballCount;

  const balls: PlinkoBall[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    const x = bandLeft + slice * (i + 0.5) + rng.range(-slice * 0.3, slice * 0.3);
    const y = -config.ballRadius - i * config.releaseStagger;
    const body = createBody({
      id: `ball-${i}`,
      x,
      y,
      radius: config.ballRadius,
      mass: 1,
      vx: rng.range(-0.15, 0.15),
      vy: 0,
      restitution: config.ballRestitution,
    });
    balls.push({ index: i, body });
    world.bodies.push(body);
  }

  return { config, board, world, balls, landings: [], done: false, settledFor: 0 };
}

/** Advances the run by one tick. Safe to call after `done` — it becomes a no-op. */
export function advance(run: PlinkoRun): void {
  if (run.done) return;

  step(run.world);

  if (isSettled(run.world, run.config.settleThreshold)) {
    run.settledFor++;
  } else {
    run.settledFor = 0;
  }

  const allInSlots = run.balls.every(
    (ball) => ball.body.y > run.config.board.slotTopY + run.config.ballRadius,
  );

  if ((run.settledFor >= run.config.settleTicks && allInSlots) ||
      run.world.tick >= run.config.maxTicks) {
    finish(run);
  }
}

function finish(run: PlinkoRun): void {
  run.landings = run.balls.map((ball) => ({
    ballIndex: ball.index,
    slot: slotForX(run.board, ball.body.x),
    tick: run.world.tick,
  }));
  run.done = true;
}

/** Runs a complete drop headlessly and returns the result. */
export function runPlinko(config: PlinkoConfig): PlinkoResult {
  const run = createPlinkoRun(config);
  while (!run.done) advance(run);

  return {
    seed: config.seed,
    landings: run.landings,
    ticks: run.world.tick,
    settled: run.world.tick < config.maxTicks,
    checksum: hashWorld(run.world),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- plinko`
Expected: PASS, 9 tests passed.

If `settled` is false or `ticks` hits `maxTicks`, the balls are not coming to rest.
Increase `drag` toward 1 is *wrong* — instead lower `ballRestitution` so they stop
bouncing sooner. Do not raise `maxSpeed` above `pegRadius + ballRadius`.

- [ ] **Step 5: Commit**

```bash
git add src/sim/plinko/plinko.ts src/sim/plinko/plinko.test.ts
git commit -m "feat(sim): add deterministic Plinko simulation"
```

---

## Task 11: The determinism test suite

This is the test that protects the entire project. It must never be weakened or skipped.

**Files:**
- Create: `tests/determinism.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/determinism.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../src/sim/plinko/plinko';

const base = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };

describe('deterministic replay', () => {
  it('produces byte-identical results across 25 replays of the same seed', () => {
    const first = runPlinko({ ...base, seed: 987654 });
    for (let i = 0; i < 25; i++) {
      const replay = runPlinko({ ...base, seed: 987654 });
      expect(replay.checksum).toBe(first.checksum);
      expect(replay.ticks).toBe(first.ticks);
      expect(replay.landings).toEqual(first.landings);
    }
  });

  it('is unaffected by other simulations running in between', () => {
    const first = runPlinko({ ...base, seed: 555 });
    runPlinko({ ...base, seed: 111 });
    runPlinko({ ...base, seed: 222 });
    const again = runPlinko({ ...base, seed: 555 });
    expect(again.checksum).toBe(first.checksum);
  });

  it('gives every seed in a sample a distinct checksum', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      seen.add(runPlinko({ ...base, seed }).checksum);
    }
    expect(seen.size).toBe(200);
  });

  it('always settles within the tick limit across 200 seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(runPlinko({ ...base, seed }).settled).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- determinism`
Expected: PASS, 4 tests passed.

If the third test fails because two seeds collide, that is acceptable only if the
*landings* differ — a 32-bit hash has a small birthday-collision chance. Investigate
before relaxing it; a genuine collision at 200 samples is very unlikely.

- [ ] **Step 3: Commit**

```bash
git add tests/determinism.test.ts
git commit -m "test: prove Plinko replay is byte-identical across runs and seeds"
```

---

## Task 12: Distribution analysis tool

The measuring instrument for Phase 5 tuning. Answers "how rare is a jackpot, really?"

**Files:**
- Create: `tools/distribution.ts`

- [ ] **Step 1: Write the tool**

Create `tools/distribution.ts`:

```ts
/**
 * Reports the measured slot distribution of the Plinko board.
 *
 * Usage: npm run distribution -- [runs]
 *
 * This is how board tuning decisions get made. Do not guess at row counts or
 * spacing — change the config, run this, and read the numbers.
 */
import { DEFAULT_BOARD } from '../src/sim/plinko/board';
import { DEFAULT_PLINKO, runPlinko } from '../src/sim/plinko/plinko';

const runs = Number(process.argv[2] ?? 2000);
const config = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };
const counts = new Array<number>(DEFAULT_BOARD.slotCount).fill(0);

let totalBalls = 0;
let unsettled = 0;
const started = Date.now();

for (let seed = 1; seed <= runs; seed++) {
  const result = runPlinko({ ...config, seed });
  if (!result.settled) unsettled++;
  for (const landing of result.landings) {
    counts[landing.slot]!++;
    totalBalls++;
  }
}

const elapsed = (Date.now() - started) / 1000;

console.log(`\n  ${runs} drops, ${totalBalls} balls, ${elapsed.toFixed(1)}s\n`);

const peak = Math.max(...counts);
counts.forEach((count, index) => {
  const pct = (count / totalBalls) * 100;
  const bar = '#'.repeat(Math.round((count / peak) * 46));
  const label = String(index).padStart(2);
  console.log(`  slot ${label}  ${pct.toFixed(2).padStart(6)}%  ${bar}`);
});

console.log(`\n  rarest slot: ${(Math.min(...counts) / totalBalls * 100).toFixed(3)}%`);
if (unsettled > 0) {
  console.log(`  WARNING: ${unsettled} run(s) hit the tick limit without settling`);
}
console.log('');
```

- [ ] **Step 2: Run the tool**

Run: `npm run distribution -- 500`

Expected: a bell-shaped histogram, highest in the middle slots and lowest at slots 0
and 8, printing in under a minute with no unsettled warning.

**Target for the rarest slot: between 0.2% and 1.5% per ball.** That band matters. A
full Bot Forge is 7 boards × 10 balls = 70 drops, so 0.2% per ball means roughly a
1-in-8 chance that *somebody* hits a jackpot during the ceremony — rare enough to feel
special, common enough that it actually happens. Below 0.05%, jackpots are decoration
nobody will ever see; above 3%, they stop feeling rare.

If the measured value is outside that band, adjust and re-measure. The levers, in order
of how much they move the number:

| Symptom | Fix |
|---|---|
| Outer slots read 0.00% — distribution too narrow | Increase `pegSpacingX`, or reduce `width`. Both widen the spread relative to the board. |
| Outer slots too common — distribution too flat | Reduce `pegSpacingX`, or increase `width`. |
| Curve is lopsided rather than symmetric | A peg row is running off one edge. Check that `pegTopY + rows * pegSpacingY` stays above `slotTopY` and that row offsets keep pegs inside `width`. |

Do not change `rows` to chase this number without also re-checking that the last peg row
still clears `slotTopY`. Re-run `npm test -- board` after any geometry change.

- [ ] **Step 3: Record the baseline in the spec**

Append the measured rarest-slot percentage to the Phase 5 line in
`docs/superpowers/specs/2026-08-03-quest-draft-selector-design.md` section 14, replacing:

```markdown
- Plinko row count and final odds distribution — Phase 5, tuned empirically.
```

with (substituting the number you actually measured):

```markdown
- Plinko row count and final odds distribution — Phase 5, tuned empirically.
  Baseline at 12 rows / 9 slots: rarest slot measured at X.XXX% per ball.
```

- [ ] **Step 4: Commit**

```bash
git add tools/distribution.ts docs/superpowers/specs/
git commit -m "feat(tools): add Plinko slot distribution harness and record baseline"
```

---

## Task 13: PixiJS renderer

First code in the render layer. It reads sim state and draws it — no rules, no decisions.
Placeholder art only; real visuals are Phase 7.

**Files:**
- Create: `src/render/plinko-renderer.ts`

- [ ] **Step 1: Write the renderer**

Create `src/render/plinko-renderer.ts`:

```ts
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { PlinkoRun } from '../sim/plinko/plinko';

/** Placeholder member colours. Replaced with real league colours in Phase 10. */
const BALL_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

export interface PlinkoRenderer {
  /** Draws the current state of the run. Call once per animation frame. */
  draw(run: PlinkoRun): void;
  destroy(): void;
}

export async function createPlinkoRenderer(
  parent: HTMLElement,
  run: PlinkoRun,
  highlightBallIndex: number | null,
): Promise<PlinkoRenderer> {
  const { width, height } = run.config.board;

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

  // Static geometry is drawn once — pegs and dividers never move.
  const statics = new Graphics();
  for (const peg of run.board.pegs) {
    statics.circle(peg.x, peg.y, peg.radius).fill(0x35424f);
  }
  for (const seg of run.board.segments) {
    statics.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 2, color: 0x2a3542 });
  }
  for (const slot of run.board.slots) {
    statics
      .rect(slot.minX + 2, run.config.board.slotTopY, slot.maxX - slot.minX - 4, 4)
      .fill(0x1d2836);
  }
  app.stage.addChild(statics);

  const dynamic = new Graphics();
  app.stage.addChild(dynamic);

  const labels = new Container();
  app.stage.addChild(labels);
  const labelTexts = run.balls.map((ball) => {
    const text = new Text({
      text: String(ball.index + 1),
      style: { fontSize: 13, fill: 0x0b0f16, fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const draw = (current: PlinkoRun): void => {
    dynamic.clear();

    for (const ball of current.balls) {
      const color = BALL_COLORS[ball.index % BALL_COLORS.length]!;
      const isHighlighted = ball.index === highlightBallIndex;

      if (isHighlighted) {
        dynamic.circle(ball.body.x, ball.body.y, ball.body.radius + 7).fill({
          color: 0xffffff,
          alpha: 0.18,
        });
      }

      dynamic.circle(ball.body.x, ball.body.y, ball.body.radius).fill(color);
      dynamic
        .circle(ball.body.x, ball.body.y, ball.body.radius)
        .stroke({ width: isHighlighted ? 3 : 1.5, color: 0xffffff, alpha: isHighlighted ? 0.9 : 0.25 });

      const label = labelTexts[ball.index]!;
      label.x = ball.body.x;
      label.y = ball.body.y;
    }
  };

  draw(run);

  return {
    draw,
    destroy: () => app.destroy(true, { children: true }),
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/render/plinko-renderer.ts
git commit -m "feat(render): add PixiJS Plinko renderer with highlight support"
```

---

## Task 14: Shell page

Wires everything together into something you can actually watch.

**Files:**
- Create: `src/shell/main.ts`

- [ ] **Step 1: Write the shell**

Create `src/shell/main.ts`:

```ts
import { DEFAULT_BOARD } from '../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun } from '../sim/plinko/plinko';
import { createPlinkoRenderer, type PlinkoRenderer } from '../render/plinko-renderer';

const app = document.getElementById('app')!;

const controls = document.createElement('div');
controls.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:12px';
controls.innerHTML = `
  <label>Seed <input id="seed" type="number" value="4242" style="width:110px"></label>
  <button id="run">Run</button>
  <button id="random">Random seed</button>
  <span id="status" style="color:#5d6b81"></span>
`;

const stage = document.createElement('div');
const wrapper = document.createElement('div');
wrapper.append(controls, stage);
app.appendChild(wrapper);

const seedInput = controls.querySelector<HTMLInputElement>('#seed')!;
const status = controls.querySelector<HTMLSpanElement>('#status')!;

let renderer: PlinkoRenderer | null = null;
let frame = 0;

async function start(seed: number): Promise<void> {
  cancelAnimationFrame(frame);
  renderer?.destroy();
  stage.innerHTML = '';

  const run = createPlinkoRun({ ...DEFAULT_PLINKO, board: DEFAULT_BOARD, seed });
  // Ball 0 stands in for "the member watching" until real league data exists.
  renderer = await createPlinkoRenderer(stage, run, 0);

  const loop = (): void => {
    // The sim runs at a fixed rate regardless of display refresh. Two ticks per
    // frame is a playback speed choice and has no effect on the outcome.
    for (let i = 0; i < 2 && !run.done; i++) advance(run);

    renderer!.draw(run);
    status.textContent = run.done
      ? `settled at tick ${run.world.tick} — slots: ${run.landings.map((l) => l.slot).join(', ')}`
      : `tick ${run.world.tick}`;

    if (!run.done) frame = requestAnimationFrame(loop);
  };

  loop();
}

controls.querySelector('#run')!.addEventListener('click', () => {
  void start(Number(seedInput.value));
});

controls.querySelector('#random')!.addEventListener('click', () => {
  // Deliberately uses Math.random: choosing WHICH seed to watch is a shell-layer
  // decision, not part of the simulation. The sim itself never sees it.
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  void start(Number(seedInput.value));
});

void start(Number(seedInput.value));
```

- [ ] **Step 2: Verify the full build**

Run: `npm run build`
Expected: type check passes and Vite builds without errors.

- [ ] **Step 3: Run it and watch**

Run: `npm run dev`

Open the printed URL. Expected: ten numbered balls drop through the peg grid, collide
with each other, and settle into slots. Ball 1 has a white halo. The status line reports
the settled tick and the slot each ball landed in.

Enter the same seed twice and confirm the reported slots are identical both times.

- [ ] **Step 4: Run the whole suite and lint**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shell/main.ts
git commit -m "feat(shell): add Bot Forge viewer page with seed control"
```

---

## Definition of done

- [ ] `npm test` passes, including the determinism suite
- [ ] `npm run lint` passes with the sim guard rules active
- [ ] `npx tsc --noEmit` reports no errors
- [ ] `npm run dev` shows ten balls dropping and settling into slots
- [ ] The same seed produces the same slots, every time, on every reload
- [ ] `npm run distribution -- 500` prints a bell curve with no unsettled warnings

## What this does not include

Deliberately deferred, in the phase noted in the spec:

- The seven bot categories and their options (Phase 4) — this plan drops balls into
  numbered slots, not into named parts
- Running seven boards back to back to build a whole bot (Phase 4)
- The pity system from spec section 8.1 (Phase 5)
- Real visuals, lighting, particles, and bot assembly animation (Phase 7)
- Sound (Phase 8)
- Member selection and the viewing website (Phase 10)
