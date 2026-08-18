/**
 * Small colour helpers for the shell layer — reading a member's `#RRGGBB` hex and
 * deciding what's legible on top of it. Pure presentation math; nothing here touches
 * `src/sim/`.
 */

/** Picks readable ink (near-black or near-white) for text/icons drawn on a small swatch
 *  filled with `hexColour`. Ten roster colours span from `#FFFFFF` (Vin) to `#1C1F26`
 *  (Tommy) — a single fixed ink colour would fail contrast against roughly half of them,
 *  so this reads the swatch's own luma and picks the readable side of the line. */
function lumaOf(hexColour: string): number {
  const hex = hexColour.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function readableInkFor(hexColour: string): string {
  return lumaOf(hexColour) > 0.55 ? '#0b0f16' : '#f5f7fb';
}

/**
 * True when a member's colour is dark enough that a small filled swatch of it reads as a
 * hole rather than as a token — it sits on backgrounds (`--bg-0` through `--bg-2`) that
 * are themselves nearly black. Those swatches get a brighter ring so their edge is
 * visible; every other colour is left alone.
 *
 * Tommy's `#3A352E` is the one roster colour this catches, and the third place it has
 * needed special handling: `arena-renderer.ts` gives his bot a bright outline
 * (`DARK_BOT_LUMINANCE`) and his health bar a brightened fill (`healthBarColour`). Same
 * threshold as the renderer's, kept in sync by intent rather than by import — `src/render/`
 * must not be reached into from `src/shell/`, see that file's own note on the duplication.
 */
export function isDarkColour(hexColour: string): boolean {
  return lumaOf(hexColour) < 0.3;
}
