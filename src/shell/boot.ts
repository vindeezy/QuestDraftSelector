import { checkOfficialRecord, checkRecord, type ChecksumCheck } from './checksum-gate';
import { mountRouter } from './router';
import { loadMaterials } from '../render/materials';
import { clearProgress } from './progress';
import type { EventRecord } from '../sim/event/record';

/**
 * The whole boot sequence: show a loading state, run the checksum gate, and either
 * mount the router (checksum agrees) or block with an error (it doesn't). See
 * `docs/superpowers/specs/2026-08-11-website-design.md` §4.
 */

function renderLoading(container: HTMLElement): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'gate gate--loading';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="gate__mark" aria-hidden="true"></div>
    <p class="gate__status">Assembling the event…</p>
  `;
  container.appendChild(el);
}

function renderError(container: HTMLElement, check: ChecksumCheck): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'gate gate--error';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="gate__error-mark" aria-hidden="true">!</div>
    <h1>Something's not right</h1>
    <p>
      The event on this device doesn't match the one that was approved. Nobody should
      watch this until it's fixed — tell whoever's running the draft.
    </p>
    <p class="gate__detail">expected <code>${check.expectedChecksum}</code>, got <code>${check.actualChecksum}</code></p>
  `;
  container.appendChild(el);
}

/** Resolves once the loading state has had a real chance to reach the screen, before
 *  the heavy, synchronous `runEvent` call blocks the main thread for the ~2.5s the spec
 *  calls out. Races two rAFs (paint-aligned — the first frame is often the one that
 *  *applies* the DOM change scheduled just before it, not the one that paints it)
 *  against a short timeout backstop, so a tab that loads hidden or backgrounded (where
 *  some engines throttle or never fire `requestAnimationFrame`) still proceeds instead
 *  of hanging on "Assembling the event…" forever. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 50);
  });
}

/**
 * Runs the checksum gate against `record` (the real official record when omitted),
 * showing the loading state first, then either mounting the router or blocking with an
 * error. Returns the check result so a caller — or a test — can see what happened
 * without re-deriving it.
 */
/**
 * `?reset` — wipe this device's progress for the current event and start from the landing
 * screen as a genuinely first-time viewer.
 *
 * Two jobs. It makes reviewing the opening screens possible at all: the site resumes where
 * the last watch stopped, which is correct behaviour and exactly wrong when you want to
 * look at the screens you already walked past. And on draft night it is the escape hatch
 * for a member whose stored state is wedged.
 *
 * The parameter is stripped from the URL immediately afterwards. Leaving it there would
 * make the reset sticky — every refresh would wipe progress again, so the viewer could
 * never get past the landing screen by reloading, which is the first thing anyone tries.
 */
function applyResetParam(seed: number): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has('reset')) return;

  clearProgress(seed);

  url.searchParams.delete('reset');
  window.history.replaceState(null, '', url.toString());
}

/**
 * Returns the gate result.
 *
 * Nullable for historical reasons worth keeping: `?sounds` used to mount a sound lab here and
 * return null, because the gate genuinely had not run and saying so beat inventing a passing
 * result for a check nobody performed. The lab is gone; the honest return type is not, since
 * any future route that short-circuits boot will want exactly the same escape hatch.
 */
export async function boot(
  container: HTMLElement,
  record?: EventRecord,
): Promise<ChecksumCheck | null> {
  renderLoading(container);
  await nextPaint();

  const check = record ? checkRecord(record) : checkOfficialRecord();

  if (!check.ok) {
    renderError(container, check);
    return check;
  }

  // After the gate, so a mismatched event still blocks rather than being quietly reset,
  // and before the router mounts, so the router reads the cleared state.
  applyResetParam(check.record.masterSeed);

  container.innerHTML = '';

  // Started here and deliberately NOT awaited. The first beat that needs a material texture is
  // the build reveal, ten beats and several minutes of Forge away, so 320 KB has all the time it
  // needs; blocking the landing screen on it would be paying a real cost to prevent a problem
  // that cannot happen. `void` rather than a bare call so the floating promise is explicit --
  // `loadMaterials` never rejects, by design.
  void loadMaterials();

  mountRouter({ container, seed: check.record.masterSeed });
  return check;
}
