/**
 * Facts about the floor that the simulation does not record.
 *
 * Pure — no PixiJS, no drawing. One function, and it exists because of a gap between what the
 * simulation stores and what a viewer needs to see.
 *
 * The Oil Slick ability does not create oil. It converts one floor tile to `Surface.Ice`
 * (`src/sim/arena/ability.ts`), because slippery is the whole mechanical point and ice was
 * already slippery. That is a perfectly good simulation decision and a bad presentation one: a
 * bot fires its ability and a pale blue patch of ICE appears behind it, on a floor that in two
 * of the three arenas already has ice on it. The one thing the ability is for — leaving a
 * hazard in your pursuer's path — is invisible, because it looks like scenery that was always
 * there.
 *
 * The obvious fix is a new `Surface.Oil`. It is also the wrong one: that is a change under
 * `src/sim/`, which per `docs/STATUS.md` invalidates the recorded event and demands a
 * re-record, and it would be spending the project's most expensive kind of change on something
 * purely cosmetic.
 *
 * This is the cheap fix, and it is exact rather than approximate. Mid-match there are only two
 * writers to the surface map: this ability, which sets Ice, and floor collapse, which sets
 * Plain. So a tile that is Ice now and was not Ice when the match began was necessarily oiled.
 * No simulation change, no effect plumbing, and no guessing.
 */

import { Surface, type SurfaceValue } from '../sim/arena/surface';

/**
 * Whether tile `index` has been oiled since the match began.
 *
 * `baseline` is the surface map captured at mount. Comparing against it rather than tracking
 * ability events means this cannot drift out of sync with the simulation: it reads the same
 * array the physics reads, one frame later.
 */
export function isOiled(
  baseline: Readonly<Uint8Array>,
  surfaces: Readonly<Uint8Array>,
  index: number,
): boolean {
  if (index < 0 || index >= surfaces.length || index >= baseline.length) return false;
  return surfaces[index] === Surface.Ice && baseline[index] !== Surface.Ice;
}

/**
 * The colour an oiled tile is drawn in.
 *
 * Dark where ice is pale, which is the entire point — the two must not be confusable, and they
 * currently are, being the same colour. Kept clear of the collapse warning's orange-brown for
 * the same reason tar is: nothing on this floor should be mistakable for a tile about to drop.
 */
export const OIL_COLOR = 0x1a1726;

/** The faint cool sheen on top of the pool. Oil's one recognisable trait besides being dark. */
export const OIL_SHEEN = 0x4b4a7a;

/** True when a surface value is one a texture should be looked up for. Ordinary floor is drawn
 *  as flat colour and needs no lookup. */
export function isTexturedSurface(surface: SurfaceValue): boolean {
  return surface !== Surface.Plain;
}

/**
 * Brightens a colour's channels, clamped, and reports how far it actually got.
 *
 * The clamp is the interesting part. A texture is MULTIPLIED into the surface colour, and
 * multiplying only darkens: tinting a floor colour with a texture averaging 0.6 drops the arena
 * nearly half a shade and — far worse — squashes the texture's variation down with it. On a
 * floor whose luminance is 28, a texture varying by 36% shows as ten levels. Nobody sees ten
 * levels.
 *
 * Brightening the colour FIRST fixes both at once: the product lands back on the tone that was
 * chosen for the floor, and the texture's variation is scaled up by the same factor, which is
 * what makes grain visible on a dark surface at all.
 *
 * It cannot always be granted. Ice is already near-white and has no headroom, so it takes what
 * it can — which is fine, because a pale surface shows its texture without any help.
 */
export function brighten(colour: number, factor: number): { colour: number; applied: number } {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const brightest = Math.max(r, g, b, 1);
  // Never let any channel clip, because clipping shifts the HUE — a lifted ice blue that clips
  // green and blue first comes out pink, and the surface stops reading as ice.
  const applied = Math.min(factor, 255 / brightest);
  return {
    colour:
      (Math.round(r * applied) << 16) | (Math.round(g * applied) << 8) | Math.round(b * applied),
    applied,
  };
}

/**
 * How much a floor colour is brightened before its texture multiplies through it.
 *
 * The reciprocal of roughly what the textures average, so the product lands near the original
 * tone. Measured, not guessed: plain averages 0.58 of full brightness and tar 0.55.
 */
export const FLOOR_TEXTURE_LIFT = 1.7;
