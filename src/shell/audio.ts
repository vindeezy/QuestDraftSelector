/**
 * The event's single shared `AudioContext`.
 *
 * Browsers refuse to run Web Audio until it has been created or resumed from inside a
 * user gesture. Nothing on the first three screens makes sound yet, but the Forge and
 * the battles will (see `docs/superpowers/specs/2026-08-11-website-design.md` §7), and by
 * then there is no gesture left to hang the resume off — the landing screen's Begin
 * button is the one click guaranteed to happen before any of it. So the context is
 * created and resumed here, now, even though it sits idle until sound is wired in.
 *
 * A small structural interface (`AudioContextLike`) plus an injectable constructor is
 * the same shape `progress.ts` uses for storage: real code gets the real
 * `window.AudioContext`, tests hand in a fake, and nothing here needs `jsdom` (which
 * does not implement Web Audio at all) to be exercised.
 */

export interface AudioContextLike {
  readonly state: string;
  resume(): Promise<void>;
}

type AudioContextCtor = new () => AudioContextLike;

/** Resolves the real `AudioContext` constructor, or `null` if this environment has
 *  none — no `window` (a test, or SSR), or a browser old enough to lack Web Audio
 *  entirely. Safari's prefixed `webkitAudioContext` is checked as a fallback. */
function resolveDefaultCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let sharedContext: AudioContextLike | null = null;

/**
 * Creates the shared `AudioContext` on first call and resumes it if it starts
 * suspended — the state every context begins in outside a user gesture. Safe to call
 * more than once (from repeated clicks, or a screen that re-mounts): the same instance
 * is reused and merely re-resumed.
 *
 * Must be invoked synchronously from inside the gesture handler (the click listener
 * itself may `await` this, but must call it directly, not from a `.then()` or a
 * `setTimeout` — browsers only honour the gesture if the context is created/resumed
 * within the same task the click ran in).
 *
 * Never throws: a browser that refuses (or lacks) audio still lets the member watch the
 * event, they just get no sound. Callers that don't care about the result can fire this
 * with `void ensureAudioResumed()`.
 */
export async function ensureAudioResumed(
  ctor: AudioContextCtor | null = resolveDefaultCtor(),
): Promise<AudioContextLike | null> {
  if (!ctor) return null;

  if (!sharedContext) {
    try {
      sharedContext = new ctor();
    } catch {
      return null;
    }
  }

  if (sharedContext.state === 'suspended') {
    try {
      await sharedContext.resume();
    } catch {
      // Best-effort only — see the doc comment above.
    }
  }

  return sharedContext;
}

/** The shared context, if one has been created yet. `null` before the first
 *  `ensureAudioResumed()` call, or in an environment without Web Audio. */
export function getSharedAudioContext(): AudioContextLike | null {
  return sharedContext;
}

/** Test-only: clears the module-level singleton so each test starts from a clean
 *  slate. Never called from production code. */
export function __resetAudioContextForTests(): void {
  sharedContext = null;
}
