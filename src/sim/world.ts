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
