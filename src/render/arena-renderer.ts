import {
  Application, BitmapText, Container, Graphics, Particle, ParticleContainer, Rectangle, Text,
} from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { destroyOnce } from './destroy-once';
import { Surface, surfaceAt, effectOf, type SurfaceValue } from '../sim/arena/surface';
import { ZoneShape } from '../sim/arena/zone';
import { isActive } from '../sim/arena/activation';
import { ANGLE_STEPS, cosOf, sinOf } from '../sim/trig';
import { drawBotPortrait } from './bot-portrait';
import type { BotBuild } from '../sim/parts/assemble';
import type { Elimination, Match } from '../sim/arena/match';
import type { Effect } from '../sim/arena/effects';
import { createParticleField } from './vfx/particles';
import { SHAKE_CEILING, visualFor } from './vfx';
import { botIndexOf } from '../sim/parts/from-effect';
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

/** Fill and outline for an active zone, regardless of its shape. */
const ZONE_FILL = 0xff3b30;
const ZONE_STROKE = 0xff9a70;

/** Angle steps a circular zone's rotation marker advances per tick. Driven by
 * `match.world.tick`, never wall-clock time, so a saw spins identically on every
 * replay of the same seed. */
const ZONE_SPIN_STEPS_PER_TICK = 48;

const BUTTON_IDLE = 0x2c3646;
const BUTTON_PRESSED = 0xffe45c;

const PROJECTILE_COLOR = 0xffffff;
const PROJECTILE_GLOW = 0xfff3a0;

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

/** The radius the particle texture is drawn at, so a particle's `size` becomes a scale. */
const DOT_RADIUS = 8;

/** Rings used to fake a radial falloff on the particle texture. */
const DOT_RINGS = 6;

/**
 * The most opaque a single particle may be.
 *
 * Well under 1, because particles arrive in groups and overlap constantly -- twenty at full
 * opacity in the same place is an object, not an effect. This is the number that decides
 * whether sparks sit over the fight or bury it.
 */
const PARTICLE_ALPHA = 0.5;

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
  const silhouetteLayer = new Container();
  world.addChild(silhouetteLayer);
  const silhouettes: (Container | null)[] = match.bots.map((bot, index) => {
    const build = builds?.[index];
    if (!build) return null;
    const drawing = drawBotPortrait(build, resolveBotVisual(index, botVisuals).colour, {
      weaponScale: ARENA_WEAPON_SCALE,
    });
    const scale = bot.body.radius / drawing.radius;
    drawing.view.scale.set(scale);
    silhouetteLayer.addChild(drawing.view);
    return drawing.view;
  });

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
  const dot = new Graphics();
  for (let ring = DOT_RINGS; ring >= 1; ring--) {
    const t = ring / DOT_RINGS;
    dot.circle(0, 0, DOT_RADIUS * t).fill({ color: 0xffffff, alpha: 0.16 * (1 - t) + 0.08 });
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
        const surface = surfaceAt(grid, current.arena.surfaces, cx, cy);

        // A tile about to collapse always reads as WARNING first -- surface tint would
        // just compete with the one signal that actually matters right now.
        const color =
          state === TileState.Warning ? warningColor(tick) : (SURFACE_COLOR[surface] ?? 0x161d27);
        floor.rect(col * size + 1, row * size + 1, size - 2, size - 2).fill(color);

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
      if (!isActive(zone.activation, tick, current.arena.buttons)) continue;

      if (zone.shape === ZoneShape.Circle) {
        dynamic.circle(zone.x, zone.y, zone.reach).fill({ color: ZONE_FILL, alpha: 0.32 });
        dynamic.circle(zone.x, zone.y, zone.reach).stroke({ width: 2, color: ZONE_STROKE, alpha: 0.9 });

        // A spinning marker, not a decoration: it is what tells a saw apart from a
        // static damage floor like a spike strip at a glance. Angle comes entirely
        // from `match.world.tick`, so two replays of one seed spin in lockstep.
        const base = tick * ZONE_SPIN_STEPS_PER_TICK;
        for (let i = 0; i < 4; i++) {
          const angle = base + i * (ANGLE_STEPS / 4);
          const hx = cosOf(angle);
          const hy = sinOf(angle);
          dynamic
            .moveTo(zone.x, zone.y)
            .lineTo(zone.x + hx * zone.reach, zone.y + hy * zone.reach)
            .stroke({ width: 3, color: 0xffffff, alpha: 0.55 });
        }
      } else {
        const ax = cosOf(zone.heading);
        const ay = sinOf(zone.heading);
        const nx = -ay;
        const ny = ax;
        const tipX = zone.x + ax * zone.reach;
        const tipY = zone.y + ay * zone.reach;
        const leftX = zone.x + nx * zone.halfWidth;
        const leftY = zone.y + ny * zone.halfWidth;
        const rightX = zone.x - nx * zone.halfWidth;
        const rightY = zone.y - ny * zone.halfWidth;
        dynamic.poly([leftX, leftY, tipX, tipY, rightX, rightY]).fill({ color: ZONE_FILL, alpha: 0.38 });
        dynamic
          .poly([leftX, leftY, tipX, tipY, rightX, rightY])
          .stroke({ width: 2, color: ZONE_STROKE, alpha: 0.9 });
      }
    }

    for (const button of current.arena.buttons.values()) {
      dynamic
        .circle(button.x, button.y, button.radius)
        .fill({ color: button.pressed ? BUTTON_PRESSED : BUTTON_IDLE, alpha: button.pressed ? 0.9 : 0.6 });
      dynamic.circle(button.x, button.y, button.radius).stroke({ width: 2, color: 0x0b0f16, alpha: 0.8 });
    }

    for (const shot of current.projectiles) {
      dynamic.circle(shot.x, shot.y, shot.radius + 3).fill({ color: PROJECTILE_GLOW, alpha: 0.35 });
      dynamic.circle(shot.x, shot.y, shot.radius).fill({ color: PROJECTILE_COLOR, alpha: 1 });
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
  const consume = (effects: readonly Effect[]): void => {
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

      // The strongest event of the frame wins rather than accumulating: three eliminations at
      // once is a bigger moment, not three times the earthquake.
      if (!calm && visual.shake > shake) shake = Math.min(visual.shake, SHAKE_CEILING);
    }

    field.advance(FRAME_SECONDS);

    for (let i = 0; i < flash.length; i++) {
      flash[i] = Math.max(0, flash[i]! - FRAME_SECONDS / FLASH_SECONDS);
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
    consume(effects);
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
        silhouette.rotation = (bot.heading / ANGLE_STEPS) * Math.PI * 2;
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
