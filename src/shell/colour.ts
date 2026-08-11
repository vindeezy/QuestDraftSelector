/**
 * Small colour helpers for the shell layer — reading a member's `#RRGGBB` hex and
 * deciding what's legible on top of it. Pure presentation math; nothing here touches
 * `src/sim/`.
 */

/** Picks readable ink (near-black or near-white) for text/icons drawn on a small swatch
 *  filled with `hexColour`. Ten roster colours span from `#FFFFFF` (Vin) to `#1C1F26`
 *  (Tommy) — a single fixed ink colour would fail contrast against roughly half of them,
 *  so this reads the swatch's own luma and picks the readable side of the line. */
export function readableInkFor(hexColour: string): string {
  const hex = hexColour.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? '#0b0f16' : '#f5f7fb';
}
