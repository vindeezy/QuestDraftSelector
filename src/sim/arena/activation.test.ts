import { describe, it, expect } from 'vitest';
import { createBot } from './bot';
import {
  always,
  cycle,
  triggered,
  createButton,
  updateButtons,
  isActive,
} from './activation';

const bot = (x: number, y: number) => createBot({ id: 'b', x, y, heading: 0 });
const buttonsOf = (...list: ReturnType<typeof createButton>[]) =>
  new Map(list.map((b) => [b.id, b]));

describe('always', () => {
  it('is on at every tick', () => {
    const b = new Map();
    expect(isActive(always(), 0, b)).toBe(true);
    expect(isActive(always(), 99999, b)).toBe(true);
  });
});

describe('cycle', () => {
  const spec = cycle(120, 60);
  const b = new Map();

  it('is on for the first part of each period', () => {
    expect(isActive(spec, 0, b)).toBe(true);
    expect(isActive(spec, 59, b)).toBe(true);
    expect(isActive(spec, 60, b)).toBe(false);
    expect(isActive(spec, 119, b)).toBe(false);
  });

  it('repeats identically forever', () => {
    for (let t = 0; t < 400; t++) {
      expect(isActive(spec, t, b)).toBe(isActive(spec, t + 120, b));
    }
  });

  it('with phase 0 (the default) behaves exactly as before phase existed', () => {
    // Pins the no-phase behaviour: every arena built before phase existed calls
    // `cycle(period, activeTicks)` with no third argument, so this must never change.
    const zeroPhase = cycle(120, 60, 0);
    const noPhaseArg = cycle(120, 60);
    for (let t = 0; t < 400; t++) {
      expect(isActive(zeroPhase, t, b)).toBe(t % 120 < 60);
      expect(isActive(noPhaseArg, t, b)).toBe(t % 120 < 60);
      expect(isActive(noPhaseArg, t, b)).toBe(isActive(zeroPhase, t, b));
    }
  });
});

describe('cycle with a phase offset', () => {
  const b = new Map();

  it('shifts the on-window later in the period', () => {
    // period 360, activeTicks 60, phase 240: (tick + 240) % 360 < 60, which works out to
    // an on-window of ticks 120-179 of each 360-tick cycle.
    const spec = cycle(360, 60, 240);
    expect(isActive(spec, 119, b)).toBe(false);
    expect(isActive(spec, 120, b)).toBe(true);
    expect(isActive(spec, 179, b)).toBe(true);
    expect(isActive(spec, 180, b)).toBe(false);
    expect(isActive(spec, 299, b)).toBe(false);
    // Repeats identically into the second cycle.
    expect(isActive(spec, 480, b)).toBe(true);
    expect(isActive(spec, 539, b)).toBe(true);
    expect(isActive(spec, 540, b)).toBe(false);
  });

  it('normalizes a negative phase into the same [0, period) window', () => {
    // phase -120 on a 360-period cycle is the same point as phase 240.
    const negative = cycle(360, 60, -120);
    const positive = cycle(360, 60, 240);
    for (let t = 0; t < 400; t++) {
      expect(isActive(negative, t, b)).toBe(isActive(positive, t, b));
    }
  });

  it('normalizes a phase many periods larger than one cycle', () => {
    // 240 + 10*360 lands on the same point in the cycle as phase 240.
    const huge = cycle(360, 60, 240 + 10 * 360);
    const plain = cycle(360, 60, 240);
    for (let t = 0; t < 400; t++) {
      expect(isActive(huge, t, b)).toBe(isActive(plain, t, b));
    }
  });

  it('floors a fractional phase to stay integer-only', () => {
    const fractional = cycle(360, 60, 240.9);
    const integer = cycle(360, 60, 240);
    for (let t = 0; t < 400; t++) {
      expect(isActive(fractional, t, b)).toBe(isActive(integer, t, b));
    }
  });
});

describe('buttons — while-pressed', () => {
  it('is off with nobody standing on it', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(false);
  });

  it('turns on while a bot stands on it', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);
  });

  it('turns off again the moment the bot leaves', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    updateButtons(buttons, [bot(900, 900)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(false);
  });

  it('ignores eliminated bots', () => {
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    const dead = bot(105, 100);
    dead.alive = false;
    updateButtons(buttons, [dead], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(false);
  });

  it('accounts for the bot radius, not just its centre', () => {
    // Button radius 30, bot radius 20, so centres 49 apart still overlap.
    const btn = createButton('a', 100, 100, 30, 0, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(149, 100)], 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);
    updateButtons(buttons, [bot(151, 100)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(false);
  });
});

describe('buttons — latching', () => {
  it('stays on for the latch duration after a single press', () => {
    const btn = createButton('a', 100, 100, 30, 90, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    updateButtons(buttons, [bot(900, 900)], 1);
    expect(isActive(triggered('a'), 1, buttons)).toBe(true);
    expect(isActive(triggered('a'), 89, buttons)).toBe(true);
    expect(isActive(triggered('a'), 90, buttons)).toBe(false);
  });
});

describe('buttons — cooldown', () => {
  it('refuses to re-arm until the cooldown has expired', () => {
    // Latch 30, cooldown 200. A bot parked on the plate must not machine-gun it.
    const btn = createButton('a', 100, 100, 30, 30, 200);
    const buttons = buttonsOf(btn);
    const parked = [bot(105, 100)];

    updateButtons(buttons, parked, 0);
    expect(isActive(triggered('a'), 0, buttons)).toBe(true);

    for (let t = 1; t <= 150; t++) updateButtons(buttons, parked, t);
    // Latch expired at 30 and the cooldown blocks re-arming until 200.
    expect(isActive(triggered('a'), 150, buttons)).toBe(false);

    for (let t = 151; t <= 205; t++) updateButtons(buttons, parked, t);
    expect(isActive(triggered('a'), 205, buttons)).toBe(true);
  });
});

describe('isActive', () => {
  it('is off when a triggered spec names a button that does not exist', () => {
    expect(isActive(triggered('missing'), 0, new Map())).toBe(false);
  });

  it('lets one button drive several hazards', () => {
    const btn = createButton('shared', 100, 100, 30, 60, 0);
    const buttons = buttonsOf(btn);
    updateButtons(buttons, [bot(105, 100)], 0);
    expect(isActive(triggered('shared'), 5, buttons)).toBe(true);
    expect(isActive(triggered('shared'), 5, buttons)).toBe(true);
  });
});
