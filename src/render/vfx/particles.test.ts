import { describe, it, expect } from 'vitest';
import {
  PARTICLE_CAPACITY, burstCount, createParticleField, type ParticleField,
} from './particles';

/**
 * The particle layer, tested without a renderer.
 *
 * Everything here is arithmetic — how many particles an event spawns, where they go, and
 * which slot they come from — so none of it needs WebGL, and none of it should be entangled
 * with PixiJS. What the sparks LOOK like is the watch gate's job; what this file protects is
 * that the pool is bounded and that a busy battle cannot make it grow.
 *
 * The random source is injected, so "spread" and "count" are assertions rather than
 * approximately-true observations.
 */

/** A random source that walks a fixed cycle, so every spawn is reproducible. */
function fakeRandom(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    return v;
  };
}

function field(random: () => number = fakeRandom([0.5])): ParticleField {
  return createParticleField({ random });
}

/** How many particles are currently alive. */
function live(f: ParticleField): number {
  return f.particles.filter((p) => p.active).length;
}

/**
 * Advances in frame-sized steps, the way the render loop does.
 *
 * `advance` deliberately clamps a single step, so a tab that was backgrounded for ten seconds
 * cannot teleport every live particle off screen in one jump. That means one big call is not
 * the same as many small ones, and tests that want elapsed time have to spend it.
 */
function run(f: ParticleField, seconds: number): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) f.advance(step);
}

describe('burst geometry', () => {
  it('spawns more particles for a heavier hit', () => {
    expect(burstCount(1)).toBeGreaterThan(burstCount(0));
    expect(burstCount(0)).toBeGreaterThan(0); // a glancing hit still shows something
  });

  it('never spawns a fractional or negative count, whatever it is handed', () => {
    for (const intensity of [-5, 0, 0.5, 1, 40, Number.NaN]) {
      const n = burstCount(intensity);
      expect(Number.isInteger(n), String(intensity)).toBe(true);
      expect(n, String(intensity)).toBeGreaterThan(0);
    }
  });

  it('throws particles outward in every direction', () => {
    const f = field(fakeRandom([0, 0.2, 0.4, 0.6, 0.8]));
    f.burst({ x: 100, y: 100, intensity: 1, tint: 0xffffff });

    const moving = f.particles.filter((p) => p.active);
    expect(moving.length).toBeGreaterThan(4);
    // Spread means the velocities are not all pointing the same way.
    const angles = new Set(moving.map((p) => Math.round(Math.atan2(p.vy, p.vx) * 8)));
    expect(angles.size).toBeGreaterThan(1);
  });

  it('starts every particle at the event, not at the origin', () => {
    const f = field();
    f.burst({ x: 250, y: 80, intensity: 0.5, tint: 0xff0000 });
    for (const p of f.particles.filter((p) => p.active)) {
      expect(p.x).toBeCloseTo(250);
      expect(p.y).toBeCloseTo(80);
    }
  });
});

describe('the pool', () => {
  it('never exceeds its capacity, however hard it is driven', () => {
    // The whole reason this is a pool: a scrum must not be able to allocate without bound.
    const f = field();
    for (let i = 0; i < 500; i++) {
      f.burst({ x: i, y: 0, intensity: 1, tint: 0xffffff });
    }
    expect(f.particles.length).toBe(PARTICLE_CAPACITY);
    expect(live(f)).toBeLessThanOrEqual(PARTICLE_CAPACITY);
  });

  it('recycles the OLDEST particle when full, so the newest effects survive', () => {
    const f = field();
    // Fill it, then spawn one more distinguishable burst.
    while (live(f) < PARTICLE_CAPACITY) f.burst({ x: 0, y: 0, intensity: 1, tint: 0x111111 });
    f.burst({ x: 999, y: 999, intensity: 0, tint: 0xabcdef });

    const newest = f.particles.filter((p) => p.tint === 0xabcdef);
    expect(newest.length).toBeGreaterThan(0);
    expect(newest.every((p) => p.x === 999)).toBe(true);
  });

  it('reuses dead slots before recycling live ones', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const spawned = live(f);

    run(f, 2); // everything is long dead
    expect(live(f)).toBe(0);

    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    expect(live(f)).toBe(spawned);
  });
});

describe('motion', () => {
  it('moves particles along their velocity', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const p = f.particles.find((p) => p.active)!;
    const { x, y, vx, vy } = p;

    f.advance(0.1);

    expect(p.x).not.toBe(x);
    expect(Math.sign(p.x - x)).toBe(Math.sign(vx) || Math.sign(p.x - x));
    expect(Math.sign(p.y - y)).toBe(Math.sign(vy) || Math.sign(p.y - y));
  });

  it('slows particles down rather than letting them fly forever', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const p = f.particles.find((p) => p.active)!;
    const speedBefore = Math.hypot(p.vx, p.vy);

    f.advance(0.05);

    // Drag beats gravity over a short step for a fast-moving spark.
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(speedBefore);
  });

  it('retires particles when their life runs out', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    expect(live(f)).toBeGreaterThan(0);

    run(f, 2);

    expect(live(f)).toBe(0);
  });

  it('ignores a nonsense timestep rather than sending particles to infinity', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) f.advance(bad);
    for (const p of f.particles.filter((p) => p.active)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('clamps one enormous step, so a backgrounded tab does not teleport everything', () => {
    // A tab that was hidden for ten seconds comes back with a huge delta. Integrating it in
    // one go throws every live particle far off screen and they all pop out of existence at
    // once; clamping means the frame after a stall looks like an ordinary frame.
    const a = field();
    a.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    a.advance(10);
    const jumped = a.particles.find((p) => p.active)!;

    const b = field();
    b.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    b.advance(0.1);
    const stepped = b.particles.find((p) => p.active)!;

    expect(Math.abs(jumped.x)).toBeCloseTo(Math.abs(stepped.x), 3);
  });
});

describe('the three shapes', () => {
  it('puffs are slower and larger than sparks — dust, not metal', () => {
    const a = field();
    a.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const spark = a.particles.find((p) => p.active)!;

    const b = field();
    b.puff({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const dust = b.particles.find((p) => p.active)!;

    expect(Math.hypot(dust.vx, dust.vy)).toBeLessThan(Math.hypot(spark.vx, spark.vy));
    expect(dust.size).toBeGreaterThan(spark.size);
  });

  it('rings are evenly spaced, which is what makes them read as a shockwave', () => {
    // Evenly spaced is the whole point: randomly placed particles moving outward are just a
    // burst, and a shockwave has to look like a deliberate expanding circle.
    const f = field(fakeRandom([0.5]));
    f.ring({ x: 0, y: 0, intensity: 1, tint: 0xffffff });

    const angles = f.particles
      .filter((p) => p.active)
      .map((p) => Math.atan2(p.vy, p.vx))
      .sort((a, b) => a - b);

    expect(angles.length).toBeGreaterThan(5);
    const gaps = angles.slice(1).map((a, i) => a - angles[i]!);
    const first = gaps[0]!;
    for (const gap of gaps) expect(gap).toBeCloseTo(first, 4);
  });

  it('gives every ring particle the same speed, so the circle stays a circle', () => {
    const f = field(fakeRandom([0.5]));
    f.ring({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const speeds = f.particles.filter((p) => p.active).map((p) => Math.hypot(p.vx, p.vy));
    for (const speed of speeds) expect(speed).toBeCloseTo(speeds[0]!, 4);
  });
});

describe('clear', () => {
  it('drops everything, for a screen tearing down mid-fight', () => {
    const f = field();
    f.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    f.clear();
    expect(live(f)).toBe(0);
  });
});

describe('the jet', () => {
  it('throws everything within its cone, not in all directions', () => {
    // The whole point of the shape. A jet that radiates is a bot on fire rather than a bot
    // firing, which is precisely the distinction the flamethrower has to make.
    const f = field(fakeRandom([0, 0.25, 0.5, 0.75, 1]));
    f.jet({ x: 0, y: 0, intensity: 1, tint: 0xffffff, angle: 0, spread: 0.4 });

    const live = f.particles.filter((p) => p.active);
    expect(live.length).toBeGreaterThan(3);
    for (const p of live) {
      const angle = Math.atan2(p.vy, p.vx);
      expect(Math.abs(angle), `${angle}`).toBeLessThanOrEqual(0.4 + 1e-6);
    }
  });

  it('points where it is aimed', () => {
    const f = field(fakeRandom([0.5]));
    f.jet({ x: 0, y: 0, intensity: 1, tint: 0xffffff, angle: Math.PI / 2, spread: 0.1 });
    for (const p of f.particles.filter((p) => p.active)) {
      expect(p.vy).toBeGreaterThan(0); // +y, straight down the aim
      expect(Math.abs(p.vx)).toBeLessThan(Math.abs(p.vy));
    }
  });

  it('barely falls, because flame does not arc like a spark', () => {
    const a = field();
    a.jet({ x: 0, y: 0, intensity: 1, tint: 0xffffff, angle: 0, spread: 0.3 });
    const flame = a.particles.find((p) => p.active)!;

    const b = field();
    b.burst({ x: 0, y: 0, intensity: 1, tint: 0xffffff });
    const spark = b.particles.find((p) => p.active)!;

    expect(flame.weight).toBeLessThan(spark.weight);
  });
});
