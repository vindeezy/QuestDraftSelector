// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { landingScreen } from './landing';
import { sharedAudioBus, __resetAudioBusForTests } from '../audio';
import { FIRST_BEAT } from '../beats';
import type { ScreenContext } from './types';

/** Stands in for the real `AudioContext` — jsdom has no Web Audio. Injected through the
 *  bus's factory seam, so this exercises the production call path: the landing screen asks
 *  for the shared bus by name, exactly as it does in the browser. */
function fakeContext() {
  const node = (name: string) => ({ name, connect: (t: { name: string }) => t });
  const ctx = {
    ...node('root'),
    currentTime: 0,
    state: 'suspended' as string,
    destination: node('destination'),
    resumeCalls: 0,
    resume() {
      ctx.resumeCalls++;
      ctx.state = 'running';
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

let audioCtx: ReturnType<typeof fakeContext> | null = null;

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
  audioCtx = null;
  __resetAudioBusForTests(() => {
    audioCtx = fakeContext();
    return audioCtx as unknown as AudioContext;
  });
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

  it('clicking Begin unlocks the one shared bus every later screen plays through', () => {
    // BEGIN is the only click guaranteed to happen before the Forge or a battle needs sound,
    // and browsers will not start audio outside a gesture. If this stops working the whole
    // event is silent, with nothing else to hang the unlock off.
    const ctx = makeContext();
    landingScreen.render(ctx);

    expect(sharedAudioBus().ready).toBe(false);
    ctx.container.querySelector<HTMLButtonElement>('button')!.click();

    expect(sharedAudioBus().ready).toBe(true);
    expect(audioCtx?.resumeCalls).toBe(1);
    expect(audioCtx?.state).toBe('running');
  });

  it('still navigates on a browser that refuses audio', () => {
    __resetAudioBusForTests(() => {
      throw new Error('no audio here');
    });
    const ctx = makeContext();
    landingScreen.render(ctx);

    ctx.container.querySelector<HTMLButtonElement>('button')!.click();

    expect(ctx.navigate).toHaveBeenCalledWith('name-select');
  });
});
