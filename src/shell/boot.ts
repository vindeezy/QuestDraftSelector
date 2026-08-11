import { checkOfficialRecord, checkRecord, type ChecksumCheck } from './checksum-gate';
import { mountRouter } from './router';
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
export async function boot(container: HTMLElement, record?: EventRecord): Promise<ChecksumCheck> {
  renderLoading(container);
  await nextPaint();

  const check = record ? checkRecord(record) : checkOfficialRecord();

  if (!check.ok) {
    renderError(container, check);
    return check;
  }

  container.innerHTML = '';
  mountRouter({ container, seed: check.record.masterSeed });
  return check;
}
