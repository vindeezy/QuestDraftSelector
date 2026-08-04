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
  // Must sit above the residual jitter of a ball at rest. A resting ball never
  // truly reaches zero: gravity adds `gravity` each tick and the bounce returns
  // `restitution` of it, settling into a steady wobble of about
  // restitution * gravity / (1 + restitution) — roughly 0.06 at these values.
  // A threshold below that means the run never terminates.
  settleThreshold: 0.3,
  settleTicks: 30,
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

  const balls: PlinkoBall[] = [];
  for (let i = 0; i < config.ballCount; i++) {
    const x = bandLeft + slice * (i + 0.5) + rng.range(-slice * 0.3, slice * 0.3);
    const y = -config.ballRadius - i * config.releaseStagger;
    const body = createBody({
      id: `ball-${i}`,
      x,
      y,
      radius: config.ballRadius,
      mass: 1,
      vx: rng.range(-0.15, 0.15),
      vy: 0,
      restitution: config.ballRestitution,
    });
    balls.push({ index: i, body });
    world.bodies.push(body);
  }

  return { config, board, world, balls, landings: [], done: false, settledFor: 0 };
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

  const allInSlots = run.balls.every(
    (ball) => ball.body.y > run.config.board.slotTopY + run.config.ballRadius,
  );

  if ((run.settledFor >= run.config.settleTicks && allInSlots) ||
      run.world.tick >= run.config.maxTicks) {
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
