import { createRng, type Rng } from '../rng';
import { createWorld, step, type World } from '../world';
import { hashNumbers } from '../checksum';
import { ANGLE_STEPS } from '../trig';
import { buildArena, type Arena, type ArenaConfig } from './arena';
import { isOverHole } from './tiles';
import { applyGrip, applyThrust, createBot, steerToward, DEFAULT_BOT, type Bot } from './bot';
import { resolveHit } from './combat';

export type EliminationCause = 'destroyed' | 'fell';

export interface Elimination {
  botId: string;
  cause: EliminationCause;
  tick: number;
  /** Bot that dealt the killing blow, when there was one. */
  byId: string | null;
}

export interface Placement {
  botId: string;
  /** 1 is the winner. */
  place: number;
}

export interface MatchConfig {
  seed: number;
  arena: ArenaConfig;
  botCount: number;
  maxTicks: number;
  drag: number;
}

export interface Match {
  config: MatchConfig;
  arena: Arena;
  world: World;
  bots: Bot[];
  eliminations: Elimination[];
  done: boolean;
}

export interface MatchResult {
  seed: number;
  placements: Placement[];
  eliminations: Elimination[];
  ticks: number;
  checksum: string;
}

/**
 * Match defaults for the greybox.
 *
 * `maxTicks` is 18000, which is five minutes at 60 ticks per second — the hard ceiling
 * from the design. The spiral collapse that normally forces an ending before then is a
 * later task, so until it exists some matches will run to the limit. That is expected.
 */
export const DEFAULT_MATCH: Omit<MatchConfig, 'arena' | 'seed'> = {
  botCount: 10,
  maxTicks: 18000,
  drag: 0.985,
};

/** Spawns bots on solid floor, spread out, without overlapping. */
function spawnBots(arena: Arena, count: number, rng: Rng): Bot[] {
  const bots: Bot[] = [];
  const size = arena.config.tileSize;

  // Candidate tiles: solid, and not on the outer ring so nobody starts against a wall.
  const candidates: Array<readonly [number, number]> = [];
  for (let row = 1; row < arena.config.rows - 1; row++) {
    for (let col = 1; col < arena.config.cols - 1; col++) {
      const x = col * size + size / 2;
      const y = row * size + size / 2;
      if (!isOverHole(arena.grid, x, y)) candidates.push([col, row]);
    }
  }

  // Shuffle with the seeded PRNG so spawn position never correlates with bot index —
  // the same fairness rule the Plinko board needed.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = swap;
  }

  for (let i = 0; i < count; i++) {
    const [col, row] = candidates[i]!;
    bots.push(
      createBot({
        id: `bot-${i}`,
        x: col * size + size / 2,
        y: row * size + size / 2,
        heading: Math.floor(rng.next() * ANGLE_STEPS),
      }),
    );
  }

  return bots;
}

export function createMatch(config: MatchConfig): Match {
  const arena = buildArena(config.arena);
  const rng = createRng(config.seed);

  const world = createWorld({
    gravity: 0,
    maxSpeed: DEFAULT_BOT.maxSpeed,
    drag: config.drag,
    iterations: 2,
  });
  world.segments.push(...arena.segments);

  const bots = spawnBots(arena, config.botCount, rng);
  for (const bot of bots) world.bodies.push(bot.body);

  return { config, arena, world, bots, eliminations: [], done: false };
}

/**
 * Placeholder AI: drive at the nearest living bot.
 *
 * Deliberately throwaway. It exists so movement and combat can be watched before the
 * real utility-based AI is designed. Do not build on it.
 */
function driveStub(match: Match, bot: Bot): void {
  let targetX = 0;
  let targetY = 0;
  let bestSq = Number.POSITIVE_INFINITY;
  let found = false;

  for (const other of match.bots) {
    if (other === bot || !other.alive) continue;
    const dx = other.body.x - bot.body.x;
    const dy = other.body.y - bot.body.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestSq) {
      bestSq = distSq;
      targetX = dx;
      targetY = dy;
      found = true;
    }
  }

  if (!found) return;
  steerToward(bot, targetX, targetY);
  applyThrust(bot, 1);
  applyGrip(bot);
}

function eliminate(match: Match, bot: Bot, cause: EliminationCause, byId: string | null): void {
  bot.alive = false;
  bot.body.invMass = 0;
  bot.body.vx = 0;
  bot.body.vy = 0;
  match.eliminations.push({ botId: bot.body.id, cause, tick: match.world.tick, byId });
}

export function advanceMatch(match: Match): void {
  if (match.done) return;

  for (const bot of match.bots) {
    if (bot.alive) driveStub(match, bot);
  }

  step(match.world);

  // `world.step` already resolved the physical collisions and reported them. This
  // converts those contacts into damage, once per direction so a head-on hurts both
  // and a flank attack is one-sided.
  for (const contact of match.world.contacts) {
    if (contact.b === 'segment') continue;
    const a = match.bots.find((bot) => bot.body.id === contact.a);
    const b = match.bots.find((bot) => bot.body.id === contact.b);
    if (!a || !b || !a.alive || !b.alive) continue;

    if (resolveHit(a, b, contact.speed) > 0 && b.health === 0) {
      eliminate(match, b, 'destroyed', a.body.id);
    }
    if (b.alive && resolveHit(b, a, contact.speed) > 0 && a.health === 0) {
      eliminate(match, a, 'destroyed', b.body.id);
    }
  }

  for (const bot of match.bots) {
    if (!bot.alive) continue;
    if (bot.health <= 0) {
      eliminate(match, bot, 'destroyed', null);
    } else if (isOverHole(match.arena.grid, bot.body.x, bot.body.y)) {
      eliminate(match, bot, 'fell', null);
    }
  }

  const living = match.bots.filter((bot) => bot.alive).length;
  if (living <= 1 || match.world.tick >= match.config.maxTicks) {
    match.done = true;
  }
}

/** Ranks bots: survivors first, then eliminated in reverse order of death. */
function buildPlacements(match: Match): Placement[] {
  const order: string[] = [];
  const survivors = match.bots.filter((bot) => bot.alive);

  // Ties among survivors at the tick limit break on remaining health, then bot id.
  survivors.sort((a, b) => {
    if (b.health !== a.health) return b.health - a.health;
    return a.body.id < b.body.id ? -1 : 1;
  });
  for (const bot of survivors) order.push(bot.body.id);

  for (let i = match.eliminations.length - 1; i >= 0; i--) {
    order.push(match.eliminations[i]!.botId);
  }

  return order.map((botId, index) => ({ botId, place: index + 1 }));
}

export function runMatch(config: MatchConfig): MatchResult {
  const match = createMatch(config);
  while (!match.done) advanceMatch(match);

  const values: number[] = [];
  for (const bot of match.bots) {
    values.push(bot.body.x, bot.body.y, bot.body.vx, bot.body.vy, bot.heading, bot.health);
  }
  values.push(match.world.tick);

  return {
    seed: config.seed,
    placements: buildPlacements(match),
    eliminations: match.eliminations,
    ticks: match.world.tick,
    checksum: hashNumbers(values),
  };
}
