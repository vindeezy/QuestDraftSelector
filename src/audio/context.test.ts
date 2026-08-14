import { describe, it, expect } from 'vitest';
import { createAudioBus } from './context';

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
    const { bus, log } = makeBus();
    bus.unlock();
    expect(log).toEqual([
      { from: 'gain', to: 'limiter' },
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
