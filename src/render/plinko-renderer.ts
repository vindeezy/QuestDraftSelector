import { Application, Container, Graphics, Text } from 'pixi.js';
import type { PlinkoRun } from '../sim/plinko/plinko';

/** Placeholder member colours. Replaced with real league colours in a later phase. */
const BALL_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

export interface PlinkoRenderer {
  /** Draws the current state of the run. Call once per animation frame. */
  draw(run: PlinkoRun): void;
  destroy(): void;
}

export async function createPlinkoRenderer(
  parent: HTMLElement,
  run: PlinkoRun,
  highlightBallIndex: number | null,
): Promise<PlinkoRenderer> {
  const { width, height } = run.config.board;

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

  // Static geometry is drawn once — pegs and dividers never move.
  const statics = new Graphics();
  for (const peg of run.board.pegs) {
    statics.circle(peg.x, peg.y, peg.radius).fill(0x35424f);
  }
  for (const seg of run.board.segments) {
    statics.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({ width: 2, color: 0x2a3542 });
  }
  for (const slot of run.board.slots) {
    statics
      .rect(slot.minX + 2, run.config.board.slotTopY, slot.maxX - slot.minX - 4, 4)
      .fill(0x1d2836);
  }
  app.stage.addChild(statics);

  const dynamic = new Graphics();
  app.stage.addChild(dynamic);

  const labels = new Container();
  app.stage.addChild(labels);
  const labelTexts = run.balls.map((ball) => {
    const text = new Text({
      text: String(ball.index + 1),
      style: { fontSize: 13, fill: 0x0b0f16, fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const draw = (current: PlinkoRun): void => {
    dynamic.clear();

    for (const ball of current.balls) {
      const color = BALL_COLORS[ball.index % BALL_COLORS.length]!;
      const isHighlighted = ball.index === highlightBallIndex;

      if (isHighlighted) {
        dynamic.circle(ball.body.x, ball.body.y, ball.body.radius + 7).fill({
          color: 0xffffff,
          alpha: 0.18,
        });
      }

      dynamic.circle(ball.body.x, ball.body.y, ball.body.radius).fill(color);
      dynamic
        .circle(ball.body.x, ball.body.y, ball.body.radius)
        .stroke({ width: isHighlighted ? 3 : 1.5, color: 0xffffff, alpha: isHighlighted ? 0.9 : 0.25 });

      const label = labelTexts[ball.index]!;
      label.x = ball.body.x;
      label.y = ball.body.y;
    }
  };

  draw(run);

  return {
    draw,
    destroy: () => app.destroy(true, { children: true }),
  };
}
