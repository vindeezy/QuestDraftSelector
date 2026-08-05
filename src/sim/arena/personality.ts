/**
 * The seven driver personalities, as weight vectors over the AI's actions.
 *
 * No behaviour lives here. This file is data, and that is the point: a personality is a
 * set of numbers, not a code path, so new ones cost nothing and balance changes are a
 * spreadsheet edit rather than a rewrite.
 */

export interface Weights {
  // The three chase weights select WHO a bot targets, not what it does. There is one
  // `chase` action; these bias the weighted draw in `resolveTarget`.
  /** Preference for closer targets. */
  chaseNearest: number;
  /** Preference for wounded targets. */
  chaseWeakest: number;
  /** Preference for whoever has the most kills. */
  chaseLeader: number;
  /** Attack two bots already fighting each other. */
  attackEngaged: number;
  /** Ram a target from the side that sends it toward a hazard or another bot. */
  shove: number;
  /** Back off to build a run-up, then strike at full speed. */
  charge: number;
  /** Break off after landing a hit. */
  disengage: number;
  /** Flee when hurt. */
  retreat: number;
  /** Circle a target rather than closing. */
  strafe: number;
  /** Showboat after causing an elimination. */
  celebrate: number;
  /**
   * How much danger the bot will drive through, 0 to 1. Scales down the hole-repulsion
   * blend. Governs how much risk it accepts, never whether it can see the hazard.
   */
  riskTolerance: number;
  /** Ticks between target reconsiderations. Lower means more erratic. */
  retargetInterval: number;
}

export const PERSONALITY_NAMES = [
  'aggressive',
  'defensive',
  'hitAndRun',
  'thirdParty',
  'chaos',
  'showman',
  'instigator',
] as const;

export type PersonalityName = (typeof PERSONALITY_NAMES)[number];

const TABLE: Record<PersonalityName, Weights> = {
  // Hellbent on attacking. Rarely backs off, prioritises dealing damage.
  aggressive: {
    chaseNearest: 1.0, chaseWeakest: 0.7, chaseLeader: 0.3, attackEngaged: 0.3,
    shove: 0.2, charge: 0.3, disengage: 0.0, retreat: 0.05, strafe: 0.1,
    celebrate: 0.1, riskTolerance: 0.55, retargetInterval: 180,
  },
  // Avoids trouble but attacks when necessary. Fights an intelligent battle.
  defensive: {
    chaseNearest: 0.3, chaseWeakest: 0.9, chaseLeader: 0.05, attackEngaged: 0.2,
    shove: 0.2, charge: 0.1, disengage: 0.5, retreat: 0.5, strafe: 0.7,
    celebrate: 0.0, riskTolerance: 0.4, retargetInterval: 120,
  },
  // Strike, break off, repeat. Damage followed by self-preservation.
  hitAndRun: {
    chaseNearest: 0.6, chaseWeakest: 0.8, chaseLeader: 0.1, attackEngaged: 0.4,
    shove: 0.1, charge: 0.5, disengage: 1.0, retreat: 0.4, strafe: 0.4,
    celebrate: 0.05, riskTolerance: 0.45, retargetInterval: 90,
  },
  // Hunts bots already locked in a fight, looking for 2-on-1 eliminations.
  thirdParty: {
    chaseNearest: 0.2, chaseWeakest: 0.6, chaseLeader: 0.1, attackEngaged: 1.0,
    shove: 0.3, charge: 0.3, disengage: 0.3, retreat: 0.5, strafe: 0.5,
    celebrate: 0.05, riskTolerance: 0.5, retargetInterval: 100,
  },
  // Completely unpredictable. Rerolls its own weights mid-battle. The values here are
  // only its starting state; ai.ts replaces them periodically.
  chaos: {
    chaseNearest: 0.5, chaseWeakest: 0.5, chaseLeader: 0.5, attackEngaged: 0.5,
    shove: 0.5, charge: 0.5, disengage: 0.5, retreat: 0.5, strafe: 0.5,
    celebrate: 0.5, riskTolerance: 0.5, retargetInterval: 45,
  },
  // Big dramatic hits, fights on the edge of danger, showboats after a kill.
  showman: {
    chaseNearest: 0.7, chaseWeakest: 0.3, chaseLeader: 0.8, attackEngaged: 0.4,
    shove: 0.3, charge: 1.0, disengage: 0.2, retreat: 0.1, strafe: 0.3,
    celebrate: 1.0, riskTolerance: 0.62, retargetInterval: 150,
  },
  // Bumps bots into each other and into hazards. Rarely commits to a fight itself.
  instigator: {
    chaseNearest: 0.25, chaseWeakest: 0.2, chaseLeader: 0.2, attackEngaged: 0.6,
    shove: 1.0, charge: 0.2, disengage: 0.7, retreat: 0.5, strafe: 0.6,
    celebrate: 0.1, riskTolerance: 0.5, retargetInterval: 60,
  },
};

/** Returns a fresh copy, so a bot can mutate its own weights without affecting others. */
export function weightsFor(name: PersonalityName): Weights {
  return { ...TABLE[name] };
}
