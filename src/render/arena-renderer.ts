import { Application, Container, Graphics, Text } from 'pixi.js';
import { TileState } from '../sim/arena/tiles';
import { cosOf, sinOf } from '../sim/trig';
import type { Match } from '../sim/arena/match';

const BOT_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

export interface ArenaRenderer {
  draw(match: Match): void;
  destroy(): void;
}

export async function createArenaRenderer(
  parent: HTMLElement,
  match: Match,
  highlightIndex: number | null,
): Promise<ArenaRenderer> {
  const { width, height } = match.arena.grid;

  const app = new Application();
  await app.init({
    width,
    height,
    background: 0x0b0f16,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  parent.appendChild(app.canvas);

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

  const drawFloor = (current: Match): void => {
    floor.clear();
    const grid = current.arena.grid;
    const size = grid.tileSize;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const state = grid.tiles[row * grid.cols + col];
        if (state === TileState.Gone) continue;
        const color = state === TileState.Warning ? 0x4a2318 : 0x161d27;
        floor.rect(col * size + 1, row * size + 1, size - 2, size - 2).fill(color);
      }
    }
    for (const seg of current.arena.segments) {
      floor.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 4, color: 0x35424f });
    }
  };

  const draw = (current: Match): void => {
    drawFloor(current);
    dynamic.clear();

    current.bots.forEach((bot, index) => {
      const label = labelTexts[index]!;
      if (!bot.alive) {
        label.visible = false;
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
    });
  };

  draw(match);

  return { draw, destroy: () => app.destroy(true, { children: true }) };
}
