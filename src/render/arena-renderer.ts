import {
  Application, BitmapText, Container, Graphics, Particle, ParticleContainer, Rectangle, Text,
} from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { destroyOnce } from './destroy-once';
import { Surface, surfaceAt, effectOf, type SurfaceValue } from '../sim/arena/surface';
import { Activation, isActive } from '../sim/arena/activation';
import { ANGLE_STEPS, cosOf, sinOf } from '../sim/trig';
import { drawBotPortrait, type BotPortraitWeapon } from './bot-portrait';
import type { BotBuild } from '../sim/parts/assemble';
import type { Elimination, Match } from '../sim/arena/match';
import type { Effect } from '../sim/arena/effects';
import { createParticleField } from './vfx/particles';
import { SHAKE_CEILING, visualFor } from './vfx';
import { edgeScale, hammerPose, hammerProgress, spinAngle } from './vfx/weapon-motion';
import { createEmitterArt, createZoneArt, drawCannonball, type HazardArt } from './hazard-art';
import { OIL_COLOR, OIL_SHEEN, isOiled } from './floor-state';
import { armourTexture, textureFor } from './materials';
import {
  HAZARD_JET_EVERY,
  RECOIL_TICKS,
  crusherScale,
  muzzleFlash,
  recoilOffset,
} from './vfx/hazard-motion';
import { botIndexOf } from '../sim/parts/from-effect';
import { partAt } from '../sim/parts/tables';
import { prefersReducedMotion } from './reduced-motion';

const BOT_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

/** A bot's real-world identity: the member's colour and the two-letter initials to
 *  print on its body — the same shape `PlinkoBallVisual` (`plinko-renderer.ts`) already
 *  uses for a member's ball, since it is the same "colour + initials" identity mechanism
 *  applied to a different renderer (§5.1/§5.2 of the design spec). Optional — a caller
 *  with no real members (the "What to expect" demo loop, `what-to-expect.ts`) falls back
 *  to `BOT_COLORS` and a 1-based index label, exactly as before this existed. */
export interface ArenaBotVisual {
  /** 0xRRGGBB. */
  colour: number;
  label: string;
}

/** Perceived brightness, 0 (black) to 1 (white). Same formula `plinko-renderer.ts` and
 *  `bot-portrait.ts` both already use, duplicated rather than imported for the same
 *  layering reason they give: `src/render/` must not reach into `src/shell/`, and these
 *  three files sit alongside each other rather than one importing from another. */
function luminance(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Dark ink on a bright bot, light ink on a dark one, so initials stay readable against
 *  any member colour — the same rule `plinko-renderer.ts`'s `inkFor` applies to a ball. */
function inkFor(colour: number): number {
  return luminance(colour) > 0.55 ? 0x0b0f16 : 0xffffff;
}

/** Below this brightness a bot is at real risk of disappearing into the arena's own dark
 *  floor and wall colours (`0x0b0f16`/`0x35424f`) — see the roster.ts comment on the one
 *  member (Tommy, `#1C1F26`) this matters for, and `plinko-renderer.ts`'s identical
 *  `DARK_BALL_LUMINANCE` guard on the same member's ball. Exported so a test can check the
 *  threshold directly against Tommy's real roster colour without duplicating the number. */
export const DARK_BOT_LUMINANCE = 0.18;

/** True when `colour` needs a brighter, thicker outline to stay legible against the
 *  arena floor — pulled out as its own pure function so this specific requirement (the
 *  "Tommy needs a light outline" rule from the design spec and `roster.ts`) is directly
 *  testable without a WebGL context. */
export function needsBrightOutline(colour: number): boolean {
  return luminance(colour) < DARK_BOT_LUMINANCE;
}

/**
 * Minimum brightness for a health bar's fill.
 *
 * Set well above `DARK_BOT_LUMINANCE` because the bar has none of the defences the bot
 * body has. A dark bot still reads: it is a large disc, it carries its initials, and
 * `needsBrightOutline` gives it a bright rim. The bar is 4px tall, unlabelled, un-outlined,
 * and sits on a black track over a dark floor — so a near-black fill leaves nothing to see
 * at all until the bot drops under 30% health and the bar turns red.
 *
 * Identity is not what this colour is for; the bar sits directly above its own bot, so
 * ownership is never in doubt. Brightness is the only job.
 */
const HEALTH_BAR_MIN_LUMINANCE = 0.45;

/** `colour` scaled by `factor`, each channel clamped to 0..255. */
function scaleChannels(colour: number, factor: number): number {
  const scale = (channel: number): number => {
    const raised = Math.round(channel * factor);
    return raised > 255 ? 255 : raised;
  };
  const r = scale((colour >> 16) & 0xff);
  const g = scale((colour >> 8) & 0xff);
  const b = scale(colour & 0xff);
  return (r << 16) | (g << 8) | b;
}

/** `colour` mixed `t` of the way toward white (`t` in 0..1). */
function blendToWhite(colour: number, t: number): number {
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * t);
  const r = mix((colour >> 16) & 0xff);
  const g = mix((colour >> 8) & 0xff);
  const b = mix(colour & 0xff);
  return (r << 16) | (g << 8) | b;
}

/**
 * A member colour, brightened just enough to read as a health bar. Bright colours are
 * returned untouched, so nine of the ten members' bars are exactly their own colour.
 *
 * Scaling comes first because multiplying all three channels preserves hue — a dark colour
 * brightens into a lighter version of itself rather than a generic grey. Scaling alone is
 * not enough in general, though: channels clamp at 255, and pure black cannot scale at all.
 * Whatever brightness the scale could not deliver is made up by blending toward white,
 * which always reaches the target because luminance is linear in such a blend.
 *
 * Exported so a test can assert the guarantee — every roster colour clears the floor —
 * without a WebGL context.
 */
export function healthBarColour(colour: number): number {
  const start = luminance(colour);
  if (start >= HEALTH_BAR_MIN_LUMINANCE) return colour;

  const scaled = start > 0 ? scaleChannels(colour, HEALTH_BAR_MIN_LUMINANCE / start) : colour;
  const reached = luminance(scaled);
  if (reached >= HEALTH_BAR_MIN_LUMINANCE) return scaled;

  return blendToWhite(scaled, (HEALTH_BAR_MIN_LUMINANCE - reached) / (1 - reached));
}

/** Bot `index`'s colour and label: `botVisuals[index]` when supplied, else the placeholder
 *  palette and a 1-based index — the same fallback `plinko-renderer.ts`'s ball drawing
 *  uses. Pure and side-effect-free so `arena-renderer.test.ts` can check the resolution
 *  rule directly, without mounting a renderer. */
export function resolveBotVisual(index: number, botVisuals?: readonly ArenaBotVisual[]): ArenaBotVisual {
  const visual = botVisuals?.[index];
  if (visual) return visual;
  return { colour: BOT_COLORS[index % BOT_COLORS.length]!, label: String(index + 1) };
}

/** One kill feed line's text: who, by whom, and how. `cause: 'fell'` and `byId === null`
 *  (an environmental/hazard kill — see the `Elimination` doc comment in `match.ts`) both
 *  read as "no attacker" but are worded differently, since a bot falling through the floor
 *  and a bot cooked by a flame jet are not the same story. `labelFor` is injected rather
 *  than a bare id lookup so this stays pure and independently testable
 *  (`arena-renderer.test.ts`) without constructing a real `Match`. */
export function killFeedLine(
  elimination: Pick<Elimination, 'botId' | 'cause' | 'byId'>,
  labelFor: (botId: string) => string,
): string {
  const victim = labelFor(elimination.botId);
  if (elimination.cause === 'fell') return `${victim} fell`;
  if (elimination.byId) return `${victim} eliminated by ${labelFor(elimination.byId)}`;
  return `${victim} destroyed`;
}

/** Width of the right-hand margin the kill feed lives in, beyond the arena itself.
 *  210, not the original 190 — wide enough for the longest real line
 *  (`"XX eliminated by YY"`, two two-letter initials) plus its colour dot without
 *  wrapping or clipping. */
/**
 * How much bigger a weapon is drawn in the arena than on the build reveal.
 *
 * A bot here is drawn at its physics radius, roughly a third of the portrait's, and at
 * that size an unscaled weapon is a few pixels of metal — enough to see a machine has
 * something on its front, not enough to tell a hammer from a spinner. 1.7 was chosen to
 * make the silhouette readable while still fitting inside the space a bot needs to not
 * look like it is wielding a lamp post; it does not change the weapon's ARC or reach,
 * both of which live in the simulation and are unaffected by anything in this file.
 */
const ARENA_WEAPON_SCALE = 1.7;

const KILL_FEED_WIDTH = 210;
const KILL_FEED_HEADER_HEIGHT = 30;
const KILL_FEED_ROW_HEIGHT = 20;

/** How many ticks a WARNING tile takes to complete one pulse cycle. */
const PULSE_PERIOD_TICKS = 40;

const WARNING_BASE = 0x4a2318;
const WARNING_BRIGHT = 0xff6a3d;

/** Floor tint per surface. Plain floor and any surface missing here keep the default. */
const SURFACE_COLOR: Partial<Record<SurfaceValue, number>> = {
  // Dark and viscous, and — deliberately — nowhere near the WARNING pulse's orange-brown
  // range so a tarred tile is never mistaken for a tile about to drop.
  [Surface.Tar]: 0x241a10,
  [Surface.Ice]: 0xcdeefb,
  [Surface.Gravel]: 0x7c7161,
  [Surface.ConveyorN]: 0x2c3f52,
  [Surface.ConveyorS]: 0x2c3f52,
  [Surface.ConveyorE]: 0x2c3f52,
  [Surface.ConveyorW]: 0x2c3f52,
};

/**
 * Radians a hazard saw turns per tick.
 *
 * Held below `pi / SAW_TEETH`, the rate past which an eleven-toothed blade sampled once a
 * frame becomes ambiguous and then reads as turning backwards. Slower than a bot's blade in
 * radians and about the same in teeth-per-second, which is the thing an eye actually tracks --
 * and its edge travels faster, because an arena saw is half again as wide.
 */
export const SAW_SPIN_PER_TICK = 0.24;

const BUTTON_IDLE = 0x2c3646;
const BUTTON_PRESSED = 0xffe45c;

/**
 * The one colour fire is, wherever it comes from.
 *
 * Shared by the flamethrower weapon and the flame-jet hazard on purpose. They are the same
 * substance and the request was explicitly that they look it; two nearly-equal oranges is the
 * kind of difference nobody can name but everybody can see.
 */
const FLAME_TINT = 0xff9a3c;

/**
 * How hard a hazard jet burns, against a weapon's 0.75.
 *
 * Higher, because an arena flame jet is a fixed installation with a supply line and a bot is
 * carrying its fuel. It also has to fill a 110-unit cone rather than a 50-unit one, and the
 * same density spread over four times the area would read as a jet running out.
 */
const FLAME_HAZARD_INTENSITY = 0.85;

/**
 * How much bigger than its physics radius a cannonball is drawn.
 *
 * The same argument as `ARENA_WEAPON_SCALE`, and the same disclaimer: this changes nothing
 * about what the shot HITS, which lives in the simulation. A cannonball is 6 units against a
 * bot's 14-20, which on a 600-pixel-wide arena is about four pixels -- too small to carry the
 * lit edge that makes it read as an iron sphere rather than as a dot, and small enough that
 * its own smoke was outsizing it.
 */
const CANNONBALL_SCALE = 1.7;

/** One frame at the fixed sixty-per-second the whole show is built around. */
const FRAME_SECONDS = 1 / 60;

/** How long a struck bot stays lit. Short: it must read as a hit, not as a status. */
const FLASH_SECONDS = 0.16;

/** How long a shake takes to die away. */
const SHAKE_SECONDS = 0.28;

/**
 * How far the arena may move at full shake.
 *
 * Four pixels. It reads as a jolt, and more starts costing readability — which is the one
 * thing shake is least allowed to take, since a death is exactly when everybody is scanning
 * the screen for whose bot it was.
 */
const SHAKE_PIXELS = 4;

/**
 * Radians a spinning weapon turns per simulation tick.
 *
 * Driven off `match.world.tick` rather than wall-clock time, so a replay of the same seed
 * shows the blade at the same angle every time. Nothing depends on that -- visuals are never
 * checksummed -- but Replay exists, and a fight that looked different the second time would
 * quietly undermine the thing the whole site is built on.
 *
 * Deliberately not the real rpm. A blade turning at anything like its true speed under a 60Hz
 * sampler is a stroboscope: it reads as stationary, or as slowly turning backwards.
 *
 * The limit is not a matter of taste and it is tighter than it looks. A saw blade is not one
 * shape rotating, it is a shape with ten-fold rotational symmetry, so it becomes ambiguous
 * once it advances HALF A TOOTH between frames -- `pi / teeth`, or 0.314 for a ten-toothed
 * blade, not `pi`. This sat at 0.42 and was quietly rendering every saw in the show turning
 * backwards. A spinning bar has only two-fold symmetry and was never at risk; it is slower now
 * for the blade's sake, which costs nothing since both read as "turning fast" either way.
 */
export const SPIN_PER_TICK = 0.26;

/**
 * Ticks a hammer takes to rear up, smash down and settle.
 *
 * Measured against how often a hammer actually connects: 57-77 landed blows across a battle,
 * roughly one every two seconds. At fourteen ticks the stroke lasted under a quarter second,
 * so the weapon sat still, blinked, and froze again -- which reads as a bug rather than as a
 * hammer. Long enough here to be seen, and short enough to fit inside the shortest attack
 * cooldown a build can roll, so one stroke is always finished before the next begins.
 */
const SWING_TICKS = 26;

/** Ticks a flamethrower keeps burning after its last landed hit. */
const FLAME_TICKS = 10;

/** Half-angle of the flame cone. */
const FLAME_SPREAD = 0.34;

/** The radius the particle texture is drawn at, so a particle's `size` becomes a scale. */
const DOT_RADIUS = 8;

/** Rings used to build a radial falloff on the particle texture. Eight passes at 0.3 each
 *  accumulate to roughly 0.94 at the centre and 0.3 at the rim. */
const DOT_RINGS = 8;

/**
 * The most opaque a single particle may be.
 *
 * The softness now lives in the texture rather than here, so this can sit high: the first
 * version stacked a faint texture UNDER a low ceiling and the two multiplied down to nothing.
 * The texture stops overlaps becoming a solid mass; this only trims the very brightest.
 */
const PARTICLE_ALPHA = 0.85;

export interface ArenaRenderer {
  /**
   * Draws one frame.
   *
   * `effects` is the frame's accumulated bus, not `match.effects`: the battle screen may run
   * more than one tick per rendered frame, and the bus is cleared at the start of every tick,
   * so reading it here would show only the last tick's events and silently drop the rest.
   * Defaults to `match.effects` for callers stepping one tick a frame.
   */
  draw(match: Match, effects?: readonly Effect[]): void;
  destroy(): void;
}

/** Linear blend between two 0xRRGGBB colors, t in [0, 1]. */
function lerpColor(from: number, to: number, t: number): number {
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Brightness of a WARNING tile's pulse for this tick.
 *
 * Driven entirely by `match.world.tick`, never wall-clock time, so the collapse wave
 * looks identical on every replay of the same seed regardless of when it is watched.
 */
function warningColor(tick: number): number {
  const phase = (tick % PULSE_PERIOD_TICKS) / PULSE_PERIOD_TICKS;
  const brightness = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  return lerpColor(WARNING_BASE, WARNING_BRIGHT, brightness);
}

export async function createArenaRenderer(
  parent: HTMLElement,
  match: Match,
  highlightIndex: number | null,
  personalityTags: Map<string, string> = new Map(),
  botVisuals?: readonly ArenaBotVisual[],
  builds?: readonly BotBuild[],
): Promise<ArenaRenderer> {
  const { width, height } = match.arena.grid;
  const canvasWidth = width + KILL_FEED_WIDTH;

  const app = new Application();
  await app.init({
    width: canvasWidth,
    height,
    background: 0x0b0f16,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  parent.appendChild(app.canvas);

  // The arena itself keeps the exact coordinates it always had — only the canvas grew,
  // to the right, to make room for the kill feed. Nothing here shifts.
  //
  // Everything the arena draws lives inside `world` so screen shake can move all of it at
  // once. The kill feed stays outside: it is a list of text in the margin, and a running
  // scoreboard that jitters every time somebody dies is harder to read at exactly the moment
  // people are reading it.
  const world = new Container();
  app.stage.addChild(world);
  const floor = new Graphics();
  world.addChild(floor);
  // Below `dynamic` and below the bots: a hazard is scenery bots stand on, and one drawn
  // over a bot reads as the bot being underneath the floor.
  const hazardLayer = new Container();
  world.addChild(hazardLayer);
  const dynamic = new Graphics();
  world.addChild(dynamic);

  // BitmapText, not Text: every bot's label moves every frame (see the `pixijs-scene-text`
  // skill and `plinko-renderer.ts`'s identical choice for the same reason) — an
  // atlas-backed label is the cheaper one to reposition ten times a frame. Content and ink
  // colour are fixed for the match's lifetime (see `resolveBotVisual`), so both are set
  // once here rather than in `draw`.
  /**
   * One pre-built machine per bot, or an empty array when no builds were supplied — the
   * "What to expect" demo loop has no real event behind it and keeps the plain circles.
   *
   * Built once. `drawBotPortrait` returns a container whose local origin is the bot's
   * centre facing +x, which is the convention `heading` already uses, so per frame the
   * draw loop only sets x, y and rotation. Scaled from the portrait's own drawn radius to
   * this bot's physics radius so the silhouette matches its collision circle: weapon and
   * armour geometry inside the portrait is sized in absolute units against the chassis
   * extent, so scaling the whole container is the only way to keep those proportions.
   */
  /**
   * One pre-built machine per hazard, keyed by id.
   *
   * Built once for the same reason the silhouettes are: the gauntlet arena places 24 flame
   * jets and 9 saws, and re-tessellating a 14-toothed blade for each of them 60 times a
   * second to draw a shape that only ROTATED is work for nothing.
   *
   * `wasActive`/`changedAt` are what let a hazard animate its transitions rather than
   * snapping between two states -- a crusher needs to know how long it has been falling, and
   * `isActive` only says whether it is.
   */
  interface HazardEntry {
    art: HazardArt;
    reach: number;
    heading: number;
    x: number;
    y: number;
    wasActive: boolean;
    changedAt: number;
  }

  /**
   * The surface map as the match began.
   *
   * The only way to know an Oil Slick has been fired. Mid-match the surfaces array has exactly
   * two writers -- the ability, which sets Ice, and floor collapse, which sets Plain -- so a
   * tile holding Ice that did not hold it at mount was oiled. Copied rather than referenced,
   * for the obvious reason.
   */
  const baseSurfaces = Uint8Array.from(match.arena.surfaces);

  const hazardEntries = new Map<string, HazardEntry>();
  for (const zone of match.arena.zones) {
    const art = createZoneArt(zone.id, zone.reach);
    art.view.position.set(zone.x, zone.y);
    const heading = (zone.heading / ANGLE_STEPS) * Math.PI * 2;
    art.view.rotation = heading;
    hazardLayer.addChild(art.view);
    hazardEntries.set(zone.id, {
      art,
      reach: zone.reach,
      heading,
      x: zone.x,
      y: zone.y,
      wasActive: false,
      changedAt: 0,
    });
  }

  /** Per emitter: its gun, and the tick it last fired, which drives recoil and flash. */
  const emitterArt = new Map<
    string,
    { art: HazardArt; firedAt: number; x: number; y: number; heading: number; triggered: boolean }
  >();
  for (const emitter of match.arena.emitters) {
    // Sized against the shot rather than picked: a gun visibly narrower than its own
    // cannonball is the kind of detail that reads as wrong without being identifiable.
    const art = createEmitterArt(Math.max(13, emitter.radius * 2.4));
    art.view.position.set(emitter.x, emitter.y);
    const heading = (emitter.heading / ANGLE_STEPS) * Math.PI * 2;
    art.view.rotation = heading;
    hazardLayer.addChild(art.view);
    art.view.visible = emitter.activation.mode !== Activation.Triggered;
    emitterArt.set(emitter.id, {
      art,
      firedAt: -9999,
      x: emitter.x,
      y: emitter.y,
      heading,
      triggered: emitter.activation.mode === Activation.Triggered,
    });
  }

  const silhouetteLayer = new Container();
  world.addChild(silhouetteLayer);
  const silhouettes: (Container | null)[] = [];

  /** Per bot: how its weapon moves, and where its muzzle sits in ARENA units. */
  const weapons: (({ scale: number } & BotPortraitWeapon) | null)[] = match.bots.map(
    (bot, index) => {
      const build = builds?.[index];
      if (!build) {
        silhouettes.push(null);
        return null;
      }
      const drawing = drawBotPortrait(build, resolveBotVisual(index, botVisuals).colour, {
        weaponScale: ARENA_WEAPON_SCALE,
        // Not awaited here. `createArenaRenderer` runs when a battle beat mounts, and a battle
        // that waited on a download before drawing would be a black screen with a BEGIN button
        // over it. By this point loading started long ago; if it somehow has not finished, the
        // bots are drawn in flat colour, which is exactly how they looked last week.
        texture: armourTexture(partAt('armour', build.armour).id),
        weaponTexture: textureFor('weapon'),
      });
      const scale = bot.body.radius / drawing.radius;
      drawing.view.scale.set(scale);
      silhouetteLayer.addChild(drawing.view);
      silhouettes.push(drawing.view);
      // The muzzle comes back in the portrait's own units; everything drawn here is in arena
      // units, and the two differ by the same factor the silhouette was scaled by.
      return { ...drawing.weapon, scale: scale * ARENA_WEAPON_SCALE };
    },
  );

  /**
   * Sparks and dust.
   *
   * Above the bots so a hit reads as landing ON one, and BELOW the labels and tags so a
   * viewer hunting their own machine can always still read the names. That ordering is the
   * whole reason this sits here rather than on top: if effects hide bots, effects lose.
   *
   * One texture, one draw call, and a pool allocated once — see `vfx/particles.ts` for why
   * the bound matters more than the look.
   */
  // A SOFT dot, not a hard disc. Concentric rings of falling alpha approximate a radial
  // falloff, and the difference is not cosmetic: hard-edged circles at full opacity stack into
  // a solid mass wherever several land together, which in a scrum is a pale blob sitting on
  // top of the bots. Soft edges accumulate into a glow instead of a shape.
  // Drawn largest-first so the rings ACCUMULATE: each pass adds a little more opacity to
  // everything inside it, which builds a bright core fading to a soft edge. The first attempt
  // gave every ring a low alpha and no accumulation, producing a dot that was uniformly faint
  // -- measured at 0.02-0.06 on screen, which is invisible. A spark needs a solid centre; the
  // softness is only there so overlapping ones blend instead of stacking into a disc.
  const dot = new Graphics();
  for (let ring = DOT_RINGS; ring >= 1; ring--) {
    dot.circle(0, 0, (DOT_RADIUS * ring) / DOT_RINGS).fill({ color: 0xffffff, alpha: 0.3 });
  }
  // `resolution: 1` explicitly. `generateTexture` otherwise inherits the application's
  // resolution, which is the viewer's `devicePixelRatio` -- so on a 2.5x display every
  // particle came out two and a half times too big, and the effect layer looked different on
  // every monitor. Particle size is a design decision, not a property of somebody's screen.
  const dotTexture = app.renderer.generateTexture({ target: dot, resolution: 1 });
  dot.destroy();

  const field = createParticleField();
  const sprites = field.particles.map(
    () => new Particle({ texture: dotTexture, anchorX: 0.5, anchorY: 0.5, alpha: 0 }),
  );
  const particleLayer = new ParticleContainer({
    texture: dotTexture,
    particles: sprites,
    // Position, size and colour all change every frame; without these the GPU keeps the
    // values from when each particle was uploaded and nothing appears to move.
    dynamicProperties: { position: true, vertex: true, color: true },
    // Required in practice: a ParticleContainer reports empty bounds by default and is
    // culled as invisible the moment anything turns culling on.
    boundsArea: new Rectangle(0, 0, width, height),
  });
  // Required. Passing `particles` to the constructor deliberately skips the per-call view
  // update, so without this the container never builds its GPU buffers and draws nothing at
  // all -- which is exactly what it did.
  particleLayer.update();
  world.addChild(particleLayer);


  /**
   * The white bloom on a bot that was just struck.
   *
   * Drawn as its own layer rather than tinting the silhouette, because tint MULTIPLIES: it can
   * only ever darken a sprite, so it cannot brighten a bot no matter what colour is passed. An
   * additive overlay is the only way to make something on a canvas get lighter.
   *
   * Above the bots so it is visible, below the labels so it can never hide a name.
   */
  const flashLayer = new Graphics();
  world.addChild(flashLayer);

  const labels = new Container();
  world.addChild(labels);
  const labelTexts = match.bots.map((_, index) => {
    const visual = resolveBotVisual(index, botVisuals);
    const text = new BitmapText({
      text: visual.label,
      style: { fontFamily: 'Arial', fontSize: 12, fill: inkFor(visual.colour), fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const tags = new Container();
  world.addChild(tags);
  const tagTexts = match.bots.map(() => {
    const text = new BitmapText({
      text: '',
      style: { fontFamily: 'Arial', fontSize: 10, fill: 0x9fb0c6, fontWeight: '600' },
    });
    text.anchor.set(0.5, 0);
    tags.addChild(text);
    return text;
  });

  /**
   * How white each bot is flashing, 0-1, decaying every frame.
   *
   * The flash does more work than the sparks do. Sparks say "a hit happened somewhere"; a
   * bot going bright says "it happened to THAT one", which is what somebody hunting their
   * own machine in a ten-bot scrum actually needs.
   */
  const flash = match.bots.map(() => 0);

  /**
   * Ticks remaining on each flamethrower's burn.
   *
   * Only the jet needs one. A hammer's crush is driven from the simulation's own
   * `nextAttackTick`, so it needs no timer here -- see `hammerProgress`.
   */
  const burn = match.bots.map(() => 0);

  /** Current shake energy, 0-1, decaying every frame. */
  let shake = 0;

  // Read once. Someone who has asked their operating system for less motion is not asking
  // per battle, and re-querying every frame would cost more than it could ever save.
  const calm = prefersReducedMotion();

  // Bot number (1-based, matching the legacy on-body label) by id, resolved once — the
  // roster does not change over a match's lifetime. Still used as the kill feed's
  // fallback identity when no real member visuals are supplied (the demo loop).
  const botNumberById = new Map<string, number>();
  match.bots.forEach((bot, index) => botNumberById.set(bot.body.id, index + 1));

  // Real member initials by bot id, for the kill feed's "who/by whom" text — falls back
  // to `#<number>` (via `killFeedLabelFor` below) when no real member visuals exist.
  const killFeedVisualById = new Map<string, ArenaBotVisual>();
  match.bots.forEach((bot, index) => {
    const visual = botVisuals?.[index];
    if (visual) killFeedVisualById.set(bot.body.id, visual);
  });
  const killFeedLabelFor = (botId: string): string =>
    killFeedVisualById.get(botId)?.label ?? `#${botNumberById.get(botId) ?? '?'}`;

  // Kill feed lives in the margin to the right of the arena.
  const killFeed = new Container();
  killFeed.x = width;
  app.stage.addChild(killFeed);

  const killFeedDivider = new Graphics();
  killFeedDivider.moveTo(0, 0).lineTo(0, height).stroke({ width: 1, color: 0x1a2230 });
  killFeed.addChild(killFeedDivider);

  const killFeedHeader = new Text({
    text: 'KILL FEED',
    style: { fontSize: 11, fill: 0x5b6a80, fontWeight: '700', letterSpacing: 1 },
  });
  killFeedHeader.x = 16;
  killFeedHeader.y = 12;
  killFeed.addChild(killFeedHeader);

  const killFeedMaxRows = Math.max(
    0,
    Math.floor((height - KILL_FEED_HEADER_HEIGHT) / KILL_FEED_ROW_HEIGHT),
  );
  // Each row is a small colour dot (the victim's member colour, "colour by member" per
  // the design spec) plus the `killFeedLine` text, in a fixed legible ink colour — the
  // dot carries identity, so the text itself never has to fight for contrast against the
  // panel's own dark background the way member-coloured text would for Tommy's near-black.
  const killFeedRows = Array.from({ length: killFeedMaxRows }, (_, row) => {
    const container = new Container();
    container.x = 16;
    container.y = KILL_FEED_HEADER_HEIGHT + row * KILL_FEED_ROW_HEIGHT;
    killFeed.addChild(container);

    const dot = new Graphics();
    container.addChild(dot);

    const text = new Text({
      text: '',
      style: { fontSize: 12, fill: 0xdbe4ef },
    });
    text.x = 12;
    container.addChild(text);

    return { container, dot, text };
  });

  const drawFloor = (current: Match): void => {
    floor.clear();
    const grid = current.arena.grid;
    const size = grid.tileSize;
    const tick = current.world.tick;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const state = grid.tiles[row * grid.cols + col];
        if (state === TileState.Gone) continue;

        const cx = col * size + size / 2;
        const cy = row * size + size / 2;
        const index = row * grid.cols + col;
        const surface = surfaceAt(grid, current.arena.surfaces, cx, cy);
        // An oiled tile IS an ice tile as far as the physics is concerned -- see
        // `floor-state.ts` for why the renderer has to work this out for itself.
        const oiled = isOiled(baseSurfaces, current.arena.surfaces, index);

        // A tile about to collapse always reads as WARNING first -- surface tint would
        // just compete with the one signal that actually matters right now.
        const color =
          state === TileState.Warning
            ? warningColor(tick)
            : oiled
              ? OIL_COLOR
              : (SURFACE_COLOR[surface] ?? 0x161d27);
        floor.rect(col * size + 1, row * size + 1, size - 2, size - 2).fill(color);

        // The sheen, drawn only on oil and only when the tile is not screaming about
        // collapsing. Two offset ellipses rather than a circle: a pool that spread rather than
        // a target painted on the floor.
        if (oiled && state !== TileState.Warning) {
          floor.ellipse(cx - size * 0.08, cy - size * 0.04, size * 0.3, size * 0.22)
            .fill({ color: OIL_SHEEN, alpha: 0.5 });
          floor.ellipse(cx + size * 0.14, cy + size * 0.12, size * 0.16, size * 0.11)
            .fill({ color: OIL_SHEEN, alpha: 0.35 });
        }

        if (state !== TileState.Warning) {
          const push = effectOf(surface);
          if (push.pushX !== 0 || push.pushY !== 0) {
            // Conveyors are otherwise indistinguishable from each other, so the push
            // direction is the whole point of drawing a chevron at all.
            const plen = Math.sqrt(push.pushX * push.pushX + push.pushY * push.pushY);
            const dx = push.pushX / plen;
            const dy = push.pushY / plen;
            const px = -dy;
            const py = dx;
            const tipX = cx + dx * size * 0.28;
            const tipY = cy + dy * size * 0.28;
            const backX = cx - dx * size * 0.14;
            const backY = cy - dy * size * 0.14;
            floor
              .moveTo(backX + px * size * 0.2, backY + py * size * 0.2)
              .lineTo(tipX, tipY)
              .lineTo(backX - px * size * 0.2, backY - py * size * 0.2)
              .stroke({ width: 3, color: 0xdfe9f2, alpha: 0.8 });
          }
        }
      }
    }
    for (const seg of current.arena.segments) {
      floor.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 4, color: 0x35424f });
    }
  };

  /**
   * Zones only while active (so pulsing/timing hazards visibly flick on and off), floor
   * plates always, and any projectile currently in flight.
   *
   * Drawn into `dynamic` before the bots below, so hazards never occlude a bot standing
   * on top of them.
   */
  const drawHazards = (current: Match): void => {
    const tick = current.world.tick;

    for (const zone of current.arena.zones) {
      const entry = hazardEntries.get(zone.id);
      if (!entry) continue;
      const active = isActive(zone.activation, tick, current.arena.buttons);
      if (active !== entry.wasActive) {
        entry.wasActive = active;
        entry.changedAt = tick;
      }
      const since = tick - entry.changedAt;
      const { art } = entry;

      // A TRIGGERED hazard is a trap: hidden until a bot rolls over the plate that springs it.
      // A cycling or always-on one is a fixed installation, and its rhythm is the warning --
      // for those, being able to see the machine between firings is the point.
      //
      // The Crossfire is built entirely from the first kind: all four saws, all sixteen flame
      // jets and all four cannons are on plates. Drawing them permanently laid the whole trap
      // layout out in advance, which is the opposite of what that arena is for.
      const permanent = zone.activation.mode !== Activation.Triggered;
      art.view.visible = permanent || active;
      if (!art.view.visible) continue;

      switch (art.family) {
        case 'saw':
          if (art.spin) art.spin.rotation = spinAngle(tick, SAW_SPIN_PER_TICK);
          break;

        case 'flame':
          // The nozzle is permanent; the fire is not. Particles rather than a drawn cone, and
          // the SAME `jet` the flamethrower weapon uses -- one fire in the whole event, so a
          // hazard jet and a bot's jet are recognisably the same substance.
          if (active && !calm && tick % HAZARD_JET_EVERY === 0) {
            field.jet({
              x: entry.x,
              y: entry.y,
              intensity: FLAME_HAZARD_INTENSITY,
              tint: FLAME_TINT,
              angle: entry.heading,
              spread: FLAME_SPREAD,
              // Its own zone's reach, so the fire ends where the damage does. A flame drawn
              // shorter than the zone burning bots is worse than no flame: it actively
              // misinforms about where it is safe to stand.
              reach: entry.reach,
            });
          }
          break;

        case 'crusher':
          // A sprung crusher gets its slam for free: it becomes visible on the frame it
          // activates, when `since` is 0 and the plate is at the top of its travel, and drops
          // to the floor over the next three ticks. It arrives from above rather than
          // appearing already landed.
          if (art.plate) art.plate.scale.set(crusherScale(active, since));
          // Dust on the frame it lands, not every frame it is down.
          if (active && since === 0 && !calm) {
            field.puff({ x: entry.x, y: entry.y, intensity: 0.9, tint: 0x9aa7b4 });
          }
          break;

        default:
          // An unrecognised hazard keeps the old greybox behaviour, including only being
          // visible while it is live.
          art.view.visible = active;
      }
    }

    for (const gun of emitterArt.values()) {
      const since = tick - gun.firedAt;
      // Same rule as the zones, with one adjustment: an emitter's active window is a single
      // tick (that is how it fires exactly one shot per period), so "visible while active"
      // would be a gun that flickers for one frame. A sprung cannon is instead shown for as
      // long as it is visibly recoiling -- it appears, kicks, and withdraws.
      gun.art.view.visible = !gun.triggered || since < RECOIL_TICKS;
      if (!gun.art.view.visible) continue;
      // The barrel drives back into the carriage; the carriage stays put.
      if (gun.art.plate) gun.art.plate.x = -recoilOffset(since);
      if (gun.art.flash) {
        const brightness = muzzleFlash(since);
        gun.art.flash.visible = brightness > 0;
        gun.art.flash.alpha = brightness;
      }
    }

    for (const button of current.arena.buttons.values()) {
      dynamic
        .circle(button.x, button.y, button.radius)
        .fill({ color: button.pressed ? BUTTON_PRESSED : BUTTON_IDLE, alpha: button.pressed ? 0.9 : 0.6 });
      dynamic.circle(button.x, button.y, button.radius).stroke({ width: 2, color: 0x0b0f16, alpha: 0.8 });
    }

    for (const shot of current.projectiles) {
      drawCannonball(dynamic, shot.x, shot.y, shot.radius * CANNONBALL_SCALE);
      // A thin smoke trail, thrown backwards along the flight path. Every third tick rather
      // than every one: a shot crosses the arena in under two seconds and a continuous ribbon
      // of smoke reads as a laser, which is a different hazard on the same table.
      if (!calm && tick % 3 === 0) {
        const speed = Math.hypot(shot.vx, shot.vy);
        const backX = speed > 0 ? -(shot.vx / speed) * shot.radius * 1.5 : 0;
        const backY = speed > 0 ? -(shot.vy / speed) * shot.radius * 1.5 : 0;
        field.puff({ x: shot.x + backX, y: shot.y + backY, intensity: 0.12, tint: 0x6b7683, scale: 0.35 });
      }
    }
  };

  const drawKillFeed = (current: Match): void => {
    // Most recent first, capped at whatever fits the margin.
    const recent = current.eliminations.slice(-killFeedMaxRows).reverse();
    for (let i = 0; i < killFeedRows.length; i++) {
      const row = killFeedRows[i]!;
      const elim = recent[i];
      if (!elim) {
        row.dot.clear();
        row.text.text = '';
        continue;
      }

      const colour = killFeedVisualById.get(elim.botId)?.colour ?? 0x8fa3b8;
      row.dot.clear();
      row.dot.circle(4, 6, 4).fill(colour);
      if (needsBrightOutline(colour)) {
        row.dot.circle(4, 6, 4).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
      }

      row.text.text = killFeedLine(elim, killFeedLabelFor);
    }
  };

  /**
   * Turns one frame's events into sparks, flashes and shake.
   *
   * Spawns first, then advances, then paints, so a particle created this frame is visible this
   * frame rather than one late. At sixty frames a second a one-frame delay on a hit is not
   * consciously noticed but it is felt, and it costs nothing to avoid.
   */
  const consume = (effects: readonly Effect[], tick: number): void => {
    for (const effect of effects) {
      const visual = visualFor(effect, builds ?? []);

      for (const layer of visual.layers) {
        const spec = {
          x: effect.x,
          y: effect.y,
          // Reduced motion thins the spawn rather than removing it. Somebody who asked for
          // less movement still needs to see that a hit landed; they just do not need a
          // faceful of debris to know it.
          intensity: effect.intensity * layer.scale * (calm ? 0.45 : 1),
          tint: layer.tint,
        };
        if (layer.kind === 'burst') field.burst(spec);
        else if (layer.kind === 'puff') field.puff(spec);
        else field.ring(spec);
      }

      if (visual.flash) {
        const index = botIndexOf(effect.botId);
        if (index !== null && index < flash.length) flash[index] = 1;
      }

      // A gun recoils and flashes when IT fires, which is the one hazard event that happens
      // somewhere other than where a bot is standing.
      if (effect.kind === 'cannonFire' && effect.source) {
        const gun = emitterArt.get(effect.source);
        if (gun) gun.firedAt = tick;
      }

      // Flame belongs to the ATTACKER, which `source` names. The victim gets the flash and
      // the sparks; the bot that fired gets the fire.
      if (effect.kind === 'weaponHit') {
        const by = botIndexOf(effect.source ?? null);
        if (by !== null && by < burn.length && weapons[by]?.motion === 'jet') {
          burn[by] = FLAME_TICKS;
        }
      }

      // The strongest event of the frame wins rather than accumulating: three eliminations at
      // once is a bigger moment, not three times the earthquake.
      if (!calm && visual.shake > shake) shake = Math.min(visual.shake, SHAKE_CEILING);
    }

    field.advance(FRAME_SECONDS);

    for (let i = 0; i < flash.length; i++) {
      flash[i] = Math.max(0, flash[i]! - FRAME_SECONDS / FLASH_SECONDS);
      // Counted in ticks rather than seconds, because it is wound by a simulation event and
      // read by a simulation-clocked animation.
      burn[i] = Math.max(0, burn[i]! - 1);
    }
    shake = Math.max(0, shake - FRAME_SECONDS / SHAKE_SECONDS);

    // Offset the whole arena, kill feed excluded. Rounded to whole pixels: a sub-pixel offset
    // on a canvas this size blurs every edge instead of reading as a jolt.
    const amount = shake * SHAKE_PIXELS;
    world.x = amount === 0 ? 0 : Math.round((Math.random() * 2 - 1) * amount);
    world.y = amount === 0 ? 0 : Math.round((Math.random() * 2 - 1) * amount);

    // Copy the pool onto the GPU-facing structs. Dead particles go to alpha 0 rather than
    // being removed: the sprite list is fixed for the renderer's whole lifetime, which is the
    // entire reason this is one draw call.
    for (let i = 0; i < sprites.length; i++) {
      const particle = field.particles[i]!;
      const sprite = sprites[i]!;
      if (!particle.active) {
        sprite.alpha = 0;
        continue;
      }
      sprite.x = particle.x;
      sprite.y = particle.y;
      const scale = particle.size / DOT_RADIUS;
      sprite.scaleX = scale;
      sprite.scaleY = scale;
      sprite.tint = particle.tint;
      // Fades across its life, so particles thin away rather than vanishing mid-flight, and
      // never reaches full opacity -- see `PARTICLE_ALPHA`.
      sprite.alpha = Math.min(1, (particle.life / particle.maxLife) * 1.4) * PARTICLE_ALPHA;
    }
  };

  const draw = (current: Match, effects: readonly Effect[] = current.effects): void => {
    // The tick goes in because recoil is counted in ticks, not in frames: a gun's kick has to
    // look the same on a replay as it did live, and frames are not guaranteed to line up
    // one-for-one with simulation steps.
    consume(effects, current.world.tick);
    flashLayer.clear();
    drawFloor(current);
    dynamic.clear();
    drawHazards(current);

    current.bots.forEach((bot, index) => {
      const label = labelTexts[index]!;
      const tag = tagTexts[index]!;
      if (!bot.alive) {
        label.visible = false;
        tag.visible = false;
        // Silhouettes persist between frames rather than being cleared with `dynamic`, so
        // a dead bot has to be hidden explicitly or its wreck sits on the floor forever.
        const dead = silhouettes[index];
        if (dead) dead.visible = false;
        return;
      }
      label.visible = true;

      const color = resolveBotVisual(index, botVisuals).colour;
      const isHighlighted = index === highlightIndex;
      const { x, y } = bot.body;
      const r = bot.body.radius;

      // The persistent highlight: a soft halo behind the claimed member's bot, the whole
      // event through — the same visual vocabulary `plinko-renderer.ts` uses for "this is
      // your ball", carried from the Forge into the battles.
      if (isHighlighted) {
        dynamic.circle(x, y, r + 6).fill({ color: 0xffffff, alpha: 0.16 });
      }

      // The bloom for a bot struck in the last sixth of a second. Drawn for every bot, with
      // or without a silhouette, so the demo loop's plain circles react too.
      const lit = flash[index] ?? 0;
      if (lit > 0) {
        flashLayer.circle(x, y, r + 3).fill({ color: 0xffffff, alpha: lit * 0.5 });
      }

      const silhouette = silhouettes[index];
      if (silhouette) {
        // The machine the Forge actually dealt: chassis silhouette, armour rim and weapon,
        // the same drawing the build reveal shows, rotated to the bot's heading.
        //
        // Positioned rather than redrawn. The geometry is built once at mount, so a frame
        // costs three property writes per bot instead of re-tessellating ten shapes —
        // cheaper than the circle it replaces, which was rebuilt into `dynamic` every
        // frame.
        silhouette.visible = true;
        silhouette.x = x;
        silhouette.y = y;
        const heading = (bot.heading / ANGLE_STEPS) * Math.PI * 2;
        silhouette.rotation = heading;

        // The weapon moves under its own power, on top of wherever the bot is facing.
        const weapon = weapons[index];
        if (weapon) {
          switch (weapon.motion) {
            case 'spin':
              // A saw or a bar turning in the plane we are looking down on.
              weapon.node.rotation = spinAngle(current.world.tick, SPIN_PER_TICK);
              break;

            case 'edge':
              // A vertical spinner's disc turns about a HORIZONTAL axis, so from above it
              // never rotates -- it presents its edge, then its face.
              weapon.node.scale.set(edgeScale(current.world.tick, SPIN_PER_TICK), 1);
              break;

            case 'swing': {
              // A crush, not a sweep. The head rears up and drops, which from directly above
              // is not a movement across the screen at all -- see `hammerPose` for how that
              // is projected into something a top-down viewer can actually read.
              //
              // Timed from when the bot may strike NEXT rather than from when it last landed
              // a blow, so the smash arrives on the beat instead of a sixth of a second after
              // its own sound.
              const pose = hammerPose(
                hammerProgress(bot.nextAttackTick - current.world.tick, SWING_TICKS),
              );
              // The arm foreshortens toward its root and all but disappears at the top of the
              // lift. Only along its length: a haft seen from above gets shorter as it rises,
              // not thinner.
              weapon.node.scale.set(pose.reach, 1);
              if (weapon.head) {
                // The head rides the end of the arm, so it slides back over the pivot as the
                // arm collapses -- and being drawn on top, it covers what is left. That is
                // where the swing actually comes from: the arm vanishing UNDER the head, and
                // reappearing from beneath it on the way down.
                weapon.head.x = weapon.pivotX + weapon.headOffset * pose.reach;
                // Scaled on its own, never with the arm. `size` is distance from the camera,
                // and the head is the part that travels.
                weapon.head.scale.set(pose.size);
              }
              break;
            }

            case 'jet': {
              if ((burn[index] ?? 0) > 0) {
                // From the nozzle, along the bot's heading. The muzzle is in the portrait's
                // own units, rotated into the arena with the bot.
                const reach = weapon.muzzle.x * weapon.scale;
                field.jet({
                  x: x + Math.cos(heading) * reach,
                  y: y + Math.sin(heading) * reach,
                  intensity: calm ? 0.35 : 0.75,
                  tint: 0xff9a3c,
                  angle: heading,
                  spread: FLAME_SPREAD,
                });
              }
              break;
            }

            default:
              break;
          }
        }
        // No heading spike: the silhouette faces where the bot faces, so the shape itself
        // now says what the spike used to.
      } else {
        dynamic.circle(x, y, r).fill(color);
        // A thin outline on every bot, brighter and thicker for the highlighted bot and for
        // any bot dark enough to lose its edge against the arena floor (Tommy, `#1C1F26` —
        // see `needsBrightOutline`'s doc comment) — the same three-way rule
        // `plinko-renderer.ts` applies to a ball.
        dynamic.circle(x, y, r).stroke({
          width: isHighlighted ? 3 : needsBrightOutline(color) ? 2.5 : 1.5,
          color: 0xffffff,
          alpha: isHighlighted ? 0.9 : needsBrightOutline(color) ? 0.65 : 0.25,
        });

        // Heading spike, so facing is readable at a glance. This is why combat feels
        // directional rather than random.
        const hx = cosOf(bot.heading);
        const hy = sinOf(bot.heading);
        dynamic
          .moveTo(x + hx * r * 0.4, y + hy * r * 0.4)
          .lineTo(x + hx * (r + 12), y + hy * (r + 12))
          .stroke({ width: 5, color: 0xffffff, alpha: 0.85 });
      }

      // Health bar above the bot.
      const frac = bot.health / bot.maxHealth;
      dynamic.rect(x - r, y - r - 10, r * 2, 4).fill({ color: 0x000000, alpha: 0.5 });
      dynamic.rect(x - r, y - r - 10, r * 2 * frac, 4).fill(frac < 0.3 ? 0xff4a4a : healthBarColour(color));

      label.x = x;
      label.y = y;

      const tagLabel = personalityTags.get(bot.body.id);
      if (tagLabel) {
        tag.text = tagLabel;
        tag.visible = true;
        tag.x = x;
        tag.y = y + r + 4;
      } else {
        tag.visible = false;
      }
    });

    drawKillFeed(current);
  };

  draw(match);

  return { draw, destroy: destroyOnce(app) };
}
