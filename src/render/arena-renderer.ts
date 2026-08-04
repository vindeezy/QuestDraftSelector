import { Application, Container, Graphics, Text } from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { cosOf, sinOf } from '../sim/trig';
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
        const color = state === TileState.Warning ? warningColor(tick) : 0x161d27;
        floor.rect(col * size + 1, row * size + 1, size - 2, size - 2).fill(color);
      }
    }
    for (const seg of current.arena.segments) {
      floor.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 4, color: 0x35424f });
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
