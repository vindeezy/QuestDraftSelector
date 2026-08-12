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
import type { AssembledBot } from '../parts/assemble';
import { PERSONALITY_NAMES, type PersonalityName } from './personality';
import { buildSpiralOrder, updateCollapse } from './collapse';
import { updateButtons } from './activation';
import { updateTrapdoors } from './trapdoor';
import { effectOf, surfaceAt } from './surface';
import { applyZone } from './zone';
import { fireEmitters, stepProjectiles, type Projectile } from './projectile';
import { pushEffect, collisionIntensity, COLLISION_MIN_SPEED, type Effect } from './effects';

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
  /**
   * One assembled bot per bot index, from the Forge. When supplied, every bot's stats,
   * personality and ability come from its build instead of `DEFAULT_BOT` and the shuffled
   * assignment below — the Forge already assigned both fairly, so re-shuffling on top of
   * that would only throw away information. Optional so the greybox tests and the metrics
   * harness can keep running without builds, using the shuffle fallback exactly as before.
   * When supplied, must have exactly `botCount` entries.
   */
  builds?: AssembledBot[];
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
  /**
   * Impact moments from this tick only — weapon hits, hazard contact, hard collisions,
   * eliminations and so on — for the renderer and audio layer to react to. Cleared at
   * the START of every `advanceMatch` call, so this always describes exactly one tick.
   * Derived, never causal: nothing in `src/sim/` reads this to make a decision, and it is
   * never part of the checksum. See `effects.ts` for the full contract.
   */
  effects: Effect[];
}

export interface DamageDealt {
  botId: string;
  damageDealt: number;
  /** Total damage this bot sustained, from every source. See `Bot.damageTaken`. */
  damageTaken: number;
  /** Landed weapon hits this bot scored on another bot. See `Bot.contacts`. */
  contacts: number;
  /** Eliminations this bot caused. Mirrors `Bot.kills`, surfaced here for convenience. */
  kills: number;
  /**
   * The tick this bot was eliminated, or the match's final tick if it survived to the
   * end. Diagnostic only, alongside the rest of this record — nothing in the simulation
   * reads it.
   */
  survivalTicks: number;
}

export interface MatchResult {
  seed: number;
  placements: Placement[];
  eliminations: Elimination[];
  /** Per-bot totals for this match. The event's second tiebreaker (`damageDealt`) lives
   * here, alongside diagnostic-only fields that nothing in the simulation reads. */
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

/**
 * Spawns bots on solid floor, spread out, without overlapping.
 *
 * `builds`, when supplied, gives bot `i` its stats from `builds[i]`. Bot index already
 * maps straight to member index (see `runForgeBoard`'s and `runBattle`'s doc comments in
 * `event.ts`), and spawn position is shuffled independently of that index below, so
 * handing bot `i` build `i`'s stats introduces no new correlation between a member's
 * index and their outcome.
 */
function spawnBots(arena: Arena, count: number, rng: Rng, builds?: AssembledBot[]): Bot[] {
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
      createBot(
        {
          id: `bot-${i}`,
          x: col * size + size / 2,
          y: row * size + size / 2,
          heading: Math.floor(rng.next() * ANGLE_STEPS),
        },
        builds ? builds[i]!.stats : DEFAULT_BOT,
      ),
    );
  }

  return bots;
}

/**
 * Assigns a personality to every bot.
 *
 * Fallback only, used when no builds are supplied. Cycles through `PERSONALITY_NAMES`
 * until there are `botCount` entries, then shuffles with the seeded PRNG so personality
 * never correlates with bot index — the same fairness rule spawn position and the Plinko
 * board needed. When builds are supplied, personality comes from each build instead.
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
 * Fallback only, used when no builds are supplied. Cycles through `ABILITY_NAMES` until
 * there are `botCount` entries, then shuffles with the seeded PRNG so ability never
 * correlates with bot index — the same fairness rule spawn position and personality
 * already follow. When builds are supplied, ability comes from each build instead.
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

  const bots = spawnBots(arena, config.botCount, rng, config.builds);
  for (const bot of bots) world.bodies.push(bot.body);

  const personalities = config.builds
    ? config.builds.map((build) => build.personality)
    : assignPersonalities(config.botCount, rng);
  const aiStates = new Map<string, AiState>();
  bots.forEach((bot, i) => {
    aiStates.set(bot.body.id, createAiState(personalities[i]!));
  });

  const abilities = config.builds
    ? config.builds.map((build) => build.ability)
    : assignAbilities(config.botCount, rng);
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
    effects: [],
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
  // elimination: 1.0 always -- there is no "how hard", a bot is either out or it isn't.
  pushEffect(match.effects, 'elimination', bot.body.x, bot.body.y, 1, bot.body.id);

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

  // Cleared at the START of the tick, so `match.effects` always describes exactly the
  // tick that just ran, never a mix of this tick and stale carryover from the last.
  match.effects.length = 0;

  // Buttons update before the AI drives, so a plate armed this tick is already
  // dangerous this tick rather than one tick late.
  const tick = match.world.tick;
  updateButtons(match.arena.buttons, match.bots, tick);

  // Trapdoors update before the collapse, deliberately. `updateCollapse` is a pure,
  // idempotent function of the current tick that re-asserts `Gone` for every tile it
  // owns on every call, so a trapdoor that wrongly tries to reopen ground the collapse
  // has already claimed gets overwritten back to `Gone` a few lines below, in the same
  // tick, before anything reads the grid. Swap this order and that stops being true.
  updateTrapdoors(match.arena.trapdoors, match.arena.grid, tick, match.arena.buttons, match.effects);

  updateCollapse(match);

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
      applyZone(zone, bot, tick, match.arena.buttons, match.effects);
    }
  }

  fireEmitters(match.arena.emitters, tick, match.arena.buttons, match.projectiles, match.effects);
  stepProjectiles(
    match.projectiles,
    match.bots,
    match.arena.grid.width,
    match.arena.grid.height,
    match.effects,
  );

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

    // collision: every touching pair generates a contact every tick they overlap, most
    // of which is two bots resting against each other -- not an impact. COLLISION_MIN_SPEED
    // keeps only the ones that actually look/sound like a hit; see effects.ts for the
    // real-match data behind that number. botId is null: this is about the pair, not
    // either bot individually.
    if (contact.speed >= COLLISION_MIN_SPEED) {
      pushEffect(match.effects, 'collision', contact.x, contact.y, collisionIntensity(contact.speed), null);
    }

    // Each exchange can kill BOTH bots: the swing kills the target, and the target's
    // Spiked Composite reflects enough back to kill the swinger. Both checks run, and
    // neither is an `else` — a mutual kill credits both.
    //
    // The reflect check is why the swinger's own death is tested here rather than left
    // to the health sweep below. That sweep credits nobody, so a bot that impaled itself
    // on someone's spikes used to read as an unattributed "destroyed", as if a hazard had
    // done it. Spiked armour is a part its owner drafted and chose to carry; a kill it
    // earns belongs to them. Inside this block, a zero-health attacker can ONLY have been
    // reflected — nothing else in `resolveHit` touches the attacker's health.
    if (resolveHit(a, b, contact.speed, match.world.tick, match.effects) > 0) {
      maybeDisengage(match, a);
      launch(b, b.body.x - a.body.x, b.body.y - a.body.y, a.weaponKnockback, match.world.tick);
      if (b.health === 0) eliminate(match, b, 'destroyed', a.body.id);
      if (a.health === 0) eliminate(match, a, 'destroyed', b.body.id);
    }
    if (b.alive && resolveHit(b, a, contact.speed, match.world.tick, match.effects) > 0) {
      maybeDisengage(match, b);
      launch(a, a.body.x - b.body.x, a.body.y - b.body.y, b.weaponKnockback, match.world.tick);
      if (a.health === 0) eliminate(match, a, 'destroyed', b.body.id);
      if (b.health === 0) eliminate(match, b, 'destroyed', a.body.id);
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

  // Elimination tick per bot id, for `survivalTicks` below. A bot not in this map
  // survived to the final tick.
  const eliminationTick = new Map<string, number>();
  for (const e of match.eliminations) eliminationTick.set(e.botId, e.tick);

  return {
    seed: config.seed,
    placements: buildPlacements(match),
    eliminations: match.eliminations,
    damage: match.bots.map((bot) => ({
      botId: bot.body.id,
      damageDealt: bot.damageDealt,
      damageTaken: bot.damageTaken,
      contacts: bot.contacts,
      kills: bot.kills,
      survivalTicks: eliminationTick.get(bot.body.id) ?? match.world.tick,
    })),
    ticks: match.world.tick,
    checksum: hashNumbers(values),
  };
}
