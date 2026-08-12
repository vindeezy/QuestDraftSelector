import { Application, BitmapText, Container, Graphics } from 'pixi.js';
import type { PlinkoRun } from '../sim/plinko/plinko';
import { destroyOnce } from './destroy-once';

/** Placeholder member colours, used only when a caller does not supply real ones via
 *  `ballVisuals` (the "What to expect" demo loop, which never shows real members). */
const BALL_COLORS = [
  0xff6a3d, 0x3ddc84, 0x4aa8ff, 0xc77dff, 0xffd23d,
  0xff4d8d, 0x5ce1e6, 0xffa03d, 0x9d7bff, 0x6ee7a0,
];

/** A ball's real-world identity: the member's colour and the two-letter initials to
 *  print on it. Optional — callers without real members (the demo loop) fall back to
 *  the placeholder palette and a 1-based index label. */
export interface PlinkoBallVisual {
  /** 0xRRGGBB. */
  colour: number;
  label: string;
}

/** Perceived brightness, 0 (black) to 1 (white) — good enough for picking a legible
 *  label colour and deciding whether a ball needs a brighter outline; not a rigorous
 *  WCAG contrast calculation, which this decorative use doesn't need. Same formula as
 *  `shell/colour.ts`'s `readableInkFor` (duplicated rather than imported: `src/render/`
 *  sits below `src/shell/` in the architecture, see the spec's §3 diagram, so it must
 *  not reach upward for a shell helper). */
function luminance(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Dark ink on a bright ball, light ink on a dark one, so initials stay readable
 *  against any member colour. */
function inkFor(colour: number): number {
  return luminance(colour) > 0.55 ? 0x0b0f16 : 0xffffff;
}

/** Below this brightness a ball is at real risk of disappearing into the board's own
 *  near-black background (`0x0b0f16`) and peg colour (`0x35424f`) — see the roster.ts
 *  comment on the one member (Tommy, `#1C1F26`) who needs this. Those balls get a
 *  brighter, thicker outline regardless of whether they're the highlighted one. */
const DARK_BALL_LUMINANCE = 0.18;

export interface PlinkoRenderer {
  /** Draws the current state of the run. Call once per animation frame. */
  draw(run: PlinkoRun): void;
  destroy(): void;
}

export async function createPlinkoRenderer(
  parent: HTMLElement,
  run: PlinkoRun,
  highlightBallIndex: number | null,
  ballVisuals?: readonly PlinkoBallVisual[],
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

  // BitmapText, not Text: labels move every frame (see `pixijs-scene-text` skill), and
  // while their *content* is fixed per ball here, an atlas-backed label is also the
  // cheaper one to create ten of.
  const labels = new Container();
  app.stage.addChild(labels);
  const labelTexts = run.balls.map((ball) => {
    const visual = ballVisuals?.[ball.index];
    const color = visual?.colour ?? BALL_COLORS[ball.index % BALL_COLORS.length]!;
    const text = new BitmapText({
      text: visual?.label ?? String(ball.index + 1),
      style: { fontFamily: 'Arial', fontSize: 13, fill: inkFor(color), fontWeight: '700' },
    });
    text.anchor.set(0.5);
    labels.addChild(text);
    return text;
  });

  const draw = (current: PlinkoRun): void => {
    dynamic.clear();

    for (const ball of current.balls) {
      const visual = ballVisuals?.[ball.index];
      const color = visual?.colour ?? BALL_COLORS[ball.index % BALL_COLORS.length]!;
      const isHighlighted = ball.index === highlightBallIndex;
      const isDarkBall = luminance(color) < DARK_BALL_LUMINANCE;

      if (isHighlighted) {
        // Matches the arena renderer's own highlight ring exactly — the same visual
        // vocabulary carries from "this is your ball" here to "this is your bot" there.
        dynamic.circle(ball.body.x, ball.body.y, ball.body.radius + 6).fill({
          color: 0xffffff,
          alpha: 0.16,
        });
      }

      dynamic.circle(ball.body.x, ball.body.y, ball.body.radius).fill(color);
      dynamic.circle(ball.body.x, ball.body.y, ball.body.radius).stroke({
        width: isHighlighted ? 3 : isDarkBall ? 2.5 : 1.5,
        color: 0xffffff,
        alpha: isHighlighted ? 0.9 : isDarkBall ? 0.65 : 0.25,
      });

      const label = labelTexts[ball.index]!;
      label.x = ball.body.x;
      label.y = ball.body.y;
    }
  };

  draw(run);

  return {
    draw,
    destroy: destroyOnce(app),
  };
}
