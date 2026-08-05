import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import { arcAlignment, damageFrom, resolveHit, vulnerability } from './combat';

const at = (x: number, y: number, heading: number) =>
  createBot({ id: `${x},${y}`, x, y, heading });

describe('arcAlignment', () => {
  it('is 1 when the target is dead ahead', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, 100, 0)).toBeCloseTo(1, 8);
  });

  it('is 0 when the target is directly behind', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, -100, 0)).toBe(0);
  });

  it('is 0 when the target is directly to the side', () => {
    const a = at(0, 0, 0);
    expect(arcAlignment(a, 0, 100)).toBe(0);
  });

  it('falls off across the arc rather than cutting off sharply', () => {
    const a = at(0, 0, 0);
    const dead = arcAlignment(a, 100, 0);
    const halfway = arcAlignment(a, 100, 41); // ~22 degrees, half the 45 degree arc
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(dead);
  });

  it('never returns a negative value', () => {
    for (let angle = 0; angle < 4096; angle += 37) {
      const b = at(0, 0, angle);
      expect(arcAlignment(b, 100, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('damageFrom', () => {
  it('scales with impact speed', () => {
    const a = at(0, 0, 0);
    const slow = damageFrom(a, 1, 1);
    const fast = damageFrom(a, 4, 1);
    expect(fast).toBeCloseTo(slow * 4, 8);
  });

  it('scales with alignment', () => {
    const a = at(0, 0, 0);
    expect(damageFrom(a, 3, 0)).toBe(0);
    expect(damageFrom(a, 3, 1)).toBeGreaterThan(0);
  });

  it('is reduced by target armour', () => {
    const a = at(0, 0, 0);
    const soft = damageFrom(a, 3, 1, 1);
    const hard = damageFrom(a, 3, 1, 2);
    expect(hard).toBeCloseTo(soft / 2, 8);
  });
});

describe('vulnerability', () => {
  it('is lowest for a hit on the front', () => {
    // Target faces +x, attacker is at +x, so this lands on its front armour.
    expect(vulnerability(at(0, 0, 0), 100, 0)).toBeCloseTo(0.7, 8);
  });

  it('is highest for a hit on the rear', () => {
    // Target faces +x, attacker is behind at -x.
    expect(vulnerability(at(0, 0, 0), -100, 0)).toBeCloseTo(1.8, 8);
  });

  it('is midway for a hit on the side', () => {
    expect(vulnerability(at(0, 0, 0), 0, 100)).toBeCloseTo(1.25, 6);
  });

  it('makes the rear more than twice as soft as the front', () => {
    const front = vulnerability(at(0, 0, 0), 100, 0);
    const rear = vulnerability(at(0, 0, 0), -100, 0);
    expect(rear / front).toBeGreaterThan(2);
  });

  it('is symmetric between the two flanks', () => {
    expect(vulnerability(at(0, 0, 0), 0, 100)).toBeCloseTo(
      vulnerability(at(0, 0, 0), 0, -100),
      8,
    );
  });
});

describe('resolveHit', () => {
  it('hurts a fleeing bot far more than one facing its attacker', () => {
    // The whole point of the rear multiplier: turning your back is expensive.
    const chaser = at(0, 0, 0);
    const fleeing = at(40, 0, 0); // faces away, chaser is on its rear
    const facing = at(40, 0, 2048); // turned to meet the chaser head-on
    resolveHit(chaser, fleeing, 4);
    resolveHit(chaser, facing, 4);
    const fleeingLost = fleeing.maxHealth - fleeing.health;
    const facingLost = facing.maxHealth - facing.health;
    expect(fleeingLost).toBeGreaterThan(facingLost * 2);
  });

  it('damages the target when the attacker connects head-on', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4);
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it('does no damage when the attacker is facing away', () => {
    const attacker = at(0, 0, 2048); // facing -x, target is at +x
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4);
    expect(target.health).toBe(target.maxHealth);
  });

  it('hurts both bots in a head-on collision', () => {
    const a = at(0, 0, 0);
    const b = at(40, 0, 2048);
    resolveHit(a, b, 4);
    resolveHit(b, a, 4);
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('is one-sided when one bot catches the other in the flank', () => {
    // This asymmetry is the whole reason positioning matters.
    const attacker = at(0, 0, 0);
    const victim = at(40, 0, 1024); // facing +y, so attacker is on its flank
    resolveHit(attacker, victim, 4);
    resolveHit(victim, attacker, 4);
    expect(victim.health).toBeLessThan(victim.maxHealth);
    expect(attacker.health).toBe(attacker.maxHealth);
  });

  it('reports the damage it dealt', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const dealt = resolveHit(attacker, target, 4);
    expect(dealt).toBeCloseTo(target.maxHealth - target.health, 8);
  });

  it('does not take a dead bot below zero health', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.health = 0.5;
    resolveHit(attacker, target, 10);
    expect(target.health).toBe(0);
  });

  it('does nothing when either bot is already eliminated', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.alive = false;
    expect(resolveHit(attacker, target, 4)).toBe(0);
    expect(target.health).toBe(target.maxHealth);
  });
});
