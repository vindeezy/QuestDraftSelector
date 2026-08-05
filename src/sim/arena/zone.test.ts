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
