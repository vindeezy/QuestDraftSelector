import { Application, Container, Graphics, Sprite, type FillInput, type Texture } from 'pixi.js';
import type { BotBuild } from '../sim/parts/assemble';
import { partAt } from '../sim/parts/tables';
import { destroyOnce } from './destroy-once';
import { armourTexture, loadMaterials, textureFor } from './materials';
import { chassisSprite, loadChassisSprites, spritesAbsent } from './chassis-sprites';

/**
 * Draws an assembled bot's portrait — the first time a league member sees the machine
 * that will fight for them, presented like a character-select screen (build-reveal, beat
 * 10, `docs/superpowers/specs/2026-08-11-website-design.md` §5.3 and §8).
 *
 * Split into two layers on purpose:
 *
 * - `drawBotPortrait` is the pure primitive: six slot indices in, a `Container` plus its
 *   part anchors out. It owns no `Application` and touches no DOM, so a future caller —
 *   the arena renderer is the obvious one, see the task brief — can add the returned
 *   `view` into an *existing* stage at whatever position/rotation/scale it wants, the
 *   same way `arena-renderer.ts` already draws many bots into one shared canvas.
 * - `mountBotPortraitStage` is the concrete, `Application`-owning helper this screen
 *   actually uses, the same shape `createArenaRenderer`/`createPlinkoRenderer` already
 *   have: it creates its own canvas, mounts `drawBotPortrait`'s output centred in it, and
 *   hands back anchor positions in viewport pixels so a caller can draw leader lines that
 *   track the portrait's own idle drift.
 *
 * §8's "four visual channels" table is implemented directly:
 *
 *   | Channel            | Carries         |
 *   |---------------------|-----------------|
 *   | Silhouette          | chassis shape   |
 *   | Fill colour         | member identity |
 *   | Rim / edge treatment| armour material |
 *   | Front attachment    | weapon          |
 *
 * Drive, ability and personality own none of these — that is expected (§8's own words:
 * "correctly excluded") — so nothing here invents geometry for them, and
 * `BotPortraitAnchors` has no field for any of the three.
 */

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** Where the chassis, weapon and armour visually live, in the portrait's own local
 *  space (before whatever position/rotation/scale a caller applies to `view`) — so a
 *  caller can attach a leader line, or anything else, without re-deriving the geometry
 *  that produced the drawing. No entry for drive/ability/personality: see the module
 *  doc comment. */
export interface BotPortraitAnchors {
  chassis: Point2;
  weapon: Point2;
  armour: Point2;
}

export interface BotPortraitWeapon {
  /** The moving part. Rotate or scale this; the mount around it keeps it attached. */
  node: Container;
  /** A hammer's head, separate from its arm so it can slide along it. Null for everything
   *  else, whose weapon is a single rigid piece. */
  head: Container | null;
  /** Where `head` sits at rest, measured along +x from the pivot. Zero when there is no head. */
  headOffset: number;
  /** The pivot, in the same local units as `headOffset` — the head slides between the two. */
  pivotX: number;
  motion: WeaponMotion;
  /** The nozzle or contact point, in the portrait's own local units — the arena scales it. */
  muzzle: Point2;
}

export interface BotPortraitDrawing {
  /** Local origin is the bot's own centre, facing +x — the same "heading 0 -> +x"
   *  convention `arena-renderer.ts` already uses for `cosOf(bot.heading)`, so a future
   *  caller can rotate this exactly the way it already rotates a heading spike. */
  view: Container;
  anchors: BotPortraitAnchors;
  /** Everything a caller needs to animate the weapon. The build reveal ignores it. */
  weapon: BotPortraitWeapon;
  /** The chassis's own drawn radius, in local units — `CHASSIS_BASE_RADIUS` scaled per
   *  chassis (only Tower's differs, see `chassisRadiusFor`). A caller fitting the
   *  portrait into a box can use this instead of re-measuring bounds. */
  radius: number;
}

/** Baseline chassis radius, in local drawing units. Arbitrary — nothing outside this
 *  module reads it — chosen only so every shape below reads at a comfortable size
 *  relative to its own weapon/armour embellishments. */
const CHASSIS_BASE_RADIUS = 62;

/**
 * How much of the portrait canvas the machine fills, measured across its widest axis.
 *
 * Short of 1 on purpose: the idle drift rotates the bot a few degrees each way, and a
 * shape that exactly fills its square at rest clips its own corners as it turns. This
 * leaves enough room for that swing plus a little air, without the sea of empty space the
 * portrait had when it was drawn at a fixed size and merely centred.
 */
const PORTRAIT_FILL = 0.86;

// --- Shape description ------------------------------------------------------------------
//
// One small data shape per chassis, rather than six near-duplicate draw functions: fill,
// stroke (armour rim) and the anchor maths (front/rear extent, a point on the outline at
// an arbitrary angle) all dispatch off `ChassisShape.kind`, so "Wedge is a `poly`, Circle
// is a `circle`" is the only per-chassis decision that has to be made twice.

type ChassisShape =
  | { kind: 'poly'; points: readonly Point2[] }
  | { kind: 'circle'; radius: number }
  | { kind: 'roundRect'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'regularPoly'; sides: number; radius: number; rotation: number };

function regularPolyVertices(shape: { sides: number; radius: number; rotation: number }): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i < shape.sides; i++) {
    const angle = shape.rotation + (Math.PI * 2 * i) / shape.sides;
    points.push({ x: Math.cos(angle) * shape.radius, y: Math.sin(angle) * shape.radius });
  }
  return points;
}

function flatten(points: readonly Point2[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x, p.y);
  }
  return out;
}

/**
 * Six chassis silhouettes, true to their stats in `sim/parts/tables.ts` (see the doc
 * comment above each `CHASSIS` entry there for the numbers this reflects):
 *
 * - **Wedge** — a pointed prow (0.40 front vulnerability: nearly immune head-on).
 * - **Diamond** — a rhombus, tough front and back, thin at the flanks.
 * - **Square** — a plain, axis-aligned square: "the honest baseline."
 * - **Circle** — a true circle: uniform armour, no weak side.
 * - **Box** — a chunky rounded rect, deliberately near-filling its own footprint: the
 *   heaviest chassis, +20% mass.
 * - **Tower** — a compact octagon at 0.75x this function's own radius, matching its
 *   "25% smaller radius" stat exactly rather than just reading small by convention.
 *
 * Every polygon here is symmetric across the local x-axis by construction — no vertex
 * exists at y=0 off-centre — which is what lets `extentX` below place the weapon mount
 * and the chassis's own rear anchor on the centreline without special-casing any shape.
 */
function chassisShapeFor(chassisId: string, r: number): ChassisShape {
  switch (chassisId) {
    case 'chassis-wedge':
      return {
        kind: 'poly',
        points: [
          { x: r, y: 0 },
          { x: r * 0.15, y: r * 0.85 },
          { x: -r * 0.85, y: r * 0.6 },
          { x: -r * 0.85, y: -r * 0.6 },
          { x: r * 0.15, y: -r * 0.85 },
        ],
      };
    case 'chassis-diamond':
      return {
        kind: 'poly',
        points: [
          { x: r, y: 0 },
          { x: 0, y: r * 0.8 },
          { x: -r, y: 0 },
          { x: 0, y: -r * 0.8 },
        ],
      };
    case 'chassis-square':
      return {
        kind: 'poly',
        points: [
          { x: r * 0.78, y: r * 0.78 },
          { x: -r * 0.78, y: r * 0.78 },
          { x: -r * 0.78, y: -r * 0.78 },
          { x: r * 0.78, y: -r * 0.78 },
        ],
      };
    case 'chassis-circle':
      return { kind: 'circle', radius: r };
    case 'chassis-box':
      return {
        kind: 'roundRect',
        x: -r * 0.92,
        y: -r * 0.92,
        width: r * 1.84,
        height: r * 1.84,
        radius: r * 0.16,
      };
    case 'chassis-tower':
      return { kind: 'regularPoly', sides: 8, radius: r, rotation: Math.PI / 8 };
    default:
      // Unreached with a real `Part` from `tables.ts` — `partAt` always returns one of
      // the six ids above — but a shape must exist for the type to be total.
      return { kind: 'circle', radius: r };
  }
}

/** Tower is the one chassis whose stats actually change its radius — see the
 *  `scale: { radius: 0.75 }` line on `chassis-tower` in `tables.ts`. Every other chassis
 *  draws at the same baseline; their identity is silhouette, not size. */
function chassisRadiusFor(chassisId: string): number {
  return chassisId === 'chassis-tower' ? CHASSIS_BASE_RADIUS * 0.75 : CHASSIS_BASE_RADIUS;
}

/**
 * The fill for a chassis body: the member's colour, optionally with a material through it.
 *
 * `textureSpace: 'local'` is what makes this a two-line change rather than a matrix exercise —
 * it stretches the texture to each shape's own bounds, so all six chassis silhouettes are
 * covered edge to edge without anybody computing a UV transform per shape.
 *
 * `color` alongside `texture` MULTIPLIES the two, which is precisely the intent: the material
 * supplies the surface and the member's colour supplies the identity. It is also why every
 * texture in `src/render/textures/` is deliberately light — multiplying can only darken, and a
 * dark material would swallow the one thing that says whose bot this is.
 */
/**
 * How strongly a material shows through a bot's colour, 0 to 1.
 *
 * Not 1, and the reason is measured rather than aesthetic. A texture MULTIPLIES, so a bot's
 * apparent colour became its member colour times its armour's brightness -- and those run from
 * 0.47 for depleted uranium to 0.84 for aluminium. That put the ARMOUR on the same channel as
 * the identity: Vin drew uranium and his white bot rendered as `#787878`, while Nick Lenker's
 * silver drew titanium and rendered `#69747e`. Measured in CIELAB, those two went from 30.8
 * apart to 7.5, which is not "similar", it is the same colour.
 *
 * Worse, it could not be fixed by changing the hexes. White is already `#ffffff`; there is no
 * brighter white to reach for.
 *
 * Drawing the flat colour first and the textured copy over it at this alpha makes the effective
 * multiplier `1 - s + s * texture`, which pulls the range from [0.47, 0.84] up to [0.71, 0.91].
 * The material keeps its full pattern -- every rivet, weave and pit is still there -- at reduced
 * amplitude, and the ten colours get most of their separation back.
 */
export const TEXTURE_STRENGTH = 0.55;

function bodyFill(colour: number, texture: Texture | null): number | FillInput {
  return texture === null ? colour : { texture, color: colour, textureSpace: 'local' };
}

/**
 * The fill for a weapon's bright metal.
 *
 * Tinted with `WEAPON_METAL` rather than the member's colour: a weapon is not a place to carry
 * identity — that is the chassis's job — and colouring the blade would make ten bots' weapons
 * ten different colours, which is a decoration rather than a machine.
 */
function weaponFill(texture: Texture | null | undefined): number | FillInput {
  if (!texture) return WEAPON_METAL;
  return { texture, color: WEAPON_METAL, textureSpace: 'local' };
}

function traceShape(g: Graphics, shape: ChassisShape): Graphics {
  switch (shape.kind) {
    case 'poly':
      return g.poly(flatten(shape.points));
    case 'circle':
      return g.circle(0, 0, shape.radius);
    case 'roundRect':
      return g.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius);
    case 'regularPoly':
      return g.regularPoly(0, 0, shape.radius, shape.sides, shape.rotation);
  }
}

function fillShape(
  g: Graphics,
  shape: ChassisShape,
  colour: number,
  texture: Texture | null = null,
): void {
  // Flat colour first, then the material over it at partial alpha. Two passes rather than one,
  // because a single textured fill multiplies at full strength and the armour's brightness ends
  // up impersonating the member's colour -- see `TEXTURE_STRENGTH`.
  traceShape(g, shape).fill(colour);
  if (texture !== null) {
    traceShape(g, shape).fill({
      ...(bodyFill(colour, texture) as object),
      alpha: TEXTURE_STRENGTH,
    } as FillInput);
  }
}

interface StrokeOpts {
  width: number;
  color: number;
  alpha?: number;
}

function strokeShape(g: Graphics, shape: ChassisShape, opts: StrokeOpts): void {
  switch (shape.kind) {
    case 'poly':
      g.poly(flatten(shape.points)).stroke(opts);
      return;
    case 'circle':
      g.circle(0, 0, shape.radius).stroke(opts);
      return;
    case 'roundRect':
      g.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius).stroke(opts);
      return;
    case 'regularPoly':
      g.regularPoly(0, 0, shape.radius, shape.sides, shape.rotation).stroke(opts);
      return;
  }
}

/** The x-extent of `shape` along its own centreline (see the symmetry note on
 *  `chassisShapeFor`): `dir` 1 for the front-most point (where the weapon mounts), -1
 *  for the rear-most (the chassis card's own leader-line anchor). */
function extentX(shape: ChassisShape, dir: 1 | -1): number {
  switch (shape.kind) {
    case 'circle':
      return dir * shape.radius;
    case 'roundRect':
      return dir === 1 ? shape.x + shape.width : shape.x;
    case 'poly': {
      const xs = shape.points.map((p) => p.x);
      return dir === 1 ? Math.max(...xs) : Math.min(...xs);
    }
    case 'regularPoly': {
      const xs = regularPolyVertices(shape).map((p) => p.x);
      return dir === 1 ? Math.max(...xs) : Math.min(...xs);
    }
  }
}

/** Ray/segment intersection, ray from the origin along unit direction `(dx, dy)`
 *  against segment `a`-`b`. Returns the distance along the ray, or `null` if they don't
 *  meet in front of the ray or within the segment. Standard 2x2 linear solve; see the
 *  call site (`pointOnOutline`) for why this is the one piece of real geometry here. */
function raySegmentDistance(dx: number, dy: number, a: Point2, b: Point2): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = -dx * ey + ex * dy;
  if (Math.abs(det) < 1e-9) return null;
  const t = (-a.x * ey + ex * a.y) / det;
  const s = (dx * a.y - dy * a.x) / det;
  if (t < 0 || s < 0 || s > 1) return null;
  return t;
}

/**
 * A point on `shape`'s own outline in the direction `angle` (radians, 0 = +x) from the
 * centre — used to place the armour rim's own decorations (Spiked Composite's spikes,
 * Carbon Fibre's weave ticks, Aluminium's polish ticks) exactly on whatever silhouette
 * is currently drawn, rather than hard-coding positions that would only fit one chassis.
 * Every shape here is star-convex around the origin, so casting one ray from the centre
 * always has exactly one answer.
 */
function pointOnOutline(shape: ChassisShape, angle: number): Point2 {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  if (shape.kind === 'circle') {
    return { x: dx * shape.radius, y: dy * shape.radius };
  }
  if (shape.kind === 'roundRect') {
    // Corner rounding is ignored here — the ticks/spikes this feeds are a handful of
    // pixels long, and the rectangle approximation is indistinguishable from the true
    // rounded outline at that scale.
    const hw = shape.width / 2;
    const hh = shape.height / 2;
    const tx = Math.abs(dx) < 1e-9 ? Infinity : hw / Math.abs(dx);
    const ty = Math.abs(dy) < 1e-9 ? Infinity : hh / Math.abs(dy);
    const t = Math.min(tx, ty);
    return { x: dx * t, y: dy * t };
  }

  const points = shape.kind === 'poly' ? shape.points : regularPolyVertices(shape);
  let bestT = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const t = raySegmentDistance(dx, dy, a, b);
    if (t !== null && t < bestT) bestT = t;
  }
  if (!Number.isFinite(bestT)) bestT = 0;
  return { x: dx * bestT, y: dy * bestT };
}

/** Lightens (`percent` > 0) or darkens (`percent` < 0) a 0xRRGGBB colour — used only for
 *  a chassis's own panel-line embellishments, which want to read as "the same material,
 *  a shade off" rather than a second unrelated colour. */
function shade(colour: number, percent: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const adjust = (c: number): number => {
    const v = percent < 0 ? c * (1 + percent / 100) : c + (255 - c) * (percent / 100);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
}

/** Per-chassis panel-line detail, drawn in a shade of the member's own colour. Purely
 *  decorative — it never changes bounds or anchors — but it is what keeps six silhouettes
 *  from reading as "flat shape with a different outline" and nothing else. */
function drawChassisDetail(g: Graphics, chassisId: string, shape: ChassisShape, r: number, colour: number): void {
  const dark = shade(colour, -45);
  const light = shade(colour, 35);

  switch (chassisId) {
    case 'chassis-wedge':
      g.moveTo(-r * 0.7, 0)
        .lineTo(r * 0.85, 0)
        .stroke({ width: 3, color: dark, alpha: 0.55 });
      return;
    case 'chassis-diamond':
      if (shape.kind === 'poly') {
        const inset = shape.points.map((p) => ({ x: p.x * 0.55, y: p.y * 0.55 }));
        strokeShape(g, { kind: 'poly', points: inset }, { width: 2, color: light, alpha: 0.5 });
      }
      return;
    case 'chassis-square':
      if (shape.kind === 'poly') {
        const inset = shape.points.map((p) => ({ x: p.x * 0.62, y: p.y * 0.62 }));
        strokeShape(g, { kind: 'poly', points: inset }, { width: 2, color: dark, alpha: 0.5 });
      }
      return;
    case 'chassis-circle':
      g.circle(0, 0, r * 0.6).stroke({ width: 2, color: dark, alpha: 0.5 });
      return;
    case 'chassis-box':
      g.moveTo(-r * 0.8, -r * 0.32)
        .lineTo(r * 0.8, -r * 0.32)
        .stroke({ width: 2, color: dark, alpha: 0.55 });
      g.moveTo(-r * 0.8, r * 0.32)
        .lineTo(r * 0.8, r * 0.32)
        .stroke({ width: 2, color: dark, alpha: 0.55 });
      for (const cx of [-r * 0.75, r * 0.75]) {
        for (const cy of [-r * 0.75, r * 0.75]) {
          g.circle(cx, cy, r * 0.06).fill({ color: dark, alpha: 0.7 });
        }
      }
      return;
    case 'chassis-tower':
      g.regularPoly(0, 0, r * 0.5, 8, Math.PI / 8).stroke({ width: 2, color: light, alpha: 0.55 });
      g.circle(0, 0, r * 0.1).fill({ color: light, alpha: 0.6 });
      return;
    default:
      return;
  }
}

const WEAPON_METAL = 0xc9d3de;
const WEAPON_DARK = 0x393f4a;

/**
 * The six front attachments, mounted at `frontX` (the chassis's own front extent, from
 * `extentX`) so a weapon always sits flush against whatever silhouette it's attached to
 * rather than floating a fixed distance from the origin. Shapes lean on `tables.ts`'s own
 * stats: Hammer (highest damage, longest cooldown) reads heavy and slow on a stalk;
 * Flamethrower (no knockback) is a nozzle, not a blade; Ram Plate (the widest arc save
 * one, 899 steps / ~79 degrees) is a wide flat face flush to the front rather than
 * something that projects out on its own.
 *
 * Returns the weapon's own outermost point — the tip a leader line should land on.
 */
/**
 * How a weapon moves under its own power.
 *
 * Top-down matters here. A saw blade and a spinning bar rotate in the plane we are looking
 * at, so they simply spin. A VERTICAL spinner does not: its disc turns about a horizontal
 * axis, so from above it does not rotate at all — it appears to thin and thicken as the disc
 * presents its edge and then its face. Spinning it in-plane would be the easy thing to do and
 * would read as the wrong machine.
 */
export type WeaponMotion = 'spin' | 'edge' | 'swing' | 'jet' | 'none';

/** Teeth on a bot's saw blade. Exported because the arena's spin rate has to stay below the
 *  rate at which this many teeth alias — see the aliasing test in `weapon-motion.test.ts`. */
export const WEAPON_SAW_TEETH = 10;

export interface WeaponDrawing {
  /** Where a leader line should land — the tip, as before. */
  tip: Point2;
  /** The point the weapon moves about: a blade's centre, a haft's root, a nozzle's mouth. */
  pivot: Point2;
  motion: WeaponMotion;
  /**
   * Set only when the weapon drew a separate head into `head`: how far along +x from the
   * pivot that head sits at rest.
   *
   * Only the hammer uses it, and it is the difference between a crush that reads and one that
   * does not. Drawn as one piece, foreshortening the weapon shrinks the HEAD too, so a hammer
   * rearing up looks like a hammer getting smaller. Drawn as two, the arm collapses toward the
   * pivot while the head slides back along it and grows — and the head, being on top, covers
   * the arm exactly as it would if you were standing over the machine looking down.
   */
  headOffset?: number;
}

function drawWeapon(
  g: Graphics,
  head: Graphics,
  weaponId: string,
  frontX: number,
  metal: number | FillInput = WEAPON_METAL,
): WeaponDrawing {
  switch (weaponId) {
    case 'weapon-vertical-spinner': {
      const cx = frontX + 14;
      g.ellipse(cx, 0, 10, 26).fill(metal);
      g.ellipse(cx, 0, 10, 26).stroke({ width: 2, color: WEAPON_DARK, alpha: 0.85 });
      g.moveTo(cx, -22)
        .lineTo(cx, 22)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
      return { tip: { x: cx, y: -26 }, pivot: { x: cx, y: 0 }, motion: 'edge' };
    }
    case 'weapon-hammer': {
      const headX = frontX + 22;
      const rootX = frontX - 6;
      // The arm, into the moving layer. The head goes into its own, drawn about its OWN
      // centre so it can be slid along the arm and scaled without dragging the arm with it.
      g.moveTo(rootX, 0)
        .lineTo(headX - 10, 0)
        .stroke({ width: 6, color: WEAPON_DARK });
      head.poly([-11, -20, 11, -14, 11, 14, -11, 20]).fill(metal);
      // Pivots at the haft's root, where an arm would hold it, so it swings rather than
      // orbiting the bot.
      return {
        tip: { x: headX + 10, y: 0 },
        pivot: { x: rootX, y: 0 },
        motion: 'swing',
        // The head's centre: the poly spans headX-12 to headX+10, so it is a pixel back of
        // `headX`. Measured rather than assumed, because it decides where the head sits at
        // rest and the reveal draws the hammer standing still.
        headOffset: headX - 1 - rootX,
      };
    }
    case 'weapon-saw-blade': {
      const cx = frontX + 12;
      const teeth = WEAPON_SAW_TEETH;
      const outer = 20;
      g.star(cx, 0, teeth, outer, 12).fill(metal);
      g.circle(cx, 0, 5).fill(WEAPON_DARK);
      // `star`'s own first vertex sits at the top (angle -90 deg), stepping every
      // `180 / teeth` degrees and alternating outer/inner radius — with `teeth = 10`
      // that puts an *inner*-radius vertex exactly on the local +x axis, so the blade's
      // true rightmost point is the nearest *outer* vertex, one half-step away, not the
      // outer radius itself. Anchoring at the outer radius directly would land outside
      // the shape actually drawn.
      const halfStep = Math.PI / teeth;
      return {
        tip: { x: cx + outer * Math.cos(halfStep), y: 0 },
        pivot: { x: cx, y: 0 },
        motion: 'spin',
      };
    }
    case 'weapon-spinning-bar': {
      const cx = frontX + 4;
      g.rect(cx - 4, -30, 8, 60).fill(metal);
      g.circle(cx, 0, 6).fill(WEAPON_DARK);
      return { tip: { x: cx, y: -30 }, pivot: { x: cx, y: 0 }, motion: 'spin' };
    }
    case 'weapon-ram-plate': {
      g.roundRect(frontX - 4, -26, 16, 52, 3).fill(metal);
      g.roundRect(frontX - 4, -26, 16, 52, 3).stroke({ width: 2, color: WEAPON_DARK, alpha: 0.85 });
      return { tip: { x: frontX + 12, y: 0 }, pivot: { x: frontX, y: 0 }, motion: 'none' };
    }
    case 'weapon-flamethrower': {
      const tipX = frontX + 26;
      g.poly([frontX - 2, -8, tipX, -4, tipX, 4, frontX - 2, 8]).fill(WEAPON_DARK);
      g.circle(tipX, 0, 5).fill(0xff8a3d);
      g.circle(tipX, 0, 5).stroke({ width: 1.5, color: 0xffd23d, alpha: 0.9 });
      // The nozzle mouth: where flame has to come from, or it looks like the bot is on
      // fire rather than firing.
      return { tip: { x: tipX, y: 0 }, pivot: { x: tipX, y: 0 }, motion: 'jet' };
    }
    default:
      return { tip: { x: frontX, y: 0 }, pivot: { x: frontX, y: 0 }, motion: 'none' };
  }
}

/**
 * The seven armour rim treatments, traced along `shape`'s own outline (so the rim always
 * fits whichever chassis it's drawn on) via `strokeShape`, with Spiked Composite's spikes,
 * Carbon Fibre's weave and Aluminium's polish ticks placed with `pointOnOutline` for the
 * same reason. Returns a point on the rim (its own top, angle -90 deg) for the armour
 * card's leader line.
 */
function drawArmour(g: Graphics, armourId: string, shape: ChassisShape): Point2 {
  // +PI/2, not -PI/2. Armour is a rim treatment running the whole way round, so any point
  // on the outline describes it equally well — which makes this purely a question of where
  // the leader line should land. The portrait is presented rotated so the bot faces up,
  // which maps local +y to screen right and local -y to screen left. At -PI/2 the anchor
  // sat on the screen's left while its card sits on the right, so every armour leader line
  // was drawn straight across the machine it was pointing at.
  const top = pointOnOutline(shape, Math.PI / 2);

  switch (armourId) {
    case 'armour-depleted-uranium':
      // Heavy and dark — the toughest, slowest-turning armour in the game.
      strokeShape(g, shape, { width: 10, color: 0x201f18, alpha: 0.95 });
      strokeShape(g, shape, { width: 4, color: 0x4a4a2f, alpha: 0.6 });
      break;
    case 'armour-carbon-fibre':
      // Thin and bright, with a woven look — barely any protection, lightest by far.
      strokeShape(g, shape, { width: 2, color: 0xdfe9f2, alpha: 0.9 });
      for (let i = 0; i < 10; i++) {
        const a1 = (Math.PI * 2 * i) / 10;
        const p1 = pointOnOutline(shape, a1);
        const p2 = pointOnOutline(shape, a1 + 0.18);
        g.moveTo(p1.x * 1.02, p1.y * 1.02)
          .lineTo(p2.x * 0.96, p2.y * 0.96)
          .stroke({ width: 1, color: 0x9fd8ee, alpha: 0.5 });
      }
      break;
    case 'armour-alloy':
      strokeShape(g, shape, { width: 5, color: 0x8fa3b8, alpha: 0.85 });
      break;
    case 'armour-aluminium':
      // No weight penalty, no drama — a plain, thin, polished rim with light ticks.
      strokeShape(g, shape, { width: 3, color: 0xd7dee6, alpha: 0.8 });
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        const p = pointOnOutline(shape, a);
        const inner = { x: p.x * 0.9, y: p.y * 0.9 };
        g.moveTo(inner.x, inner.y)
          .lineTo(p.x, p.y)
          .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
      }
      break;
    case 'armour-titanium':
      strokeShape(g, shape, { width: 4, color: 0xb9c8e6, alpha: 0.85 });
      strokeShape(g, shape, { width: 1, color: 0xffffff, alpha: 0.5 });
      break;
    case 'armour-hardened-steel':
      // Second-toughest: thick, but visibly a notch below Depleted Uranium.
      strokeShape(g, shape, { width: 8, color: 0x3b4657, alpha: 0.95 });
      break;
    case 'armour-spiked-composite': {
      // The one armour that must be visibly spiked — it is the material that reflects
      // damage back onto whoever lands a hit, so the spikes are the whole point.
      strokeShape(g, shape, { width: 5, color: 0x8a2b2b, alpha: 0.9 });
      const spikeCount = 8;
      for (let i = 0; i < spikeCount; i++) {
        const a = (Math.PI * 2 * i) / spikeCount;
        const base = pointOnOutline(shape, a);
        const len = Math.hypot(base.x, base.y) || 1;
        const nx = base.x / len;
        const ny = base.y / len;
        const tx = -ny;
        const ty = nx;
        const tip = { x: base.x + nx * 14, y: base.y + ny * 14 };
        const s1 = { x: base.x + tx * 5, y: base.y + ty * 5 };
        const s2 = { x: base.x - tx * 5, y: base.y - ty * 5 };
        g.poly([s1.x, s1.y, tip.x, tip.y, s2.x, s2.y]).fill(0xb23a3a);
      }
      break;
    }
    default:
      strokeShape(g, shape, { width: 4, color: 0x8fa3b8, alpha: 0.8 });
  }

  return top;
}

/** Perceived brightness, 0 (black) to 1 (white). Same formula `plinko-renderer.ts` and
 *  `shell/colour.ts` both already use, duplicated rather than imported for the same
 *  layering reason `plinko-renderer.ts` gives: this is `src/render/`, which must not
 *  reach up into `src/shell/`. */
function luminance(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Below this brightness, a dark outline reads as *no* outline — the fill and the edge
 *  are both near-black, so the silhouette loses its crisp edge exactly where a member's
 *  own colour happens to be dark (Tommy, `#1C1F26`, is the one roster colour this
 *  matters for — see `plinko-renderer.ts`'s identical `DARK_BALL_LUMINANCE` guard on the
 *  same member). A bright outline is used instead once the fill drops below it. */
const DARK_FILL_LUMINANCE = 0.18;

/**
 * Draws one assembled bot: chassis silhouette in the member's own colour, the armour rim
 * traced on top, the weapon mounted at the front. Pure — no `Application`, no DOM, safe to
 * call from a plain unit test (`Graphics` builds its draw instructions and local bounds
 * without a renderer; only turning them into pixels needs a WebGL/WebGPU context).
 */
/** Extras a caller can ask for. Everything defaults to the build reveal's behaviour, so
 *  the screen this module was written for is unaffected. */
export interface BotPortraitOptions {
  /**
   * Multiplier on the weapon's size, scaled about where it mounts on the chassis front so
   * it grows outward rather than detaching.
   *
   * Exists for the arena. A bot there is drawn at its physics radius — about a third of
   * the portrait's — and at that size a weapon is a few pixels: you can tell a machine has
   * something on its front, but not what. Enlarging it only in the arena keeps the build
   * reveal, where the bot is 600px tall and the weapon already reads, exactly as it was.
   */
  weaponScale?: number;

  /**
   * The material to draw the chassis body in. Omitted or null draws flat colour.
   *
   * Passed in already-loaded rather than looked up here, because this function is synchronous
   * and textures are not. That also keeps the decision at the call site: the arena and the
   * build reveal can each choose, and a caller that has no textures (the "What to expect" demo
   * loop, every test, any environment without a GPU) simply does not pass one.
   */
  texture?: Texture | null;

  /**
   * The metal to draw the weapon's bright parts in. Omitted or null draws flat colour.
   *
   * Separate from `texture` because the two answer different questions: the chassis carries the
   * armour material a member was dealt, while every weapon is machined from the same steel. One
   * option could not express that without pretending the weapon's metal is a build property.
   */
  weaponTexture?: Texture | null;

  /**
   * An optional chassis sprite, drawn over the vector body and UNDER the armour rim and the
   * weapon — the SPR 1 trial (`docs/sprite-prompts.md`, `chassis-sprites.ts`).
   *
   * Additive by construction: the vector body is still drawn underneath, so omitting this (or
   * passing null, which is what every caller does until sprite files exist) leaves the portrait
   * byte-for-byte what it was. That is deliberate — this is a timeboxed experiment, and an
   * experiment that changes the default path is one that cannot be cheaply abandoned.
   *
   * Tinted with the member's colour, so the art must be light and greyscale for the same reason
   * the armour textures are: `tint` multiplies and can only darken.
   */
  chassisSprite?: Texture | null;
}

export function drawBotPortrait(
  build: BotBuild,
  colour: number,
  options: BotPortraitOptions = {},
): BotPortraitDrawing {
  const chassisPart = partAt('chassis', build.chassis);
  const weaponPart = partAt('weapon', build.weapon);
  const armourPart = partAt('armour', build.armour);

  const r = chassisRadiusFor(chassisPart.id);
  const shape = chassisShapeFor(chassisPart.id, r);

  const view = new Container();

  const isDarkFill = luminance(colour) < DARK_FILL_LUMINANCE;
  const outline: StrokeOpts = isDarkFill
    ? { width: 2.5, color: 0xffffff, alpha: 0.55 }
    : { width: 3, color: 0x0b0f16, alpha: 0.85 };

  const body = new Graphics();
  // The armour's material, on the chassis body rather than the armour rim. The rim is 2-10px
  // wide and a texture on it would be invisible at any scale; the body is the only surface big
  // enough to say what the machine is made of. The rim keeps its own distinct treatment on top,
  // which is what carries the material at silhouette level.
  fillShape(body, shape, colour, options.texture ?? null);
  strokeShape(body, shape, outline);
  drawChassisDetail(body, chassisPart.id, shape, r, colour);
  view.addChild(body);

  // The trial layer. Sized to the chassis's own diameter rather than the texture's pixels, so a
  // sprite generated at any resolution lands at the size the silhouette already occupies, and
  // `anchor 0.5` puts its centre on the bot's centre of rotation — a sprite offset by even a few
  // pixels reads as a wobble the moment the bot turns.
  if (options.chassisSprite) {
    const sprite = new Sprite(options.chassisSprite);
    sprite.anchor.set(0.5);
    sprite.width = r * 2;
    sprite.height = r * 2;
    sprite.tint = colour;
    view.addChild(sprite);
  }

  const armourGfx = new Graphics();
  const armourAnchor = drawArmour(armourGfx, armourPart.id, shape);
  view.addChild(armourGfx);

  const weaponGfx = new Graphics();
  const weaponHead = new Graphics();
  const frontX = extentX(shape, 1);
  // The weapon's own steel, shared by all six weapons — they are all machined parts off the
  // same bench, unlike the armour, whose whole point is that the seven materials differ.
  const weaponMetal = weaponFill(options.weaponTexture);
  const drawn = drawWeapon(weaponGfx, weaponHead, weaponPart.id, frontX, weaponMetal);
  const weaponAnchor = drawn.tip;
  const weaponScale = options.weaponScale ?? 1;

  // Two nested transforms, because the weapon needs two different centres at once. The MOUNT
  // scales about where the weapon meets the chassis, so enlarging it grows the weapon outward
  // instead of pushing it off the bot. The moving part inside pivots about the weapon's own
  // centre, so a blade spins in place rather than orbiting the chassis. One container cannot
  // do both: pivot and position are a single point.
  const weaponMount = new Container();
  weaponMount.pivot.set(frontX, 0);
  weaponMount.position.set(frontX, 0);
  weaponMount.scale.set(weaponScale);

  weaponGfx.pivot.set(drawn.pivot.x, drawn.pivot.y);
  weaponGfx.position.set(drawn.pivot.x, drawn.pivot.y);
  weaponMount.addChild(weaponGfx);

  // Added AFTER the arm, so it draws over it. That z-order is the occlusion.
  const head = drawn.headOffset === undefined ? null : weaponHead;
  if (head) {
    head.position.set(drawn.pivot.x + drawn.headOffset!, drawn.pivot.y);
    weaponMount.addChild(head);
  }
  view.addChild(weaponMount);

  const chassisAnchor: Point2 = { x: extentX(shape, -1), y: 0 };

  return {
    view,
    weapon: {
      node: weaponGfx,
      head,
      headOffset: drawn.headOffset ?? 0,
      pivotX: drawn.pivot.x,
      motion: drawn.motion,
      muzzle: { x: drawn.tip.x, y: drawn.tip.y },
    },
    anchors: {
      chassis: chassisAnchor,
      // Moved with the weapon, so a leader line still lands on the tip it points at.
      weapon: {
        x: frontX + (weaponAnchor.x - frontX) * weaponScale,
        y: weaponAnchor.y * weaponScale,
      },
      armour: armourAnchor,
    },
    radius: r,
  };
}

// --- The Application-owning stage, for the build-reveal screen --------------------------

export interface BotPortraitStage {
  /** Advances the idle drift by one frame and redraws — call once per animation frame,
   *  the same contract `ArenaRenderer.draw`/`PlinkoRenderer.draw` already have. */
  tick(): void;
  /** Anchor positions in viewport pixels (i.e. directly comparable to
   *  `Element.getBoundingClientRect()`), recomputed from the portrait's *current*
   *  transform — since idle drift keeps rotating it, a caller drawing leader lines needs
   *  this called fresh every frame, not just once at mount. */
  anchorPositions(): BotPortraitAnchors;
  destroy(): void;
}

/** How far the portrait's idle rotation drifts either side of its resting pose, in
 *  radians. Small on purpose — see `mountBotPortraitStage`'s doc comment on why a full
 *  spin was rejected. */
const IDLE_DRIFT_RANGE = 0.12;
/** Radians of drift phase advanced per animation frame. Purely a presentation speed
 *  knob, same spirit as `forge.ts`'s `TICKS_PER_FRAME` — nothing here is simulated, so
 *  there is no determinism to protect, only a "does it read as alive" judgement call. */
const IDLE_DRIFT_SPEED = 0.012;

/**
 * Mounts a `drawBotPortrait` drawing into its own small `Application`, centred, with a
 * slow idle rotation drift — "something alive," per the project owner's ask, so the
 * reveal doesn't read as a static diagram. A full continuous spin was rejected: this
 * portrait has three cards on fixed DOM positions drawing leader lines to it, and a full
 * rotation would sweep those lines wildly around the screen every few seconds. A bounded
 * back-and-forth drift keeps the anchors near their resting position while still visibly
 * moving.
 *
 * Owns the `Application` the same way `createArenaRenderer`/`createPlinkoRenderer` do —
 * `destroy()` goes through `destroyOnce` for the same reason theirs does (see that
 * module's doc comment on the double-destroy crash this guards against).
 */
export async function mountBotPortraitStage(
  parent: HTMLElement,
  build: BotBuild,
  colour: number,
  size = 420,
): Promise<BotPortraitStage> {
  // Awaited here, and only here. This function is already async and the reveal is the screen
  // where the material is actually studied, so it is worth being certain rather than merely
  // likely. Loading began at boot, ten beats earlier, so in practice this resolves instantly --
  // and if it somehow has not, the fallback draws flat colour rather than waiting forever.
  await loadMaterials();
  // The SPR 1 trial, and this is the ONLY place it is loaded -- `mountBotPortraitStage` is the
  // build reveal's helper and nothing else calls it, so the arena, the Forge and the demo loop
  // cannot pick up a sprite even by accident. `spritesAbsent` short-circuits the await entirely
  // while the folder is empty, so the shipped path does no extra work at all.
  if (!spritesAbsent()) await loadChassisSprites();

  const app = new Application();
  await app.init({
    width: size,
    height: size,
    background: 0x0b0f16,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  parent.appendChild(app.canvas);

  const drawing = drawBotPortrait(build, colour, {
    texture: armourTexture(partAt('armour', build.armour).id),
    weaponTexture: textureFor('weapon'),
    chassisSprite: chassisSprite(partAt('chassis', build.chassis).id),
  });
  drawing.view.x = size / 2;
  drawing.view.y = size / 2;

  // Scale the drawing to fill the canvas it was given. Without this the bot is drawn at a
  // fixed ~62-unit radius and merely *centred* in the canvas, so asking for a bigger
  // portrait bought nothing but more empty space around an unchanged machine — at 640 the
  // bot occupied under a fifth of its own stage.
  //
  // Measured from real local bounds rather than `drawing.radius`, because the chassis is
  // not the widest thing here: a Hammer or a Vertical Spinner juts well past the hull, and
  // Spiked Composite's rim spikes stick out all the way round. Scaling off the chassis
  // alone would push those past the canvas edge and clip them.
  //
  // `getLocalBounds` is pre-transform, so this is unaffected by the resting rotation and
  // idle drift applied below, and the anchors stay exact because `toGlobal` walks the same
  // transform this scale becomes part of.
  const bounds = drawing.view.getLocalBounds();
  const extent = Math.max(bounds.width, bounds.height);
  if (extent > 0) {
    const scale = (size * PORTRAIT_FILL) / extent;
    drawing.view.scale.set(scale);
  }

  app.stage.addChild(drawing.view);

  // Presented facing "up", toward the viewer, rather than the sideways +x every other
  // renderer's heading-0 uses — a character-select portrait reads better nose-out than
  // nose-right. This is a display-only rotation on the container; `drawing.anchors` stay
  // in the drawing's own unrotated local space, which is exactly why `anchorPositions`
  // below has to re-derive world position through the live transform on every call
  // rather than rotating the anchors once up front.
  const restingRotation = -Math.PI / 2;
  drawing.view.rotation = restingRotation;

  let drift = 0;

  const toViewportPoint = (local: Point2): Point2 => {
    const global = drawing.view.toGlobal(local);
    const rect = app.canvas.getBoundingClientRect();
    return { x: rect.left + global.x, y: rect.top + global.y };
  };

  return {
    tick(): void {
      drift += IDLE_DRIFT_SPEED;
      drawing.view.rotation = restingRotation + Math.sin(drift) * IDLE_DRIFT_RANGE;
    },
    anchorPositions(): BotPortraitAnchors {
      return {
        chassis: toViewportPoint(drawing.anchors.chassis),
        weapon: toViewportPoint(drawing.anchors.weapon),
        armour: toViewportPoint(drawing.anchors.armour),
      };
    },
    destroy: destroyOnce(app),
  };
}
