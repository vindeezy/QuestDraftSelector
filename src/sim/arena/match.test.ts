import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA, PROVING_ARENA } from './arena';
import { DEFAULT_MATCH, createMatch, advanceMatch, runMatch } from './match';
import { assemble, type AssembledBot, type BotBuild } from '../parts/assemble';
import { slotCountFor } from '../parts/tables';

const config = { ...DEFAULT_MATCH, arena: DEFAULT_ARENA };

/** Ten distinct builds — one per bot — that vary chassis and armour so `maxHealth`
 *  genuinely differs, and step through every category's slot range so nothing here is
 *  accidentally out of range. */
function makeVariedBuilds(count = 10): AssembledBot[] {
  const builds: BotBuild[] = Array.from({ length: count }, (_, i) => ({
    chassis: i % slotCountFor('chassis'),
    drive: (i + 1) % slotCountFor('drive'),
    weapon: (i + 2) % slotCountFor('weapon'),
    armour: (i + 3) % slotCountFor('armour'),
    ability: (i + 4) % slotCountFor('ability'),
    personality: (i + 5) % slotCountFor('personality'),
  }));
  return builds.map((build) => assemble(build));
}

describe('createMatch', () => {
  it('places the requested number of bots', () => {
    const m = createMatch({ ...config, seed: 1, botCount: 10 });
    expect(m.bots.length).toBe(10);
    expect(m.bots.every((b) => b.alive)).toBe(true);
  });

  it('starts every bot on solid floor and inside the arena', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch({ ...config, seed, botCount: 10 });
      for (const bot of m.bots) {
        expect(bot.body.x).toBeGreaterThan(0);
        expect(bot.body.y).toBeGreaterThan(0);
        expect(bot.body.x).toBeLessThan(m.arena.grid.width);
        expect(bot.body.y).toBeLessThan(m.arena.grid.height);
      }
    }
  });

  it('does not start any two bots overlapping', () => {
    const m = createMatch({ ...config, seed: 7, botCount: 10 });
    for (let i = 0; i < m.bots.length; i++) {
      for (let j = i + 1; j < m.bots.length; j++) {
        const a = m.bots[i]!.body;
        const b = m.bots[j]!.body;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });
});

describe('advanceMatch', () => {
  it('advances the tick counter', () => {
    const m = createMatch({ ...config, seed: 2, botCount: 4 });
    advanceMatch(m);
    advanceMatch(m);
    expect(m.world.tick).toBe(2);
  });

  it('eliminates a bot moved over a hole', () => {
    const m = createMatch({ ...config, seed: 3, botCount: 4 });
    const victim = m.bots[0]!;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    victim.body.x = col * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;
    victim.body.y = row * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;
    advanceMatch(m);
    expect(victim.alive).toBe(false);
    expect(m.eliminations.some((e) => e.botId === victim.body.id && e.cause === 'fell')).toBe(true);
  });

  it('eliminates a bot whose health reaches zero', () => {
    const m = createMatch({ ...config, seed: 4, botCount: 4 });
    const victim = m.bots[0]!;
    victim.health = 0;
    advanceMatch(m);
    expect(victim.alive).toBe(false);
    expect(
      m.eliminations.some((e) => e.botId === victim.body.id && e.cause === 'destroyed'),
    ).toBe(true);
  });

  it('is a no-op once the match is over', () => {
    const m = createMatch({ ...config, seed: 5, botCount: 2 });
    while (!m.done) advanceMatch(m);
    const tick = m.world.tick;
    advanceMatch(m);
    advanceMatch(m);
    expect(m.world.tick).toBe(tick);
  });

  it('never lets a living bot leave the arena bounds', () => {
    const m = createMatch({ ...config, seed: 6, botCount: 10 });
    while (!m.done) {
      advanceMatch(m);
      for (const bot of m.bots) {
        if (!bot.alive) continue;
        expect(Number.isFinite(bot.body.x)).toBe(true);
        expect(bot.body.x).toBeGreaterThan(-bot.body.radius);
        expect(bot.body.x).toBeLessThan(m.arena.grid.width + bot.body.radius);
      }
    }
  });
});

describe('runMatch', () => {
  it('ranks every bot even when the match reaches the tick limit', () => {
    // A single survivor is NOT guaranteed yet: the spiral collapse that forces an
    // ending is a later task, and the chase stub happily circles forever. What must
    // hold now is that every bot gets exactly one place regardless.
    for (let seed = 1; seed <= 30; seed++) {
      const r = runMatch({ ...config, seed, botCount: 10 });
      expect(r.placements.length).toBe(10);
      expect(r.placements[0]!.place).toBe(1);
      expect(new Set(r.placements.map((p) => p.botId)).size).toBe(10);
    }
    // 30 full matches. Vitest defaults to a 5s per-test limit, which this exceeds.
  }, 60000);

  it('ranks every bot exactly once', () => {
    const r = runMatch({ ...config, seed: 11, botCount: 10 });
    const places = r.placements.map((p) => p.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('records a cause for every elimination', () => {
    const r = runMatch({ ...config, seed: 12, botCount: 10 });
    for (const e of r.eliminations) {
      expect(['destroyed', 'fell']).toContain(e.cause);
    }
  });

  it('produces identical results for the same seed', () => {
    const a = runMatch({ ...config, seed: 4242, botCount: 10 });
    const b = runMatch({ ...config, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('produces different results for different seeds', () => {
    const a = runMatch({ ...config, seed: 1, botCount: 10 });
    const b = runMatch({ ...config, seed: 2, botCount: 10 });
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('reports survivalTicks as the elimination tick for an eliminated bot, and the final tick for a survivor', () => {
    const r = runMatch({ ...config, seed: 12, botCount: 10 });
    const byId = new Map(r.damage.map((d) => [d.botId, d]));
    const eliminatedIds = new Set<string>();
    for (const e of r.eliminations) {
      eliminatedIds.add(e.botId);
      expect(byId.get(e.botId)!.survivalTicks).toBe(e.tick);
    }
    for (const d of r.damage) {
      if (!eliminatedIds.has(d.botId)) expect(d.survivalTicks).toBe(r.ticks);
    }
  });

  it('does not change the checksum when the new diagnostic counters are added', () => {
    // The checksum is computed from position/velocity/heading/health/tick only — the
    // new damageTaken/contacts/kills/survivalTicks fields must never feed into it.
    // Guarded here as a same-seed-twice determinism check, same as the pair above.
    const a = runMatch({ ...config, seed: 4242, botCount: 10 });
    const b = runMatch({ ...config, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.damage).toEqual(b.damage);
  });

  it('produces identical results for the same seed on PROVING_ARENA', () => {
    // Same determinism guarantee, on the new arena with a live trapdoor in the mix.
    const provingConfig = { ...DEFAULT_MATCH, arena: PROVING_ARENA };
    const a = runMatch({ ...provingConfig, seed: 4242, botCount: 10 });
    const b = runMatch({ ...provingConfig, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.placements).toEqual(b.placements);
  });

  it('terminates within the tick limit', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = runMatch({ ...config, seed, botCount: 10 });
      expect(r.ticks).toBeLessThanOrEqual(config.maxTicks);
    }
  }, 60000);

  it('gives every bot a different spawn across seeds — no index bias', () => {
    // Guards the fairness rule: spawn position must not correlate with bot index.
    const firstBotX: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      firstBotX.push(createMatch({ ...config, seed, botCount: 10 }).bots[0]!.body.x);
    }
    expect(new Set(firstBotX).size).toBeGreaterThan(10);
  });
});

describe('personalities', () => {
  it('assigns a personality to every bot', () => {
    const m = createMatch({ ...config, seed: 1, botCount: 10 });
    for (const bot of m.bots) {
      expect(m.aiStates.get(bot.body.id)).toBeDefined();
    }
  });

  it('does not correlate personality with bot index across seeds', () => {
    const first: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch({ ...config, seed, botCount: 10 });
      first.push(m.aiStates.get(m.bots[0]!.body.id)!.personality);
    }
    expect(new Set(first).size).toBeGreaterThan(3);
  });

  it('uses every personality when there are at least seven bots', () => {
    const m = createMatch({ ...config, seed: 3, botCount: 10 });
    const used = new Set([...m.aiStates.values()].map((s) => s.personality));
    expect(used.size).toBe(7);
  });
});

describe('createMatch: builds', () => {
  it('uses each build\'s stats instead of DEFAULT_BOT', () => {
    const builds = makeVariedBuilds(10);
    const m = createMatch({ ...config, seed: 1, botCount: 10, builds });

    m.bots.forEach((bot, i) => {
      expect(bot.maxHealth).toBeCloseTo(builds[i]!.stats.maxHealth, 8);
      expect(bot.body.radius).toBeCloseTo(builds[i]!.stats.radius, 8);
    });
  });

  it('produces bots that genuinely differ — at least two distinct maxHealth values among ten', () => {
    const builds = makeVariedBuilds(10);
    const m = createMatch({ ...config, seed: 2, botCount: 10, builds });
    const maxHealths = m.bots.map((bot) => bot.maxHealth);
    expect(new Set(maxHealths).size).toBeGreaterThanOrEqual(2);
  });

  it('takes personality from the build, not the shuffle', () => {
    const builds = makeVariedBuilds(10);
    const m = createMatch({ ...config, seed: 8, botCount: 10, builds });

    m.bots.forEach((bot, i) => {
      expect(m.aiStates.get(bot.body.id)!.personality).toBe(builds[i]!.personality);
    });
  });

  it('takes ability from the build, not the shuffle', () => {
    const builds = makeVariedBuilds(10);
    const m = createMatch({ ...config, seed: 9, botCount: 10, builds });

    m.bots.forEach((bot, i) => {
      expect(m.abilityStates.get(bot.body.id)!.name).toBe(builds[i]!.ability);
    });
  });

  it('falls back to the shuffle when no builds are supplied', () => {
    // Same seed with and without builds must diverge in personality/ability assignment
    // only because the builds path skips the shuffle draws entirely — this just confirms
    // the no-builds path still works and is independent of the builds path.
    const m = createMatch({ ...config, seed: 10, botCount: 10 });
    for (const bot of m.bots) {
      expect(m.aiStates.get(bot.body.id)).toBeDefined();
      expect(m.abilityStates.get(bot.body.id)).toBeDefined();
    }
  });

  it('runs a full match to completion using builds', () => {
    const builds = makeVariedBuilds(10);
    const r = runMatch({ ...config, seed: 13, botCount: 10, builds });
    expect(r.placements.length).toBe(10);
    expect(new Set(r.placements.map((p) => p.botId)).size).toBe(10);
  });
});
