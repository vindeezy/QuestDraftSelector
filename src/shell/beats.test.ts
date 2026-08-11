import { describe, it, expect } from 'vitest';
import { CATEGORIES } from '../sim/parts/tables';
import {
  BEAT_IDS,
  BEATS,
  FIRST_BEAT,
  LAST_BEAT,
  FORGE_BEAT_CATEGORY,
  beatIndex,
  categoryForBeat,
  isBeatId,
  isBeforeBeat,
  nextBeat,
  previousBeat,
  type BeatId,
} from './beats';

describe('BEAT_IDS', () => {
  it('has exactly nineteen beats', () => {
    expect(BEAT_IDS.length).toBe(19);
  });

  it('is in the exact order the spec lays out', () => {
    expect(BEAT_IDS).toEqual([
      'landing',
      'name-select',
      'what-to-expect',
      'forge-1',
      'forge-2',
      'forge-3',
      'forge-4',
      'forge-5',
      'forge-6',
      'build-reveal',
      'battle-1',
      'standings-1',
      'battle-2',
      'battle-2-result',
      'standings-2',
      'battle-3',
      'battle-3-result',
      'draft-order',
      'complete',
    ]);
  });

  it('has all unique ids', () => {
    expect(new Set(BEAT_IDS).size).toBe(BEAT_IDS.length);
  });

  it('starts at landing and ends at complete', () => {
    expect(FIRST_BEAT).toBe('landing');
    expect(LAST_BEAT).toBe('complete');
    expect(BEAT_IDS[0]).toBe(FIRST_BEAT);
    expect(BEAT_IDS[BEAT_IDS.length - 1]).toBe(LAST_BEAT);
  });

  it('BEATS is the same sequence as BEAT_IDS', () => {
    expect(BEATS).toEqual(BEAT_IDS);
  });
});

describe('the six Forge beats', () => {
  it('appear consecutively, in CATEGORIES order', () => {
    const categories = ['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6'].map(
      (id) => categoryForBeat(id as BeatId),
    );
    expect(categories).toEqual([...CATEGORIES]);
  });

  it('FORGE_BEAT_CATEGORY maps every forge beat to a category, in order', () => {
    expect([...FORGE_BEAT_CATEGORY.values()]).toEqual([...CATEGORIES]);
    expect([...FORGE_BEAT_CATEGORY.keys()]).toEqual(['forge-1', 'forge-2', 'forge-3', 'forge-4', 'forge-5', 'forge-6']);
  });

  it('categoryForBeat returns null for a non-Forge beat', () => {
    expect(categoryForBeat('landing')).toBeNull();
    expect(categoryForBeat('draft-order')).toBeNull();
  });
});

describe('isBeatId', () => {
  it('accepts every real beat id', () => {
    for (const id of BEAT_IDS) expect(isBeatId(id)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isBeatId('forge-7')).toBe(false);
    expect(isBeatId('')).toBe(false);
    expect(isBeatId(undefined)).toBe(false);
    expect(isBeatId(null)).toBe(false);
    expect(isBeatId(42)).toBe(false);
  });
});

describe('beatIndex', () => {
  it('assigns 0 to landing and 18 to complete', () => {
    expect(beatIndex('landing')).toBe(0);
    expect(beatIndex('complete')).toBe(18);
  });

  it('is strictly increasing along BEAT_IDS', () => {
    const indices = BEAT_IDS.map((id) => beatIndex(id));
    expect(indices).toEqual(BEAT_IDS.map((_, i) => i));
  });
});

describe('nextBeat / previousBeat', () => {
  it('walks forward through the whole sequence and lands on null past complete', () => {
    let current: BeatId | null = FIRST_BEAT;
    const visited: BeatId[] = [];
    while (current !== null) {
      visited.push(current);
      current = nextBeat(current);
    }
    expect(visited).toEqual(BEAT_IDS);
  });

  it('previousBeat is null at landing', () => {
    expect(previousBeat('landing')).toBeNull();
  });

  it('nextBeat and previousBeat are inverses in the middle of the sequence', () => {
    expect(nextBeat('forge-3')).toBe('forge-4');
    expect(previousBeat('forge-4')).toBe('forge-3');
  });
});

describe('isBeforeBeat', () => {
  it('orders beats by their position', () => {
    expect(isBeforeBeat('landing', 'complete')).toBe(true);
    expect(isBeforeBeat('complete', 'landing')).toBe(false);
    expect(isBeforeBeat('battle-2', 'battle-2-result')).toBe(true);
  });

  it('is false for a beat compared to itself', () => {
    expect(isBeforeBeat('battle-1', 'battle-1')).toBe(false);
  });
});
