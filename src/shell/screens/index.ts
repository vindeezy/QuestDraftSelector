import { BEAT_IDS, type BeatId } from '../beats';
import type { Screen } from './types';
import { landingScreen } from './landing';
import { nameSelectScreen } from './name-select';
import { whatToExpectScreen } from './what-to-expect';
import { stubScreen } from './stub';

/**
 * The beat -> screen registry. Only the first three beats have a real screen this task
 * built; every other beat gets `stubScreen(id)` — a placeholder that still lets the
 * router and progress machinery be exercised end to end. Building here as a lookup
 * table, rather than a switch in the router, keeps adding a real screen later a one-line
 * change: replace the entry, delete nothing else.
 */
const REAL_SCREENS: Partial<Record<BeatId, Screen>> = {
  landing: landingScreen,
  'name-select': nameSelectScreen,
  'what-to-expect': whatToExpectScreen,
};

export const SCREENS: Readonly<Record<BeatId, Screen>> = Object.fromEntries(
  BEAT_IDS.map((id) => [id, REAL_SCREENS[id] ?? stubScreen(id)]),
) as Record<BeatId, Screen>;
