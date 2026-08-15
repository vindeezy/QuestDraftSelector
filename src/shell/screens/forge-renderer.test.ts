// @vitest-environment jsdom
//
// Separate file from `forge.test.ts` on purpose: `vi.mock` applies to every test in the
// file it's declared in, and this file replaces `canvasSupportsWebGL` and
// `createPlinkoRenderer` for every test here — the rest of `forgeScreen`'s behaviour
// (progressive reveal, replay correctness) is covered against the *real* modules in
// `forge.test.ts`, which needs those mocks absent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROSTER } from '../../config/roster';
import { CATEGORIES, slotCountFor } from '../../sim/parts/tables';
import { FIRST_BEAT } from '../beats';
import type { ScreenContext } from './types';

const { createPlinkoRendererMock, drawMock, destroyMock } = vi.hoisted(() => {
  const drawMock = vi.fn();
  const destroyMock = vi.fn();
  // Typed with five params (rather than `()`) purely so `mock.calls[0]` below is typed
  // as a 5-tuple and the highlight-index / ball-visuals / extras arguments can be
  // indexed out of it — the real `createPlinkoRenderer` signature isn't imported here on
  // purpose (this mock replaces it entirely).
  const createPlinkoRendererMock = vi.fn(
    async (parent: unknown, run: unknown, highlight: unknown, visuals: unknown, extras: unknown) => {
      void parent;
      void run;
      void highlight;
      void visuals;
      void extras;
      return { draw: drawMock, destroy: destroyMock };
    },
  );
  return { createPlinkoRendererMock, drawMock, destroyMock };
});

vi.mock('../canvas-support', () => ({
  canvasSupportsWebGL: () => true,
}));

vi.mock('../../render/plinko-renderer', () => ({
  createPlinkoRenderer: createPlinkoRendererMock,
  // `forge.ts` calls this synchronously (before `createPlinkoRenderer` even resolves)
  // to compute the extras it passes in — it has to exist on the mock too, or every
  // test in this file blows up before the assertion it's actually checking.
  releaseMargin: vi.fn(() => 0),
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
    controls: document.createElement('div'),
    replay: vi.fn(),
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

  it('passes every slot its label, matching slotLabelsFor for that board — for all six categories', async () => {
    const { forgeScreen, slotLabelsFor } = await import('./forge');
    const beats = ['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6'] as const;

    for (let i = 0; i < beats.length; i++) {
      createPlinkoRendererMock.mockClear();
      const ctx = makeContext();
      const teardown = forgeScreen(beats[i]!).render(ctx)!;

      await Promise.resolve();
      await Promise.resolve();

      const category = CATEGORIES[i]!;
      const [, , , , extras] = createPlinkoRendererMock.mock.calls[0]! as [
        unknown,
        unknown,
        unknown,
        unknown,
        { slotLabels?: readonly string[] },
      ];

      expect(extras.slotLabels).toEqual(slotLabelsFor(category));
      expect(extras.slotLabels).toHaveLength(slotCountFor(category));

      teardown();
    }
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
