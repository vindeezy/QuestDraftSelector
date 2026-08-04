import { createBody, type Body } from '../body';
import { createRng } from '../rng';
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

export interface PlinkoRun {
  config: PlinkoConfig;
  board: Board;
  world: World;
  balls: PlinkoBall[];
  landings: Landing[];
  done: boolean;
  settledFor: number;
  inSlotsFor: number;
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

  // One release position per ball: its own slice of the band, at its own height.
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    positions.push({
      x: bandLeft + slice * (i + 0.5),
      y: -config.ballRadius - i * config.releaseStagger,
    });
  }

  // Fisher-Yates, seeded. This step is fairness-critical, not cosmetic.
  //
  // A symmetric random walk preserves the expected value of its starting position, so
  // a ball released on the left lands left on average no matter how many peg rows it
  // falls through — extra rows widen the spread but never move the mean. Assigning
  // release positions by ball index therefore hands each member a permanently
  // different distribution. Measured over 5,000 balls before this shuffle existed:
  // ball 0 averaged slot 1.72 and ball 9 averaged slot 5.64, a 3.9-slot bias on a
  // 9-slot board. Randomising the assignment is the only thing that removes it.
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = positions[i]!;
    positions[i] = positions[j]!;
    positions[j] = swap;
  }

  const balls: PlinkoBall[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    const slot = positions[i]!;
    const body = createBody({
      id: `ball-${i}`,
      x: slot.x + rng.range(-slice * 0.3, slice * 0.3),
      y: slot.y,
      radius: config.ballRadius,
      mass: 1,
      vx: rng.range(-0.15, 0.15),
      vy: 0,
      restitution: config.ballRestitution,
    });
    balls.push({ index: i, body });
    world.bodies.push(body);
  }

  return { config, board, world, balls, landings: [], done: false, settledFor: 0, inSlotsFor: 0 };
}

/** Advances the run by one tick. Safe to call after `done` — it becomes a no-op. */
export function advance(run: PlinkoRun): void {
  if (run.done) return;

  step(run.world);

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
