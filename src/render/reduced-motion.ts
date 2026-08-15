/**
 * Whether the viewer has asked their system for less motion.
 *
 * Honoured because screen shake is the one effect in this project that can make somebody feel
 * unwell, and a draft night is ten people in a room where nobody is going to announce that.
 * The setting is theirs, already made, and costs one query to respect.
 *
 * Guarded rather than assumed: `matchMedia` is missing in jsdom and in older browsers, and an
 * effect layer must never be the reason a screen fails to render.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
