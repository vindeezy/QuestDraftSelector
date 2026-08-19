/**
 * Small colour helpers for the shell layer — reading a member's `#RRGGBB` hex and
 * deciding what's legible on top of it. Pure presentation math; nothing here touches
 * `src/sim/`.
 */

function channels(hexColour: string): [number, number, number] {
  const hex = hexColour.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function lumaOf(hexColour: string): number {
  const [r, g, b] = channels(hexColour);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** WCAG relative luminance — the perceptual one, unlike `lumaOf`'s cheaper weighting. */
function relativeLuminance(hexColour: string): number {
  const [r, g, b] = channels(hexColour).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const INK_DARK = '#000000';
const INK_LIGHT = '#ffffff';

/**
 * Readable ink for text drawn on a small swatch filled with `hexColour`.
 *
 * **Measures both options and takes the better one**, rather than reading the swatch's luma
 * and picking a side of a fixed line. The threshold version sat at 0.55 and got three of the
 * ten roster colours wrong, because a luma threshold answers "is this light or dark" when the
 * question is "which ink can actually be read on it". Pat's green measures 0.497 — a hair
 * under the line — so it took the light ink and landed at **2.56:1**, well under the 4.5
 * a two-letter initial at 13px needs. Measured directly, the dark ink on that same green is
 * 7.04.
 *
 * Pure black and white rather than the palette's near-black and near-white, and that is
 * measured too: with `#0c0e11`/`#f5f7fb` the worst member still only reached 4.25 (Nick
 * Lenker's slate), and no softer pair clears the bar. At pure black and white every member
 * passes, worst 4.60. On a saturated swatch the extra harshness is invisible; a failing
 * contrast is not.
 */
export function readableInkFor(hexColour: string): string {
  return contrastRatio(INK_DARK, hexColour) >= contrastRatio(INK_LIGHT, hexColour)
    ? INK_DARK
    : INK_LIGHT;
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
