import { createRng, type Rng } from '../rng';
import { createWorld, step, type World } from '../world';
import { hashNumbers } from '../checksum';
import { ANGLE_STEPS } from '../trig';

import { buildArena, type Arena, type ArenaConfig } from './arena';
import { isOverHole } from './tiles';
import { createBot, DEFAULT_BOT, type Bot } from './bot';
import { resolveHit } from './combat';
import { launch, updateLaunch } from './launch';
import { createAiState, driveWithAi, lockAction, CELEBRATE_TICKS, DISENGAGE_TICKS, type AiState } from './ai';
import { createAbilityState, updateAbility, ABILITY_NAMES, type AbilityState } from './ability';
import type { AbilityName } from '../parts/tables';
import { PERSONALITY_NAMES, type PersonalityName } from './personality';
import { buildSpiralOrder, updateCollapse } from './collapse';
import { updateButtons } from './activation';
import { effectOf, surfaceAt } from './surface';
import { applyZone } from './zone';
import { fireEmitters, stepProjectiles, type Projectile } from './projectile';

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
  /**
   * The match's seeded random stream. Stored here so anything that needs randomness
   * during a match — the AI's target lottery, the Agent of Chaos reroll — draws from
   * this one generator instead of creating a second source of truth.
   */
  rng: Rng;
  /**
   * AI state per bot, keyed by `bot.body.id`. Kept off the `Bot` type so `Bot` stays a
   * pure physics-and-stats record.
   */
  aiStates: Map<string, AiState>;
  /**
   * Ability state per bot, keyed by `bot.body.id`. Kept off `Bot` for the same reason
   * `aiStates` is: `Bot` stays a pure physics-and-stats record.
   */
  abilityStates: Map<string, AbilityState>;
  /** Tile indices in outside-in spiral order, consumed by the endgame collapse. */
  collapseOrder: number[];
  /** Shots in flight from emitters, live for the ticks between firing and impact. */
  projectiles: Projectile[];
}

export interface DamageDealt {
  botId: string;
  damageDealt: number;
}

export interface MatchResult {
  seed: number;
  placements: Placement[];
  eliminations: Elimination[];
  /** Total damage each bot dealt this match. The event's second tiebreaker. */
  damage: DamageDealt[];
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

/**
 * Assigns a personality to every bot.
 *
 * Cycles through `PERSONALITY_NAMES` until there are `botCount` entries, then shuffles
 * with the seeded PRNG so personality never correlates with bot index — the same
 * fairness rule spawn position and the Plinko board needed.
 */
function assignPersonalities(botCount: number, rng: Rng): PersonalityName[] {
  const assignment: PersonalityName[] = [];
  for (let i = 0; i < botCount; i++) {
    assignment.push(PERSONALITY_NAMES[i % PERSONALITY_NAMES.length]!);
  }

  for (let i = assignment.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = assignment[i]!;
    assignment[i] = assignment[j]!;
    assignment[j] = swap;
  }

  return assignment;
}

/**
 * Assigns an ability to every bot.
 *
 * Cycles through `ABILITY_NAMES` until there are `botCount` entries, then shuffles with
 * the seeded PRNG so ability never correlates with bot index — the same fairness rule
 * spawn position and personality already follow. Until the Forge is wired up (a later
 * task), this is every bot's only source of an ability; once builds are supplied there,
 * the ability will come from the build instead, exactly as personality will.
 */
function assignAbilities(botCount: number, rng: Rng): AbilityName[] {
  const assignment: AbilityName[] = [];
  for (let i = 0; i < botCount; i++) {
    assignment.push(ABILITY_NAMES[i % ABILITY_NAMES.length]!);
  }

  for (let i = assignment.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = assignment[i]!;
    assignment[i] = assignment[j]!;
    assignment[j] = swap;
  }

  return assignment;
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

  const personalities = assignPersonalities(config.botCount, rng);
  const aiStates = new Map<string, AiState>();
  bots.forEach((bot, i) => {
    aiStates.set(bot.body.id, createAiState(personalities[i]!));
  });

  const abilities = assignAbilities(config.botCount, rng);
  const abilityStates = new Map<string, AbilityState>();
  bots.forEach((bot, i) => {
    abilityStates.set(bot.body.id, createAbilityState(abilities[i]!, bot));
  });

  const collapseOrder = buildSpiralOrder(arena.grid);

  return {
    config,
    arena,
    world,
    bots,
    eliminations: [],
    done: false,
    rng,
    aiStates,
    abilityStates,
    collapseOrder,
    projectiles: [],
  };
}

/**
 * A bot that just landed a hit and leans heavily toward disengaging breaks off instead
 * of committing further. This is what makes Hit-and-Run strike and back away.
 */
function maybeDisengage(match: Match, attacker: Bot): void {
  const state = match.aiStates.get(attacker.body.id);
  if (state && state.weights.disengage > 0.7) {
    lockAction(state, 'disengage', match.world.tick, DISENGAGE_TICKS);
  }
}

function eliminate(match: Match, bot: Bot, cause: EliminationCause, byId: string | null): void {
  bot.alive = false;
  bot.body.invMass = 0;
  bot.body.vx = 0;
  bot.body.vy = 0;
  match.eliminations.push({ botId: bot.body.id, cause, tick: match.world.tick, byId });

  if (byId !== null) {
    const killer = match.bots.find((other) => other.body.id === byId);
    if (killer) {
      killer.kills++;
      const killerState = match.aiStates.get(killer.body.id);
      if (killerState && killerState.weights.celebrate > 0.5) {
        lockAction(killerState, 'celebrate', match.world.tick, CELEBRATE_TICKS);
      }
    }
  }
}

export function advanceMatch(match: Match): void {
  if (match.done) return;

  updateCollapse(match);

  // Buttons update before the AI drives, so a plate armed this tick is already
  // dangerous this tick rather than one tick late.
  const tick = match.world.tick;
  updateButtons(match.arena.buttons, match.bots, tick);

  for (const bot of match.bots) {
    if (!bot.alive) continue;
    driveWithAi(match, bot, match.aiStates.get(bot.body.id)!);
  }

  // Surfaces and zones apply before `step`, so the speed clamp inside `integrate` still
  // runs last. A body that ends a tick travelling further than the smallest thing it can
  // collide with passes straight through it, and ice reduces friction — applying these
  // after the clamp would reopen that hole.
  for (const bot of match.bots) {
    if (!bot.alive) continue;

    const surface = surfaceAt(match.arena.grid, match.arena.surfaces, bot.body.x, bot.body.y);
    const effect = effectOf(surface);
    bot.body.vx = bot.body.vx * effect.drag + effect.pushX;
    bot.body.vy = bot.body.vy * effect.drag + effect.pushY;

    for (const zone of match.arena.zones) {
      applyZone(zone, bot, tick, match.arena.buttons);
    }
  }

  fireEmitters(match.arena.emitters, tick, match.arena.buttons, match.projectiles);
  stepProjectiles(match.projectiles, match.bots, match.arena.grid.width, match.arena.grid.height);

  // Sync each bot's effective speed cap onto its body before physics runs this tick,
  // so a launch from a hit earlier this tick (or a decaying one from a prior tick) is
  // in place for `integrate` to clamp to.
  for (const bot of match.bots) {
    if (!bot.alive) continue;
    updateLaunch(bot, tick);
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

    a.lastContactTick = match.world.tick;
    a.lastContactId = b.body.id;
    b.lastContactTick = match.world.tick;
    b.lastContactId = a.body.id;

    if (resolveHit(a, b, contact.speed, match.world.tick) > 0) {
      maybeDisengage(match, a);
      launch(b, b.body.x - a.body.x, b.body.y - a.body.y, a.weaponKnockback, match.world.tick);
      if (b.health === 0) eliminate(match, b, 'destroyed', a.body.id);
    }
    if (b.alive && resolveHit(b, a, contact.speed, match.world.tick) > 0) {
      maybeDisengage(match, b);
      launch(a, a.body.x - b.body.x, a.body.y - b.body.y, b.weaponKnockback, match.world.tick);
      if (a.health === 0) eliminate(match, a, 'destroyed', b.body.id);
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

  // Abilities update after damage is fully resolved and before the next tick's AI runs,
  // so a bot that just crossed a threshold this tick acts on it starting next tick.
  for (const bot of match.bots) {
    if (!bot.alive) continue;
    updateAbility(match, bot, match.abilityStates.get(bot.body.id)!);
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
    damage: match.bots.map((bot) => ({ botId: bot.body.id, damageDealt: bot.damageDealt })),
    ticks: match.world.tick,
    checksum: hashNumbers(values),
  };
}
