// @vitest-environment jsdom
//
// Separate file from `build-reveal.test.ts` on purpose: `vi.mock` applies to every test
// in the file it's declared in, and this file replaces `canvasSupportsWebGL` and
// `mountBotPortraitStage` for every test here — the rest of `buildRevealScreen`'s
// behaviour (card content, the claim/scout distinction, Continue) is covered against the
// *real* modules in `build-reveal.test.ts`, which needs those mocks absent so it can run
// the (real, no-WebGL-in-jsdom) fallback path instead. Same split `forge-renderer.test.ts`
// already uses against `forge.test.ts`, for the identical reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEvent } from '../../sim/event/event';
import { ROSTER, toEventMembers } from '../../config/roster';
import { FIRST_BEAT } from '../beats';
import { claimMember, loadProgress, type ProgressStorage } from '../progress';
import type { ScreenContext } from './types';

const { mountBotPortraitStageMock, tickMock, anchorPositionsMock, destroyMock } = vi.hoisted(() => {
  const tickMock = vi.fn();
  const anchorPositionsMock = vi.fn(() => ({
    chassis: { x: 1, y: 2 },
    weapon: { x: 3, y: 4 },
    armour: { x: 5, y: 6 },
  }));
  const destroyMock = vi.fn();
  const mountBotPortraitStageMock = vi.fn(async (parent: unknown, build: unknown, colour: unknown, size: unknown) => {
    void parent;
    void build;
    void colour;
    void size;
    return { tick: tickMock, anchorPositions: anchorPositionsMock, destroy: destroyMock };
  });
  return { mountBotPortraitStageMock, tickMock, anchorPositionsMock, destroyMock };
});

vi.mock('../canvas-support', () => ({
  canvasSupportsWebGL: () => true,
}));

vi.mock('../../render/bot-portrait', () => ({
  mountBotPortraitStage: mountBotPortraitStageMock,
}));

const SEED = 918273;

class MemoryStorage implements ProgressStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  mountBotPortraitStageMock.mockClear();
  tickMock.mockClear();
  anchorPositionsMock.mockClear();
  destroyMock.mockClear();
});

function makeContext(claimedMemberId: string | null): ScreenContext {
  const container = document.createElement('div');
  document.body.appendChild(container);
  if (claimedMemberId) claimMember(SEED, claimedMemberId, storage);
  return {
    container,
    seed: SEED,
    state: { hasCompletedOnce: false, claimedMemberId, furthestBeat: FIRST_BEAT },
    storage,
    navigate: vi.fn(),
    controls: document.createElement('div'),
    replay: vi.fn(),
  };
}

const event = runEvent({ masterSeed: SEED, members: toEventMembers(ROSTER) });

function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

describe('buildRevealScreen — wiring into the bot portrait renderer', () => {
  it("mounts the claimed member's own recorded build and colour on first render", async () => {
    const { buildRevealScreen } = await import('./build-reveal');
    const memberIndex = 3;
    const claimed = ROSTER[memberIndex]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    await Promise.resolve();
    await Promise.resolve();

    expect(mountBotPortraitStageMock).toHaveBeenCalledTimes(1);
    const [, build, colour] = mountBotPortraitStageMock.mock.calls[0]!;
    expect(build).toEqual(event.builds[memberIndex]);
    expect(colour).toBe(hexToNumber(claimed.colour));
  });

  it("scouting another member remounts the portrait with THAT member's build and colour, tears the previous stage down, and never touches claimedMemberId", async () => {
    const { buildRevealScreen } = await import('./build-reveal');
    const claimedIndex = 0;
    const otherIndex = 5;
    const claimed = ROSTER[claimedIndex]!;
    const other = ROSTER[otherIndex]!;
    const ctx = makeContext(claimed.id);
    buildRevealScreen.render(ctx);

    await Promise.resolve();
    await Promise.resolve();
    expect(mountBotPortraitStageMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).not.toHaveBeenCalled();

    const badge = ctx.container.querySelector<HTMLButtonElement>(`[data-member-id="${other.id}"]`)!;
    badge.click();

    // The previous portrait's stage is torn down before the new one mounts.
    expect(destroyMock).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(mountBotPortraitStageMock).toHaveBeenCalledTimes(2);
    const [, build, colour] = mountBotPortraitStageMock.mock.calls[1]!;
    expect(build).toEqual(event.builds[otherIndex]);
    expect(colour).toBe(hexToNumber(other.colour));

    // Scouting is not switching: the claim itself never moves.
    expect(loadProgress(SEED, storage).claimedMemberId).toBe(claimed.id);
  });

  it('teardown cancels the idle-drift animation frame loop and destroys the mounted stage', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const { buildRevealScreen } = await import('./build-reveal');
    const claimed = ROSTER[1]!;
    const ctx = makeContext(claimed.id);
    const teardown = buildRevealScreen.render(ctx);

    await Promise.resolve();
    await Promise.resolve();

    expect(rafSpy).toHaveBeenCalled();
    const scheduledFrameId = rafSpy.mock.results[0]!.value as number;
    expect(destroyMock).not.toHaveBeenCalled();

    teardown?.();

    expect(cafSpy).toHaveBeenCalledWith(scheduledFrameId);
    expect(destroyMock).toHaveBeenCalledTimes(1);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });
});
