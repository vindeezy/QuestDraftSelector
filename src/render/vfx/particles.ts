/**
 * The particle pool.
 *
 * Pure arithmetic — no PixiJS, no canvas, no WebGL. A particle here is a position, a velocity
 * and a remaining life; drawing them is a separate job, and keeping the two apart is what
 * lets the thing that actually matters be tested: that a ten-bot scrum cannot make this grow.
 *
 * The bound is the entire design. Effects arrive in bursts — measured on the real event, a
 * battle peaks at 66 effects in one second — and a naive implementation allocates a fresh
 * object per spark, sheds them a moment later, and hands the garbage collector a steady
 * stream of work. A collection pause mid-fight is exactly the kind of hitch that ruins a
 * frame, and it arrives at the busiest moment because that is when the most garbage was made.
 *
 * So the pool is allocated once and never grows. When every slot is busy, the OLDEST particle
 * is taken rather than a new one made: the sparks from the blow that just landed matter more
 * than the tail of one that landed half a second ago, and refusing to spawn would make a
 * heavy scrum look emptier than a light one.
 *
 * Sizes are in world units and chosen against the BOT radius (roughly 14-20), not in the
 * abstract. The first pass used 1-3, which is a pixel or two on screen and simply cannot be
 * seen next to a machine eight times its size.
 *
 * `Math.random` is fine here. This is presentation, downstream of the effect bus, and cannot
 * reach the simulation — the lint guard enforces the direction that matters. It is injectable
 * anyway, so the geometry can be asserted rather than eyeballed.
 */

/**
 * How many particles may exist at once.
 *
 * Sized against the measured worst case rather than guessed: the busiest second of the real
 * recorded event asks for 66 effects, and a heavy burst is about 18 particles, so a bad second
 * wants roughly 1,200 spawns. They do not all live at once — most are gone inside 400ms — and
 * 900 leaves room for the peak while staying small enough to update every frame without
 * thinking about it.
 */
export const PARTICLE_CAPACITY = 900;

/** Gravity, in units per second squared. Gentle: sparks arc, they do not fall like rocks. */
const GRAVITY = 260;

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds remaining. */
  life: number;
  /** Seconds it started with, so a renderer can fade on `life / maxLife`. */
  maxLife: number;
  size: number;
  tint: number;
  /** Per-second velocity retention, 0-1. Lower is thicker air. */
  drag: number;
  /** How strongly gravity pulls this one. Dust barely falls; sparks do. */
  weight: number;
  /** Monotonic spawn counter, used to find the oldest when the pool is full. */
  bornAt: number;
}

export interface SpawnOptions {
  x: number;
  y: number;
  /** 0-1 from the effect bus. Drives count, speed and life. */
  intensity: number;
  tint: number;
}

export interface ParticleField {
  /** The whole pool, live and dead. Exposed for the renderer and the tests to walk. */
  readonly particles: readonly Particle[];
  /** Sparks thrown outward: weapon hits, hazard contact. */
  burst(options: SpawnOptions): void;
  /** Slow, fat, barely-falling dust: collisions, smoke. */
  puff(options: SpawnOptions): void;
  /** An evenly spaced expanding circle: shockwaves, eliminations. */
  ring(options: SpawnOptions): void;
  /** Integrates by `seconds`. */
  advance(seconds: number): void;
  /** Retires everything. */
  clear(): void;
}

export interface FieldOptions {
  capacity?: number;
  random?: () => number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

/**
 * How many sparks a hit throws.
 *
 * Never zero. A glancing blow that produced no visible reaction would read as the hit not
 * having registered, which is worse than showing too little — the same reasoning that keeps
 * `gainFor` off silence in the audio layer.
 */
export function burstCount(intensity: number): number {
  return Math.round(5 + 13 * clamp01(intensity));
}

function puffCount(intensity: number): number {
  return Math.round(3 + 6 * clamp01(intensity));
}

function ringCount(intensity: number): number {
  return Math.round(12 + 16 * clamp01(intensity));
}

export function createParticleField(options: FieldOptions = {}): ParticleField {
  const capacity = Math.max(1, Math.floor(options.capacity ?? PARTICLE_CAPACITY));
  const random = options.random ?? Math.random;

  // Allocated once, up front. Every field below is overwritten on spawn, so these values are
  // only ever "not currently in use".
  const particles: Particle[] = Array.from({ length: capacity }, () => ({
    active: false,
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1,
    size: 1, tint: 0xffffff,
    drag: 0.5, weight: 1,
    bornAt: 0,
  }));

  let clock = 0;
  // Where the last search stopped. Spawning walks on from here rather than restarting at zero
  // every time, so filling the pool is linear overall instead of quadratic — with 900 slots
  // and a burst every frame, restarting would rescan hundreds of live particles per spawn.
  let cursor = 0;

  /** A free slot, or the oldest live one when there are none. */
  function claim(): Particle {
    for (let i = 0; i < capacity; i++) {
      const candidate = particles[(cursor + i) % capacity]!;
      if (!candidate.active) {
        cursor = (cursor + i + 1) % capacity;
        return candidate;
      }
    }

    // Full. Take the oldest: the newest effect is the one the viewer is looking at.
    let oldest = particles[0]!;
    for (const candidate of particles) {
      if (candidate.bornAt < oldest.bornAt) oldest = candidate;
    }
    return oldest;
  }

  function spawn(
    o: SpawnOptions,
    speed: number,
    angle: number,
    life: number,
    size: number,
    drag: number,
    weight: number,
  ): void {
    const p = claim();
    p.active = true;
    p.x = o.x;
    p.y = o.y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.tint = o.tint;
    p.drag = drag;
    p.weight = weight;
    p.bornAt = clock++;
  }

  return {
    particles,

    burst(o) {
      const force = clamp01(o.intensity);
      const count = burstCount(o.intensity);
      for (let i = 0; i < count; i++) {
        // Fully random angles rather than an even fan: metal spraying off an impact has no
        // pattern to it, and an even fan reads as a decoration rather than as debris.
        spawn(
          o,
          90 + 240 * force * random(),
          random() * Math.PI * 2,
          0.22 + 0.32 * random(),
          2.4 + 3.4 * random(),
          0.06,
          1,
        );
      }
    },

    puff(o) {
      const force = clamp01(o.intensity);
      const count = puffCount(o.intensity);
      for (let i = 0; i < count; i++) {
        // Slow, fat and nearly weightless: dust hangs where a spark would arc away.
        spawn(
          o,
          18 + 46 * force * random(),
          random() * Math.PI * 2,
          0.38 + 0.4 * random(),
          // 20% smaller than they were, which takes about a third off the area they cover.
          // Dust is the most frequent thing on screen -- collisions alone fire roughly 800
          // times a battle -- so it is the one effect whose job is to be felt and not noticed.
          4.8 + 4.8 * random(),
          0.3,
          0.12,
        );
      }
    },

    ring(o) {
      const force = clamp01(o.intensity);
      const count = ringCount(o.intensity);
      const speed = 150 + 210 * force;
      for (let i = 0; i < count; i++) {
        // Evenly spaced and all at one speed. Randomise either and it stops being a shockwave
        // and becomes an ordinary burst — the deliberateness IS the effect.
        spawn(o, speed, (i / count) * Math.PI * 2, 0.3 + 0.16 * force, 3.4 + 2.6 * force, 0.55, 0.25);
      }
    },

    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      // Clamped so a backgrounded tab returning after ten seconds does not teleport every
      // live particle off the screen in one step.
      const dt = Math.min(seconds, 0.1);

      for (const p of particles) {
        if (!p.active) continue;

        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          continue;
        }

        // Exponential drag, so the same coefficient behaves the same at any frame rate.
        const kept = Math.pow(p.drag, dt);
        p.vx *= kept;
        p.vy *= kept;
        p.vy += GRAVITY * p.weight * dt;

        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    },

    clear() {
      for (const p of particles) p.active = false;
    },
  };
}
