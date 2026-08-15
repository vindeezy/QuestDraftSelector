import { describe, it, expect, beforeEach } from 'vitest';
import { ensureAudioResumed, sharedAudioBus, __resetAudioBusForTests } from './audio';

/**
 * There must be exactly ONE audio bus for the whole event.
 *
 * This file used to test a second `AudioContext` that lived here, separate from the one the
 * sound layer built. Two contexts means two output graphs: master volume and mute reach one
 * of them, the BEGIN gesture unlocks the other, and neither problem shows up until something
 * actually makes a noise. These tests exist to keep it collapsed.
 *
 * jsdom has no Web Audio, so the context factory is injected — the same seam `progress.ts`
 * uses for `localStorage`.
 */

interface FakeNode {
  name: string;
  connect(target: { name: string }): unknown;
}

function fakeContext(log: string[]) {
  const node = (name: string): FakeNode => ({
    name,
    connect(target) {
      log.push(`${name}->${target.name}`);
      return target;
    },
  });
  const ctx = {
    ...node('root'),
    currentTime: 0,
    state: 'suspended' as string,
    destination: node('destination'),
    resume() {
      ctx.state = 'running';
      log.push('resume');
      return Promise.resolve();
    },
    createGain: () => ({ ...node('gain'), gain: { value: 1 } }),
    createBiquadFilter: () => ({
      ...node('shelf'), type: '', frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 },
    }),
    createDynamicsCompressor: () => ({
      ...node('limiter'),
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 },
      attack: { value: 0 }, release: { value: 0 },
    }),
  };
  return ctx;
}

let log: string[];
let built: number;

beforeEach(() => {
  log = [];
  built = 0;
  __resetAudioBusForTests(() => {
    built++;
    return fakeContext(log) as unknown as AudioContext;
  });
});

describe('the shared bus', () => {
  it('is the same bus every time it is asked for', () => {
    expect(sharedAudioBus()).toBe(sharedAudioBus());
    expect(ensureAudioResumed()).toBe(sharedAudioBus());
  });

  it('stays silent until unlocked, because browsers block audio before a gesture', () => {
    expect(sharedAudioBus().ready).toBe(false);
    expect(built).toBe(0);

    ensureAudioResumed();

    expect(sharedAudioBus().ready).toBe(true);
    expect(built).toBe(1);
    expect(log).toContain('resume');
  });

  it('is idempotent, because BEGIN can be clicked twice', () => {
    ensureAudioResumed();
    ensureAudioResumed();
    ensureAudioResumed();
    expect(built).toBe(1);
  });

  it('keeps a volume set before the gesture', () => {
    // The controls exist on screens the viewer may reach before anything makes a sound.
    sharedAudioBus().setVolume(0.4);
    ensureAudioResumed();
    expect(sharedAudioBus().volume).toBeCloseTo(0.4);
    expect(sharedAudioBus().masterGain?.gain.value).toBeCloseTo(0.4);
  });

  it('lets the walkthrough continue on a browser with no Web Audio at all', () => {
    __resetAudioBusForTests(() => {
      throw new Error('no audio here');
    });
    expect(() => ensureAudioResumed()).not.toThrow();
    expect(sharedAudioBus().ready).toBe(false);
  });
});
