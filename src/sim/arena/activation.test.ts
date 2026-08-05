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
