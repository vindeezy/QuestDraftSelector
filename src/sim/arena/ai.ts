import { cosOf, sinOf } from '../trig';
import { isOverHole } from './tiles';
import { DEFAULT_BOT, isStunned, isUntargetable, type Bot } from './bot';
import { driveAway, driveToward, interceptOffset } from './steering';
import type { BotView } from './perception';
import { perceive } from './perception';
import { weightsFor, type PersonalityName, type Weights } from './personality';
import { effectOf, surfaceAt } from './surface';
import type { Match } from './match';

export const ACTIONS = [
  'relocate',
  'chase',
  'attackEngaged',
  'shove',
  'charge',
  'disengage',
  'retreat',
  'strafe',
  'celebrate',
] as const;

export type ActionName = (typeof ACTIONS)[number];

/** How long a showboat lasts. A deliberate vulnerability window. */
export const CELEBRATE_TICKS = 75;
/** How long a hit-and-run break-off lasts. */
export const DISENGAGE_TICKS = 90;
/** Beyond this range a charge is a run-up; inside it, back off first. */
const CHARGE_RANGE = 220;
/** Ticks between Agent of Chaos rerolling its own weights. */
const CHAOS_REROLL = 240;
/**
 * Scales hole repulsion into the same units as the chase offsets it blends with.
 *
 * Chase offsets are a vector to the target, so they routinely run to several hundred
 * units. At 260 the repulsion was simply outvoted: an aggressive bot (caution 0.3)
 * pushed back with about 65 units against a 300-unit pull, and drove in. Falls were 62%
 * of all eliminations, which made the whole match a contest of who avoided holes best
 * rather than who fought best.
 */
const AVOID_BLEND = 900;
/** How hard hazard proximity cuts the throttle. Scaled by caution. */
const BRAKE_STRENGTH = 0.9;
/** A braking bot never fully stops, or it would be a sitting target. */
const MIN_HAZARD_THROTTLE = 0.25;
/** How often the stuck check measures displacement. Four seconds. */
const STUCK_WINDOW = 240;
/** Net movement below this over the window counts as stuck. */
const STUCK_DISTANCE = 55;
/** How long a bot commits to its escape destination. */
const RELOCATE_TICKS = 150;

export interface AiState {
  personality: PersonalityName;
  weights: Weights;
  lockedAction: ActionName | null;
  lockedUntil: number;
  target: string | null;
  nextRetarget: number;
  nextChaosReroll: number;
  /** Position the stuck check measures displacement from. */
  anchorX: number;
  anchorY: number;
  anchorTick: number;
  /** Where a relocating bot is heading. */
  relocateX: number;
  relocateY: number;
}

export function createAiState(personality: PersonalityName): AiState {
  return {
    personality,
    weights: weightsFor(personality),
    lockedAction: null,
    lockedUntil: 0,
    target: null,
    nextRetarget: 0,
    nextChaosReroll: CHAOS_REROLL,
    anchorX: 0,
    anchorY: 0,
    anchorTick: 0,
    relocateX: 0,
    relocateY: 0,
  };
}

/**
 * Detects a bot that has stopped getting anywhere, and sends it somewhere else.
 *
 * Displacement is the right signal, not speed. Two failure modes were measured at seed
 * 725633 and only displacement catches both: a bot pressed against another in a shoving
 * stalemate (speed 1.8, contact gap exactly 40) and a bot in a turn so tight it went
 * nowhere while travelling flat out (speed 7.0, net displacement 10 units over 240
 * ticks — roughly 1,680 units of driving in a circle).
 *
 * On detection the bot commits to a random solid tile for a fixed span, which breaks
 * the symmetry that caused the lock-up in the first place.
 */
function checkStuck(match: Match, self: Bot, state: AiState): void {
  const tick = match.world.tick;
  if (tick - state.anchorTick < STUCK_WINDOW) return;

  const dx = self.body.x - state.anchorX;
  const dy = self.body.y - state.anchorY;
  const moved = Math.sqrt(dx * dx + dy * dy);

  state.anchorX = self.body.x;
  state.anchorY = self.body.y;
  state.anchorTick = tick;

  if (moved > STUCK_DISTANCE) return;

  // Pick a destination well away from here, drawn from the seeded stream.
  const grid = match.arena.grid;
  const size = grid.tileSize;
  for (let attempt = 0; attempt < 12; attempt++) {
    const col = Math.floor(match.rng.next() * grid.cols);
    const row = Math.floor(match.rng.next() * grid.rows);
    const x = col * size + size / 2;
    const y = row * size + size / 2;
    if (isOverHole(grid, x, y)) continue;
    const dx = x - self.body.x;
    const dy = y - self.body.y;
    // Compared squared, so no square root is needed at all here.
    if (dx * dx + dy * dy < size * 4 * (size * 4)) continue;
    state.relocateX = x;
    state.relocateY = y;
    lockAction(state, 'relocate', tick, RELOCATE_TICKS);
    return;
  }
}

/** Locks a bot into a behaviour for a fixed span, suspending normal scoring. */
export function lockAction(state: AiState, action: ActionName, tick: number, ticks: number): void {
  state.lockedAction = action;
  state.lockedUntil = tick + ticks;
}

function health01(bot: Bot): number {
  return bot.health / bot.maxHealth;
}

/**
 * Picks and commits to a target, re-drawn on the personality's retarget interval.
 *
 * Choosing the nearest bot every tick is what made the greybox stub produce duels
 * instead of a battle royale: the nearest bot stays nearest, so a fight never breaks up.
 * Committing to a target for a span and then re-drawing — weighted by personality, drawn
 * from the seeded PRNG — is what makes fights form, break, and reform.
 *
 * The chaseNearest / chaseWeakest / chaseLeader weights select the TARGET here. They are
 * not separate actions; a bot has one `chase` action and these decide who it chases.
 */
function resolveTarget(match: Match, self: Bot, state: AiState): Bot | null {
  const current =
    state.target === null ? null : match.bots.find((b) => b.body.id === state.target) ?? null;

  if (
    current !== null &&
    current.alive &&
    !isUntargetable(current, match.world.tick) &&
    match.world.tick < state.nextRetarget
  ) {
    return current;
  }

  const candidates = match.bots.filter(
    (b) => b !== self && b.alive && !isUntargetable(b, match.world.tick),
  );
  if (candidates.length === 0) {
    state.target = null;
    return null;
  }

  const weights: number[] = [];
  let total = 0;
  for (const c of candidates) {
    const dx = c.body.x - self.body.x;
    const dy = c.body.y - self.body.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // The trailing constant keeps every bot reachable, so even an unattractive target
    // is occasionally chosen. That residual is where unpredictability comes from.
    const weight =
      state.weights.chaseNearest / (1 + dist / 300) +
      state.weights.chaseWeakest * (1 - health01(c)) +
      (c.kills > 0 ? state.weights.chaseLeader : 0) +
      0.05;
    weights.push(weight);
    total += weight;
  }

  let roll = match.rng.next() * total;
  let picked = candidates[candidates.length - 1]!;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      picked = candidates[i]!;
      break;
    }
  }

  state.target = picked.body.id;
  state.nextRetarget = match.world.tick + state.weights.retargetInterval;
  return picked;
}

/**
 * Scores every action and returns the winner.
 *
 * Hazard avoidance is deliberately NOT an action here — it is blended into steering in
 * `driveWithAi`. Making it compete would force a bot to choose between chasing and
 * dodging; blending lets it do both, which is what competent driving looks like.
 */
export function chooseAction(
  match: Match,
  self: Bot,
  view: BotView,
  state: AiState,
): ActionName {
  const tick = match.world.tick;

  if (state.lockedAction !== null && tick < state.lockedUntil) return state.lockedAction;
  state.lockedAction = null;

  const w = state.weights;
  const hurt = 1 - health01(self);
  const dist = view.nearest === null ? Number.POSITIVE_INFINITY : Math.sqrt(view.nearestDistSq);
  const closeness = view.nearest === null ? 0 : 1 / (1 + dist / 300);

  let best: ActionName = 'strafe';
  let bestScore = -1;

  const consider = (action: ActionName, score: number): void => {
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  };

  if (view.nearest !== null) {
    // One chase action. WHO it chases is decided by resolveTarget, not by scoring
    // three near-identical actions against each other.
    const chaseDrive =
      (w.chaseNearest * closeness +
        w.chaseWeakest * (view.weakest === null ? 0 : 1 - health01(view.weakest)) +
        (view.leader === null ? 0 : w.chaseLeader)) /
      3;
    consider('chase', chaseDrive);
    consider('strafe', w.strafe * closeness * 0.5);
    consider('shove', w.shove * closeness);
    consider('charge', w.charge * (dist > CHARGE_RANGE ? 1 : 0.35));
  }
  if (view.engagedPair !== null) {
    consider('attackEngaged', w.attackEngaged);
  }
  consider('retreat', w.retreat * hurt);
  consider('disengage', w.disengage * hurt * 0.4);

  return best;
}

/** Where the chosen action wants to go, as an offset from the bot. */
function actionOffset(
  action: ActionName,
  self: Bot,
  view: BotView,
  target: Bot | null,
  state: AiState,
): { x: number; y: number } {
  const speed = DEFAULT_BOT.maxSpeed;
  const mark = target ?? view.nearest;

  const toward = (other: Bot): { x: number; y: number } =>
    interceptOffset(self, other.body.x, other.body.y, other.body.vx, other.body.vy, speed);

  switch (action) {
    case 'relocate':
      return { x: state.relocateX - self.body.x, y: state.relocateY - self.body.y };
    case 'chase':
    case 'charge':
      return mark ? toward(mark) : { x: 0, y: 0 };
    case 'shove': {
      // Not a plain ram. Line up on the far side of the target from where you want it
      // to end up, so the hit sends it there. This is the whole of the Instigator.
      if (!mark) return { x: 0, y: 0 };
      // Push it away from wherever the bot itself is being repelled — that is, toward
      // the danger the bot can see. If nothing is nearby, push it toward the arena edge.
      const pushX = -view.avoidX;
      const pushY = -view.avoidY;
      const len = Math.sqrt(pushX * pushX + pushY * pushY);
      if (len === 0) return toward(mark);
      const standoff = self.body.radius * 2;
      return {
        x: mark.body.x - (pushX / len) * standoff - self.body.x,
        y: mark.body.y - (pushY / len) * standoff - self.body.y,
      };
    }
    case 'attackEngaged': {
      if (view.engagedPair === null) return { x: 0, y: 0 };
      // Aim at the midpoint of the scrum, so it arrives between them.
      const [a, b] = view.engagedPair;
      return {
        x: (a.body.x + b.body.x) / 2 - self.body.x,
        y: (a.body.y + b.body.y) / 2 - self.body.y,
      };
    }
    case 'strafe': {
      if (!view.nearest) return { x: 0, y: 0 };
      // Perpendicular to the line to the target: circle rather than close.
      const dx = view.nearest.body.x - self.body.x;
      const dy = view.nearest.body.y - self.body.y;
      return { x: -dy, y: dx };
    }
    case 'retreat':
    case 'disengage':
      return mark
        ? { x: self.body.x - mark.body.x, y: self.body.y - mark.body.y }
        : { x: 0, y: 0 };
    case 'celebrate':
      // Spin on the spot: aim perpendicular to the current heading so it keeps turning.
      return { x: -sinOf(self.heading), y: cosOf(self.heading) };
  }
}

/**
 * Decides and drives one bot for one tick.
 *
 * Hole repulsion is blended into the chosen direction, scaled by `1 - riskTolerance`.
 * A defensive bot gives a pit a wide berth; a showman drives past it. Personality
 * governs how much risk is accepted, never whether the hazard is visible.
 */
export function driveWithAi(match: Match, self: Bot, state: AiState): void {
  if (!self.alive) return;
  // Stunned: no steering, no thrust. Momentum and shoveability are untouched — this
  // function simply never runs, so nothing here overwrites the body's velocity.
  if (isStunned(self, match.world.tick)) return;

  const view = perceive(match, self);
  const tick = match.world.tick;

  checkStuck(match, self, state);

  if (state.personality === 'chaos' && tick >= state.nextChaosReroll) {
    // Cycles through the other personalities, which is exactly what Agent of Chaos is.
    const others = ['aggressive', 'defensive', 'hitAndRun', 'thirdParty', 'showman', 'instigator'] as const;
    const pick = others[Math.floor(match.rng.next() * others.length)]!;
    state.weights = weightsFor(pick);
    state.nextChaosReroll = tick + CHAOS_REROLL;
  }

  const action = chooseAction(match, self, view, state);
  const target = resolveTarget(match, self, state);

  if (action === 'charge' && target !== null) {
    const dx = target.body.x - self.body.x;
    const dy = target.body.y - self.body.y;
    if (Math.sqrt(dx * dx + dy * dy) < CHARGE_RANGE * 0.5) {
      // Too close to build a run-up. Back off first, then commit on a later tick.
      driveAway(self, dx, dy);
      return;
    }
  }

  const want = actionOffset(action, self, view, target, state);
  const caution = 1 - state.weights.riskTolerance;

  // Hazard avoidance: push straight away from the hole, and brake so the turn radius
  // is small enough for that push to actually work.
  //
  // Steering AROUND the hole instead of back from it was tried and measured worse —
  // unassisted pit deaths rose from 46% to 53%, because the tangent runs along the
  // hole's edge and a bot skimming the boundary falls in on any drift.
  const danger = Math.sqrt(view.avoidX * view.avoidX + view.avoidY * view.avoidY);
  const dx = want.x + view.avoidX * caution * AVOID_BLEND;
  const dy = want.y + view.avoidY * caution * AVOID_BLEND;

  const brake = danger * caution * BRAKE_STRENGTH;
  const cap = brake > 1 - MIN_HAZARD_THROTTLE ? MIN_HAZARD_THROTTLE : 1 - brake;

  // The floor surface under the bot right now scales how much grip applies this tick —
  // ice lets it slide, gravel bites harder.
  const surface = surfaceAt(match.arena.grid, match.arena.surfaces, self.body.x, self.body.y);
  const gripScale = effectOf(surface).grip;

  driveToward(self, dx, dy, cap, gripScale);
}
