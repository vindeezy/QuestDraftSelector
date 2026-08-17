import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_MASTER_SEED, parseMasterSeed, previewSeed } from './record-event';

/**
 * `main()` at the bottom of `record-event.ts` is guarded behind `process.env.VITEST`
 * (set for this whole test process), so importing the module above never runs the CLI --
 * only the exported `parseMasterSeed`/`previewSeed`/`MAX_MASTER_SEED` are exercised here.
 */

describe('parseMasterSeed', () => {
  it('accepts the low boundary, 1', () => {
    expect(parseMasterSeed('1')).toBe(1);
  });

  it('accepts the high boundary, MAX_MASTER_SEED (2147483647)', () => {
    expect(MAX_MASTER_SEED).toBe(2147483647);
    expect(parseMasterSeed('2147483647')).toBe(2147483647);
  });

  it('accepts an ordinary in-range seed', () => {
    expect(parseMasterSeed('12345')).toBe(12345);
  });

  it.each([
    ['0', 'zero'],
    ['-1', 'a negative number'],
    ['2147483648', 'one past the high boundary'],
    ['1.5', 'a non-integer'],
    ['abc', 'not a number at all'],
    ['', 'an empty string'],
    ['NaN', 'the literal string NaN'],
  ])('rejects %s (%s)', (raw) => {
    expect(() => parseMasterSeed(raw)).toThrow();
  });

  it('states the valid range in its error message', () => {
    expect(() => parseMasterSeed('0')).toThrow(/1 and 2147483647/);
    expect(() => parseMasterSeed('abc')).toThrow(/1 and 2147483647/);
  });

  it('names the actual rejected value in its error message', () => {
    expect(() => parseMasterSeed('abc')).toThrow(/"abc"/);
    expect(() => parseMasterSeed('-1')).toThrow(/"-1"/);
  });
});

describe('previewSeed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureOutput(seed: number): string {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    previewSeed(seed);
    return lines.join('\n');
  }

  /** A seed whose event still needs tiebreaks to resolve — see the tiebreak test below
   *  for why it cannot share seed 12345 with the rest of this block. */
  const TIEBREAK_SEED = 7;

  it('produces a stable draft order for a known seed (pinned -- a change here means the simulation changed, not just this tool)', () => {
    const output = captureOutput(12345);
    expect(output).toContain(
      'draft order:     Spencer Lalk (57 pts) > Nick Lenker (54 pts) > Nick Cinotti (53 pts) > ' +
        'Vin Cinotti (50 pts) > Erik Gundersen (49 pts) > Tommy McCormick (39 pts) > ' +
        'Colby Thompson (32 pts) > Pat Driscoll (24 pts) > Rob Arena (14 pts) > Paden Simmons (3 pts)',
    );
    // Moved from `29af339d` on 17 August when six member colours changed, and that is the
    // checksum working rather than breaking. It folds in each member's id, name AND colour on
    // purpose (see `runEvent`), so that a record cannot go on verifying after the league swaps
    // somebody out — a roster is WHO is in it, not just how many.
    //
    // The simulation did not change, and the assertion above this one is the proof: the draft
    // order and every point total are identical, and that line kept passing while this one
    // failed. If both ever move together, something real has changed and re-pinning is the
    // wrong response.
    expect(output).toContain('checksum:        77d1da53');
  });

  it('reproduces the exact same draft order across two separate runs of the same seed', () => {
    const first = captureOutput(12345);
    const second = captureOutput(12345);
    expect(first).toBe(second);
  });

  it('uses the real roster: a real member name appears in the output, not a placeholder', () => {
    const output = captureOutput(12345);
    expect(output).toContain('Nick Cinotti');
    expect(output).not.toContain('Member 1');
  });

  it('prints every build with all six part categories', () => {
    const output = captureOutput(12345);
    expect(output).toMatch(/Paden Simmons\s+\S.*,.*,.*,.*,.*,.*/);
  });

  it('reports which rule settled each tiebreak, alongside the count', () => {
    // Deliberately NOT seed 12345, which no longer produces a tiebreak at all. Pinning
    // "0 place(s)" there would have left this test passing while covering nothing — the
    // failure mode to watch for whenever a scoring change moves these fixtures.
    //
    // Seed 7 is chosen because it exercises BOTH tiebreak rules in one run: two places
    // settled by damage and two by eliminations. A seed with only one rule would quietly
    // drop coverage of the other.
    const output = captureOutput(TIEBREAK_SEED);
    expect(output).toContain('tiebreaks:       4 place(s) needed a tiebreak');
    expect(output).toContain('draft position 3 (Paden Simmons): settled by damage');
    expect(output).toContain('draft position 4 (Pat Driscoll): settled by damage');
    expect(output).toContain('draft position 5 (Vin Cinotti): settled by eliminations');
    expect(output).toContain('draft position 6 (Rob Arena): settled by eliminations');
  });

  it('prints battle lengths alongside the arena name for each battle', () => {
    const output = captureOutput(12345);
    expect(output).toContain('battle lengths:  The Grinder 133s, The Gauntlet 169s, The Crossfire 148s');
  });
});
