import { describe, it, expect } from 'vitest';
import { createBot, DEFAULT_BOT, type BotStats } from './bot';
import { arcAlignment, damageFrom, resolveHit, vulnerability } from './combat';

const at = (x: number, y: number, heading: number) =>
  createBot({ id: `${x},${y}`, x, y, heading });

const atStats = (x: number, y: number, heading: number, stats: Partial<BotStats>) =>
  createBot({ id: `${x},${y}`, x, y, heading }, { ...DEFAULT_BOT, ...stats });

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

  it('reads per-bot chassis values, not the old fixed constants', () => {
    // A 0.40 front / 2.2 rear chassis (Wedge-like) takes over five times as much from
    // behind as it does head-on.
    const wedge = atStats(0, 0, 0, { frontVulnerability: 0.4, sideVulnerability: 1.4, rearVulnerability: 2.2 });
    const front = vulnerability(wedge, 100, 0);
    const rear = vulnerability(wedge, -100, 0);
    expect(front).toBeCloseTo(0.4, 8);
    expect(rear).toBeCloseTo(2.2, 8);
    expect(rear / front).toBeGreaterThan(5);
  });

  it('uses side vulnerability rather than skipping it in a straight front-to-rear lerp', () => {
    // Two chassis with identical front and rear, differing only in side. A single lerp
    // from front to rear would make these indistinguishable at every facing except
    // exactly 0; the two-segment version must show a real difference approaching the
    // flank.
    const paperFlank = atStats(0, 0, 0, {
      frontVulnerability: 0.75,
      sideVulnerability: 1.7,
      rearVulnerability: 1.0,
    });
    const toughFlank = atStats(0, 0, 0, {
      frontVulnerability: 0.75,
      sideVulnerability: 1.2,
      rearVulnerability: 1.0,
    });
    // A near-flank angle, not exactly 90 degrees, so both segments' shape is exercised.
    const flankHit = vulnerability(paperFlank, 1, 100);
    const toughHit = vulnerability(toughFlank, 1, 100);
    expect(flankHit).toBeGreaterThan(toughHit);
    // At the exact side angle both must equal their own side value exactly.
    expect(vulnerability(paperFlank, 0, 100)).toBeCloseTo(1.7, 8);
    expect(vulnerability(toughFlank, 0, 100)).toBeCloseTo(1.2, 8);
  });

  it('returns exactly the side value at facing 0, for a chassis where side is not the midpoint', () => {
    // Diamond-shaped: front 0.75, side 1.7, rear 1.0. The midpoint of front and rear is
    // 0.875, nowhere near 1.7 — a straight lerp would silently erase this chassis's
    // whole design. The two-segment interpolation must still land exactly on 1.7.
    const diamond = atStats(0, 0, 0, {
      frontVulnerability: 0.75,
      sideVulnerability: 1.7,
      rearVulnerability: 1.0,
    });
    expect(vulnerability(diamond, 0, 100)).toBeCloseTo(1.7, 8);
    expect(vulnerability(diamond, 0, -100)).toBeCloseTo(1.7, 8);
  });
});

describe('resolveHit', () => {
  it('hurts a fleeing bot far more than one facing its attacker', () => {
    // The whole point of the rear multiplier: turning your back is expensive.
    const chaser = at(0, 0, 0);
    const fleeing = at(40, 0, 0); // faces away, chaser is on its rear
    const facing = at(40, 0, 2048); // turned to meet the chaser head-on
    resolveHit(chaser, fleeing, 4, 0);
    resolveHit(chaser, facing, 4, 0);
    const fleeingLost = fleeing.maxHealth - fleeing.health;
    const facingLost = facing.maxHealth - facing.health;
    expect(fleeingLost).toBeGreaterThan(facingLost * 2);
  });

  it('damages the target when the attacker connects head-on', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4, 0);
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it('does no damage when the attacker is facing away', () => {
    const attacker = at(0, 0, 2048); // facing -x, target is at +x
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4, 0);
    expect(target.health).toBe(target.maxHealth);
  });

  it('hurts both bots in a head-on collision', () => {
    const a = at(0, 0, 0);
    const b = at(40, 0, 2048);
    resolveHit(a, b, 4, 0);
    resolveHit(b, a, 4, 0);
    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBeLessThan(b.maxHealth);
  });

  it('is one-sided when one bot catches the other in the flank', () => {
    // This asymmetry is the whole reason positioning matters.
    const attacker = at(0, 0, 0);
    const victim = at(40, 0, 1024); // facing +y, so attacker is on its flank
    resolveHit(attacker, victim, 4, 0);
    resolveHit(victim, attacker, 4, 0);
    expect(victim.health).toBeLessThan(victim.maxHealth);
    expect(attacker.health).toBe(attacker.maxHealth);
  });

  it('reports the damage it dealt', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const dealt = resolveHit(attacker, target, 4, 0);
    expect(dealt).toBeCloseTo(target.maxHealth - target.health, 8);
  });

  it('does not take a dead bot below zero health', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.health = 0.5;
    resolveHit(attacker, target, 10, 0);
    expect(target.health).toBe(0);
  });

  it('does nothing when either bot is already eliminated', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.alive = false;
    expect(resolveHit(attacker, target, 4, 0)).toBe(0);
    expect(target.health).toBe(target.maxHealth);
  });
});

describe('damage tracking', () => {
  it('starts at zero', () => {
    expect(at(0, 0, 0).damageDealt).toBe(0);
  });

  it('credits the attacker for what it dealt', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const dealt = resolveHit(attacker, target, 4, 0);
    expect(attacker.damageDealt).toBeCloseTo(dealt, 8);
  });

  it('accumulates across hits', () => {
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    const first = resolveHit(attacker, target, 4, 0);
    const second = resolveHit(attacker, target, 4, 1000);
    expect(attacker.damageDealt).toBeCloseTo(first + second, 8);
  });

  it('credits only what was actually dealt, not overkill', () => {
    // A bot on 5 health hit for 40 gives the attacker 5, not 40. Otherwise finishing
    // off wounded bots would beat grinding down a healthy one on the tiebreaker.
    const attacker = at(0, 0, 0);
    const target = at(40, 0, 0);
    target.health = 5;
    resolveHit(attacker, target, 100, 0);
    expect(attacker.damageDealt).toBe(5);
  });

  it('credits nothing for a blocked hit', () => {
    const attacker = at(0, 0, 2048); // facing away
    const target = at(40, 0, 0);
    resolveHit(attacker, target, 4, 0);
    expect(attacker.damageDealt).toBe(0);
  });
});

describe('damage reflection', () => {
  it('returns 35% of what the target took, back at the attacker', () => {
    const attacker = at(0, 0, 0);
    const target = atStats(40, 0, 0, { damageReflect: 0.35 });
    const startHealth = attacker.health;
    const dealt = resolveHit(attacker, target, 4, 0);
    expect(dealt).toBeGreaterThan(0);
    const attackerLost = startHealth - attacker.health;
    expect(attackerLost).toBeCloseTo(dealt * 0.35, 8);
  });

  it('does nothing for a bot with zero reflect', () => {
    const attacker = at(0, 0, 0);
    const target = atStats(40, 0, 0, { damageReflect: 0 });
    const startHealth = attacker.health;
    resolveHit(attacker, target, 4, 0);
    expect(attacker.health).toBe(startHealth);
  });

  it('cannot push the attacker below zero health', () => {
    const attacker = at(0, 0, 0);
    attacker.health = 1;
    // A high reflect fraction and a hefty hit so the naive reflected amount would be
    // far more than the attacker has left.
    const target = atStats(40, 0, 0, { damageReflect: 0.35 });
    resolveHit(attacker, target, 100, 0);
    expect(attacker.health).toBe(0);
  });

  it('does not credit the reflected damage to either bot\'s damageDealt', () => {
    const attacker = at(0, 0, 0);
    const target = atStats(40, 0, 0, { damageReflect: 0.35 });
    const dealt = resolveHit(attacker, target, 4, 0);
    // The attacker is credited with exactly what it dealt to the target, not a cent more
    // for the reflected damage that bounced back onto itself.
    expect(attacker.damageDealt).toBeCloseTo(dealt, 8);
    // The target never dealt anything at all — reflection is not an attack it made.
    expect(target.damageDealt).toBe(0);
  });
});
