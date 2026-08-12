// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BEAT_IDS, type BeatId } from './beats';
import { mountRouter } from './router';
import type { ProgressStorage } from './progress';

/** Same in-memory `ProgressStorage` fake `progress.test.ts` uses — see that file's doc
 *  comment for why every test here injects one rather than relying on real
 *  `localStorage` (unavailable in Vitest's default `node` environment, and this suite
 *  opts into `jsdom` only for the DOM, not for storage). */
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

const SEED = 9999;
const WATCH_KEY = `questDraftSelector:v1:${SEED}:watch`;

/** Writes a watch blob directly, bypassing `recordBeatReached`'s one-step-at-a-time
 *  gating — the same escape hatch `progress.test.ts` uses to place a fixture at an
 *  arbitrary beat without walking every beat in between. */
function seedFurthestBeat(storage: MemoryStorage, beat: BeatId, claimedMemberId: string | null = null): void {
  storage.setItem(WATCH_KEY, JSON.stringify({ claimedMemberId, furthestBeat: beat }));
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('mountRouter', () => {
  it('mounts a first-time viewer straight into landing', () => {
    const storage = new MemoryStorage();
    const container = makeContainer();
    const router = mountRouter({ container, seed: SEED, storage });

    expect(router.currentBeat).toBe('landing');
    expect(container.dataset.beat).toBe('landing');
    expect(container.textContent).toContain('Begin');
  });

  it('resumes a returning viewer directly at their furthest beat, for every one of the nineteen beats', () => {
    for (const beat of BEAT_IDS) {
      const storage = new MemoryStorage();
      seedFurthestBeat(storage, beat);
      const container = makeContainer();

      const router = mountRouter({ container, seed: SEED, storage });

      expect(router.currentBeat).toBe(beat);
      expect(container.dataset.beat).toBe(beat);

      // The Forge beats' screen starts a real animation-frame loop (see forge.ts) —
      // torn down here so it doesn't keep ticking in the background against a detached
      // container for the rest of the suite.
      router.destroy();
    }
  });

  it('shows the real name-select screen (not a stub) at name-select', () => {
    const storage = new MemoryStorage();
    seedFurthestBeat(storage, 'name-select');
    const container = makeContainer();

    mountRouter({ container, seed: SEED, storage });

    expect(container.textContent).toContain("Who's watching?");
    expect(container.querySelectorAll('.roster-tile')).toHaveLength(10);
  });

  it('shows the real what-to-expect screen (not a stub) at what-to-expect', () => {
    const storage = new MemoryStorage();
    seedFurthestBeat(storage, 'what-to-expect');
    const container = makeContainer();

    mountRouter({ container, seed: SEED, storage });

    // Collapse whitespace before matching. Copy is line-wrapped in the HTML template, so
    // `textContent` carries the source's newlines and indentation mid-sentence — which the
    // browser collapses and the reader never sees. Asserting on the raw string would couple
    // the test to how the template happens to be formatted rather than to what renders.
    const text = container.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('What to expect');
    expect(text).toContain('Survive to score, fight to score more.');
  });

  it('shows the real Forge screen (not a stub) for each of the six Forge beats', () => {
    const forgeBeats = BEAT_IDS.slice(BEAT_IDS.indexOf('forge-1'), BEAT_IDS.indexOf('forge-6') + 1);
    expect(forgeBeats).toEqual(['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6']);

    for (const beat of forgeBeats) {
      const storage = new MemoryStorage();
      seedFurthestBeat(storage, beat);
      const container = makeContainer();

      const router = mountRouter({ container, seed: SEED, storage });

      expect(router.currentBeat).toBe(beat);
      expect(container.querySelector('.screen-forge')).not.toBeNull();
      expect(container.querySelector('.screen-stub')).toBeNull();

      router.destroy();
    }
  });

  it('shows a placeholder stub for every beat after the Forge, except build-reveal and the three battles which are real now', () => {
    const realBeatsPastForge: ReadonlySet<string> = new Set(['build-reveal', 'battle-1', 'battle-2', 'battle-3']);
    const stubBeats = BEAT_IDS.slice(BEAT_IDS.indexOf('forge-6') + 1).filter((beat) => !realBeatsPastForge.has(beat));
    expect(stubBeats.length).toBeGreaterThan(0);

    for (const beat of stubBeats) {
      const storage = new MemoryStorage();
      seedFurthestBeat(storage, beat);
      const container = makeContainer();

      mountRouter({ container, seed: SEED, storage });

      expect(container.querySelector('.screen-stub')).not.toBeNull();
    }
  });

  it('shows the real battle screen (not a stub) for each of the three battle beats', () => {
    for (const beat of ['battle-1', 'battle-2', 'battle-3'] as const) {
      const storage = new MemoryStorage();
      seedFurthestBeat(storage, beat, 'paden');
      const container = makeContainer();

      const router = mountRouter({ container, seed: SEED, storage });

      expect(router.currentBeat).toBe(beat);
      expect(container.querySelector('.screen-battle')).not.toBeNull();
      expect(container.querySelector('.screen-stub')).toBeNull();

      router.destroy();
    }
  });

  it('shows the real build-reveal screen (not a stub) at build-reveal', () => {
    const storage = new MemoryStorage();
    seedFurthestBeat(storage, 'build-reveal', 'paden');
    const container = makeContainer();

    mountRouter({ container, seed: SEED, storage });

    expect(container.querySelector('.screen-build-reveal')).not.toBeNull();
    expect(container.querySelector('.screen-stub')).toBeNull();
    expect(container.querySelectorAll('.reveal-selector__badge')).toHaveLength(10);
  });

  it('navigate() advances the beat and persists it, so a later mount resumes there', () => {
    const storage = new MemoryStorage();
    const container = makeContainer();
    const router = mountRouter({ container, seed: SEED, storage });

    router.navigate('name-select');

    expect(router.currentBeat).toBe('name-select');
    expect(container.dataset.beat).toBe('name-select');

    const laterContainer = makeContainer();
    const laterRouter = mountRouter({ container: laterContainer, seed: SEED, storage });
    expect(laterRouter.currentBeat).toBe('name-select');
  });

  it('navigate() refuses to jump past what canNavigateToBeat allows', () => {
    const storage = new MemoryStorage();
    const container = makeContainer();
    const router = mountRouter({ container, seed: SEED, storage });

    router.navigate('draft-order');

    expect(router.currentBeat).toBe('landing');
    expect(container.dataset.beat).toBe('landing');
  });
});

describe('a screen whose teardown throws', () => {
  it('does not strand the viewer on the previous beat', async () => {
    // The regression this guards. A PixiJS renderer threw `_cancelResize is not a function`
    // while being destroyed; the exception escaped `teardown()` before the router could
    // clear the container, so the next screen never rendered. Progress kept recording the
    // beat that had been reached, so the stored state and the screen disagreed and the
    // walkthrough simply stopped advancing -- on draft night, a dead site.
    //
    // Mocked at the screen registry rather than by adding a test hook to the router: the
    // property under test is "the router survives a badly-behaved screen", and a screen
    // that throws on teardown is exactly what a broken renderer looks like from here.
    vi.resetModules();
    vi.doMock('./screens', () => ({
      SCREENS: new Proxy(
        {},
        {
          get: (_t, beat: string) => ({
            render: (ctx: { container: HTMLElement }) => {
              const el = document.createElement('p');
              el.textContent = `screen:${beat}`;
              ctx.container.appendChild(el);
              return () => {
                throw new Error('renderer blew up during destroy');
              };
            },
          }),
        },
      ),
    }));

    const { mountRouter: mountWithThrowingScreens } = await import('./router');
    const storage = new MemoryStorage();
    const container = makeContainer();
    const router = mountWithThrowingScreens({ container, seed: SEED, storage });

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      router.navigate('name-select');
    } finally {
      console.error = originalError;
      vi.doUnmock('./screens');
      vi.resetModules();
    }

    // Navigation completed despite the teardown throwing...
    expect(router.currentBeat).toBe('name-select');
    expect(container.dataset.beat).toBe('name-select');
    expect(container.textContent).toContain('screen:name-select');
    // ...and the failure was reported rather than silently swallowed.
    expect(errors.length).toBeGreaterThan(0);
  });
});
