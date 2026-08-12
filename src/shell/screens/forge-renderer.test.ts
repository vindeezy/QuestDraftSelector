// @vitest-environment jsdom
//
// Separate file from `forge.test.ts` on purpose: `vi.mock` applies to every test in the
// file it's declared in, and this file replaces `canvasSupportsWebGL` and
// `createPlinkoRenderer` for every test here — the rest of `forgeScreen`'s behaviour
// (progressive reveal, replay correctness) is covered against the *real* modules in
// `forge.test.ts`, which needs those mocks absent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROSTER } from '../../config/roster';
import { FIRST_BEAT } from '../beats';
import type { ScreenContext } from './types';

const { createPlinkoRendererMock, drawMock, destroyMock } = vi.hoisted(() => {
  const drawMock = vi.fn();
  const destroyMock = vi.fn();
  // Typed with four params (rather than `()`) purely so `mock.calls[0]` below is typed
  // as a 4-tuple and the highlight-index / ball-visuals arguments can be indexed out of
  // it — the real `createPlinkoRenderer` signature isn't imported here on purpose (this
  // mock replaces it entirely).
  const createPlinkoRendererMock = vi.fn(async (parent: unknown, run: unknown, highlight: unknown, visuals: unknown) => {
    void parent;
    void run;
    void highlight;
    void visuals;
    return { draw: drawMock, destroy: destroyMock };
  });
  return { createPlinkoRendererMock, drawMock, destroyMock };
});

vi.mock('../canvas-support', () => ({
  canvasSupportsWebGL: () => true,
}));

vi.mock('../../render/plinko-renderer', () => ({
  createPlinkoRenderer: createPlinkoRendererMock,
}));

const SEED = 555111;

function makeContext(claimedMemberId: string | null = 'tommy'): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage: undefined,
    navigate: vi.fn(),
  };
}

beforeEach(() => {
  createPlinkoRendererMock.mockClear();
  drawMock.mockClear();
  destroyMock.mockClear();
});

describe('forgeScreen — wiring into the Plinko renderer', () => {
  it('mounts ten balls, each tinted with its member colour and labelled with their initials, and highlights the claimed member', async () => {
    const { forgeScreen, memberBallVisuals } = await import('./forge');
    const ctx = makeContext('tommy');
    const teardown = forgeScreen('forge-1').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    expect(createPlinkoRendererMock).toHaveBeenCalledTimes(1);
    const [, , highlightIndex, ballVisuals] = createPlinkoRendererMock.mock.calls[0]!;

    expect(ballVisuals).toEqual(memberBallVisuals(ROSTER));
    expect(ballVisuals).toHaveLength(10);

    const tommyIndex = ROSTER.findIndex((m) => m.id === 'tommy');
    expect(highlightIndex).toBe(tommyIndex);

    teardown();
  });

  it('highlights no one when no member is claimed', async () => {
    const { forgeScreen } = await import('./forge');
    const ctx = makeContext(null);
    const teardown = forgeScreen('forge-2').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    const [, , highlightIndex] = createPlinkoRendererMock.mock.calls[0]!;
    expect(highlightIndex).toBeNull();

    teardown();
  });

  it('destroys the renderer on teardown', async () => {
    const { forgeScreen } = await import('./forge');
    const ctx = makeContext();
    const teardown = forgeScreen('forge-3').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    expect(destroyMock).not.toHaveBeenCalled();
    teardown();
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('destroys the renderer even if teardown fires before the async mount resolves', async () => {
    const { forgeScreen } = await import('./forge');
    const ctx = makeContext();
    const teardown = forgeScreen('forge-4').render(ctx)!;

    // Tear down synchronously, before the `createPlinkoRenderer` promise has resolved.
    teardown();

    await Promise.resolve();
    await Promise.resolve();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
