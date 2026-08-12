import { ROSTER } from '../config/roster';
import { BEAT_IDS, FIRST_BEAT, LAST_BEAT, beatIndex, isBeatId, isBeforeBeat, type BeatId } from './beats';

/**
 * Progress storage: where a member is up to in the nineteen beats, and whether they have
 * ever finished the event once. See `docs/superpowers/specs/2026-08-11-website-design.md`
 * §3 ("Beat state, progress, and re-watching").
 *
 * Two values, kept in two separate `localStorage` keys on purpose — that separation is
 * what makes "watch again as someone else" work without ever re-locking the site:
 *
 * - `hasCompletedOnce` — sticky. Sits in its own key so clearing "the current watch" can
 *   never touch it.
 * - The current watch (`claimedMemberId` + `furthestBeat`) — resettable. One JSON blob in
 *   its own key, so it can be wiped in a single `removeItem`.
 *
 * Both keys are namespaced by the event's master seed, so a re-recording (a new seed)
 * starts everyone fresh rather than resuming them into a beat sequence, or a build reveal,
 * that no longer matches what was recorded.
 *
 * `localStorage` is not guaranteed to exist (Vitest's `node` environment does not define
 * it) or to work (private browsing, quota exceeded, disabled entirely). Every exported
 * function here takes an optional `storage` parameter — a small structural interface
 * matching the three `localStorage` methods this module needs — defaulting to a safely
 * resolved `globalThis.localStorage`. Tests inject a fake (in-memory, or one that throws)
 * instead of relying on jsdom, which is not a project dependency. Every access to that
 * storage, default or injected, is wrapped so a throw never escapes this module: a member
 * whose browser can't persist state still gets to watch the event, they just cannot resume
 * into the middle of it later.
 */

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Where this viewing is up to (`furthestBeat`, `claimedMemberId`) plus the sticky
 *  `hasCompletedOnce` unlock. What every exported function here reads or produces. */
export interface ProgressState {
  readonly hasCompletedOnce: boolean;
  readonly claimedMemberId: string | null;
  readonly furthestBeat: BeatId;
}

const KEY_NAMESPACE = 'questDraftSelector:v1';
const COMPLETED_VALUE = 'true';

function completionKey(seed: number): string {
  return `${KEY_NAMESPACE}:${seed}:hasCompletedOnce`;
}

function watchKey(seed: number): string {
  return `${KEY_NAMESPACE}:${seed}:watch`;
}

/** Resolves the real `localStorage`, or `null` if it does not exist (Vitest's `node`
 *  environment) or throws merely to look at (older Safari private browsing throws on
 *  property access, not just on method calls). `typeof` never throws for an undeclared
 *  identifier, but the surrounding try/catch guards the property-access failure mode too. */
function resolveDefaultStorage(): ProgressStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function safeGet(storage: ProgressStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: ProgressStorage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Best-effort persistence only. A write failure (quota exceeded, disabled storage)
    // must not stop the member from continuing to watch — it just means their place
    // will not be remembered on reload.
  }
}

function safeRemove(storage: ProgressStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // See safeSet.
  }
}

function isKnownMemberId(id: string): boolean {
  return ROSTER.some((member) => member.id === id);
}

interface WatchPayload {
  claimedMemberId: string | null;
  furthestBeat: BeatId;
}

const DEFAULT_WATCH: WatchPayload = { claimedMemberId: null, furthestBeat: FIRST_BEAT };

/**
 * Reads and validates the current-watch blob, falling back to `DEFAULT_WATCH` on any
 * shape it does not recognise: malformed JSON, a `furthestBeat` that is missing or is not
 * one of the nineteen real beat ids, or a `claimedMemberId` that is present but is neither
 * `null` nor a real roster id. A partially-bad payload resets the whole watch rather than
 * salvaging the one field that parsed — a `furthestBeat` from a shape this module does not
 * recognise cannot be trusted just because `claimedMemberId` happened to look fine.
 */
function readWatch(seed: number, storage: ProgressStorage | null): WatchPayload {
  const raw = safeGet(storage, watchKey(seed));
  if (raw === null) return DEFAULT_WATCH;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_WATCH;
  }

  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WATCH;
  const record = parsed as Record<string, unknown>;

  const { furthestBeat } = record;
  if (!isBeatId(furthestBeat)) return DEFAULT_WATCH;

  const { claimedMemberId } = record;
  if (claimedMemberId === undefined || claimedMemberId === null) {
    return { claimedMemberId: null, furthestBeat };
  }
  if (typeof claimedMemberId !== 'string' || !isKnownMemberId(claimedMemberId)) {
    return DEFAULT_WATCH;
  }

  return { claimedMemberId, furthestBeat };
}

function writeWatch(seed: number, storage: ProgressStorage | null, payload: WatchPayload): void {
  safeSet(storage, watchKey(seed), JSON.stringify(payload));
}

/** Reads whole progress for `seed`: the sticky unlock plus the current watch. Never
 *  throws — corrupt or missing storage reads back as a brand-new viewer. */
export function loadProgress(seed: number, storage: ProgressStorage | null = resolveDefaultStorage()): ProgressState {
  const hasCompletedOnce = safeGet(storage, completionKey(seed)) === COMPLETED_VALUE;
  const watch = readWatch(seed, storage);
  return { hasCompletedOnce, claimedMemberId: watch.claimedMemberId, furthestBeat: watch.furthestBeat };
}

/**
 * The anti-spoiler rule (rule 1) plus the post-completion unlock (rule 3): can `state`
 * reach `beat` right now?
 *
 * Once `hasCompletedOnce`, every beat is reachable — full skip navigation. Until then, a
 * member may revisit anything up to `furthestBeat` (rule 2, going back) and may advance at
 * most one beat past it — the single step that extends the frontier. Anything further
 * ahead is a spoiler and is refused.
 */
export function canNavigateToBeat(state: ProgressState, beat: BeatId): boolean {
  if (state.hasCompletedOnce) return true;
  return beatIndex(beat) <= beatIndex(state.furthestBeat) + 1;
}

/**
 * Has this member already experienced `beat`?
 *
 * Deliberately NOT `canNavigateToBeat`, and the difference is the whole point. That
 * function permits `furthestBeat + 1` — the single step that extends the frontier, which
 * is exactly how a screen moves the walkthrough forward. Gating a *forward button* on it
 * would let someone click straight into a battle they had never watched, which is the one
 * thing forward navigation must never do.
 *
 * So this is the strict version: at or before `furthestBeat`, with no `+ 1`. Safe by
 * construction, because `furthestBeat` only ever advances when a screen navigates on
 * completion — it can never run ahead of what was actually sat through.
 *
 * `hasCompletedOnce` still unlocks everything, and that is not a hole: it means the whole
 * event has been watched end to end. It is checked separately from `furthestBeat` because
 * `resetWatch` ("watch again as someone else") deliberately sends `furthestBeat` back to
 * `landing` while leaving the unlock alone.
 */
export function hasSeenBeat(state: ProgressState, beat: BeatId): boolean {
  if (state.hasCompletedOnce) return true;
  return beatIndex(beat) <= beatIndex(state.furthestBeat);
}

/**
 * Called when `beat` is actually shown to the member. Extends `furthestBeat` forward when
 * `beat` is new ground, leaves it untouched when `beat` is somewhere already seen (going
 * back must never shrink progress), and sets the sticky `hasCompletedOnce` the moment
 * `beat` is `complete`.
 *
 * If `beat` is not currently reachable (see `canNavigateToBeat`) this is a no-op: nothing
 * is persisted and the state returned is exactly what `loadProgress` would have returned
 * anyway. Callers are expected to gate navigation with `canNavigateToBeat` themselves; this
 * function's refusal is a second line of defence, not the primary UI gate.
 */
export function recordBeatReached(
  seed: number,
  beat: BeatId,
  storage: ProgressStorage | null = resolveDefaultStorage(),
): ProgressState {
  const state = loadProgress(seed, storage);
  if (!canNavigateToBeat(state, beat)) return state;

  const furthestBeat = isBeforeBeat(state.furthestBeat, beat) ? beat : state.furthestBeat;
  writeWatch(seed, storage, { claimedMemberId: state.claimedMemberId, furthestBeat });

  const hasCompletedOnce = state.hasCompletedOnce || beat === LAST_BEAT;
  if (hasCompletedOnce && !state.hasCompletedOnce) safeSet(storage, completionKey(seed), COMPLETED_VALUE);

  return { hasCompletedOnce, claimedMemberId: state.claimedMemberId, furthestBeat };
}

/**
 * Sets which roster member this watch follows. Throws on an id that is not in
 * `src/config/roster.ts` — unlike storage corruption, an invalid id reaching this function
 * means the caller (the name-select screen) has a bug, not that a member's browser ate
 * their data, so it is not swallowed the way a bad read is.
 */
export function claimMember(
  seed: number,
  memberId: string,
  storage: ProgressStorage | null = resolveDefaultStorage(),
): ProgressState {
  if (!isKnownMemberId(memberId)) {
    throw new Error(`claimMember: "${memberId}" is not a member of the roster.`);
  }
  const state = loadProgress(seed, storage);
  writeWatch(seed, storage, { claimedMemberId: memberId, furthestBeat: state.furthestBeat });
  return { ...state, claimedMemberId: memberId };
}

/**
 * "Watch again as someone else" (rule 4). Clears the current watch — `claimedMemberId` and
 * `furthestBeat`, both back to their defaults — by deleting that one storage key outright.
 * `hasCompletedOnce` lives under a different key and is never touched, so the member is
 * never re-locked: `canNavigateToBeat` will keep returning `true` for every beat on the
 * very next call.
 */
export function resetWatch(seed: number, storage: ProgressStorage | null = resolveDefaultStorage()): ProgressState {
  safeRemove(storage, watchKey(seed));
  const hasCompletedOnce = safeGet(storage, completionKey(seed)) === COMPLETED_VALUE;
  return { hasCompletedOnce, claimedMemberId: null, furthestBeat: FIRST_BEAT };
}

/**
 * A total wipe for this seed — the current watch AND the completion unlock.
 *
 * Deliberately harsher than `resetWatch`. That one implements the designed re-watch flow
 * and keeps the unlock, because a member who has earned skip navigation should not lose it
 * for changing whose side they watch from. This exists for the other case: getting back to
 * a genuinely first-time viewing, which is what reviewing the opening screens needs, and
 * what an escape hatch on draft night should do for someone whose stored state is wedged.
 *
 * Reached via `?reset` — see `boot.ts`.
 */
export function clearProgress(seed: number, storage: ProgressStorage | null = resolveDefaultStorage()): ProgressState {
  safeRemove(storage, watchKey(seed));
  safeRemove(storage, completionKey(seed));
  return { hasCompletedOnce: false, claimedMemberId: null, furthestBeat: FIRST_BEAT };
}

// Re-exported so consumers of this module don't also need to import from `./beats` just to
// name the full beat list or the sentinel first/last beats.
export { BEAT_IDS, FIRST_BEAT, LAST_BEAT };
