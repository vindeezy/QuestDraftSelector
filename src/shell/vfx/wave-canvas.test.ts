// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountWaveCanvas } from './wave-canvas';

/**
 * jsdom has no 2D context, so nothing here checks what gets DRAWN — `wave-field.test.ts`
 * covers that, which is the whole reason the arithmetic lives in a separate file.
 *
 * What is checked is the part that can strand the site: mounting, and coming back off. The
 * landing screen is the first screen with a teardown, and a frame loop that outlives its
 * screen would leak one per visit with nothing on screen to show for it.
 */

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

let frames: Array<(t: number) => void>;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {};
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('mounting the field', () => {
  it('puts the canvas behind everything already in the host', () => {
    const el = host();
    el.innerHTML = '<div class="landing-content">title</div>';
    mountWaveCanvas(el);
    // Source order IS paint order here — nothing in the landing stack is z-indexed. A canvas
    // appended instead of prepended would sit on top of the title.
    expect(el.firstElementChild?.tagName).toBe('CANVAS');
  });

  it('hides itself from assistive tech', () => {
    const el = host();
    mountWaveCanvas(el);
    expect(el.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('survives a host that cannot give it a 2D context', () => {
    // Exactly the jsdom case, and also a browser that has run out of contexts. An atmosphere
    // layer must never be the reason a screen fails to render.
    const el = host();
    expect(() => mountWaveCanvas(el)).not.toThrow();
  });
});

describe('coming back off', () => {
  it('removes the canvas', () => {
    const el = host();
    const handle = mountWaveCanvas(el);
    handle.destroy();
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('stops asking for frames', () => {
    const el = host();
    const handle = mountWaveCanvas(el);
    const before = frames.length;
    handle.destroy();
    // Run whatever was already queued. A destroyed field must not schedule anything further.
    frames.forEach((cb) => { cb(16); });
    expect(frames.length).toBe(before);
  });

  it('can be destroyed twice without complaint', () => {
    // The router calls teardown on navigation, and again on `destroy()` if the page is being
    // torn down mid-transition. Both paths are real.
    const el = host();
    const handle = mountWaveCanvas(el);
    handle.destroy();
    expect(() => { handle.destroy(); }).not.toThrow();
  });

  it('lets go of the visibility listener', () => {
    const el = host();
    const remove = vi.spyOn(document, 'removeEventListener');
    mountWaveCanvas(el).destroy();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
