// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { landingScreen } from './landing';
import { getSharedAudioContext, __resetAudioContextForTests } from '../audio';
import { FIRST_BEAT } from '../beats';
import type { ScreenContext } from './types';

/** Stands in for the real `AudioContext` — see `audio.test.ts`'s doc comment for why
 *  jsdom can't provide one itself. Assigned onto `window`/`globalThis` here (rather than
 *  injected through a parameter, the way `audio.test.ts` does it directly) because the
 *  landing screen calls `ensureAudioResumed()` with no arguments, exactly as production
 *  code does — this test is checking that real call path, not the injectable one. */
class FakeAudioContext {
  state = 'suspended';
  resumeCalls = 0;
  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }
}

function makeContext(): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: 42,
    state: { hasCompletedOnce: false, claimedMemberId: null, furthestBeat: FIRST_BEAT },
    storage: undefined,
    navigate: vi.fn(),
  };
}

beforeEach(() => {
  __resetAudioContextForTests();
  (globalThis as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;
});

describe('landingScreen', () => {
  it('renders a Begin button', () => {
    const ctx = makeContext();
    landingScreen.render(ctx);

    const button = ctx.container.querySelector('button');
    expect(button?.textContent?.trim()).toBe('Begin');
  });

  it('clicking Begin advances to name-select', () => {
    const ctx = makeContext();
    landingScreen.render(ctx);

    ctx.container.querySelector<HTMLButtonElement>('button')!.click();

    expect(ctx.navigate).toHaveBeenCalledWith('name-select');
  });

  it('clicking Begin creates and resumes the shared AudioContext', async () => {
    const ctx = makeContext();
    landingScreen.render(ctx);

    expect(getSharedAudioContext()).toBeNull();
    ctx.container.querySelector<HTMLButtonElement>('button')!.click();

    // ensureAudioResumed() is fired without being awaited by the click handler
    // (audio must never block navigation) -- give its microtasks a turn.
    await Promise.resolve();
    await Promise.resolve();

    const audioCtx = getSharedAudioContext() as unknown as FakeAudioContext;
    expect(audioCtx).not.toBeNull();
    expect(audioCtx.resumeCalls).toBe(1);
    expect(audioCtx.state).toBe('running');
  });
});
