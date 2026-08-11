import { describe, it, expect } from 'vitest';
import {
  pushEffect,
  weaponHitIntensity,
  hazardHitIntensity,
  collisionIntensity,
  WEAPON_HIT_REFERENCE_DAMAGE,
  HAZARD_HIT_REFERENCE_DAMAGE,
  COLLISION_REFERENCE_SPEED,
  type Effect,
} from './effects';

describe('pushEffect', () => {
  it('appends exactly one effect with the given fields', () => {
    const effects: Effect[] = [];
    pushEffect(effects, 'weaponHit', 10, 20, 0.5, 'bot-0');
    expect(effects.length).toBe(1);
    expect(effects[0]).toEqual({ kind: 'weaponHit', x: 10, y: 20, intensity: 0.5, botId: 'bot-0' });
  });

  it('allows a null botId, for events not about a single bot', () => {
    const effects: Effect[] = [];
    pushEffect(effects, 'collision', 0, 0, 0.2, null);
    expect(effects[0]!.botId).toBeNull();
  });
});

describe('weaponHitIntensity', () => {
  it('is 0 for 0 damage', () => {
    expect(weaponHitIntensity(0)).toBe(0);
  });

  it('is 1 at the reference damage', () => {
    expect(weaponHitIntensity(WEAPON_HIT_REFERENCE_DAMAGE)).toBeCloseTo(1, 8);
  });

  it('is 0.5 at half the reference damage', () => {
    expect(weaponHitIntensity(WEAPON_HIT_REFERENCE_DAMAGE / 2)).toBeCloseTo(0.5, 8);
  });

  it('clamps above the reference rather than exceeding 1', () => {
    expect(weaponHitIntensity(WEAPON_HIT_REFERENCE_DAMAGE * 5)).toBe(1);
  });

  it('never returns a negative value', () => {
    expect(weaponHitIntensity(-5)).toBe(0);
  });
});

describe('hazardHitIntensity', () => {
  it('is 0 for 0 damage', () => {
    expect(hazardHitIntensity(0)).toBe(0);
  });

  it('is 1 at the reference damage', () => {
    expect(hazardHitIntensity(HAZARD_HIT_REFERENCE_DAMAGE)).toBeCloseTo(1, 8);
  });

  it('clamps above the reference rather than exceeding 1', () => {
    expect(hazardHitIntensity(HAZARD_HIT_REFERENCE_DAMAGE * 5)).toBe(1);
  });

  it('never returns a negative value', () => {
    expect(hazardHitIntensity(-1)).toBe(0);
  });
});

describe('collisionIntensity', () => {
  it('is 0 at zero speed', () => {
    expect(collisionIntensity(0)).toBe(0);
  });

  it('is 1 at the reference speed', () => {
    expect(collisionIntensity(COLLISION_REFERENCE_SPEED)).toBeCloseTo(1, 8);
  });

  it('clamps above the reference rather than exceeding 1', () => {
    expect(collisionIntensity(COLLISION_REFERENCE_SPEED * 5)).toBe(1);
  });

  it('never returns a negative value', () => {
    expect(collisionIntensity(-3)).toBe(0);
  });
});
