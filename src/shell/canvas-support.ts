/**
 * True when this environment can actually give PixiJS a WebGL context. Checked once,
 * synchronously, before attempting to mount a live panel — so an environment that can't
 * render (a test harness, a locked-down kiosk browser) gets a static fallback immediately
 * instead of an async PixiJS init that would only fail (or hang) later.
 *
 * Shared by every screen that mounts a live renderer (`what-to-expect.ts`, `forge.ts`) —
 * pulled out here rather than duplicated so the one check stays in one place.
 */
export function canvasSupportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
