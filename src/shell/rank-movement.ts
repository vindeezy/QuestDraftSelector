/**
 * How far each member moved between two standings boards.
 *
 * Pure, and typed structurally rather than against `ScoreRow`, so it can be reasoned about and
 * tested without a DOM, a renderer or an event result.
 *
 * **Why this exists.** The cumulative board after battle two answers "what are the totals" and
 * says nothing about the only thing anybody in the room is actually asking, which is whether
 * they climbed. A table that appears fully formed makes every viewer do the diff in their head
 * against a board they saw several minutes and one whole battle ago. Nobody does that; they
 * find their own name, read a number, and the moment passes.
 *
 * Movement is the meaning on that screen, so it is computed rather than implied — and it is
 * free, because `scoreboardRows` is pure and takes a battle index, so the previous ranking is
 * one more call with a smaller number.
 *
 * Deliberately NOT shown on the first board. After one battle there is nothing to have moved
 * from: everyone starts level, every delta would read `+0`, and a column of zeroes teaches a
 * viewer to ignore the column exactly when the next screen needs them to read it.
 */

export interface Ranked {
  readonly memberId: string;
  /** 1-based placement on the board. */
  readonly rank: number;
}

export interface RankMove {
  readonly memberId: string;
  /** Where they were on the previous board. */
  readonly from: number;
  /** Where they are now. */
  readonly to: number;
  /** Places gained. Positive is a climb, negative is a fall, zero is unmoved. */
  readonly delta: number;
}

/**
 * Movement per member, keyed by id.
 *
 * A member absent from the previous board is omitted rather than reported as an enormous
 * climb — it cannot happen with a fixed roster, and inventing a delta for it would put a
 * dramatic number on screen for what is really a bug.
 */
export function rankMovement(
  current: readonly Ranked[],
  previous: readonly Ranked[],
): Map<string, RankMove> {
  const was = new Map(previous.map((row) => [row.memberId, row.rank]));
  const moves = new Map<string, RankMove>();

  for (const row of current) {
    const from = was.get(row.memberId);
    if (from === undefined) continue;
    moves.set(row.memberId, {
      memberId: row.memberId,
      from,
      to: row.rank,
      delta: from - row.rank,
    });
  }

  return moves;
}

/**
 * The screen-reader sentence for a move.
 *
 * The badge is a drawn triangle and a number, which says nothing out loud. This is the same
 * fact in the product's own language, and it is what actually gets announced.
 */
export function movementLabel(move: RankMove): string {
  if (move.delta > 0) return `up ${move.delta} ${places(move.delta)} to ${move.to}`;
  if (move.delta < 0) return `down ${-move.delta} ${places(-move.delta)} to ${move.to}`;
  return `holds ${move.to}`;
}

function places(n: number): string {
  return n === 1 ? 'place' : 'places';
}
