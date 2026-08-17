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

/**
 * What the oil texture is multiplied by.
 *
 * It used to be drawn untinted, on the reasoning that oil's identity is its own colour and a
 * multiply could only spoil the iridescence. That was right until the plain floor was
 * lightened: the texture averages luminance 60 and the floor now sits near 78, so a slick and
 * clean ground were within twenty levels of each other and the spill stopped reading as a
 * spill.
 *
 * Multiply is the only lever available -- it cannot brighten, but oil wants to go the other way
 * anyway. Roughly 0.43, which lands the slick near luminance 25 against a floor of 78: dark
 * enough to be unmistakably a liquid on the ground rather than a patch of it. Slightly cool
 * rather than neutral grey, so what iridescence survives leans blue-purple instead of muddying.
 */
export const OIL_TINT = 0x6e6e85;

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

/**
 * The outline of an oil slick, as a flat `[x, y, x, y, ...]` polygon.
 *
 * A slick used to be drawn as the tile it occupies: a hard-edged square, which is the one shape
 * a spilled liquid never makes. This is a closed loop whose radius wanders with the angle,
 * built from three sine terms at different frequencies so the wobble does not settle into an
 * obvious rhythm the way a single term does.
 *
 * **Deterministic, from the tile index.** Not random, and this matters more than it looks: the
 * site has a Replay button, and a spill that reshaped itself between two viewings of the same
 * seed would quietly undermine the claim the whole event rests on. The same tile always gives
 * the same splat.
 *
 * **Sized to roughly the tile it stands for.** It bulges past the edges in places and falls
 * short in others, which is what makes it read as liquid — but the average is close to the
 * tile, because the tile is exactly the area that is slippery. A small tidy puddle would look
 * better and misinform about where it is safe to drive, which is the same objection that
 * decided how far a flame jet is drawn.
 *
 * The overspill is a bonus rather than a defect: adjacent oiled tiles run into one another and
 * read as one spreading pool rather than two stamps.
 */
export function oilSplatPoints(
  centreX: number,
  centreY: number,
  size: number,
  index: number,
  steps = 32,
): number[] {
  // Three odd-ish multipliers so the terms do not share a period and repeat visibly.
  const hash = (Math.abs(Math.trunc(index)) * 2654435761) >>> 0;
  const phaseA = ((hash & 0xff) / 255) * Math.PI * 2;
  const phaseB = (((hash >>> 8) & 0xff) / 255) * Math.PI * 2;
  const phaseC = (((hash >>> 16) & 0xff) / 255) * Math.PI * 2;

  const points: number[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble =
      0.13 * Math.sin(angle * 2 + phaseA) +
      0.08 * Math.sin(angle * 3 + phaseB) +
      0.05 * Math.sin(angle * 5 + phaseC);
    const radius = size * (OIL_SPLAT_RADIUS + wobble);
    points.push(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
  }
  return points;
}

/**
 * The splat's mean radius, as a fraction of a tile.
 *
 * Above half, so the lobes reach the tile edges and beyond rather than leaving a visible ring
 * of clean floor around every slick. Below the half-diagonal (0.707), so it does not routinely
 * cover the corners of tiles nobody oiled.
 */
export const OIL_SPLAT_RADIUS = 0.58;
