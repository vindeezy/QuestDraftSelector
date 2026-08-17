/**
 * What the hazards actually look like.
 *
 * They were greyboxed in HZ 8 and never revisited: every circular zone was a translucent disc
 * with four white spokes, every cone a translucent triangle, and a cannon was not drawn at all
 * — only the shot it produced. That was the right call at the time, when the question was
 * whether hazards were killing people at a sensible rate. It stops being the right call once
 * anyone is watching, because a saw blade, a crusher and a spike strip are the same disc, and
 * "the thing that just killed you" should be legible.
 *
 * Two decisions shape this file.
 *
 * **Built once, animated by transform.** Every hazard's geometry is tessellated at mount and
 * afterwards only its rotation, scale and visibility change. The old code rebuilt every zone
 * into one immediate-mode `Graphics` every frame, which was affordable for a disc and four
 * lines and is not for fourteen-toothed blades across the twenty-four flame jets and nine saws
 * the gauntlet arena places. This is the same move the bot silhouettes already make, and it
 * makes the detailed version CHEAPER than the greybox it replaces.
 *
 * **Identity comes from the id.** A zone does not record which hazard it is, and it should not
 * have to: nothing in the simulation cares, and adding a presentational field to simulation
 * data to satisfy a renderer is how a clean layer boundary starts leaking. The ids are already
 * named for their hazard (`saw-l`, `flame-t2`, `cannon-top`), which is exactly how the audio
 * layer decides what a hazard SOUNDS like. Same source, same answer, no new coupling.
 */

import { Container, Graphics } from 'pixi.js';

/** The hazard families that actually appear across the three arenas. */
export type HazardFamily = 'saw' | 'flame' | 'cannon' | 'crusher' | 'unknown';

const FAMILIES = new Set<string>(['saw', 'flame', 'cannon', 'crusher']);

/**
 * Which hazard an id names.
 *
 * The prefix before the first dash, matching `hazardSoundFor` in the audio layer. Anything
 * unrecognised is drawn as the old greybox disc rather than not drawn at all — a hazard added
 * later must be VISIBLE the first time it runs, or a missing look is indistinguishable from a
 * broken hazard, exactly as a missing sound would be.
 */
export function hazardFamily(id: string): HazardFamily {
  const head = id.split('-')[0] ?? '';
  return FAMILIES.has(head) ? (head as HazardFamily) : 'unknown';
}

// Steel, in the same register as the weapon metals in `bot-portrait.ts` so a hazard saw and a
// weapon saw look like they came out of the same workshop.
const STEEL = 0xb9c7d6;
const STEEL_DARK = 0x6a7a8c;
const HOUSING = 0x4a5663;
const HOUSING_DARK = 0x2c3540;
const RUST = 0x8a5a3c;
const SHADOW = 0x05080c;

/**
 * A blade.
 *
 * Drawn about its own centre so the whole thing can simply be rotated. `star` gives the teeth
 * for free and gives them evenly, which a real blade has and a hand-rolled polygon loop tends
 * not to.
 */
/**
 * Teeth on an arena saw.
 *
 * Fewer than a real blade of this size would carry, and chosen with the spin rate rather than
 * separately: a rotationally symmetric shape sampled once a frame reads as turning BACKWARDS
 * once it advances more than half a tooth per frame, and the coarser the teeth the more room
 * that leaves. Coarse teeth also simply look more brutal, which is what an arena saw is for.
 * `SAW_SPIN_PER_TICK` is held below the limit this implies — see the aliasing test.
 */
export const SAW_TEETH = 11;

export function drawSawBlade(g: Graphics, reach: number): void {
  const teeth = SAW_TEETH;
  // Sits under the blade and slightly off it, which is the only thing saying the blade is
  // above the floor rather than painted on it.
  g.circle(2, 3, reach).fill({ color: SHADOW, alpha: 0.45 });

  g.star(0, 0, teeth, reach, reach * 0.74).fill(STEEL);
  g.star(0, 0, teeth, reach, reach * 0.74).stroke({ width: 1.5, color: HOUSING_DARK, alpha: 0.9 });

  // Lightening slots, the cutouts a real blade has to shed heat and weight. They also give
  // the eye something to track, without which a symmetrical blade barely reads as spinning.
  const slots = 5;
  for (let i = 0; i < slots; i++) {
    const a = (i / slots) * Math.PI * 2;
    g.circle(Math.cos(a) * reach * 0.45, Math.sin(a) * reach * 0.45, reach * 0.13).fill({
      color: HOUSING_DARK,
      alpha: 0.85,
    });
  }

  g.circle(0, 0, reach * 0.28).fill(STEEL_DARK);
  g.circle(0, 0, reach * 0.28).stroke({ width: 1.5, color: HOUSING_DARK });
  g.circle(0, 0, reach * 0.1).fill(HOUSING_DARK);
}

/**
 * A flame jet's nozzle, pointing along +x.
 *
 * Drawn separately from the fire, so a jet on a CYCLE can show its hardware between firings:
 * that kind is a fixed installation whose rhythm is the warning, and hiding it would remove
 * the only thing that makes the rhythm useful. A jet on a plate is the opposite -- a trap, and
 * the renderer hides those entirely until they are sprung. This function does not decide
 * which; it only draws the housing.
 *
 * The fire itself is not drawn here at all — it is particles, the same `jet` the flamethrower
 * weapon uses, because the whole point is that the two should look like the same fire.
 */
export function drawFlameNozzle(g: Graphics, size: number): void {
  const body = size * 0.55;
  g.roundRect(-body, -body * 0.62, body * 1.5, body * 1.24, 3).fill(HOUSING);
  g.roundRect(-body, -body * 0.62, body * 1.5, body * 1.24, 3).stroke({
    width: 1.5,
    color: HOUSING_DARK,
  });
  // The flared muzzle, wider than the body so the shape reads as pointing somewhere.
  g.poly([body * 0.5, -body * 0.5, body * 1.15, -body * 0.78, body * 1.15, body * 0.78, body * 0.5, body * 0.5])
    .fill(STEEL_DARK);
  g.circle(body * 1.05, 0, body * 0.3).fill({ color: RUST, alpha: 0.85 });
}

/**
 * A cannon, pointing along +x, drawn about its trunnion so recoil is a slide along local x.
 *
 * Returns the barrel separately: the barrel recoils and the carriage does not, and a gun whose
 * mount slides backwards with the barrel looks like it is being shoved rather than firing.
 */
export function drawCannon(carriage: Graphics, barrel: Graphics, size: number): void {
  carriage.circle(0, 0, size * 0.62).fill(HOUSING);
  carriage.circle(0, 0, size * 0.62).stroke({ width: 2, color: HOUSING_DARK });
  carriage.circle(0, 0, size * 0.3).fill(HOUSING_DARK);

  barrel.roundRect(-size * 0.35, -size * 0.3, size * 1.5, size * 0.6, 3).fill(STEEL_DARK);
  barrel
    .roundRect(-size * 0.35, -size * 0.3, size * 1.5, size * 0.6, 3)
    .stroke({ width: 1.5, color: HOUSING_DARK });
  // The muzzle band, thicker than the barrel, which is what makes the far end read as the
  // business end rather than as a rectangle that stops.
  barrel.roundRect(size * 0.95, -size * 0.4, size * 0.22, size * 0.8, 2).fill(STEEL);
  barrel.circle(size * 1.06, 0, size * 0.2).fill(0x11161d);
}

/**
 * A crusher's plate.
 *
 * Square where everything else round, because it is the one hazard that is not a machine with
 * a moving edge — it is a weight. Rivets sell the mass; a plain rectangle reads as a UI panel.
 */
export function drawCrusherPlate(g: Graphics, reach: number): void {
  const half = reach * 0.82;
  g.roundRect(-half, -half, half * 2, half * 2, 5).fill(HOUSING);
  g.roundRect(-half, -half, half * 2, half * 2, 5).stroke({ width: 2.5, color: HOUSING_DARK });
  g.roundRect(-half * 0.62, -half * 0.62, half * 1.24, half * 1.24, 3).stroke({
    width: 1.5,
    color: STEEL_DARK,
    alpha: 0.7,
  });
  const inset = half * 0.72;
  for (const [rx, ry] of [
    [-inset, -inset],
    [inset, -inset],
    [inset, inset],
    [-inset, inset],
  ] as const) {
    g.circle(rx, ry, reach * 0.075).fill(STEEL_DARK);
  }
}

/**
 * An iron ball with a lit edge.
 *
 * Takes a position rather than being drawn about its own origin, because shots come and go
 * every few seconds and giving each one a persistent container to transform would cost more
 * than the three circles it saves.
 */
export function drawCannonball(g: Graphics, x: number, y: number, radius: number): void {
  g.circle(x, y, radius).fill(0x1b222b);
  g.circle(x, y, radius).stroke({ width: 1.5, color: STEEL_DARK, alpha: 0.9 });
  // Offset highlight, always from the same direction. A flat disc is a dot; one lit
  // consistently is a sphere, and that is the entire difference between the two.
  g.circle(x - radius * 0.3, y - radius * 0.32, radius * 0.34).fill({ color: STEEL, alpha: 0.75 });
}

/** The old greybox disc, kept for hazards this file does not recognise. */
export function drawUnknownZone(g: Graphics, reach: number): void {
  g.circle(0, 0, reach).fill({ color: 0xff6b6b, alpha: 0.32 });
  g.circle(0, 0, reach).stroke({ width: 2, color: 0xff9f9f, alpha: 0.9 });
}

/**
 * A hazard's drawing plus the handles needed to animate it.
 *
 * `view` is positioned and rotated by the renderer; `spin` and `plate` are the parts that move
 * relative to it. Null handles are the normal case — most hazards have only one moving piece,
 * or none.
 */
export interface HazardArt {
  view: Container;
  family: HazardFamily;
  /** The part that rotates (a saw's blade). */
  spin: Container | null;
  /** The part that rises and slams (a crusher's plate), or slides back (a cannon's barrel). */
  plate: Container | null;
  /** Drawn only in the frames right after a shot. */
  flash: Graphics | null;
}

/** Builds the art for one zone, from its id and reach. */
export function createZoneArt(id: string, reach: number): HazardArt {
  const family = hazardFamily(id);
  const view = new Container();

  if (family === 'saw') {
    const blade = new Graphics();
    drawSawBlade(blade, reach);
    view.addChild(blade);
    return { view, family, spin: blade, plate: null, flash: null };
  }

  if (family === 'flame') {
    const nozzle = new Graphics();
    drawFlameNozzle(nozzle, reach * 0.2);
    view.addChild(nozzle);
    return { view, family, spin: null, plate: null, flash: null };
  }

  if (family === 'crusher') {
    const shadow = new Graphics();
    shadow.circle(0, 0, reach * 0.9).fill({ color: SHADOW, alpha: 0.5 });
    view.addChild(shadow);
    const plate = new Graphics();
    drawCrusherPlate(plate, reach);
    view.addChild(plate);
    return { view, family, spin: null, plate, flash: null };
  }

  const g = new Graphics();
  drawUnknownZone(g, reach);
  view.addChild(g);
  return { view, family: 'unknown', spin: null, plate: null, flash: null };
}

/** Builds the art for one emitter. `size` scales the gun against the shot it fires. */
export function createEmitterArt(size: number): HazardArt {
  const view = new Container();
  const carriage = new Graphics();
  const barrel = new Graphics();
  drawCannon(carriage, barrel, size);
  // Barrel under the carriage: it slides back INTO the mount, and drawing it on top makes it
  // look like it is sliding across one.
  view.addChild(barrel);
  view.addChild(carriage);

  const flash = new Graphics();
  // Built once at full brightness and revealed by alpha, so a shot costs no tessellation.
  flash.poly([size * 0.9, 0, size * 2.1, -size * 0.62, size * 2.6, 0, size * 2.1, size * 0.62])
    .fill({ color: 0xfff0c0, alpha: 0.95 });
  flash.circle(size * 1.15, 0, size * 0.5).fill({ color: 0xffd27a, alpha: 0.9 });
  flash.visible = false;
  view.addChild(flash);

  return { view, family: 'cannon', spin: null, plate: barrel, flash };
}
