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
