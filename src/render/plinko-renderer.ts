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

/** Optional extras beyond a bare drop. Both default to "off" so an existing caller that
 *  never passes this object (the "What to expect" demo loop) renders exactly as before —
 *  see the doc comments on `slotLabels` and `topMargin` for why each one is opt-in. */
export interface PlinkoRendererExtras {
  /** One label per slot, in slot order (`run.board.slots[i]` <-> `slotLabels[i]`) —
   *  what that slot awards, painted once at mount and never touched again, since slot
   *  assignment never changes mid-run. Missing entries are simply skipped, so a caller
   *  with no categories to show (the demo loop) can omit this entirely. */
  slotLabels?: readonly string[];
  /**
   * Extra canvas height ABOVE the board's own, so a ball's full release column — which
   * starts above y=0, off the board's own drawing surface, so the balls can "fall into
   * view" once a drop is moving — is instead visible in an "at rest" frame where no
   * ticks have run yet. Without this, the pre-drop frame the Forge screen wants to hold
   * on (see `forge.ts`, where `forgeScreen` computes this via `releaseMargin(run)`
   * before wiring up the drop button) would show an empty board.
   *
   * Left at the default 0 for any caller that never shows a genuine tick-0 frame — the
   * "What to expect" demo loop restarts straight into its first advanced tick, so a
   * grown canvas would only cost it space for a frame nobody ever sees.
   */
  topMargin?: number;
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

/**
 * How far above y=0 a run's release column reaches, right now — i.e. how much extra
 * canvas height an "at rest" frame needs so every ball is visible instead of floating
 * off the top edge. Reads current ball positions rather than deriving it from config,
 * so it stays correct no matter what release tuning (`releaseStagger`, `ballRadius`,
 * `ballCount`) produced them; call it before any `advance()` for the pre-drop figure.
 */
/**
 * Ceiling on the headroom above the board, in board units.
 *
 * The release column is staggered, so the topmost ball can sit ~344 units above y=0 — and
 * honouring that in full made the canvas 45% taller (760 -> 1104). Since the board is
 * letterboxed to fit its container, that tall-and-narrow aspect meant the board drew at
 * only 42% of the available width, with the rest of the screen empty. Paying that much of
 * the vertical budget to show ten balls queued up is a bad trade against the board being
 * big enough to actually watch.
 *
 * Capped, the balls above the cap start off-screen and fall into view — which is what a
 * Plinko drop looks like anyway. The cap costs nothing at the moment that matters.
 */
const MAX_TOP_MARGIN = 96;

export function releaseMargin(run: PlinkoRun): number {
  let highest = 0;
  for (const ball of run.balls) {
    const top = ball.body.radius - ball.body.y; // distance above y=0 this ball's top edge sits, if any.
    if (top > highest) highest = top;
  }
  if (highest <= 0) return 0;
  const wanted = Math.ceil(highest) + 12; // +12: a little breathing room above the topmost ball.
  return wanted > MAX_TOP_MARGIN ? MAX_TOP_MARGIN : wanted;
}

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
  extras?: PlinkoRendererExtras,
): Promise<PlinkoRenderer> {
  const { width, height } = run.config.board;
  const topMargin = extras?.topMargin ?? 0;

  const app = new Application();
  await app.init({
    width,
    height: height + topMargin,
    background: 0x0b0f16,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  parent.appendChild(app.canvas);

  // Every dynamic and static coordinate below is still exactly `ball.body.x/y`,
  // `peg.x/y`, etc. — this container is the ONE place `topMargin` is applied, as a
  // transform rather than arithmetic scattered through every draw call.
  const boardLayer = new Container();
  boardLayer.y = topMargin;
  app.stage.addChild(boardLayer);

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
  boardLayer.addChild(statics);

  // Slot labels — what each slot awards, painted once and left alone. Sit just below
  // the divider line, near the top of each slot's enclosed zone, since that is the
  // area a ball spends the least time resting over (it falls through there, settling
  // toward the floor below) — the spot most likely to stay legible after balls land.
  if (extras?.slotLabels) {
    const slotLabels = extras.slotLabels;
    const slotLabelLayer = new Container();
    for (const slot of run.board.slots) {
      const label = slotLabels[slot.index];
      if (label === undefined) continue;
      const slotWidth = slot.maxX - slot.minX;
      const text = new BitmapText({
        text: label,
        style: {
          fontFamily: 'Arial',
          fontSize: 10,
          fontWeight: '700',
          fill: 0xc7d2e0,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: Math.max(40, slotWidth - 8),
          lineHeight: 12,
        },
      });
      text.anchor.set(0.5, 0);
      text.x = (slot.minX + slot.maxX) / 2;
      text.y = run.config.board.slotTopY + 8;
      slotLabelLayer.addChild(text);
    }
    boardLayer.addChild(slotLabelLayer);
  }

  const dynamic = new Graphics();
  boardLayer.addChild(dynamic);

  // BitmapText, not Text: labels move every frame (see `pixijs-scene-text` skill), and
  // while their *content* is fixed per ball here, an atlas-backed label is also the
  // cheaper one to create ten of.
  const labels = new Container();
  boardLayer.addChild(labels);
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
