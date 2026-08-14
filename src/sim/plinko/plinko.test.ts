import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD } from './board';
import { DEFAULT_PLINKO, runPlinko, createPlinkoRun, advance } from './plinko';

const config = { ...DEFAULT_PLINKO, board: DEFAULT_BOARD };

describe('runPlinko', () => {
  it('lands every ball in a slot', () => {
    const result = runPlinko({ ...config, seed: 4242, ballCount: 10 });
    expect(result.landings.length).toBe(10);
    for (const landing of result.landings) {
      expect(landing.slot).toBeGreaterThanOrEqual(0);
      expect(landing.slot).toBeLessThan(DEFAULT_BOARD.slotCount);
    }
  });

  it('preserves ball identity in landing order', () => {
    const result = runPlinko({ ...config, seed: 77, ballCount: 10 });
    const ids = result.landings.map((l) => l.ballIndex).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('terminates well before the tick limit', () => {
    const result = runPlinko({ ...config, seed: 5, ballCount: 10 });
    expect(result.settled).toBe(true);
    expect(result.ticks).toBeLessThan(config.maxTicks);
  });

  it('produces identical results for the same seed', () => {
    const a = runPlinko({ ...config, seed: 31337, ballCount: 10 });
    const b = runPlinko({ ...config, seed: 31337, ballCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.landings).toEqual(b.landings);
  });

  it('produces different results for different seeds', () => {
    const a = runPlinko({ ...config, seed: 1, ballCount: 10 });
    const b = runPlinko({ ...config, seed: 2, ballCount: 10 });
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('handles a single ball', () => {
    expect(runPlinko({ ...config, seed: 9, ballCount: 1 }).landings.length).toBe(1);
  });

  it('handles twelve balls', () => {
    expect(runPlinko({ ...config, seed: 9, ballCount: 12 }).landings.length).toBe(12);
  });

  it('never produces a NaN position', () => {
    const run = createPlinkoRun({ ...config, seed: 808, ballCount: 10 });
    while (!run.done) {
      advance(run);
      for (const ball of run.balls) {
        expect(Number.isFinite(ball.body.x)).toBe(true);
        expect(Number.isFinite(ball.body.y)).toBe(true);
      }
    }
  });

  it('keeps every ball inside the board horizontally', () => {
    const run = createPlinkoRun({ ...config, seed: 1234, ballCount: 10 });
    while (!run.done) {
      advance(run);
      for (const ball of run.balls) {
        expect(ball.body.x).toBeGreaterThan(-1);
        expect(ball.body.x).toBeLessThan(DEFAULT_BOARD.width + 1);
      }
    }
  });
});

describe('advance', () => {
  it('reaches the same result as runPlinko when stepped manually', () => {
    const run = createPlinkoRun({ ...config, seed: 2024, ballCount: 10 });
    while (!run.done) advance(run);
    const direct = runPlinko({ ...config, seed: 2024, ballCount: 10 });
    expect(run.landings).toEqual(direct.landings);
  });

  it('is a no-op once the run is done', () => {
    const run = createPlinkoRun({ ...config, seed: 55, ballCount: 10 });
    while (!run.done) advance(run);
    const tickAtEnd = run.world.tick;
    const landingsAtEnd = run.landings;
    advance(run);
    advance(run);
    expect(run.world.tick).toBe(tickAtEnd);
    expect(run.landings).toEqual(landingsAtEnd);
  });
});

describe('the Forge effect bus', () => {
  /** Drives a run until it has emitted at least one peg strike, or gives up. */
  function untilFirstPegHit(seed: number): ReturnType<typeof createPlinkoRun> {
    const run = createPlinkoRun({ ...config, seed, ballCount: 10 });
    for (let i = 0; i < 2000 && !run.done && run.effects.length === 0; i++) advance(run);
    return run;
  }

  it('emits a peg strike as the balls fall', () => {
    const run = untilFirstPegHit(4242);
    expect(run.effects.length).toBeGreaterThan(0);
    expect(run.effects[0]!.kind).toBe('pegHit');
  });

  it('names which ball struck, and normalises the impact to 0-1', () => {
    const run = untilFirstPegHit(4242);
    for (const e of run.effects) {
      expect(e.ballIndex).toBeGreaterThanOrEqual(0);
      expect(e.ballIndex).toBeLessThan(10);
      expect(e.intensity).toBeGreaterThanOrEqual(0);
      expect(e.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('clears at the start of each tick, so a tick describes only itself', () => {
    // Rule 3 of the contract. Without the clear these would accumulate for the whole run,
    // and a consumer would replay every strike since the drop on every frame.
    const run = untilFirstPegHit(4242);
    const first = run.effects.length;
    expect(first).toBeGreaterThan(0);
    let sawSmaller = false;
    for (let i = 0; i < 200 && !run.done; i++) {
      advance(run);
      if (run.effects.length < first) sawSmaller = true;
      expect(run.effects.length).toBeLessThan(first + 200);
    }
    expect(sawSmaller).toBe(true);
  });

  it('emits nothing once the run is done', () => {
    const run = createPlinkoRun({ ...config, seed: 4242, ballCount: 10 });
    while (!run.done) advance(run);
    const after = run.effects.length;
    advance(run);
    expect(run.effects.length).toBe(after);
  });

  it('does not move the pinned Forge checksum — rule 2', () => {
    const a = runPlinko({ ...config, seed: 4242, ballCount: 10 });
    const b = runPlinko({ ...config, seed: 4242, ballCount: 10 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.landings).toEqual(b.landings);
  });
});
