import { describe, it, expect } from 'vitest';
import { movementLabel, rankMovement, type Ranked } from './rank-movement';

const board = (...ids: string[]): Ranked[] => ids.map((memberId, i) => ({ memberId, rank: i + 1 }));

describe('working out who moved', () => {
  it('reports a climb as positive and a fall as negative', () => {
    // Spencer goes 5th -> 1st, Tommy 1st -> 2nd.
    const moves = rankMovement(board('spencer', 'tommy', 'pat'), board('tommy', 'pat', 'x', 'y', 'spencer'));
    expect(moves.get('spencer')).toMatchObject({ from: 5, to: 1, delta: 4 });
    expect(moves.get('tommy')).toMatchObject({ from: 1, to: 2, delta: -1 });
  });

  it('reports nobody moving as zero rather than as absent', () => {
    // The board still has to say "holds 3rd" out loud. Omitting unmoved members would leave
    // a row with no movement cell at all, which reads as missing data rather than as steady.
    const same = board('a', 'b', 'c');
    const moves = rankMovement(same, same);
    expect([...moves.values()].every((m) => m.delta === 0)).toBe(true);
    expect(moves.size).toBe(3);
  });

  it('omits a member who was not on the previous board', () => {
    // Cannot happen with a fixed roster, and that is the point: inventing a delta would put
    // a dramatic number on screen for what is really a bug.
    const moves = rankMovement(board('a', 'newcomer'), board('a'));
    expect(moves.has('newcomer')).toBe(false);
    expect(moves.has('a')).toBe(true);
  });

  it('is not confused by the boards being in different orders', () => {
    // The previous board arrives sorted by its own ranking, not by member id.
    const moves = rankMovement(board('c', 'a', 'b'), board('b', 'c', 'a'));
    expect(moves.get('c')).toMatchObject({ from: 2, to: 1, delta: 1 });
    expect(moves.get('a')).toMatchObject({ from: 3, to: 2, delta: 1 });
    expect(moves.get('b')).toMatchObject({ from: 1, to: 3, delta: -2 });
  });

  it('conserves movement — every climb is somebody else falling', () => {
    // A useful invariant on a fixed roster: deltas must sum to zero. If they ever do not,
    // the two boards were built from different rosters and the screen is lying.
    const moves = rankMovement(board('a', 'b', 'c', 'd'), board('d', 'a', 'c', 'b'));
    expect([...moves.values()].reduce((sum, m) => sum + m.delta, 0)).toBe(0);
  });
});

describe('what it says out loud', () => {
  it('names the direction, the distance and the destination', () => {
    expect(movementLabel({ memberId: 'a', from: 6, to: 2, delta: 4 })).toBe('up 4 places to 2');
    expect(movementLabel({ memberId: 'a', from: 2, to: 5, delta: -3 })).toBe('down 3 places to 5');
  });

  it('says place, not places, for a single step', () => {
    expect(movementLabel({ memberId: 'a', from: 3, to: 2, delta: 1 })).toBe('up 1 place to 2');
    expect(movementLabel({ memberId: 'a', from: 2, to: 3, delta: -1 })).toBe('down 1 place to 3');
  });

  it('has something to say about holding position', () => {
    expect(movementLabel({ memberId: 'a', from: 4, to: 4, delta: 0 })).toBe('holds 4');
  });
});
