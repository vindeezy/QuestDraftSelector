// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFireworks } from './fireworks-canvas';

/**
 * jsdom has no 2D context, so nothing here checks what gets DRAWN — `fireworks.test.ts` covers
 * the shells and sparks, which is the whole reason the physics lives in a separate file.
 *
 * What is checked is the part that can strand the site: mounting, the reduced-motion path, and
 * coming back off. This screen is the last beat of the walkthrough and the finale stages nine
 * timers over more than two seconds, so a viewer clicking Back mid-barrage is not an edge case
 * — it is a thing that will happen on draft night.
 */

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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
  stubReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('mounting the show', () => {
  it('puts the canvas behind everything already on the board', () => {
    const el = host();
    el.innerHTML = '<div class="score-table-wrap">the board</div>';
    mountFireworks(el, 1);
    expect(el.firstElementChild?.tagName).toBe('CANVAS');
  });

  it('hides itself from assistive tech', () => {
    const el = host();
    mountFireworks(el, 1);
    expect(el.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('survives a host that cannot give it a 2D context', () => {
    // The jsdom case, and also a browser out of contexts. The celebration failing must never
    // be the reason the draft order itself fails to appear.
    const el = host();
    const show = mountFireworks(el, 1);
    expect(() => {
      show.celebrate('#2FB344');
      show.finale('#2FB344');
    }).not.toThrow();
  });
});

describe('when the viewer has asked for less motion', () => {
  it('mounts nothing at all', () => {
    // Unlike the landing's smoke, these carry no information — honouring the setting means
    // leaving them out, not holding them still.
    stubReducedMotion(true);
    const el = host();
    mountFireworks(el, 1);
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('still hands back a working handle, so the reveal never has to ask', () => {
    stubReducedMotion(true);
    const show = mountFireworks(host(), 1);
    expect(() => {
      show.celebrate('#2FB344');
      show.finale('#2FB344');
      show.destroy();
    }).not.toThrow();
  });

  it('does not start a frame loop', () => {
    stubReducedMotion(true);
    const show = mountFireworks(host(), 1);
    show.finale('#2FB344');
    expect(frames).toHaveLength(0);
  });
});

describe('leaving mid-barrage', () => {
  it('removes the canvas', () => {
    const el = host();
    const show = mountFireworks(el, 1);
    show.celebrate('#2FB344');
    show.destroy();
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('stops asking for frames', () => {
    const el = host();
    const show = mountFireworks(el, 1);
    show.celebrate('#2FB344');
    const before = frames.length;
    show.destroy();
    frames.forEach((cb) => { cb(16); });
    expect(frames.length).toBe(before);
  });

  it('cancels the finale shells still waiting to launch', () => {
    // The barrage is nine staged timers over more than two seconds. Left running, they fire
    // into a canvas that has been removed from a screen that no longer exists.
    vi.useFakeTimers();
    const el = host();
    const show = mountFireworks(el, 1);
    show.finale('#2FB344');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    show.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a launch requested after teardown', () => {
    const show = mountFireworks(host(), 1);
    show.destroy();
    expect(() => {
      show.celebrate('#2FB344');
      show.finale('#2FB344');
    }).not.toThrow();
  });

  it('can be destroyed twice without complaint', () => {
    const show = mountFireworks(host(), 1);
    show.destroy();
    expect(() => { show.destroy(); }).not.toThrow();
  });
});
