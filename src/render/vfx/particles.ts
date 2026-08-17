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
 * Sized against the measured worst case rather than guessed. `npm run mix` runs the real
 * recorded event and reports the peak; raising the cap far above demand and watching whether
 * the peak moves is what says whether the pool is actually starving, because a full pool
 * recycles silently rather than erroring.
 *
 * Measured on the shipped event, worst battle (The Crossfire): demand peaks at 764 live. It
 * was 293 before the hazards were drawn properly — the difference is almost entirely flame
 * jets, which unlike everything else here burn on a cycle whether or not anyone is near them,
 * so they are a permanent floor rather than a spike. 900 held that without visible starvation
 * (raising the cap to 1600 moved the peak by nine) but left only 15% of headroom over a worst
 * case that is itself a floor now. 1,100 restores the margin. The cost of a spare slot is one
 * skipped branch per frame.
 */
export const PARTICLE_CAPACITY = 1100;

/** Gravity, in units per second squared. Gentle: sparks arc, they do not fall like rocks. */
const GRAVITY = 260;

/** Per-second velocity retention for flame. Thick: fire slows fast, it does not fly. */
const JET_DRAG = 0.22;

/** How far a flamethrower's own jet carries when the caller does not say. */
const WEAPON_JET_REACH = 52;

/**
 * The launch speed a particle needs to travel `reach` in `life` seconds under `drag`.
 *
 * Velocity decays as `drag^t`, so distance is its integral over the particle's life:
 * `v0 * (drag^life - 1) / ln(drag)`. Solving that for `v0` is the difference between a flame
 * that fills its zone and one that is tuned by eye until it looks about right and then stops
 * looking right the moment the zone changes size.
 */
export function speedForReach(reach: number, life: number, drag: number): number {
  if (!(reach > 0) || !(life > 0) || !(drag > 0) || drag >= 1) return 0;
  const carry = (Math.pow(drag, life) - 1) / Math.log(drag);
  return carry > 0 ? reach / carry : 0;
}

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
  /**
   * Multiplies each particle's size and how long it lasts. Defaults to 1.
   *
   * One knob rather than two, because the case it exists for always wants both: a smaller
   * version of an effect that also clears faster. A cannonball's smoke is the example --
   * `puff` is tuned for collision dust, which is meant to be fat and to hang, and a shot
   * crossing the arena in a second leaves that dust behind as a row of evenly spaced beads
   * bigger than the ball that made them. Scaled down it is smoke again.
   */
  scale?: number;
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
  /**
   * A cone thrown in one direction: flame from a nozzle.
   *
   * The only shape that has a direction. Everything else here radiates, because an impact
   * has no preferred way to spray — but a jet that radiates is a bot on fire rather than a
   * bot firing, which is the whole difference the flamethrower needs to communicate.
   */
  jet(options: JetOptions): void;
  /** Integrates by `seconds`. */
  advance(seconds: number): void;
  /** Retires everything. */
  clear(): void;
}

export interface JetOptions extends SpawnOptions {
  /** Radians. The direction the nozzle points. */
  angle: number;
  /** Radians of half-spread either side of `angle`. */
  spread: number;
  /**
   * How far the flame should carry, in world units. Defaults to a flamethrower's reach.
   *
   * A length, not a speed, because the caller knows the former and not the latter. A hazard
   * flame jet is a 110-unit cone and a weapon's is about half that; asking each to supply a
   * muzzle velocity means working backwards through the drag integral by hand, getting it
   * roughly right, and having the flame stop short of the zone that is actually burning bots.
   * `speedForReach` does that arithmetic exactly instead.
   */
  reach?: number;
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

function jetCount(intensity: number): number {
  return Math.round(4 + 7 * clamp01(intensity));
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
    const scale = Number.isFinite(o.scale) && (o.scale ?? 1) > 0 ? o.scale! : 1;
    p.life = life * scale;
    p.maxLife = p.life;
    p.size = size * scale;
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

    jet(o) {
      const force = clamp01(o.intensity);
      const count = jetCount(o.intensity);
      const reach = Number.isFinite(o.reach) && (o.reach ?? 0) > 0 ? o.reach! : WEAPON_JET_REACH;
      for (let i = 0; i < count; i++) {
        // Speed varies across the cone so the flame has depth rather than arriving as a solid
        // front, and the slower particles fall behind into a tail. Each particle's speed is
        // solved from its OWN life, so a short-lived one still travels its share of the reach
        // instead of dying halfway up the cone.
        const life = 0.16 + 0.2 * random();
        const share = 0.5 + 0.5 * random();
        spawn(
          o,
          speedForReach(reach * share, life, JET_DRAG) * (0.6 + 0.4 * force),
          o.angle + (random() * 2 - 1) * o.spread,
          life,
          4 + 4.5 * random(),
          JET_DRAG,
          // Nearly weightless. Flame rises if anything; it certainly does not arc down like
          // a spark, and gravity on a jet reads as the bot spitting rather than burning.
          0.05,
        );
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
