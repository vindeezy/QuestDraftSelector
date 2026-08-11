// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureAudioResumed, getSharedAudioContext, __resetAudioContextForTests } from './audio';
import type { AudioContextLike } from './audio';

/** A minimal stand-in for the real `AudioContext` — jsdom doesn't implement Web Audio
 *  at all, so every test here injects one of these rather than relying on a global. */
class FakeAudioContext implements AudioContextLike {
  state: string = 'suspended';
  resumeCalls = 0;

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }
}

/** Stands in for a browser old enough (or locked down enough) to have no Web Audio at
 *  all — constructing it always throws, the way calling a missing global would. */
class ThrowingAudioContext implements AudioContextLike {
  state = 'suspended';
  constructor() {
    throw new Error('AudioContext is not available');
  }
  async resume(): Promise<void> {
    // unreachable — the constructor always throws first
  }
}

beforeEach(() => {
  __resetAudioContextForTests();
});

describe('ensureAudioResumed', () => {
  it('creates and resumes a suspended context', async () => {
    const ctx = await ensureAudioResumed(FakeAudioContext);
    expect(ctx).not.toBeNull();
    expect((ctx as FakeAudioContext).resumeCalls).toBe(1);
    expect(ctx!.state).toBe('running');
  });

  it('reuses the same context across repeated calls instead of creating a new one', async () => {
    const first = await ensureAudioResumed(FakeAudioContext);
    const second = await ensureAudioResumed(FakeAudioContext);
    expect(second).toBe(first);
  });

  it('does not call resume() again once the context is already running', async () => {
    const first = (await ensureAudioResumed(FakeAudioContext)) as FakeAudioContext;
    expect(first.resumeCalls).toBe(1);
    await ensureAudioResumed(FakeAudioContext);
    expect(first.resumeCalls).toBe(1);
  });

  it('returns null, never throws, when no AudioContext constructor is available', async () => {
    await expect(ensureAudioResumed(null)).resolves.toBeNull();
  });

  it('returns null, never throws, when constructing the context itself throws', async () => {
    await expect(ensureAudioResumed(ThrowingAudioContext)).resolves.toBeNull();
  });

  it('updates the module-level singleton read by getSharedAudioContext', async () => {
    expect(getSharedAudioContext()).toBeNull();
    const ctx = await ensureAudioResumed(FakeAudioContext);
    expect(getSharedAudioContext()).toBe(ctx);
  });
});
