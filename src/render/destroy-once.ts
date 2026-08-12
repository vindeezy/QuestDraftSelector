import type { Application } from 'pixi.js';

/**
 * Wraps `app.destroy()` so calling it twice is harmless.
 *
 * PixiJS v8's `ResizePlugin.destroy()` does this:
 *
 * ```js
 * this._cancelResize();
 * this._cancelResize = null;
 * ```
 *
 * so a second destroy calls `null()` and throws `_cancelResize is not a function`. That is
 * not a hypothetical: it stranded a viewer permanently on the orientation screen. The
 * router tears the current screen down before rendering the next one, the throw escaped
 * before the container could be cleared, and the walkthrough stopped advancing while
 * progress kept recording beats the viewer never saw.
 *
 * Two things guard that now — the router no longer lets a teardown block navigation, and
 * this makes the double call a no-op at the source. The router's guard keeps a leak from
 * becoming a dead site; this keeps the leak from happening.
 *
 * Screens legitimately race here: renderers mount asynchronously, so a screen can be torn
 * down before its renderer resolves, and the resolve handler then has to destroy it
 * instead. Making destruction idempotent is much easier to get right than making every one
 * of those handshakes exactly-once.
 */
export function destroyOnce(app: Application): () => void {
  let destroyed = false;
  return () => {
    if (destroyed) return;
    destroyed = true;
    app.destroy(true, { children: true });
  };
}
