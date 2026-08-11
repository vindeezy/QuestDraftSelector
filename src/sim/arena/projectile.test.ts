import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { always, cycle } from './activation';
import {
  createEmitter,
  fireEmitters,
  stepProjectiles,
  segmentHitsCircle,
} from './projectile';
import { hazardHitIntensity, type Effect } from './effects';

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
    expect(shots.length).toBe(0);
  });

  it('culls a projectile in the same tick it dies, not the tick after', () => {
    // Deliberate: dead projectiles do not linger for a frame. A one-tick lag would be
    // a surprising thing for a function called "step" to do. If the renderer ever needs
    // to draw an impact, it should be handed an explicit list of hits rather than asked
    // to notice a corpse still sitting in the projectile array.
    const target = bot(100, 300);
    const shots = [{ x: 90, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    stepProjectiles(shots, [target], arena.width, arena.height);
    expect(shots.length).toBe(0);
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it('credits a projectile hit to damageTaken — documented rule: it counts, unlike a landed contact', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height);
    expect(target.damageTaken).toBeCloseTo(18, 8);
  });

  it('does not increment contacts — an emitter has no attacking bot', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height);
    expect(target.contacts).toBe(0);
  });

  it('caps damageTaken at what the bot actually had left, not the nominal shot damage', () => {
    const target = bot(100, 300);
    target.health = 5;
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height);
    expect(target.health).toBe(0);
    expect(target.damageTaken).toBe(5);
  });
});

describe('fireEmitters — effect bus', () => {
  it('pushes exactly one cannonFire effect on the tick it fires', () => {
    const e = emitter();
    const shots: ReturnType<typeof fireEmitters> = [];
    const effects: Effect[] = [];
    fireEmitters([e], 0, noButtons, shots, effects);
    expect(effects.length).toBe(1);
    expect(effects[0]!.kind).toBe('cannonFire');
    expect(effects[0]!.intensity).toBe(1);
  });

  it('positions the effect at the emitter, not about any one bot', () => {
    const e = emitter();
    const shots: ReturnType<typeof fireEmitters> = [];
    const effects: Effect[] = [];
    fireEmitters([e], 0, noButtons, shots, effects);
    expect(effects[0]!.x).toBe(e.x);
    expect(effects[0]!.y).toBe(e.y);
    expect(effects[0]!.botId).toBeNull();
  });

  it('fires once per activation, not once per active tick — same rising-edge rule as the projectile itself', () => {
    const e = emitter(always());
    const shots: ReturnType<typeof fireEmitters> = [];
    const effects: Effect[] = [];
    for (let t = 0; t < 100; t++) fireEmitters([e], t, noButtons, shots, effects);
    expect(effects.length).toBe(1);
  });

  it('pushes nothing on a tick the emitter does not fire', () => {
    const e = emitter(cycle(120, 1));
    const shots: ReturnType<typeof fireEmitters> = [];
    const effects: Effect[] = [];
    fireEmitters([e], 5, noButtons, shots, effects);
    expect(effects.length).toBe(0);
  });
});

describe('stepProjectiles — effect bus', () => {
  const arena = { width: 960, height: 720 };

  it('pushes exactly one hazardHit effect on a landed hit', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    const effects: Effect[] = [];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height, effects);
    expect(effects.length).toBe(1);
    expect(effects[0]!.kind).toBe('hazardHit');
  });

  it('positions the effect on the bot it hit and attributes it to that bot', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    const effects: Effect[] = [];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height, effects);
    expect(effects[0]!.x).toBe(target.body.x);
    expect(effects[0]!.y).toBe(target.body.y);
    expect(effects[0]!.botId).toBe(target.body.id);
  });

  it('reports intensity as the normalised damage dealt', () => {
    const target = bot(100, 300);
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    const effects: Effect[] = [];
    for (let t = 0; t < 20; t++) stepProjectiles(shots, [target], arena.width, arena.height, effects);
    expect(effects[0]!.intensity).toBeCloseTo(hazardHitIntensity(18), 8);
  });

  it('pushes nothing on a tick with no hit', () => {
    const shots = [{ x: 10, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    const effects: Effect[] = [];
    stepProjectiles(shots, [], arena.width, arena.height, effects);
    expect(effects.length).toBe(0);
  });

  it('pushes nothing for an expiring shot that never hit anything', () => {
    const shots = [{ x: 950, y: 300, vx: 14, vy: 0, damage: 18, radius: 5, alive: true }];
    const effects: Effect[] = [];
    stepProjectiles(shots, [], arena.width, arena.height, effects);
    expect(effects.length).toBe(0);
  });
});
