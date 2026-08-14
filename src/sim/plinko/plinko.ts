import { createBody, type Body } from '../body';
import { createRng, type Rng } from '../rng';
import { createWorld, step, isSettled, type World } from '../world';
import { hashWorld } from '../checksum';
import { slotForX, buildBoard, type Board, type BoardConfig } from './board';

export interface PlinkoConfig {
  seed: number;
  board: BoardConfig;
  ballCount: number;
  ballRadius: number;
  ballRestitution: number;
  /** Fraction of board width the balls are released across. 0.2 = middle 20%. */
  releaseSpread: number;
  /** Vertical gap between successive balls at release. */
  releaseStagger: number;
  gravity: number;
  maxSpeed: number;
  drag: number;
  /** Speed below which a ball counts as stopped. */
  settleThreshold: number;
  /** Consecutive settled ticks required before the run ends. */
  settleTicks: number;
  /**
   * Ticks to wait for stillness after every ball is in the slot zone, before
   * finishing anyway. Guarantees termination when a ball stack never fully calms.
   */
  settleGraceTicks: number;
  maxTicks: number;
}

export interface Landing {
  ballIndex: number;
  slot: number;
  /** Tick at which this ball was recorded as landed. */
  tick: number;
}

export interface PlinkoBall {
  index: number;
  body: Body;
}

export interface PlinkoResult {
  seed: number;
  landings: Landing[];
  ticks: number;
  settled: boolean;
  checksum: string;
}

/**
 * The Forge's effect bus — the same idea, and the same four rules, as the arena's
 * (`src/sim/arena/effects.ts`), restated here so a reader of this file never has to go and
 * find them:
 *
 * 1. Derived, never causal. Nothing in `src/sim/` reads this to decide anything; the push
 *    below sits alongside behaviour that already existed.
 * 2. Never checksummed. `runPlinko`'s checksum is built from ball state; it never touches
 *    this. Emitting here must not move the pinned Forge checksums.
 * 3. Cleared at the START of each `advance`, so a tick's list describes only that tick.
 * 4. Deterministic: every value is a pure function of state already computed for physics.
 */
export interface PlinkoEffect {
  kind: 'pegHit';
  x: number;
  y: number;
  /** 0-1, from impact speed — see `PEG_HIT_REFERENCE_SPEED`. */
  intensity: number;
  /** Which ball struck, so a consumer can pan or vary per member. */
  ballIndex: number;
}

/**
 * The impact speed treated as a full-strength peg strike.
 *
 * `maxSpeed` is 5.5 and a ball spends most of its fall well under that, so normalising
 * against the cap would make almost every ping inaudible. 2.2 is roughly a ball at terminal
 * speed clipping a peg squarely — the strike you actually want to hear. Faster hits clamp.
 */
export const PEG_HIT_REFERENCE_SPEED = 2.2;

export function pegHitIntensity(speed: number): number {
  const n = speed / PEG_HIT_REFERENCE_SPEED;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export interface PlinkoRun {
  config: PlinkoConfig;
  board: Board;
  world: World;
  balls: PlinkoBall[];
  landings: Landing[];
  done: boolean;
  settledFor: number;
  inSlotsFor: number;
  /**
   * Ball-on-peg strikes from this tick only, for the audio layer. See `PlinkoEffect` above
   * for the contract this keeps.
   */
  effects: PlinkoEffect[];
}

/**
 * Starting values. Ball radius must stay comfortably above `maxSpeed` when added to
 * the peg radius, or a ball can pass through a peg in a single tick.
 */
export const DEFAULT_PLINKO: Omit<PlinkoConfig, 'board' | 'seed'> = {
  ballCount: 10,
  ballRadius: 13,
  ballRestitution: 0.34,
  releaseSpread: 0.2,
  releaseStagger: 34,
  gravity: 0.24,
  maxSpeed: 5.5,
  drag: 0.997,
  // Must sit above the residual jitter of a ball at rest. A ball on the floor never
  // truly reaches zero: gravity adds `gravity` each tick and the bounce returns
  // `restitution` of it, settling into a steady wobble of about
  // restitution * gravity / (1 + restitution) — roughly 0.06 at these values.
  //
  // Balls stacked on other balls wobble far harder, because ball-ball contacts
  // deliberately under-correct penetration (SEPARATION_BIAS) while the floor
  // corrects fully. A measured three-ball stack sat at 0.36. 0.6 clears that with
  // margin while staying an order of magnitude below meaningful motion.
  settleThreshold: 0.6,
  settleTicks: 30,
  settleGraceTicks: 400,
  maxTicks: 20000,
};

/** Fisher-Yates, driven by the seeded PRNG so the ordering replays identically. */
function shuffle(values: number[], rng: Rng): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = values[i]!;
    values[i] = values[j]!;
    values[j] = swap;
  }
}

export function createPlinkoRun(config: PlinkoConfig): PlinkoRun {
  const board = buildBoard(config.board);
  const rng = createRng(config.seed);

  const world = createWorld({
    gravity: config.gravity,
    maxSpeed: config.maxSpeed,
    drag: config.drag,
    iterations: 2,
  });
  world.bodies.push(...board.pegs);
  world.segments.push(...board.segments);

  // Balls release across the middle band of the board. They cannot share a release
  // point or they would jam, so each gets its own slice of the band plus a small
  // seeded jitter. This jitter is the ONLY randomness in the whole simulation —
  // everything after it is pure deterministic physics.
  const bandWidth = config.board.width * config.releaseSpread;
  const bandLeft = (config.board.width - bandWidth) / 2;
  const slice = bandWidth / config.ballCount;

  // Release slices across the band, and release heights, are generated separately and
  // shuffled INDEPENDENTLY. Both shuffles are load-bearing and they fix two different
  // problems.
  //
  // Shuffling at all is what makes the board fair between members. A symmetric random
  // walk preserves the expected value of its starting position, so a ball released on
  // the left lands left on average no matter how many peg rows it falls through —
  // extra rows widen the spread but never move the mean. Assigning slices by ball
  // index therefore hands each member a permanently different distribution. Measured
  // over 5,000 balls before any shuffle existed: ball 0 averaged slot 1.72 and ball 9
  // averaged slot 5.64, a 3.9-slot bias on a 9-slot board.
  //
  // Shuffling the two arrays independently, rather than shuffling paired (x, y)
  // positions, is what keeps the board itself left-right symmetric. If the leftmost
  // slice is always the one released lowest, the left side always drops first into a
  // clear board while the right side always falls into a crowded one. That skewed the
  // outer slots to 8.77% versus 6.53% over 3,000 balls even with paired shuffling.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    xs.push(bandLeft + slice * (i + 0.5));
    ys.push(-config.ballRadius - i * config.releaseStagger);
  }
  shuffle(xs, rng);
  shuffle(ys, rng);

  const balls: PlinkoBall[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    const body = createBody({
      id: `ball-${i}`,
      x: xs[i]! + rng.range(-slice * 0.3, slice * 0.3),
      y: ys[i]!,
      radius: config.ballRadius,
      mass: 1,
      vx: rng.range(-0.15, 0.15),
      vy: 0,
      restitution: config.ballRestitution,
    });
    balls.push({ index: i, body });
    world.bodies.push(body);
  }

  return { config, board, world, balls, landings: [], done: false, settledFor: 0, inSlotsFor: 0, effects: [] };
}

/** Advances the run by one tick. Safe to call after `done` — it becomes a no-op. */
export function advance(run: PlinkoRun): void {
  if (run.done) return;

  // Cleared before anything else runs, so this list describes exactly the tick below.
  run.effects.length = 0;

  step(run.world);

  // A ball-peg contact is one body id starting `ball-` and one starting `peg-` (see
  // `board.ts` and the ball creation below). Ball-on-ball and ball-on-divider contacts are
  // deliberately not emitted: the pegs are what make the cascade sound like a cascade, and
  // adding the rest would triple the event count for no extra character.
  for (const contact of run.world.contacts) {
    const ballId = contact.a.startsWith('ball-') ? contact.a : contact.b.startsWith('ball-') ? contact.b : null;
    const isPeg = contact.a.startsWith('peg-') || contact.b.startsWith('peg-');
    if (ballId === null || !isPeg) continue;
    run.effects.push({
      kind: 'pegHit',
      x: contact.x,
      y: contact.y,
      intensity: pegHitIntensity(contact.speed),
      ballIndex: Number(ballId.slice('ball-'.length)),
    });
  }

  if (isSettled(run.world, run.config.settleThreshold)) {
    run.settledFor++;
  } else {
    run.settledFor = 0;
  }

  // A ball below this line is fully enclosed by its slot dividers, which run from
  // slotTopY to the floor. Its slot index therefore cannot change again, no matter
  // how much it continues to jostle. That is what makes the grace period below safe:
  // waiting for stillness is cosmetic, not a correctness requirement.
  const allInSlots = run.balls.every(
    (ball) => ball.body.y > run.config.board.slotTopY + run.config.ballRadius,
  );
  run.inSlotsFor = allInSlots ? run.inSlotsFor + 1 : 0;

  const calm = run.settledFor >= run.config.settleTicks;
  const waitedLongEnough = run.inSlotsFor >= run.config.settleGraceTicks;

  if ((allInSlots && (calm || waitedLongEnough)) || run.world.tick >= run.config.maxTicks) {
    finish(run);
  }
}

function finish(run: PlinkoRun): void {
  run.landings = run.balls.map((ball) => ({
    ballIndex: ball.index,
    slot: slotForX(run.board, ball.body.x),
    tick: run.world.tick,
  }));
  run.done = true;
}

/** Runs a complete drop headlessly and returns the result. */
export function runPlinko(config: PlinkoConfig): PlinkoResult {
  const run = createPlinkoRun(config);
  while (!run.done) advance(run);

  return {
    seed: config.seed,
    landings: run.landings,
    ticks: run.world.tick,
    settled: run.world.tick < config.maxTicks,
    checksum: hashWorld(run.world),
  };
}
