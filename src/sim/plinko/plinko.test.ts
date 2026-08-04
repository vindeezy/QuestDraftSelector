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
