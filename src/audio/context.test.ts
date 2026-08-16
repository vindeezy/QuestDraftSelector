import { describe, it, expect } from 'vitest';
import { DEFAULT_TONE_CUT, MAX_TONE_CUT, createAudioBus } from './context';

/**
 * jsdom has no Web Audio, and mocking a global would leave the module reaching for
 * something that only exists in a test. So `createAudioBus` takes its context factory as a
 * parameter, and this file passes a fake — the same injection `progress.ts` uses for
 * `localStorage`.
 *
 * The fake records every `connect` so the tests can assert the SHAPE of the audio graph,
 * which is the part that matters: everything must pass through one gain and one limiter, or
 * mute has holes in it and a brawl can clip.
 */
interface Connection {
  from: string;
  to: string;
}

function fakeContextFactory(log: Connection[] = []) {
  const node = (name: string) => ({
    name,
    connect(target: { name: string }) {
      log.push({ from: name, to: target.name });
      return target;
    },
    disconnect() {},
  });

  let resumed = 0;
  const ctx = {
    ...node('destination-owner'),
    currentTime: 0,
    state: 'suspended' as string,
    destination: node('destination'),
    resume() {
      resumed++;
      ctx.state = 'running';
      return Promise.resolve();
    },
    createGain() {
      return { ...node('gain'), gain: { value: 1 } };
    },
    createBiquadFilter() {
      return {
        ...node('shelf'),
        type: '' as string,
        frequency: { value: 0 },
        gain: { value: 0 },
        Q: { value: 0 },
      };
    },
    createDynamicsCompressor() {
      return {
        ...node('limiter'),
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 1 },
        attack: { value: 0 },
        release: { value: 0 },
      };
    },
    get resumeCount() {
      return resumed;
    },
  };
  return ctx;
}

function makeBus() {
  const log: Connection[] = [];
  let created = 0;
  const bus = createAudioBus({
    factory: () => {
      created++;
      return fakeContextFactory(log) as unknown as AudioContext;
    },
  });
  return { bus, log, created: () => created };
}

describe('createAudioBus', () => {
  it('stays silent until unlocked, because browsers block audio before a gesture', () => {
    const { bus, created } = makeBus();
    expect(bus.ready).toBe(false);
    expect(created()).toBe(0);

    bus.unlock();

    expect(bus.ready).toBe(true);
    expect(created()).toBe(1);
  });

  it('is idempotent, because BEGIN can be clicked twice', () => {
    const { bus, created } = makeBus();
    bus.unlock();
    bus.unlock();
    bus.unlock();
    expect(created()).toBe(1);
  });

  it('resumes the context on unlock — a suspended context makes no sound', () => {
    const { bus } = makeBus();
    bus.unlock();
    expect((bus.ctx as unknown as { resumeCount: number }).resumeCount).toBe(1);
  });

  it('routes everything through one master gain and one limiter, in that order', () => {
    // Asserted as the WHOLE chain rather than as "contains these hops", so a node quietly
    // added or reordered fails here. Mute has holes in it the moment anything bypasses the
    // gain, and a brawl clips the moment anything bypasses the limiter.
    const { bus, log } = makeBus();
    bus.unlock();
    expect(log).toEqual([
      { from: 'gain', to: 'shelf' },
      { from: 'shelf', to: 'limiter' },
      { from: 'limiter', to: 'destination' },
    ]);
  });

  it('mutes by taking the master gain to zero — one switch, no holes', () => {
    const { bus } = makeBus();
    bus.unlock();
    bus.setMuted(true);
    expect(bus.masterGain!.gain.value).toBe(0);
    expect(bus.muted).toBe(true);
  });

  it('restores the chosen volume on unmute rather than jumping to full', () => {
    const { bus } = makeBus();
    bus.unlock();
    bus.setVolume(0.3);
    bus.setMuted(true);
    bus.setMuted(false);
    expect(bus.masterGain!.gain.value).toBeCloseTo(0.3);
  });

  it('remembers a volume set while muted, and does not unmute by setting it', () => {
    const { bus } = makeBus();
    bus.unlock();
    bus.setMuted(true);
    bus.setVolume(0.6);
    expect(bus.masterGain!.gain.value).toBe(0);
    expect(bus.muted).toBe(true);
    bus.setMuted(false);
    expect(bus.masterGain!.gain.value).toBeCloseTo(0.6);
  });

  it('accepts a volume before unlock and applies it once unlocked', () => {
    // The lab and the battle screen both have a volume control that can be touched before
    // anything has played.
    const { bus } = makeBus();
    bus.setVolume(0.25);
    bus.unlock();
    expect(bus.masterGain!.gain.value).toBeCloseTo(0.25);
  });

  it('clamps volume to 0..1 rather than trusting a caller', () => {
    const { bus } = makeBus();
    bus.unlock();
    bus.setVolume(9);
    expect(bus.masterGain!.gain.value).toBe(1);
    bus.setVolume(-4);
    expect(bus.masterGain!.gain.value).toBe(0);
  });

  it('reports a time of zero before unlock, so a caller never reads a null context', () => {
    const { bus } = makeBus();
    expect(bus.now()).toBe(0);
    bus.unlock();
    expect(bus.now()).toBe(0);
  });

  it('survives a factory that throws, leaving the site silent rather than broken', () => {
    // Some browsers refuse to construct an AudioContext at all. Sound is decoration; it
    // must never take the walkthrough down with it.
    const bus = createAudioBus({
      factory: () => {
        throw new Error('no audio here');
      },
    });
    expect(() => bus.unlock()).not.toThrow();
    expect(bus.ready).toBe(false);
    expect(bus.masterGain).toBeNull();
  });
});

describe('the master tone control', () => {
  it('starts at the setting chosen by ear, not flat', () => {
    // The palette was judged too bright everywhere rather than in one voice, so the shelf is
    // part of how these sounds are meant to be heard rather than an optional correction.
    const { bus } = makeBus();
    expect(bus.toneCut).toBe(DEFAULT_TONE_CUT);
  });

  it('clamps to a sane range rather than trusting the caller', () => {
    const { bus } = makeBus();
    bus.setToneCut(-5);
    expect(bus.toneCut).toBe(0);
    bus.setToneCut(999);
    expect(bus.toneCut).toBe(MAX_TONE_CUT);
    bus.setToneCut(Number.NaN);
    expect(bus.toneCut).toBe(0);
  });

  it('sits BEFORE the limiter, so softening also eases what the limiter has to do', () => {
    // The other order would smooth over distortion the limiter had already introduced --
    // which is the failure that made two rounds of per-voice softening miss.
    const { bus, log } = makeBus();
    bus.unlock();
    expect(log).toContainEqual({ from: 'gain', to: 'shelf' });
    expect(log).toContainEqual({ from: 'shelf', to: 'limiter' });
    expect(log).not.toContainEqual({ from: 'gain', to: 'limiter' });
  });

  it('survives a browser with no Web Audio', () => {
    const bus = createAudioBus({
      factory: () => {
        throw new Error('no audio');
      },
    });
    bus.unlock();
    expect(() => bus.setToneCut(9)).not.toThrow();
    expect(bus.toneCut).toBe(9);
  });
});

describe('recovering a suspended context', () => {
  it('resumes on unlock when the browser has suspended it', () => {
    // Browsers suspend an audio context when its page is hidden or backgrounded. `unlock` used
    // to return early once a context existed, so navigating away from a battle and back left
    // the event permanently silent -- reported from a real watch, not from a test.
    const { bus } = makeBus();
    bus.unlock();
    const ctx = bus.ctx as unknown as { state: string; resume(): Promise<void> };

    ctx.state = 'suspended';
    bus.unlock();

    expect(ctx.state).toBe('running');
  });

  it('does not rebuild the context when it resumes one', () => {
    const { bus, created } = makeBus();
    bus.unlock();
    (bus.ctx as unknown as { state: string }).state = 'suspended';
    bus.unlock();
    expect(created()).toBe(1);
  });
});
