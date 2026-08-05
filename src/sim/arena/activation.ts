import type { Bot } from './bot';

/**
 * When is a hazard dangerous?
 *
 * This is deliberately separate from what a hazard DOES. A button is not a kind of
 * hazard; it is an answer to this question, which is why one button can drive a flame
 * jet, a cannon and a hidden pit without any of them knowing buttons exist.
 */
export const Activation = {
  Always: 0,
  Cycle: 1,
  Triggered: 2,
} as const;

export type ActivationMode = (typeof Activation)[keyof typeof Activation];

export interface ActivationSpec {
  mode: ActivationMode;
  /** Cycle: full period in ticks. */
  period: number;
  /** Cycle: ticks at the start of each period during which it is on. */
  activeTicks: number;
  /** Triggered: which button arms it. */
  buttonId: string;
}

export function always(): ActivationSpec {
  return { mode: Activation.Always, period: 0, activeTicks: 0, buttonId: '' };
}

export function cycle(period: number, activeTicks: number): ActivationSpec {
  return { mode: Activation.Cycle, period, activeTicks, buttonId: '' };
}

export function triggered(buttonId: string): ActivationSpec {
  return { mode: Activation.Triggered, period: 0, activeTicks: 0, buttonId };
}

/**
 * A floor plate.
 *
 * Latch and cooldown live on the BUTTON rather than on each hazard, so several hazards
 * wired to one plate all fire together and share its rhythm. A cooldown is what stops a
 * bot parked on a plate from machine-gunning whatever it is wired to.
 */
export interface Button {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** 0 means active only while pressed. Above 0, stays armed this many ticks per press. */
  latchTicks: number;
  /** Minimum ticks between arming events. */
  cooldown: number;
  /** Runtime: is a living bot on it right now. */
  pressed: boolean;
  /** Runtime: tick at which the current latch expires. */
  armedUntil: number;
  /** Runtime: earliest tick this may arm again. */
  nextArmTick: number;
}

export function createButton(
  id: string,
  x: number,
  y: number,
  radius: number,
  latchTicks: number,
  cooldown: number,
): Button {
  return {
    id,
    x,
    y,
    radius,
    latchTicks,
    cooldown,
    pressed: false,
    armedUntil: 0,
    nextArmTick: 0,
  };
}

/** Recomputes every button's pressed and armed state for this tick. */
export function updateButtons(
  buttons: Map<string, Button>,
  bots: readonly Bot[],
  tick: number,
): void {
  for (const button of buttons.values()) {
    let pressed = false;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = bot.body.x - button.x;
      const dy = bot.body.y - button.y;
      const limit = button.radius + bot.body.radius;
      if (dx * dx + dy * dy <= limit * limit) {
        pressed = true;
        break;
      }
    }
    button.pressed = pressed;

    if (button.latchTicks > 0 && pressed && tick >= button.nextArmTick) {
      button.armedUntil = tick + button.latchTicks;
      button.nextArmTick = tick + button.cooldown;
    }
  }
}

export function isActive(
  spec: ActivationSpec,
  tick: number,
  buttons: Map<string, Button>,
): boolean {
  if (spec.mode === Activation.Always) return true;
  if (spec.mode === Activation.Cycle) {
    if (spec.period <= 0) return true;
    return tick % spec.period < spec.activeTicks;
  }
  const button = buttons.get(spec.buttonId);
  if (button === undefined) return false;
  if (button.latchTicks === 0) return button.pressed;
  return tick < button.armedUntil;
}
