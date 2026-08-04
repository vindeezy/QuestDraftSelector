import { describe, it, expect } from 'vitest';
import { DEFAULT_BOARD, buildBoard, slotForX } from './board';

describe('buildBoard', () => {
  const board = buildBoard(DEFAULT_BOARD);

  it('creates staggered peg rows', () => {
    expect(board.pegs.length).toBeGreaterThan(50);
  });

  it('makes every peg static', () => {
    for (const peg of board.pegs) expect(peg.invMass).toBe(0);
  });

  it('keeps every peg inside the board', () => {
    for (const peg of board.pegs) {
      expect(peg.x).toBeGreaterThanOrEqual(0);
      expect(peg.x).toBeLessThanOrEqual(DEFAULT_BOARD.width);
    }
  });

  it('offsets alternating rows by half the peg spacing', () => {
    const firstRowY = board.pegs[0]!.y;
    const rowOne = board.pegs.filter((p) => p.y === firstRowY).map((p) => p.x).sort((a, b) => a - b);
    const secondRowY = board.pegs.find((p) => p.y > firstRowY)!.y;
    const rowTwo = board.pegs.filter((p) => p.y === secondRowY).map((p) => p.x).sort((a, b) => a - b);
    expect(rowTwo[0]! - rowOne[0]!).toBeCloseTo(DEFAULT_BOARD.pegSpacingX / 2, 6);
  });

  it('creates two outer walls, one interior divider per slot boundary, and a floor', () => {
    const walls = 2;
    const dividers = DEFAULT_BOARD.slotCount - 1;
    const floor = 1;
    expect(board.segments.length).toBe(walls + dividers + floor);
  });

  it('produces exactly slotCount slots spanning the full width', () => {
    expect(board.slots.length).toBe(DEFAULT_BOARD.slotCount);
    expect(board.slots[0]!.minX).toBeCloseTo(0, 6);
    expect(board.slots.at(-1)!.maxX).toBeCloseTo(DEFAULT_BOARD.width, 6);
  });

  it('keeps the last peg row clear of the slot dividers', () => {
    // If pegs overlapped the divider region, balls would wedge on top of a divider
    // instead of falling into a slot.
    const lowestPeg = Math.max(...board.pegs.map((p) => p.y + p.radius));
    expect(lowestPeg).toBeLessThan(DEFAULT_BOARD.slotTopY);
  });

  it('leaves gaps between pegs wide enough for a ball to pass', () => {
    // Ball radius is 13 in the simulation config. Adjacent pegs in a row must leave
    // more than a ball diameter between their surfaces or the board would jam.
    const gap = DEFAULT_BOARD.pegSpacingX - 2 * DEFAULT_BOARD.pegRadius;
    expect(gap).toBeGreaterThan(2 * 13);
  });
});

describe('slotForX', () => {
  const board = buildBoard(DEFAULT_BOARD);

  it('maps the far left to slot 0', () => {
    expect(slotForX(board, 1)).toBe(0);
  });

  it('maps the far right to the last slot', () => {
    expect(slotForX(board, DEFAULT_BOARD.width - 1)).toBe(DEFAULT_BOARD.slotCount - 1);
  });

  it('clamps values outside the board', () => {
    expect(slotForX(board, -500)).toBe(0);
    expect(slotForX(board, 99999)).toBe(DEFAULT_BOARD.slotCount - 1);
  });

  it('puts a boundary value in the higher slot', () => {
    const slotWidth = DEFAULT_BOARD.width / DEFAULT_BOARD.slotCount;
    expect(slotForX(board, slotWidth)).toBe(1);
    expect(slotForX(board, slotWidth * 2)).toBe(2);
  });
});
