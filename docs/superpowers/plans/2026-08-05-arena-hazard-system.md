# Arena Hazard System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hazard system built from five primitives, shipping twelve hazard presets, where adding a thirteenth is a row in a data table rather than new code.

**Architecture:** Five primitives — **Surface**, **Zone**, **Hole**, **Emitter/Projectile**, **Button** — plus three **activation modes** (always, cycle, triggered) that apply to anything activatable. A button is not a hazard; it is an answer to "when is this active?", which is why one button can drive a flame jet, a cannon, or a hidden pit without any of them knowing what a button is.

**Tech Stack:** TypeScript, Vitest, PixiJS. Existing sim: `trig`, `arena/{tiles,arena,bot,combat,steering,perception,personality,ai,collapse,match}`.

**Scope:** Phase 3, step 6. The Arena Builder that lets the admin place all of this is a separate plan that follows.

**Supersedes:** `2026-08-04-arena-hazards.md`, which hand-rolled four hazards. That approach does not scale to twelve.

---

## Background for the implementer

Read `docs/superpowers/specs/2026-08-04-arena-greybox-design.md` §5.3.

**Why a system rather than four hazards.** The arena will eventually carry a dozen or more
hazard types, all placed by an admin in a visual builder who can also invent new ones by
adjusting parameters. Hand-rolling each type means a dozen code paths to maintain, test,
and render. Parameterised primitives mean one code path each and a data table on top.

**Two things this unlocks beyond flavour.** `grip` and `mass` currently do nothing — ice
is what makes Tank Tracks differ from Omni Wheels when the bot categories arrive, and tar
is what makes a heavy build a real trade-off. And tar, conveyors and air blasters are
*anti-retreat* geometry, aimed at a measured problem: survival personalities take ~60% of
wins because every bot has the same top speed, so a fleeing bot cannot be caught.

**Determinism contract, lint-enforced on `src/sim/`.** Banned: `Math.sin/cos/tan/asin/acos/
atan/atan2/pow/hypot/log/exp/cbrt/random`, the `**` operator, `Date`, `performance`,
`document`, imports from `../render` or `../shell`. Permitted: `+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.floor`, `Math.round`, `Math.abs`, `Math.min`, `Math.max`, `Math.imul`.
Test files are exempt. **Every cycle and cooldown is driven by `world.tick`, never a clock.**

**Two constraints that have already bitten this project:**

1. **The speed clamp runs after surface modifiers, never before.** A body that ends a tick
   travelling further than the smallest thing it can collide with passes through it.
2. **Projectiles need swept collision.** A cannonball at 20 units/tick against a 20-unit
   bot radius can start in front of a bot and end behind it, having "missed". Test the
   *segment* travelled this tick against each bot, not the endpoint. Build this in from
   the start; it cannot be retrofitted safely.

**Existing API:**

- `src/sim/arena/tiles.ts` — `TileState`, `TileGrid` (`cols`, `rows`, `tileSize`, `width`,
  `height`, `tiles`), `tileIndexAt(grid, x, y)` (−1 off-grid), `setTileState`, `isOverHole`
- `src/sim/arena/arena.ts` — `ArenaConfig`, `Arena` (`config`, `grid`, `segments`),
  `buildArena`, `DEFAULT_ARENA`
- `src/sim/arena/bot.ts` — `Bot` (`body`, `heading`, `health`, `alive`, …), `DEFAULT_BOT`,
  `applyGrip(bot)`, `applyThrust`
- `src/sim/arena/steering.ts` — `driveToward(bot, dx, dy, throttleCap)`
- `src/sim/arena/perception.ts` — `perceive(match, self)` → `BotView` with `avoidX`/`avoidY`
- `src/sim/arena/match.ts` — `Match` (`arena`, `world`, `bots`, `aiStates`, `rng`,
  `collapseOrder`, `eliminations`, `done`), `advanceMatch`, `createMatch`
- `src/sim/trig.ts` — `ANGLE_STEPS` (4096), `cosOf`, `sinOf`

**Commands.** `npm test -- <filter>` (never bare `npm test`, ~3 min), `npm run lint`,
`npx tsc --noEmit`, `npm run arena -- 80`. **Never run `npm run dev`. Never run anything
in the background.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/sim/arena/activation.ts` | Activation modes and buttons. The shared "is it on?" question. |
| `src/sim/arena/surface.ts` | Floor surfaces: drag, grip, and constant push. |
| `src/sim/arena/zone.ts` | Positioned damage/impulse volumes, circular or directed. |
| `src/sim/arena/projectile.ts` | Emitters and in-flight projectiles, with swept collision. |
| `src/sim/arena/hazards.ts` | The twelve presets, as data. |
| `src/sim/arena/arena.ts` | Extended config; assembles all of the above. |
| `src/sim/arena/match.ts` | Runs buttons, surfaces, zones and projectiles each tick. |
| `src/sim/arena/perception.ts` | Active hazards register as danger. |
| `src/render/arena-renderer.ts` | Draws everything. |

---

## Task 1: Activation and buttons

The shared timing primitive. Everything else depends on it.

**Files:**
- Create: `src/sim/arena/activation.ts`
- Test: `src/sim/arena/activation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import {
  Activation,
  always,
  cycle,
  triggered,
  createButton,
  updateButtons,
  isActive,
} from './activation';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });
const buttonsOf = (...list: ReturnType<typeof createButton>[]) =>
  new Map(list.map((b) => [b.id, b]));

describe('always', () => {
  it('is on at every tick', () => {
    const b = new Map();
    expect(isActive(always(), 0, b)).toBe(true);
    expect(isActive(always(), 99999, b)).toBe(true);
  });
});

describe('cycle', () => {
  const spec = cycle(120, 60);
  const b = new Map();

  it('is on for the first part of each period', () => {
    expect(isActive(spec, 0, b)).toBe(true);
    expect(isActive(spec, 59, b)).toBe(true);
    expect(isActive(spec, 60, b)).toBe(false);
    expect(isActive(spec, 119, b)).toBe(false);
  });

  it('repeats identically forever', () => {
    for (let t = 0; t < 400; t++) {
      expect(isActive(spec, t, b)).toBe(isActive(spec, t + 120, b));
    }
  });
});

describe('buttons — while-pressed', () => {
  it('is off with nobody standing on it', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(false);
  });

  it('turns on while a bot stands on it', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);
  });

  it('turns off again the moment the bot leaves', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    updateButtons(buttons, [bot(900, 900)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(false);
  });

  it('ignores eliminated bots', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    const dead = bot(105, 100);
    dead.alive = false;
    updateButtons(buttons, [dead], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(false);
  });

  it('accounts for the bot radius, not just its centre', () => {
    // Button radius 30, bot radius 20, so centres 49 apart still overlap.
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(149, 100)], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);
    updateButtons(buttons, [bot(151, 100)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(false);
  });
});

describe('buttons — latching', () => {
  it('stays on for the latch duration after a single press', () => {
    const btn = createButton('a', 100, 100, 30, 90, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    updateButtons(buttons, [bot(900, 900)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(true);
    expect(isActive(triggered('a'), 89, buttons)).toBe(true);
    expect(isActive(triggered('a'), 90, buttons)).toBe(false);
  });
});

describe('buttons — cooldown', () => {
  it('refuses to re-arm until the cooldown has expired', () => {
    // Latch 30, cooldown 200. A bot parked on the plate must not machine-gun it.
    const btn = createButton('a', 100, 100, 30, 30, 200);
    const buttons = buttonsOf(btn);
    const parked = [bot(105, 100)];

    updateButtons(buttons, parked, 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);

    for (let t = 1; t <= 150; t++) updateButtons(buttons, parked, t);
    // Latch expired at 30 and the cooldown blocks re-arming until 200.
    expect(isActive(triggered('a'), 150, buttons)).toBe(false);

    for (let t = 151; t <= 205; t++) updateButtons(buttons, parked, t);
    expect(isActive(triggered('a'), 205, buttons)).toBe(true);
  });
});

describe('isActive', () => {
  it('is off when a triggered spec names a button that does not exist', () => {
    expect(isActive(triggered('missing'), 0, new Map())).toBe(false);
  });

  it('lets one button drive several hazards', () => {
    const btn = createButton('shared', 100, 100, 30, 60, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    expect(isActive(triggered('shared'), 5, buttons)).toBe(true);
    expect(isActive(triggered('shared'), 5, buttons)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- activation` → FAIL, cannot resolve import.

- [ ] **Step 3: Implement**

```ts
import type { Bot } from './bot';

/**
 * When is a hazard dangerous?
 *
 * This is deliberately separate from what a hazard DOES. A button is not a kind of
 * hazard; it is an answer to this question, which is why one button can drive a flame
 * jet, a cannon and a hidden pit without any of them knowing buttons exist.
 */
export const Activation = {
  Always: 0,
  Cycle: 1,
  Triggered: 2,
} as const;

export type ActivationMode = (typeof Activation)[keyof typeof Activation];

export interface ActivationSpec {
  mode: ActivationMode;
  /** Cycle: full period in ticks. */
  period: number;
  /** Cycle: ticks at the start of each period during which it is on. */
  activeTicks: number;
  /** Triggered: which button arms it. */
  buttonId: string;
}

export function always(): ActivationSpec {
  return { mode: Activation.Always, period: 0, activeTicks: 0, buttonId: '' };
}

export function cycle(period: number, activeTicks: number): ActivationSpec {
  return { mode: Activation.Cycle, period, activeTicks, buttonId: '' };
}

export function triggered(buttonId: string): ActivationSpec {
  return { mode: Activation.Triggered, period: 0, activeTicks: 0, buttonId };
}

/**
 * A floor plate.
 *
 * Latch and cooldown live on the BUTTON rather than on each hazard, so several hazards
 * wired to one plate all fire together and share its rhythm. A cooldown is what stops a
 * bot parked on a plate from machine-gunning whatever it is wired to.
 */
export interface Button {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** 0 means active only while pressed. Above 0, stays armed this many ticks per press. */
  latchTicks: number;
  /** Minimum ticks between arming events. */
  cooldown: number;
  /** Runtime: is a living bot on it right now. */
  pressed: boolean;
  /** Runtime: tick at which the current latch expires. */
  armedUntil: number;
  /** Runtime: earliest tick this may arm again. */
  nextArmTick: number;
}

export function createButton(
  id: string,
  x: number,
  y: number,
  radius: number,
  latchTicks: number,
  cooldown: number,
): Button {
  return {
    id,
    x,
    y,
    radius,
    latchTicks,
    cooldown,
    pressed: false,
    armedUntil: 0,
    nextArmTick: 0,
  };
}

/** Recomputes every button's pressed and armed state for this tick. */
export function updateButtons(
  buttons: Map<string, Button>,
  bots: readonly Bot[],
  tick: number,
): void {
  for (const button of buttons.values()) {
    let pressed = false;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = bot.body.x - button.x;
      const dy = bot.body.y - button.y;
      const limit = button.radius + bot.body.radius;
      if (dx * dx + dy * dy <= limit * limit) {
        pressed = true;
        break;
      }
    }
    button.pressed = pressed;

    if (button.latchTicks > 0 && pressed && tick >= button.nextArmTick) {
      button.armedUntil = tick + button.latchTicks;
      button.nextArmTick = tick + button.cooldown;
    }
  }
}

export function isActive(
  spec: ActivationSpec,
  tick: number,
  buttons: Map<string, Button>,
): boolean {
  if (spec.mode === Activation.Always) return true;
  if (spec.mode === Activation.Cycle) {
    if (spec.period <= 0) return true;
    return tick % spec.period < spec.activeTicks;
  }
  const button = buttons.get(spec.buttonId);
  if (button === undefined) return false;
  if (button.latchTicks === 0) return button.pressed;
  return tick < button.armedUntil;
}
```

- [ ] **Step 4: Confirm it passes**

Run: `npm test -- activation` → PASS. Report the real `it()` count.

- [ ] **Step 5: Commit**

```bash
git add src/sim/arena/activation.ts src/sim/arena/activation.test.ts
git commit -m "feat(sim): add activation modes and floor-plate buttons"
```

---

## Task 2: Floor surfaces

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
    const s = createSurfaceMap(grid());
    expect(s.length).toBe(12);
    for (const v of s) expect(v).toBe(Surface.Plain);
  });
});

describe('surfaceAt', () => {
  it('round-trips a surface', () => {
    const g = grid();
    const s = createSurfaceMap(g);
    setSurface(s, 5, Surface.Ice);
    expect(surfaceAt(g, s, 70, 70)).toBe(Surface.Ice);
  });

  it('reports plain off the grid — there is no floor to be made of', () => {
    const g = grid();
    expect(surfaceAt(g, createSurfaceMap(g), -10, -10)).toBe(Surface.Plain);
  });
});

describe('effectOf', () => {
  it('leaves plain floor completely neutral', () => {
    expect(effectOf(Surface.Plain)).toEqual({ drag: 1, grip: 1, pushX: 0, pushY: 0 });
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

  it('makes gravel the inverse of ice — grippier, slightly slower', () => {
    const gravel = effectOf(Surface.Gravel);
    expect(gravel.grip).toBeGreaterThan(1);
    expect(gravel.drag).toBeLessThan(1);
  });

  it('gives conveyors a push and nothing else', () => {
    for (const s of [Surface.ConveyorN, Surface.ConveyorS, Surface.ConveyorE, Surface.ConveyorW]) {
      const e = effectOf(s);
      expect(Math.abs(e.pushX) + Math.abs(e.pushY)).toBeGreaterThan(0);
      expect(e.drag).toBe(1);
    }
  });

  it('points the four conveyors in opposite pairs', () => {
    expect(effectOf(Surface.ConveyorN).pushY).toBeLessThan(0);
    expect(effectOf(Surface.ConveyorS).pushY).toBeGreaterThan(0);
    expect(effectOf(Surface.ConveyorE).pushX).toBeGreaterThan(0);
    expect(effectOf(Surface.ConveyorW).pushX).toBeLessThan(0);
  });

  it('never returns a zero or negative multiplier', () => {
    for (const s of Object.values(Surface)) {
      expect(effectOf(s).drag).toBeGreaterThan(0);
      expect(effectOf(s).grip).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- surface` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { tileIndexAt, type TileGrid } from './tiles';

/**
 * What the floor of a tile is made of.
 *
 * Surfaces are a property of the FLOOR, which is why they live on the tile grid rather
 * than being objects like saws. They change how a bot MOVES; they never damage it.
 */
export const Surface = {
  Plain: 0,
  Tar: 1,
  Ice: 2,
  Gravel: 3,
  ConveyorN: 4,
  ConveyorS: 5,
  ConveyorE: 6,
  ConveyorW: 7,
} as const;

export type SurfaceValue = (typeof Surface)[keyof typeof Surface];

export interface SurfaceEffect {
  /** Multiplies velocity each tick. Below 1 slows the bot. */
  drag: number;
  /** Scales how much sideways velocity grip removes. Below 1 slides, above 1 bites. */
  grip: number;
  /** Constant acceleration applied while on this tile. */
  pushX: number;
  pushY: number;
}

const CONVEYOR_PUSH = 0.16;

const EFFECTS: Record<SurfaceValue, SurfaceEffect> = {
  [Surface.Plain]: { drag: 1, grip: 1, pushX: 0, pushY: 0 },
  // Tar is the anti-retreat surface. Every bot has the same top speed, so a fleeing bot
  // normally cannot be caught; tar is where that stops being true.
  [Surface.Tar]: { drag: 0.9, grip: 1, pushX: 0, pushY: 0 },
  // Ice is what gives the `grip` stat consequences, and therefore what will make Tank
  // Tracks meaningfully different from Omni Wheels.
  [Surface.Ice]: { drag: 1, grip: 0.12, pushX: 0, pushY: 0 },
  // Gravel is the inverse of ice: it costs a little speed and rewards you with grip, so
  // a heavy high-traction build gains an advantage somewhere rather than only losing.
  [Surface.Gravel]: { drag: 0.96, grip: 1.9, pushX: 0, pushY: 0 },
  // Conveyors are positional, not damaging. Point one at a pit and it becomes a trap.
  [Surface.ConveyorN]: { drag: 1, grip: 1, pushX: 0, pushY: -CONVEYOR_PUSH },
  [Surface.ConveyorS]: { drag: 1, grip: 1, pushX: 0, pushY: CONVEYOR_PUSH },
  [Surface.ConveyorE]: { drag: 1, grip: 1, pushX: CONVEYOR_PUSH, pushY: 0 },
  [Surface.ConveyorW]: { drag: 1, grip: 1, pushX: -CONVEYOR_PUSH, pushY: 0 },
};

export function createSurfaceMap(grid: TileGrid): Uint8Array {
  return new Uint8Array(grid.cols * grid.rows).fill(Surface.Plain);
}

export function setSurface(surfaces: Uint8Array, index: number, surface: SurfaceValue): void {
  surfaces[index] = surface;
}

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
  return EFFECTS[surface] ?? EFFECTS[Surface.Plain];
}
```

- [ ] **Step 4: Confirm it passes and commit**

Run `npm test -- surface`, `npm run lint`, `npx tsc --noEmit`.

```bash
git add src/sim/arena/surface.ts src/sim/arena/surface.test.ts
git commit -m "feat(sim): add floor surfaces with drag, grip, and push"
```

---

## Task 3: Zones

Positioned volumes that damage and shove. Covers saws, flame jets, spike strips, crushers,
air blasters and electric panels — six presets, one implementation.

**Files:**
- Create: `src/sim/arena/zone.ts`
- Test: `src/sim/arena/zone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { always, cycle } from './activation';
import { ZoneShape, createZone, zoneHits, applyZone } from './zone';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });
const noButtons = new Map();

const circle = (damage = 0.5, knockback = 0.9) =>
  createZone({
    id: 'z',
    shape: ZoneShape.Circle,
    x: 100,
    y: 100,
    heading: 0,
    reach: 25,
    halfWidth: 0,
    damagePerTick: damage,
    knockback,
    activation: always(),
  });

const cone = () =>
  createZone({
    id: 'z',
    shape: ZoneShape.Cone,
    x: 100,
    y: 100,
    heading: 0, // +x
    reach: 80,
    halfWidth: 26,
    damagePerTick: 0.4,
    knockback: 0.25,
    activation: cycle(120, 60),
  });

describe('zoneHits — circle', () => {
  it('hits a bot inside the radius', () => {
    expect(zoneHits(circle(), bot(110, 100))).toBe(true);
  });

  it('misses a bot outside it', () => {
    expect(zoneHits(circle(), bot(300, 100))).toBe(false);
  });

  it('accounts for the bot radius, not just its centre', () => {
    // Zone reach 25, bot radius 20, so centres 44 apart still overlap.
    expect(zoneHits(circle(), bot(144, 100))).toBe(true);
    expect(zoneHits(circle(), bot(146, 100))).toBe(false);
  });
});

describe('zoneHits — cone', () => {
  it('reaches along its heading', () => {
    expect(zoneHits(cone(), bot(150, 100))).toBe(true);
  });

  it('does not reach behind itself', () => {
    expect(zoneHits(cone(), bot(50, 100))).toBe(false);
  });

  it('is narrow across its axis', () => {
    expect(zoneHits(cone(), bot(150, 220))).toBe(false);
  });

  it('stops at its reach', () => {
    expect(zoneHits(cone(), bot(210, 100))).toBe(false);
  });
});

describe('applyZone', () => {
  it('damages a bot in an active zone', () => {
    const b = bot(110, 100);
    applyZone(circle(), b, 0, noButtons);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('shoves the bot away from the zone', () => {
    const b = bot(120, 100);
    applyZone(circle(), b, 0, noButtons);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('does nothing while the zone is off', () => {
    const b = bot(150, 100);
    applyZone(cone(), b, 70, noButtons); // off phase of a 120/60 cycle
    expect(b.health).toBe(b.maxHealth);
  });

  it('does nothing to an eliminated bot', () => {
    const b = bot(110, 100);
    b.alive = false;
    applyZone(circle(), b, 0, noButtons);
    expect(b.health).toBe(b.maxHealth);
  });

  it('can shove without damaging — the air blaster case', () => {
    const blaster = circle(0, 2.5);
    const b = bot(120, 100);
    applyZone(blaster, b, 0, noButtons);
    expect(b.health).toBe(b.maxHealth);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('kills a bot that lingers', () => {
    const z = circle();
    const b = bot(110, 100);
    for (let t = 0; t < 600; t++) applyZone(z, b, t, noButtons);
    expect(b.health).toBe(0);
  });

  it('never takes health below zero', () => {
    const z = circle(999);
    const b = bot(110, 100);
    applyZone(z, b, 0, noButtons);
    expect(b.health).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- zone` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { cosOf, sinOf } from '../trig';
import { isActive, type ActivationSpec, type Button } from './activation';
import type { Bot } from './bot';

export const ZoneShape = {
  /** Omnidirectional, like a spinning blade or a pressure plate. */
  Circle: 0,
  /** Directed, like a flame jet or an air blast. */
  Cone: 1,
} as const;

export type ZoneShapeValue = (typeof ZoneShape)[keyof typeof ZoneShape];

/**
 * A positioned volume that hurts or shoves whatever is inside it.
 *
 * Damage and knockback are independent on purpose. A saw does both; an air blaster does
 * only knockback, which makes it a purely positional hazard whose job is to fling bots
 * into other hazards rather than to wear them down.
 */
export interface Zone {
  id: string;
  shape: ZoneShapeValue;
  x: number;
  y: number;
  /** Angle index the zone points along. Ignored by circles. */
  heading: number;
  /** Radius for a circle; length for a cone. */
  reach: number;
  /** Half-width for a cone. Ignored by circles. */
  halfWidth: number;
  damagePerTick: number;
  knockback: number;
  activation: ActivationSpec;
}

export function createZone(zone: Zone): Zone {
  return { ...zone };
}

/** Whether a bot is inside the zone's volume, accounting for its radius. */
export function zoneHits(zone: Zone, bot: Bot): boolean {
  const dx = bot.body.x - zone.x;
  const dy = bot.body.y - zone.y;

  if (zone.shape === ZoneShape.Circle) {
    const limit = zone.reach + bot.body.radius;
    return dx * dx + dy * dy <= limit * limit;
  }

  const ax = cosOf(zone.heading);
  const ay = sinOf(zone.heading);
  const along = dx * ax + dy * ay;
  if (along < 0 || along > zone.reach + bot.body.radius) return false;
  const across = dx * -ay + dy * ax;
  const width = zone.halfWidth + bot.body.radius;
  return across * across <= width * width;
}

/**
 * Applies one tick of a zone to a bot.
 *
 * The knockback matters as much as the damage: being flung is what turns a saw into a
 * positional threat rather than a slow drain, and what lets one bot shove another into it.
 */
export function applyZone(
  zone: Zone,
  bot: Bot,
  tick: number,
  buttons: Map<string, Button>,
): void {
  if (!bot.alive) return;
  if (!isActive(zone.activation, tick, buttons)) return;
  if (!zoneHits(zone, bot)) return;

  if (zone.damagePerTick > 0) {
    bot.health -= zone.damagePerTick;
    if (bot.health < 0) bot.health = 0;
  }

  if (zone.knockback === 0) return;
  const dx = bot.body.x - zone.x;
  const dy = bot.body.y - zone.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return;
  const inv = 1 / Math.sqrt(lenSq);
  bot.body.vx += dx * inv * zone.knockback;
  bot.body.vy += dy * inv * zone.knockback;
}
```

- [ ] **Step 4: Confirm it passes and commit**

```bash
git add src/sim/arena/zone.ts src/sim/arena/zone.test.ts
git commit -m "feat(sim): add damage and impulse zones"
```

---

## Task 4: Projectiles

The one genuinely new primitive. **Swept collision is mandatory** — see the constraint in
the background section.

**Files:**
- Create: `src/sim/arena/projectile.ts`
- Test: `src/sim/arena/projectile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { always, cycle } from './activation';
import {
  createEmitter,
  fireEmitters,
  stepProjectiles,
  segmentHitsCircle,
} from './projectile';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });
const noButtons = new Map();

const emitter = (activation = cycle(120, 1)) =>
  createEmitter({
    id: 'e',
    x: 0,
    y: 300,
    heading: 0, // fires along +x
    speed: 14,
    damage: 18,
    radius: 5,
    activation,
  });

describe('segmentHitsCircle', () => {
  it('detects a hit when the segment passes through the circle', () => {
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 0, 10)).toBe(true);
  });

  it('detects a miss when the segment passes wide', () => {
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 50, 10)).toBe(false);
  });

  it('detects a hit that starts before and ends after the circle', () => {
    // THE reason swept collision exists: a fast projectile can skip clean over a bot
    // between one tick and the next. Endpoint-only testing would miss this entirely.
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 0, 5)).toBe(true);
  });

  it('does not detect a circle behind the segment start', () => {
    expect(segmentHitsCircle(50, 0, 100, 0, 0, 0, 10)).toBe(false);
  });

  it('does not detect a circle beyond the segment end', () => {
    expect(segmentHitsCircle(0, 0, 50, 0, 100, 0, 10)).toBe(false);
  });
});

describe('fireEmitters', () => {
  it('spawns a projectile on the tick it becomes active', () => {
    const e = emitter();
    const shots: ReturnType<typeof fireEmitters> = [];
    fireEmitters([e], 0, noButtons, shots);
    expect(shots.length).toBe(1);
  });

  it('fires once per activation, not once per active tick', () => {
    // An always-on emitter must not empty a magazine every tick.
    const e = emitter(always());
    const shots: ReturnType<typeof fireEmitters> = [];
    for (let t = 0; t < 100; t++) fireEmitters([e], t, noButtons, shots);
    expect(shots.length).toBe(1);
  });

  it('fires again on the next rising edge', () => {
    const e = emitter(cycle(50, 10));
    const shots: ReturnType<typeof fireEmitters> = [];
    for (let t = 0; t < 120; t++) fireEmitters([e], t, noButtons, shots);
    expect(shots.length).toBe(3); // ticks 0, 50, 100
  });

  it('launches along its heading', () => {
    const e = emitter();
    const shots: ReturnType<typeof fireEmitters> = [];
    fireEmitters([e], 0, noButtons, shots);
    expect(shots[0]!.vx).toBeCloseTo(14, 6);
    expect(shots[0]!.vy).toBeCloseTo(0, 6);
  });
});

describe('stepProjectiles', () => {
  const arena = { width: 960, height: 720 };

  it('moves a projectile along its velocity', () => {
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    stepProjectiles(shots, [], arena.width, arena.height);
    expect(shots[0]!.x).toBeCloseTo(24, 6);
  });

  it('damages the first bot it passes through', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height);
    expect(target.health).toBe(target.maxHealth - 18);
  });

  it('dies on impact rather than continuing through', () => {
    const near = bot(100, 300);
    const far = bot(300, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 40; t++) stepProjectiles(shots, [near, far], arena.width, arena.height);
    expect(near.health).toBeLessThan(near.maxHealth);
    expect(far.health).toBe(far.maxHealth);
  });

  it('cannot skip over a bot however fast it travels', () => {
    // 400 units per tick against a 20-unit bot. Endpoint testing would miss every time.
    const target = bot(500, 300);
    const shots = [{ x: 10, y: 300, vx: 400, vy: 0, damage: 18, radius: 5, alive: true }];
    stepProjectiles(shots, [target], arena.width, arena.height);
    stepProjectiles(shots, [target], arena.width, arena.height);
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it('ignores eliminated bots', () => {
    const dead = bot(100, 300);
    dead.alive = false;
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [dead], arena.width, arena.height);
    expect(dead.health).toBe(dead.maxHealth);
  });

  it('expires when it leaves the arena', () => {
    const shots = [{ x: 950, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    stepProjectiles(shots, [], arena.width, arena.height);
    expect(shots[0]!.alive).toBe(false);
  });

  it('removes dead projectiles from the list', () => {
    const shots = [{ x: 950, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    stepProjectiles(shots, [], arena.width, arena.height);
    stepProjectiles(shots, [], arena.width, arena.height);
    expect(shots.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- projectile` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { cosOf, sinOf } from '../trig';
import { isActive, type ActivationSpec, type Button } from './activation';
import type { Bot } from './bot';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  alive: boolean;
}

/** A wall-mounted gun. Fires one shot per activation, not one per active tick. */
export interface Emitter {
  id: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  damage: number;
  radius: number;
  activation: ActivationSpec;
  /** Runtime: whether it was active last tick, so it fires on the rising edge only. */
  wasActive: boolean;
}

export function createEmitter(init: Omit<Emitter, 'wasActive'>): Emitter {
  return { ...init, wasActive: false };
}

/**
 * Spawns a shot from each emitter that has just become active.
 *
 * Rising edge, not level: an always-on emitter should fire once, not empty a magazine
 * every tick. That also makes a button-triggered cannon fire one shot per press.
 */
export function fireEmitters(
  emitters: Emitter[],
  tick: number,
  buttons: Map<string, Button>,
  out: Projectile[],
): Projectile[] {
  for (const emitter of emitters) {
    const active = isActive(emitter.activation, tick, buttons);
    if (active && !emitter.wasActive) {
      out.push({
        x: emitter.x,
        y: emitter.y,
        vx: cosOf(emitter.heading) * emitter.speed,
        vy: sinOf(emitter.heading) * emitter.speed,
        damage: emitter.damage,
        radius: emitter.radius,
        alive: true,
      });
    }
    emitter.wasActive = active;
  }
  return out;
}

/**
 * Whether the segment from (ax, ay) to (bx, by) passes within `radius` of (cx, cy).
 *
 * This is why projectiles need sweeping rather than endpoint tests. A cannonball moving
 * 20 units per tick against a 20-unit bot can start in front of it and end behind it,
 * having passed straight through without ever overlapping at a sampled position.
 */
export function segmentHitsCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const ex = bx - ax;
  const ey = by - ay;
  const lenSq = ex * ex + ey * ey;

  let t = lenSq === 0 ? 0 : ((cx - ax) * ex + (cy - ay) * ey) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const px = ax + ex * t - cx;
  const py = ay + ey * t - cy;
  return px * px + py * py <= radius * radius;
}

/**
 * Advances every projectile one tick, resolving hits and culling the dead.
 *
 * A projectile hits at most one bot and is destroyed by it — it does not continue
 * through. When several bots lie along the path, the nearest to the start is hit.
 */
export function stepProjectiles(
  projectiles: Projectile[],
  bots: readonly Bot[],
  arenaWidth: number,
  arenaHeight: number,
): void {
  for (const shot of projectiles) {
    if (!shot.alive) continue;

    const fromX = shot.x;
    const fromY = shot.y;
    shot.x += shot.vx;
    shot.y += shot.vy;

    let hit: Bot | null = null;
    let hitDistSq = Number.POSITIVE_INFINITY;

    for (const bot of bots) {
      if (!bot.alive) continue;
      const reach = bot.body.radius + shot.radius;
      if (!segmentHitsCircle(fromX, fromY, shot.x, shot.y, bot.body.x, bot.body.y, reach)) {
        continue;
      }
      const dx = bot.body.x - fromX;
      const dy = bot.body.y - fromY;
      const distSq = dx * dx + dy * dy;
      if (distSq < hitDistSq) {
        hitDistSq = distSq;
        hit = bot;
      }
    }

    if (hit !== null) {
      hit.health -= shot.damage;
      if (hit.health < 0) hit.health = 0;
      shot.alive = false;
      continue;
    }

    if (shot.x < 0 || shot.y < 0 || shot.x > arenaWidth || shot.y > arenaHeight) {
      shot.alive = false;
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (!projectiles[i]!.alive) projectiles.splice(i, 1);
  }
}
```

- [ ] **Step 4: Confirm it passes and commit**

Run `npm test -- projectile`, `npm run lint`, `npx tsc --noEmit`.

```bash
git add src/sim/arena/projectile.ts src/sim/arena/projectile.test.ts
git commit -m "feat(sim): add projectile emitters with swept collision"
```

---

## Task 5: The hazard preset library

Twelve named hazards, entirely as data. Adding a thirteenth is a new entry here.

**Files:**
- Create: `src/sim/arena/hazards.ts`
- Test: `src/sim/arena/hazards.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { HAZARD_NAMES, hazardPreset, HazardCategory } from './hazards';

describe('HAZARD_NAMES', () => {
  it('lists twelve presets', () => {
    expect(HAZARD_NAMES.length).toBe(12);
  });

  it('has no duplicates', () => {
    expect(new Set(HAZARD_NAMES).size).toBe(HAZARD_NAMES.length);
  });
});

describe('hazardPreset', () => {
  it('gives every preset a category and a label', () => {
    for (const name of HAZARD_NAMES) {
      const p = hazardPreset(name);
      expect(p.label.length).toBeGreaterThan(0);
      expect([HazardCategory.Surface, HazardCategory.Zone, HazardCategory.Emitter]).toContain(
        p.category,
      );
    }
  });

  it('returns a fresh copy so a placement cannot mutate the table', () => {
    const a = hazardPreset('saw');
    a.label = 'changed';
    expect(hazardPreset('saw').label).not.toBe('changed');
  });

  it('gives the air blaster knockback but no damage', () => {
    const p = hazardPreset('airBlaster');
    expect(p.zone!.damagePerTick).toBe(0);
    expect(p.zone!.knockback).toBeGreaterThan(1);
  });

  it('gives the cannon a projectile fast enough to need sweeping', () => {
    const p = hazardPreset('cannon');
    expect(p.emitter!.speed).toBeGreaterThan(10);
  });

  it('makes every damaging hazard survivable for at least a second of contact', () => {
    // A hazard that kills instantly on touch is not a hazard, it is a pit.
    for (const name of HAZARD_NAMES) {
      const p = hazardPreset(name);
      if (p.zone && p.zone.damagePerTick > 0) {
        expect(p.zone.damagePerTick * 60).toBeLessThan(100);
      }
    }
  });
});
```

- [ ] **Step 2: Implement**

Create `src/sim/arena/hazards.ts` exporting `HazardCategory`, `HAZARD_NAMES`, a
`HazardPreset` type, and `hazardPreset(name)` returning a fresh copy.

The twelve, with the category each uses:

| Name | Category | Character |
|---|---|---|
| `tar` | Surface | Slows. Anti-retreat. |
| `ice` | Surface | Slippery. Gives `grip` consequences. |
| `gravel` | Surface | Slightly slow, high grip. Rewards heavy builds. |
| `conveyor` | Surface | Constant push. Point it at a pit. |
| `saw` | Zone, circle, always | Continuous damage plus knockback. |
| `flameJet` | Zone, cone, cycle | Timed directional damage. |
| `spikeStrip` | Zone, circle, always | Damage, no knockback. A floor you must not sit on. |
| `crusher` | Zone, circle, cycle | Heavy damage and a big slam, on a slow cycle. |
| `airBlaster` | Zone, cone, cycle | **No damage**, large knockback. Purely positional. |
| `electricPanel` | Zone, circle, cycle | Damage, no knockback. Floor that periodically kills. |
| `cannon` | Emitter, cycle | Fast projectile, heavy single hit. |
| `laser` | Emitter, cycle | Faster projectile, lighter hit, shorter interval. |

Each preset carries default `activation`, geometry and damage values. Every field is
overridable per placement, because the Arena Builder exposes them as sliders — the preset
is a starting point, not a constraint.

- [ ] **Step 3: Confirm and commit**

```bash
git add src/sim/arena/hazards.ts src/sim/arena/hazards.test.ts
git commit -m "feat(sim): add the twelve hazard presets as data"
```

---

## Task 6: Wire hazards into the arena and match

**Files:** `src/sim/arena/arena.ts`, `src/sim/arena/bot.ts`, `src/sim/arena/steering.ts`,
`src/sim/arena/ai.ts`, `src/sim/arena/match.ts`, `src/sim/arena/arena.test.ts`

- [ ] **Step 1: Extend the config**

`ArenaConfig` gains `surfaces` (a list of `[col, row, SurfaceValue]`), `zones`, `emitters`,
and `buttons`. `Arena` gains the built `surfaces: Uint8Array`, `zones: Zone[]`,
`emitters: Emitter[]`, and `buttons: Map<string, Button>`.

`Match` gains `projectiles: Projectile[]`.

- [ ] **Step 2: Let surfaces affect movement**

`applyGrip(bot, gripScale = 1)` multiplies `bot.grip` by the scale. `driveToward` gains a
`gripScale = 1` parameter it forwards. `driveWithAi` looks up the surface under the bot and
passes `effectOf(surface).grip`.

- [ ] **Step 3: Run everything in `advanceMatch`, in this exact order**

```
1.  updateCollapse(match)
2.  updateButtons(match.arena.buttons, match.bots, tick)
3.  drive every living bot with the AI
4.  for each living bot: apply surface drag and push, then every zone
5.  fireEmitters(...) then stepProjectiles(...)
6.  step(match.world)          <- the speed clamp lives here
7.  contacts -> combat damage
8.  sweep for health <= 0 and for bots over holes
```

**Buttons update before the AI drives**, so a hazard armed this tick is dangerous this
tick. **Surfaces apply before `step`**, so the speed clamp in `integrate` still runs last —
a body that ends a tick moving further than the smallest collision radius passes through
it. That ordering is not a preference.

No new elimination code is needed: step 8 already exists and eliminates with cause
`'destroyed'` and `byId` null. Hazard kills correctly credit nobody, which is what lets
the metrics separate them from combat kills.

- [ ] **Step 4: Add arena tests**

Cover: every configured surface tile is stamped; no surface sits on a hole tile; every
zone, emitter and button lies within the arena bounds; every `triggered` activation names
a button that exists (a dangling reference means a hazard that never fires).

- [ ] **Step 5: Verify and commit**

`npm test -- arena`, `npm test -- match`, `npm run lint`, `npx tsc --noEmit`.

Existing determinism tests must still pass — same seed, same checksum. Absolute checksums
change, which is expected.

```bash
git add src/sim/arena/
git commit -m "feat(sim): wire surfaces, zones, projectiles and buttons into matches"
```

---

## Task 7: Make the AI see hazards

Bots steer around holes already. Without this they will drive into saws exactly as they
once drove into pits.

**Files:** `src/sim/arena/perception.ts` and its test

- [ ] **Step 1: Extend `perceive`**

Add repulsion from every **currently active** zone the bot is near, and from every
emitter whose **line of fire** the bot is standing in, weighted by inverse-square distance
as holes are.

A zone that is **not currently active produces no repulsion**. That is what makes a flame
jet a timing hazard rather than a wall, and it is the whole reason flame jets are
interesting — a cornered bot gets a gamble worth taking.

- [ ] **Step 2: Test**

Cover: repulsion from an active saw; none from a flame in its off phase; more repulsion
during the on phase than the off phase; no repulsion from a button-triggered zone whose
button is unpressed.

- [ ] **Step 3: Verify and commit**

```bash
git add src/sim/arena/perception.ts src/sim/arena/perception.test.ts
git commit -m "feat(sim): make bots steer around active hazards"
```

---

## Task 8: Render and measure

**Files:** `src/render/arena-renderer.ts`, `tools/arena-metrics.ts`

- [ ] **Step 1: Draw everything**

Surfaces tinted per type and distinct from `WARNING` tiles. Zones drawn only while active,
so pulsing is visible. Saws rotating — **using `match.world.tick`, never wall-clock time**,
or replays will not look identical. Buttons as floor plates that light when pressed.
Projectiles as small bright dots.

The renderer may import the hazard geometry types and `isActive`; those are geometry, not
AI. It must not import the AI or personality modules.

- [ ] **Step 2: Split hazard deaths from combat deaths in the metrics**

Hazard kills are recorded as `destroyed` with a null `byId`, which currently conflates them
with combat and **overstates the combat figure**. Report combat, hazard, and fall
separately.

- [ ] **Step 3: Verify the build**

`npx tsc --noEmit`, `npm run lint`, `npm run build`. Do not run `npm run dev`.

- [ ] **Step 4: Measure and report**

Run `npm run arena -- 80` and report the output verbatim. **Do not tune in response.**

The number that matters most: whether survival personalities lose ground from their
current ~60% combined share. Tar, conveyors and air blasters exist to make retreating cost
something.

- [ ] **Step 5: Commit**

```bash
git add src/render/arena-renderer.ts tools/arena-metrics.ts
git commit -m "feat(render): draw hazards and separate hazard deaths from combat"
```

---

## Definition of done

- [ ] `npm test` passes in full; lint, types and build clean
- [ ] Same seed still produces the same checksum
- [ ] Every match still produces exactly one survivor
- [ ] Bots slow in tar, slide on ice, and are carried by conveyors
- [ ] Flame jets pulse; bots ignore them while off
- [ ] A cannon fires one shot per activation and the shot stops at the first bot it hits
- [ ] Driving onto a button arms whatever it is wired to, and the cooldown prevents
      a parked bot from re-triggering it continuously
- [ ] Metrics distinguish combat, hazard, and fall deaths

## What this does not include

- The Arena Builder — the next plan
- Interior walls — comes with the builder
- Bots reasoning *about* buttons (seeking or avoiding them). They trigger plates
  incidentally. Letting the Instigator deliberately shove opponents onto plates is an
  obvious later upgrade and fits that personality exactly.
- The three-component weapon model and the bot categories — Phase 4
- Any balance tuning beyond reporting the numbers
