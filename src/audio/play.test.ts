import { describe, it, expect } from 'vitest';
import { createAudioBus } from './context';
import { GLOBAL_CAP, emptyState } from './voices';
import { panFor, playFrame, playPlinkoFrame, tickToMs } from './play';
import type { Effect } from '../sim/arena/effects';
import type { PlinkoEffect } from '../sim/plinko/plinko';
import type { BotBuild } from '../sim/parts/assemble';

/**
 * The join between the simulation and the sound. What comes OUT of a speaker cannot be tested
 * here — that is the watch gate's job — so these cover the two things that would be silently
 * wrong and expensive to find later: that the mixer state actually threads through frames, and
 * that a screen with no audio still runs.
 */

/** A bus that can never build a context, as in a browser that blocks Web Audio. */
function silentBus() {
  return createAudioBus({
    factory: () => {
      throw new Error('no audio in this test');
    },
  });
}

const build = (): BotBuild => ({
  chassis: 0, drive: 0, weapon: 0, armour: 0, ability: 0, personality: 0,
});
const builds = Array.from({ length: 10 }, build);

function hit(x: number, botId = 'bot-0'): Effect {
  return { kind: 'weaponHit', x, y: 0, intensity: 0.8, botId };
}

function peg(x: number): PlinkoEffect {
  return { kind: 'pegHit', x, y: 0, intensity: 0.6, ballIndex: 0 };
}

describe('panning', () => {
  it('maps the arena across the stereo field', () => {
    expect(panFor(0, 800)).toBeCloseTo(-1);
    expect(panFor(400, 800)).toBeCloseTo(0);
    expect(panFor(800, 800)).toBeCloseTo(1);
  });

  it('never leaves the field, whatever the simulation hands over', () => {
    for (const x of [-500, 0, 400, 5000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pan = panFor(x, 800);
      expect(pan, String(x)).toBeGreaterThanOrEqual(-1);
      expect(pan, String(x)).toBeLessThanOrEqual(1);
    }
    expect(panFor(400, 0)).toBe(0); // a zero-width arena is centred, not divided by zero
  });
});

describe('the clock', () => {
  it('runs on simulation ticks, not on the wall', () => {
    // 60 ticks is one second of SIMULATION time regardless of how long the frame took to
    // render, so a slow machine gets the same mix as a fast one.
    expect(tickToMs(60)).toBeCloseTo(1000);
    expect(tickToMs(0)).toBe(0);
  });
});

describe('playFrame', () => {
  it('threads mixer state across frames, so the caps actually engage', () => {
    // The failure this guards against is silent: a caller that drops the returned state gets
    // a mix with no memory, every frame starts empty, and the battle sounds like static.
    const bus = silentBus();
    let state = emptyState();
    for (let frame = 0; frame < 40; frame++) {
      state = playFrame({
        bus,
        effects: [hit(100), hit(200), hit(300)],
        builds,
        state,
        nowMs: tickToMs(frame),
        width: 800,
      });
    }
    const ringing = [...state.live.values()].reduce((n, times) => n + times.length, 0);
    expect(ringing).toBeGreaterThan(0);
    expect(ringing).toBeLessThanOrEqual(GLOBAL_CAP);
  });

  it('returns the state untouched on an empty frame', () => {
    const before = emptyState();
    const after = playFrame({
      bus: silentBus(), effects: [], builds, state: before, nowMs: 0, width: 800,
    });
    expect(after).toBe(before);
  });

  it('runs without a working AudioContext', () => {
    // A browser that blocks audio must still get a working walkthrough, silently.
    const bus = silentBus();
    bus.unlock();
    expect(() => playFrame({
      bus, effects: [hit(0), hit(800)], builds, state: emptyState(), nowMs: 0, width: 800,
    })).not.toThrow();
  });

  it('survives builds that do not cover the bot that was hit', () => {
    expect(() => playFrame({
      bus: silentBus(), effects: [hit(100, 'bot-99')], builds: [], state: emptyState(),
      nowMs: 0, width: 800,
    })).not.toThrow();
  });
});

describe('playPlinkoFrame', () => {
  it('keeps its own budget, so a board cannot inherit a battle mix', () => {
    const bus = silentBus();
    let state = emptyState();
    for (let frame = 0; frame < 30; frame++) {
      state = playPlinkoFrame({
        bus, effects: [peg(100), peg(400)], state, nowMs: tickToMs(frame), width: 720,
      });
    }
    const ringing = [...state.live.values()].reduce((n, times) => n + times.length, 0);
    expect(ringing).toBeGreaterThan(0);
    expect([...state.live.keys()]).toEqual(['pegPing']);
  });

  it('runs silently and without throwing when there is no audio', () => {
    const bus = silentBus();
    bus.unlock();
    expect(() => playPlinkoFrame({
      bus, effects: [peg(0), peg(720)], state: emptyState(), nowMs: 0, width: 720,
    })).not.toThrow();
  });
});
