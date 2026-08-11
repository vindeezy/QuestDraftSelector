import { describe, it, expect, beforeEach } from 'vitest';
import { ROSTER } from '../config/roster';
import { BEAT_IDS, FIRST_BEAT, LAST_BEAT } from './beats';
import {
  loadProgress,
  recordBeatReached,
  claimMember,
  resetWatch,
  canNavigateToBeat,
  type ProgressState,
  type ProgressStorage,
} from './progress';

/**
 * An in-memory stand-in for `localStorage`. Vitest's configured environment is `node`
 * (see `vite.config.ts`), which does not define `localStorage` at all, and jsdom is not a
 * project dependency — so every test here injects one of these (or the throwing variant
 * below) explicitly through the `storage` parameter every exported function accepts,
 * rather than relying on a global.
 */
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

  /** Test-only escape hatch for writing a raw (possibly corrupt) value directly, as if
   *  some earlier, differently-shaped version of this module had written it. */
  setRaw(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Throws on every method, standing in for private-browsing Safari or a full quota. */
class ThrowingStorage implements ProgressStorage {
  getItem(): string | null {
    throw new Error('getItem is not available');
  }
  setItem(): void {
    throw new Error('setItem is not available');
  }
  removeItem(): void {
    throw new Error('removeItem is not available');
  }
}

const SEED = 4242;
const MEMBER_A = ROSTER[0]!.id;
const MEMBER_B = ROSTER[1]!.id;

const WATCH_KEY = `questDraftSelector:v1:${SEED}:watch`;
const COMPLETED_KEY = `questDraftSelector:v1:${SEED}:hasCompletedOnce`;

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('loadProgress', () => {
  it('returns a clean start when nothing has been stored', () => {
    const state = loadProgress(SEED, storage);
    expect(state).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });
  });

  it('a different seed key starts fresh', () => {
    recordBeatReached(SEED, 'name-select', storage);
    claimMember(SEED, MEMBER_A, storage);

    const otherSeed = loadProgress(SEED + 1, storage);
    expect(otherSeed).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });

    // And the original seed's progress is untouched by having read a different one.
    const original = loadProgress(SEED, storage);
    expect(original.claimedMemberId).toBe(MEMBER_A);
    expect(original.furthestBeat).toBe('name-select');
  });
});

describe('recordBeatReached: the anti-spoiler rule', () => {
  it('cannot advance more than one beat past furthestBeat before completion', () => {
    // Fresh viewer sits at furthestBeat = 'landing' (index 0). Jumping straight to
    // 'forge-1' (index 3) is more than one beat ahead and must be refused.
    const state = recordBeatReached(SEED, 'forge-1', storage);
    expect(state.furthestBeat).toBe(FIRST_BEAT);
    expect(state.hasCompletedOnce).toBe(false);

    // Nothing was persisted either — a second read agrees.
    expect(loadProgress(SEED, storage).furthestBeat).toBe(FIRST_BEAT);
  });

  it('allows advancing exactly one beat past furthestBeat, extending the frontier', () => {
    const state = recordBeatReached(SEED, 'name-select', storage);
    expect(state.furthestBeat).toBe('name-select');
    expect(loadProgress(SEED, storage).furthestBeat).toBe('name-select');
  });

  it('can navigate back freely to any beat already seen, without losing the frontier', () => {
    recordBeatReached(SEED, 'name-select', storage);
    recordBeatReached(SEED, 'what-to-expect', storage);

    const backState = recordBeatReached(SEED, 'landing', storage);
    // Furthest progress must not shrink just because an earlier beat was revisited.
    expect(backState.furthestBeat).toBe('what-to-expect');
    expect(loadProgress(SEED, storage).furthestBeat).toBe('what-to-expect');
  });

  it('walking forward one beat at a time reaches the end and sets hasCompletedOnce', () => {
    let state: ProgressState = loadProgress(SEED, storage);
    for (const beat of BEAT_IDS.slice(1)) {
      state = recordBeatReached(SEED, beat, storage);
    }
    expect(state.furthestBeat).toBe(LAST_BEAT);
    expect(state.hasCompletedOnce).toBe(true);
    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(true);
  });

  it('after hasCompletedOnce, any beat is reachable', () => {
    for (const beat of BEAT_IDS.slice(1)) recordBeatReached(SEED, beat, storage);
    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(true);

    // Jump straight from 'complete' all the way back to a mid-event beat, then straight
    // to a late beat far past whatever furthestBeat was — both must succeed now.
    const jumpBack = recordBeatReached(SEED, 'forge-1', storage);
    expect(jumpBack.furthestBeat).toBe(LAST_BEAT); // frontier does not shrink on rewatch either
    const jumpForward = recordBeatReached(SEED, 'draft-order', storage);
    expect(jumpForward.hasCompletedOnce).toBe(true);
  });

  it('resume returns the furthest beat', () => {
    recordBeatReached(SEED, 'name-select', storage);
    recordBeatReached(SEED, 'what-to-expect', storage);
    recordBeatReached(SEED, 'forge-1', storage);

    // A brand-new "session" just calls loadProgress with the same seed and storage.
    const resumed = loadProgress(SEED, storage);
    expect(resumed.furthestBeat).toBe('forge-1');
  });
});

describe('canNavigateToBeat', () => {
  it('allows the beat immediately after furthestBeat but not the one after that', () => {
    const state: ProgressState = { hasCompletedOnce: false, claimedMemberId: null, furthestBeat: 'forge-2' };
    expect(canNavigateToBeat(state, 'forge-2')).toBe(true); // itself
    expect(canNavigateToBeat(state, 'forge-1')).toBe(true); // back
    expect(canNavigateToBeat(state, 'forge-3')).toBe(true); // one step forward
    expect(canNavigateToBeat(state, 'forge-4')).toBe(false); // two steps forward: refused
  });

  it('allows everything once hasCompletedOnce is true, regardless of furthestBeat', () => {
    const state: ProgressState = { hasCompletedOnce: true, claimedMemberId: null, furthestBeat: 'landing' };
    expect(canNavigateToBeat(state, 'complete')).toBe(true);
    expect(canNavigateToBeat(state, 'draft-order')).toBe(true);
  });
});

describe('claimMember', () => {
  it('sets claimedMemberId without disturbing furthestBeat', () => {
    recordBeatReached(SEED, 'name-select', storage);
    const state = claimMember(SEED, MEMBER_A, storage);
    expect(state.claimedMemberId).toBe(MEMBER_A);
    expect(state.furthestBeat).toBe('name-select');
    expect(loadProgress(SEED, storage).claimedMemberId).toBe(MEMBER_A);
  });

  it('throws for a member id that is not on the roster', () => {
    expect(() => claimMember(SEED, 'not-a-real-member', storage)).toThrow(/roster/);
  });
});

describe('resetWatch: "watch again as someone else"', () => {
  it('clears the claimed member and furthest beat but keeps hasCompletedOnce', () => {
    for (const beat of BEAT_IDS.slice(1)) recordBeatReached(SEED, beat, storage);
    claimMember(SEED, MEMBER_A, storage);
    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(true);

    const afterReset = resetWatch(SEED, storage);
    expect(afterReset.claimedMemberId).toBeNull();
    expect(afterReset.furthestBeat).toBe(FIRST_BEAT);
    expect(afterReset.hasCompletedOnce).toBe(true);

    // And it's really persisted, not just the return value.
    const reloaded = loadProgress(SEED, storage);
    expect(reloaded.claimedMemberId).toBeNull();
    expect(reloaded.furthestBeat).toBe(FIRST_BEAT);
    expect(reloaded.hasCompletedOnce).toBe(true);
  });

  it('the member can then pick someone else and is never re-locked', () => {
    for (const beat of BEAT_IDS.slice(1)) recordBeatReached(SEED, beat, storage);
    resetWatch(SEED, storage);
    claimMember(SEED, MEMBER_B, storage);

    // Even though furthestBeat is back at the very start, hasCompletedOnce still lets
    // this "new" watch skip straight to the end.
    const state = recordBeatReached(SEED, 'draft-order', storage);
    expect(loadProgress(SEED, storage).claimedMemberId).toBe(MEMBER_B);
    expect(state.furthestBeat).toBe('draft-order');
  });

  it('resetting an already-clean watch is harmless', () => {
    const state = resetWatch(SEED, storage);
    expect(state).toEqual<ProgressState>({ hasCompletedOnce: false, claimedMemberId: null, furthestBeat: FIRST_BEAT });
  });
});

describe('corrupt storage falls back to a clean start', () => {
  it('malformed JSON in the watch key', () => {
    storage.setRaw(WATCH_KEY, '{not valid json');
    expect(loadProgress(SEED, storage)).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });
  });

  it('an unknown beat id in furthestBeat', () => {
    storage.setRaw(WATCH_KEY, JSON.stringify({ claimedMemberId: null, furthestBeat: 'forge-99' }));
    expect(loadProgress(SEED, storage).furthestBeat).toBe(FIRST_BEAT);
  });

  it('an unknown member id in claimedMemberId', () => {
    storage.setRaw(
      WATCH_KEY,
      JSON.stringify({ claimedMemberId: 'someone-not-on-the-roster', furthestBeat: 'forge-1' }),
    );
    const state = loadProgress(SEED, storage);
    expect(state.claimedMemberId).toBeNull();
    expect(state.furthestBeat).toBe(FIRST_BEAT); // the whole payload is untrusted, not just the bad field
  });

  it('missing fields (no furthestBeat at all)', () => {
    storage.setRaw(WATCH_KEY, JSON.stringify({ claimedMemberId: MEMBER_A }));
    expect(loadProgress(SEED, storage)).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });
  });

  it('a non-object JSON value (e.g. a bare string or number)', () => {
    storage.setRaw(WATCH_KEY, JSON.stringify('landing'));
    expect(loadProgress(SEED, storage).furthestBeat).toBe(FIRST_BEAT);
  });

  it('garbage in the completion key reads as not completed, not as a crash', () => {
    storage.setRaw(COMPLETED_KEY, 'yes please');
    expect(loadProgress(SEED, storage).hasCompletedOnce).toBe(false);
  });
});

describe('localStorage throwing does not propagate', () => {
  const throwing = new ThrowingStorage();

  it('loadProgress survives a storage that throws on read', () => {
    expect(() => loadProgress(SEED, throwing)).not.toThrow();
    expect(loadProgress(SEED, throwing)).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });
  });

  it('recordBeatReached survives a storage that throws on write', () => {
    expect(() => recordBeatReached(SEED, 'name-select', throwing)).not.toThrow();
  });

  it('claimMember survives a storage that throws on write', () => {
    expect(() => claimMember(SEED, MEMBER_A, throwing)).not.toThrow();
  });

  it('resetWatch survives a storage that throws on remove and read', () => {
    expect(() => resetWatch(SEED, throwing)).not.toThrow();
  });
});

describe('a null storage (localStorage unavailable entirely)', () => {
  it('every function still works, just without persistence', () => {
    expect(loadProgress(SEED, null)).toEqual<ProgressState>({
      hasCompletedOnce: false,
      claimedMemberId: null,
      furthestBeat: FIRST_BEAT,
    });
    expect(() => recordBeatReached(SEED, 'name-select', null)).not.toThrow();
    expect(() => claimMember(SEED, MEMBER_A, null)).not.toThrow();
    expect(() => resetWatch(SEED, null)).not.toThrow();
  });
});
