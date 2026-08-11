// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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

  it('shows a placeholder stub for every beat after what-to-expect', () => {
    const stubBeats = BEAT_IDS.slice(BEAT_IDS.indexOf('what-to-expect') + 1);
    expect(stubBeats.length).toBeGreaterThan(0);

    for (const beat of stubBeats) {
      const storage = new MemoryStorage();
      seedFurthestBeat(storage, beat);
      const container = makeContainer();

      mountRouter({ container, seed: SEED, storage });

      expect(container.querySelector('.screen-stub')).not.toBeNull();
    }
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
