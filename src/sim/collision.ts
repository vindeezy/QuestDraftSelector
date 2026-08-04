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
