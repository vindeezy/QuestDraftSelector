import { Application, Container, Graphics, Text } from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { Surface, surfaceAt, effectOf, type SurfaceValue } from '../sim/arena/surface';
import { ZoneShape } from '../sim/arena/zone';
import { isActive } from '../sim/arena/activation';
import { ANGLE_STEPS, cosOf, sinOf } from '../sim/trig';
import type { Match } from '../sim/arena/match';

const BOT_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

/** Width of the right-hand margin the kill feed lives in, beyond the arena itself. */
const KILL_FEED_WIDTH = 190;
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

export interface ArenaRenderer {
  draw(match: Match): void;
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
  const floor = new Graphics();
  app.stage.addChild(floor);
  const dynamic = new Graphics();
  app.stage.addChild(dynamic);

  const labels = new Container();
  app.stage.addChild(labels);
  const labelTexts = match.bots.map((_, index) => {
    const text = new Text({
      text: String(index + 1),
      style: { fontSize: 12, fill: 0x0b0f16, fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const tags = new Container();
  app.stage.addChild(tags);
  const tagTexts = match.bots.map(() => {
    const text = new Text({
      text: '',
      style: { fontSize: 10, fill: 0x9fb0c6, fontWeight: '600' },
    });
    text.anchor.set(0.5, 0);
    tags.addChild(text);
    return text;
  });

  // Bot number (1-based, matching the on-body label) by id, resolved once — the roster
  // does not change over a match's lifetime.
  const botNumberById = new Map<string, number>();
  match.bots.forEach((bot, index) => botNumberById.set(bot.body.id, index + 1));

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
  const killFeedRows = Array.from({ length: killFeedMaxRows }, (_, row) => {
    const text = new Text({
      text: '',
      style: { fontSize: 12, fill: 0xdbe4ef },
    });
    text.x = 16;
    text.y = KILL_FEED_HEADER_HEIGHT + row * KILL_FEED_ROW_HEIGHT;
    killFeed.addChild(text);
    return text;
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
        row.text = '';
        continue;
      }
      const number = botNumberById.get(elim.botId) ?? '?';
      row.text = `#${number} ${elim.cause}`;
    }
  };

  const draw = (current: Match): void => {
    drawFloor(current);
    dynamic.clear();
    drawHazards(current);

    current.bots.forEach((bot, index) => {
      const label = labelTexts[index]!;
      const tag = tagTexts[index]!;
      if (!bot.alive) {
        label.visible = false;
        tag.visible = false;
        return;
      }
      label.visible = true;

      const color = BOT_COLORS[index % BOT_COLORS.length]!;
      const { x, y } = bot.body;
      const r = bot.body.radius;

      if (index === highlightIndex) {
        dynamic.circle(x, y, r + 6).fill({ color: 0xffffff, alpha: 0.16 });
      }

      dynamic.circle(x, y, r).fill(color);

      // Heading spike, so facing is readable at a glance. This is why combat feels
      // directional rather than random.
      const hx = cosOf(bot.heading);
      const hy = sinOf(bot.heading);
      dynamic
        .moveTo(x + hx * r * 0.4, y + hy * r * 0.4)
        .lineTo(x + hx * (r + 12), y + hy * (r + 12))
        .stroke({ width: 5, color: 0xffffff, alpha: 0.85 });

      // Health bar above the bot.
      const frac = bot.health / bot.maxHealth;
      dynamic.rect(x - r, y - r - 10, r * 2, 4).fill({ color: 0x000000, alpha: 0.5 });
      dynamic.rect(x - r, y - r - 10, r * 2 * frac, 4).fill(frac < 0.3 ? 0xff4a4a : color);

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

  return { draw, destroy: () => app.destroy(true, { children: true }) };
}
