// @vitest-environment jsdom
//
// Separate file from `battle.test.ts` on purpose, mirroring `forge-renderer.test.ts`'s own
// split for the exact same reason given there: `vi.mock` applies to every test in the file
// it's declared in, and this file replaces `canvasSupportsWebGL` and `createArenaRenderer`
// for every test here so the wiring into the arena renderer can be checked directly. The
// replay-matches-`runEvent` correctness and the DOM-level gating/pacing behaviour are
// covered against the *real* modules in `battle.test.ts`, which needs those mocks absent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROSTER } from '../../config/roster';
import { ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { FIRST_BEAT } from '../beats';
import type { ScreenContext } from './types';

const { createArenaRendererMock, drawMock, destroyMock } = vi.hoisted(() => {
  const drawMock = vi.fn();
  const destroyMock = vi.fn();
  const createArenaRendererMock = vi.fn(
    async (
      parent: unknown,
      match: unknown,
      highlight: unknown,
      tags: unknown,
      visuals: unknown,
    ) => {
      void parent;
      void match;
      void highlight;
      void tags;
      void visuals;
      return { draw: drawMock, destroy: destroyMock };
    },
  );
  return { createArenaRendererMock, drawMock, destroyMock };
});

vi.mock('../canvas-support', () => ({
  canvasSupportsWebGL: () => true,
}));

vi.mock('../../render/arena-renderer', () => ({
  createArenaRenderer: createArenaRendererMock,
}));

const SEED = 743219;

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
  createArenaRendererMock.mockClear();
  drawMock.mockClear();
  destroyMock.mockClear();
});

describe('battleScreen — wiring into the arena renderer', () => {
  it('mounts all ten bots tinted with their member colour and labelled with their initials, and highlights the claimed member', async () => {
    const { battleScreen } = await import('./battle');
    const { memberBallVisuals } = await import('./forge');
    const ctx = makeContext('tommy');
    const teardown = battleScreen('battle-1').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    expect(createArenaRendererMock).toHaveBeenCalledTimes(1);
    const [, , highlightIndex, , botVisuals] = createArenaRendererMock.mock.calls[0]!;

    expect(botVisuals).toEqual(memberBallVisuals(ROSTER));
    expect(botVisuals).toHaveLength(10);

    const tommyIndex = ROSTER.findIndex((member) => member.id === 'tommy');
    expect(highlightIndex).toBe(tommyIndex);

    teardown();
  });

  it('highlights no one when no member is claimed', async () => {
    const { battleScreen } = await import('./battle');
    const ctx = makeContext(null);
    const teardown = battleScreen('battle-1').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    const [, , highlightIndex] = createArenaRendererMock.mock.calls[0]!;
    expect(highlightIndex).toBeNull();

    teardown();
  });

  it('mounts each battle beat against its own battle — its own arena variant and its own recorded seed, not always the first', async () => {
    const { battleScreen } = await import('./battle');
    const { getEventResult } = await import('./forge');
    const { toEventMembers } = await import('../../config/roster');
    const { ARENA_VARIANTS } = await import('../../sim/event/arenas');
    const beats = ['battle-1', 'battle-2', 'battle-3'] as const;

    const event = getEventResult(SEED, toEventMembers(ROSTER));

    for (let i = 0; i < beats.length; i++) {
      createArenaRendererMock.mockClear();
      const ctx = makeContext();
      const teardown = battleScreen(beats[i]!).render(ctx)!;

      await Promise.resolve();
      await Promise.resolve();

      expect(createArenaRendererMock).toHaveBeenCalledTimes(1);
      const [, match] = createArenaRendererMock.mock.calls[0]! as [
        unknown,
        { config: { arena: unknown; seed: number } },
        unknown,
        unknown,
        unknown,
      ];

      // `replayBattle` builds `MatchConfig` straight from `ARENA_VARIANTS[i]` and the
      // recorded battle seed, without cloning either — an identity/value check here is
      // exactly "this beat used its own battle, not battle 0's by accident".
      expect(match.config.arena).toBe(ARENA_VARIANTS[i]);
      expect(match.config.seed).toBe(event.battles[i]!.seed);

      teardown();
    }
  });

  it("names the arena and which battle this is, matching each beat's own arena", async () => {
    const { battleScreen } = await import('./battle');
    const beats = ['battle-1', 'battle-2', 'battle-3'] as const;

    for (let i = 0; i < beats.length; i++) {
      const ctx = makeContext();
      const teardown = battleScreen(beats[i]!).render(ctx)!;

      const text = ctx.container.textContent!.replace(/\s+/g, ' ');
      expect(text).toContain(`Battle ${i + 1} of 3`);
      expect(text).toContain(ARENA_VARIANT_NAMES[i]);

      teardown();
    }
  });

  it('destroys the renderer on teardown', async () => {
    const { battleScreen } = await import('./battle');
    const ctx = makeContext();
    const teardown = battleScreen('battle-3').render(ctx)!;

    await Promise.resolve();
    await Promise.resolve();

    expect(destroyMock).not.toHaveBeenCalled();
    teardown();
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('destroys the renderer even if teardown fires before the async mount resolves', async () => {
    const { battleScreen } = await import('./battle');
    const ctx = makeContext();
    const teardown = battleScreen('battle-1').render(ctx)!;

    // Tear down synchronously, before the `createArenaRenderer` promise has resolved.
    teardown();

    await Promise.resolve();
    await Promise.resolve();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('draws a frame once BEGIN is pressed', async () => {
    vi.useFakeTimers();
    try {
      const { battleScreen } = await import('./battle');
      const ctx = makeContext();
      const teardown = battleScreen('battle-1').render(ctx)!;

      await Promise.resolve();
      await Promise.resolve();

      const startButton = ctx.container.querySelector<HTMLButtonElement>('[data-role="start"]')!;
      startButton.click();

      await vi.advanceTimersByTimeAsync(16);
      expect(drawMock).toHaveBeenCalled();

      teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});
