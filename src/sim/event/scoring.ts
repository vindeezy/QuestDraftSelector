/**
 * How a battle placement becomes points, and how three battles become a draft order.
 *
 * The gaps are deliberately irregular. A linear ladder produces frequent ties across
 * three battles; this spread makes them rare, and the large gap at the top means winning
 * a battle is worth chasing rather than settling for a safe second.
 */
export const PLACEMENT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export type Tiebreak = 'eliminations' | 'damage' | 'memberId';

export interface BattleTally {
  memberId: string;
  /** Finishing place in each battle, 1 is best. */
  places: number[];
  /** Eliminations caused across all battles. */
  eliminations: number;
  /** Damage dealt across all battles. */
  damage: number;
}

export interface Standing {
  memberId: string;
  points: number;
  battlePoints: number[];
  eliminations: number;
  damage: number;
  /** 1 drafts first. */
  draftPosition: number;
  /** Which rule separated this member from whoever they tied with, if any. */
  tiebreak: Tiebreak | null;
}

/** Points for a finishing place. Places outside the table score nothing. */
export function pointsForPlace(place: number): number {
  if (place < 1 || place > PLACEMENT_POINTS.length) return 0;
  return PLACEMENT_POINTS[place - 1]!;
}

/**
 * Ranks members into a draft order.
 *
 * Points first, then eliminations, then damage, then member id. The final fallback is not
 * decoration: without it the order would depend on sort stability, and a draft order that
 * could differ between browsers would be worthless.
 */
export function buildStandings(tallies: readonly BattleTally[]): Standing[] {
  const rows = tallies.map((t) => ({
    memberId: t.memberId,
    battlePoints: t.places.map(pointsForPlace),
    points: t.places.reduce((sum, place) => sum + pointsForPlace(place), 0),
    eliminations: t.eliminations,
    damage: t.damage,
    draftPosition: 0,
    tiebreak: null as Tiebreak | null,
  }));

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.eliminations !== a.eliminations) return b.eliminations - a.eliminations;
    if (b.damage !== a.damage) return b.damage - a.damage;
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
  });

  // Record which rule actually separated each adjacent pair, so the site can say
  // "tied on points, separated by eliminations" rather than presenting a bare order.
  for (let i = 0; i < rows.length; i++) {
    rows[i]!.draftPosition = i + 1;

    const prev = rows[i - 1];
    const next = rows[i + 1];
    for (const other of [prev, next]) {
      if (other === undefined) continue;
      if (other.points !== rows[i]!.points) continue;
      if (other.eliminations !== rows[i]!.eliminations) {
        rows[i]!.tiebreak = 'eliminations';
      } else if (other.damage !== rows[i]!.damage) {
        rows[i]!.tiebreak = 'damage';
      } else {
        rows[i]!.tiebreak = 'memberId';
      }
      break;
    }
  }

  return rows;
}
