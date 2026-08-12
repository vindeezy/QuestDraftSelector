import { describe, it, expect } from 'vitest';
import { DEFAULT_ARENA, PROVING_ARENA, type ArenaConfig } from './arena';
import { DEFAULT_MATCH, createMatch, advanceMatch, runMatch } from './match';
import { assemble, type AssembledBot, type BotBuild } from '../parts/assemble';
import { slotCountFor } from '../parts/tables';
import type { Effect, EffectKind } from './effects';

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

// A bare arena with no hazards of any kind, so a lone survivor can produce no effect at
// all — the control case for the "cleared at the start of a tick" tests below.
const EMPTY_ARENA: ArenaConfig = {
  cols: 8,
  rows: 8,
  tileSize: 60,
  pits: [],
  wallGaps: [],
  surfaces: [],
  zones: [],
  emitters: [],
  buttons: [],
  trapdoors: [],
};

describe('effect bus', () => {
  it('starts empty on a freshly created match', () => {
    const m = createMatch({ ...config, seed: 1, botCount: 4 });
    expect(m.effects).toEqual([]);
  });

  it('is cleared at the start of a tick, not accumulated across ticks', () => {
    // Three bots, not two: eliminating one must leave two alive so the match keeps
    // running — with only two bots, one elimination ends the match and `advanceMatch`
    // becomes a permanent no-op (same as the existing "is a no-op once the match is
    // over" test), which would make the second call below vacuously pass for the wrong
    // reason.
    const m = createMatch({ ...DEFAULT_MATCH, arena: EMPTY_ARENA, seed: 1, botCount: 3 });
    const [victim, survivorA, survivorB] = m.bots as [
      (typeof m.bots)[number],
      (typeof m.bots)[number],
      (typeof m.bots)[number],
    ];
    // Spread everyone far apart so nothing else fires this tick or the next.
    survivorA.body.x = 50;
    survivorA.body.y = 50;
    survivorB.body.x = 50;
    survivorB.body.y = 400;
    victim.body.x = 400;
    victim.body.y = 50;
    victim.health = 0;

    advanceMatch(m); // the tick the victim is eliminated
    expect(m.done).toBe(false); // two of three still alive
    expect(m.effects.some((e) => e.kind === 'elimination')).toBe(true);

    advanceMatch(m); // a quiet tick: no hazards, two living bots kept apart
    expect(m.effects).toEqual([]);
  });

  it('pushes exactly one elimination effect, positioned on the eliminated bot, when health reaches zero', () => {
    const m = createMatch({ ...DEFAULT_MATCH, arena: EMPTY_ARENA, seed: 2, botCount: 2 });
    const victim = m.bots[0]!;
    victim.body.x = 100;
    victim.body.y = 100;
    victim.health = 0;

    advanceMatch(m);

    const kills = m.effects.filter((e) => e.kind === 'elimination');
    expect(kills.length).toBe(1);
    expect(kills[0]!.intensity).toBe(1);
    expect(kills[0]!.botId).toBe(victim.body.id);
    expect(kills[0]!.x).toBe(victim.body.x);
    expect(kills[0]!.y).toBe(victim.body.y);
  });

  it('pushes an elimination effect for a fall, same as for a destroyed bot', () => {
    const m = createMatch({ ...config, seed: 3, botCount: 4 });
    const victim = m.bots[0]!;
    const [col, row] = DEFAULT_ARENA.pits[0]!;
    victim.body.x = col * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;
    victim.body.y = row * DEFAULT_ARENA.tileSize + DEFAULT_ARENA.tileSize / 2;

    advanceMatch(m);

    const kills = m.effects.filter((e) => e.kind === 'elimination' && e.botId === victim.body.id);
    expect(kills.length).toBe(1);
  });

  it('keeps every effect kind\'s intensity within 0-1 across full matches, including hazard-heavy ones', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const provingConfig = { ...DEFAULT_MATCH, arena: PROVING_ARENA };
      const m = createMatch({ ...provingConfig, seed, botCount: 10, builds: makeVariedBuilds(10) });
      while (!m.done) {
        advanceMatch(m);
        for (const e of m.effects) {
          expect(e.intensity).toBeGreaterThanOrEqual(0);
          expect(e.intensity).toBeLessThanOrEqual(1);
        }
      }
    }
  }, 60000);

  it('produces the identical effect sequence for the same seed twice — full determinism, not just the count', () => {
    const provingConfig = { ...DEFAULT_MATCH, arena: PROVING_ARENA };
    const builds = makeVariedBuilds(10);

    function collect(seed: number): Effect[] {
      const m = createMatch({ ...provingConfig, seed, botCount: 10, builds });
      const all: Effect[] = [];
      while (!m.done) {
        advanceMatch(m);
        all.push(...m.effects);
      }
      return all;
    }

    const a = collect(4242);
    const b = collect(4242);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  }, 30000);

  it('produces a plausible mix over full matches: mostly weaponHit, some collision, eliminations matching the tally', () => {
    const provingConfig = { ...DEFAULT_MATCH, arena: PROVING_ARENA };
    const counts: Record<EffectKind, number> = {
      weaponHit: 0,
      hazardHit: 0,
      collision: 0,
      elimination: 0,
      trapdoor: 0,
      cannonFire: 0,
      abilityFire: 0,
    };
    let totalEliminations = 0;

    for (let seed = 1; seed <= 5; seed++) {
      const m = createMatch({ ...provingConfig, seed, botCount: 10, builds: makeVariedBuilds(10) });
      while (!m.done) {
        advanceMatch(m);
        for (const e of m.effects) counts[e.kind]++;
      }
      totalEliminations += m.eliminations.length;
    }

    expect(counts.weaponHit).toBeGreaterThan(0);
    expect(counts.collision).toBeGreaterThan(0);
    // weaponHit dominates the mix, as combat contact happens far more often than any
    // single hazard or ability trigger.
    expect(counts.weaponHit).toBeGreaterThan(counts.collision);
    expect(counts.weaponHit).toBeGreaterThan(counts.hazardHit);
    expect(counts.weaponHit).toBeGreaterThan(counts.abilityFire);
    expect(counts.elimination).toBe(totalEliminations);
  }, 60000);

  it('pushes a collision effect for a hard bot-vs-bot impact, but not for a gentle one', () => {
    const hard = createMatch({ ...DEFAULT_MATCH, arena: EMPTY_ARENA, seed: 5, botCount: 2 });
    const [hardA, hardB] = hard.bots as [(typeof hard.bots)[number], (typeof hard.bots)[number]];
    hardA.body.x = 300;
    hardA.body.y = 300;
    hardA.body.vx = 5;
    hardA.body.vy = 0;
    hardB.body.x = 330; // overlapping (30 apart, radii sum to 40)
    hardB.body.y = 300;
    hardB.body.vx = -5;
    hardB.body.vy = 0;
    advanceMatch(hard);
    expect(hard.effects.some((e) => e.kind === 'collision')).toBe(true);

    const gentle = createMatch({ ...DEFAULT_MATCH, arena: EMPTY_ARENA, seed: 6, botCount: 2 });
    const [gentleA, gentleB] = gentle.bots as [(typeof gentle.bots)[number], (typeof gentle.bots)[number]];
    gentleA.body.x = 300;
    gentleA.body.y = 300;
    gentleA.body.vx = 0.02;
    gentleA.body.vy = 0;
    gentleB.body.x = 330;
    gentleB.body.y = 300;
    gentleB.body.vx = -0.02;
    gentleB.body.vy = 0;
    advanceMatch(gentle);
    expect(gentle.effects.some((e) => e.kind === 'collision')).toBe(false);
  });

  it('credits a reflect kill to the owner of the spiked armour, not to nobody', () => {
    // The exact shape of the bug this covers: a bot swings, its target's Spiked Composite
    // bounces the damage back, and the SWINGER dies of it. Before the fix, only the
    // target's health was checked at the hit site, so the swinger fell through to the
    // health sweep — which credits `byId: null` — and the kill feed read "destroyed", as
    // if a hazard had done it.
    const m = createMatch({ ...DEFAULT_MATCH, arena: EMPTY_ARENA, seed: 11, botCount: 2 });
    const [swinger, spiked] = m.bots as [(typeof m.bots)[number], (typeof m.bots)[number]];

    // Nose to nose, closing, with the swinger pointed straight at the spiked bot so its
    // weapon arc covers it (heading 0 is +x, and the spiked bot is to its right).
    swinger.body.x = 240;
    swinger.body.y = 240;
    swinger.body.vx = 4;
    swinger.body.vy = 0;
    swinger.heading = 0;
    swinger.health = 1; // one bounce is fatal
    swinger.nextAttackTick = 0;

    spiked.body.x = 275;
    spiked.body.y = 240;
    spiked.body.vx = -4;
    spiked.body.vy = 0;
    spiked.damageReflect = 0.9;
    // The spiked bot deals no damage of its own, so the ONLY thing that can kill the
    // swinger here is the reflect — which is also the real-match case, where the other
    // bot's weapon happened to be mid-cooldown.
    spiked.weaponDamage = 0;

    for (let i = 0; i < 10 && m.eliminations.length === 0; i++) advanceMatch(m);

    const elimination = m.eliminations[0];
    expect(elimination).toBeDefined();
    expect(elimination!.botId).toBe(swinger.body.id);
    expect(elimination!.cause).toBe('destroyed');
    expect(elimination!.byId).toBe(spiked.body.id);
    // And the credit reaches the stat the event's scoring reads, not just the log line.
    expect(spiked.kills).toBe(1);
  });

  it('does not change the pinned event checksum — see src/sim/event/event.test.ts for the authoritative check', () => {
    // A same-seed-twice sanity check local to this file, so a regression here is caught
    // without needing to run the full event suite. The authoritative guard is the pinned
    // '2bcb9b13' checksum in event.test.ts, which exercises the whole event pipeline.
    const a = runMatch({ ...config, seed: 4242, botCount: 10 });
    const b = runMatch({ ...config, seed: 4242, botCount: 10 });
    expect(a.checksum).toBe(b.checksum);
  });
});
