import { BEAT_IDS, categoryForBeat, type BeatId } from '../beats';
import type { Screen } from './types';
import { landingScreen } from './landing';
import { nameSelectScreen } from './name-select';
import { whatToExpectScreen } from './what-to-expect';
import { forgeScreen } from './forge';
import { stubScreen } from './stub';

/**
 * The beat -> screen registry. Beats past the Forge still get `stubScreen(id)` — a
 * placeholder that still lets the router and progress machinery be exercised end to
 * end. Building here as a lookup table, rather than a switch in the router, keeps
 * adding a real screen later a one-line change: replace the entry, delete nothing else.
 *
 * The six Forge beats aren't listed individually here — `categoryForBeat` (the same
 * mapping `forge.ts` itself uses) already knows which beats they are, so that's what
 * decides which ones get `forgeScreen(id)` below, rather than hardcoding `forge-1`
 * through `forge-6` a second time.
 */
const REAL_SCREENS: Partial<Record<BeatId, Screen>> = {
  landing: landingScreen,
  'name-select': nameSelectScreen,
  'what-to-expect': whatToExpectScreen,
};

export const SCREENS: Readonly<Record<BeatId, Screen>> = Object.fromEntries(
  BEAT_IDS.map((id) => [id, REAL_SCREENS[id] ?? (categoryForBeat(id) ? forgeScreen(id) : stubScreen(id))]),
) as Record<BeatId, Screen>;
