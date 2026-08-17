import type { EventMember } from '../sim/event/event';

/**
 * The real ten-person league roster.
 *
 * `EventMember` (`src/sim/event/event.ts`) only carries `id`, `name`, `colour` — what the
 * simulation needs to run deterministically. The roster adds `initials`, which the
 * simulation never reads but the website renders on every Plinko ball and every bot so a
 * member can find themselves in a ten-way fight. See
 * `docs/superpowers/specs/2026-08-11-website-design.md`, section 5.
 *
 * `src/config/` is not under the `src/sim/` determinism lint rules, but this file stays
 * pure data plus a validator that runs once at module load — no side effects beyond that
 * one throw.
 */

export interface RosterMember {
  id: string;
  name: string;
  /** Exactly two uppercase characters — first initial, last initial. Rendered on every
   *  Plinko ball and every bot; see `validateRoster`'s uniqueness rule below. */
  initials: string;
  /** A `#RRGGBB` hex string. Shared by a member's Plinko ball and their bot — the one
   *  mechanism that makes a ten-way fight legible at a glance. */
  colour: string;
}

const HEX_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const INITIALS_PATTERN = /^[A-Z]{2}$/;
const REQUIRED_MEMBER_COUNT = 10;

/**
 * The ten members, in league order. `toEventMembers` preserves this order, and it's the
 * order the website should list members in.
 *
 * The colours were adjusted on 17 August after the material textures went on, and the reason
 * is worth keeping: **a texture multiplies, so every bot's apparent colour became its member
 * colour times its own armour's brightness.** Those brightnesses run from 0.47 for depleted
 * uranium to 0.84 for aluminium, which put the ARMOUR on the same channel as the identity.
 * Measured in CIELAB, the closest pair of bots went from 30.8 apart to 7.5 — Vin drew uranium
 * and his white bot rendered as `#787878`, a grey barely distinguishable from Nick Lenker's
 * silver. Nobody could find their machine.
 *
 * That was fixed in two places, and both are needed:
 *
 * - `TEXTURE_STRENGTH` in `render/bot-portrait.ts` draws the flat colour first and the material
 *   over it at partial alpha, which lifts the multiplier range from [0.47, 0.84] to
 *   [0.71, 0.91]. This half was unavoidable: white is already `#ffffff`, so no change to a hex
 *   could have rescued it.
 * - These hexes, chosen by search rather than by eye. A script walked candidate colours within
 *   each member's own hue family — nobody's bot may quietly become a different colour to win a
 *   distance metric — maximising the SMALLEST pairwise CIELAB distance across all ten. That
 *   took the worst pair from 17.3 to 34.0.
 *
 * Two things that search taught, which the previous by-eye pass could not have found:
 *
 * - **Red, orange, gold and yellow are four members on one continuous hue ramp.** Moving any
 *   one of them into a gap simply closes a different gap. The first hand-made attempt fixed
 *   gold-versus-yellow and immediately created orange-versus-gold at exactly the same distance.
 * - **Yellow had to get PALER, not deeper.** With gold pushed bright, a richer yellow collided
 *   with it again — measured at 27.8 against 34.0 for the paler one.
 *
 * Black still needs its light outline at render time, or it vanishes into the floor. That is a
 * rendering requirement this file cannot enforce.
 *
 * These have now had the test that matters — all ten on screen, at bot size, in motion, over
 * the textured floor — which the previous set never had.
 */
export const ROSTER: readonly RosterMember[] = [
  { id: 'paden', name: 'Paden Simmons', initials: 'PS', colour: '#2278FF' }, // Blue — pushed bluer
  { id: 'tommy', name: 'Tommy McCormick', initials: 'TM', colour: '#1C1F26' }, // Black — needs a light outline at render time, see comment above
  { id: 'colby', name: 'Colby Thompson', initials: 'CT', colour: '#E03131' }, // Red
  { id: 'pat', name: 'Pat Driscoll', initials: 'PD', colour: '#2FB344' }, // Green
  { id: 'spencer', name: 'Spencer Lalk', initials: 'SL', colour: '#FB933F' }, // Orange — brighter, away from Red
  { id: 'rob', name: 'Rob Arena', initials: 'RA', colour: '#F8B408' }, // Gold — brighter, away from Orange
  { id: 'erik', name: 'Erik Gundersen', initials: 'EG', colour: '#FF54C8' }, // Hot Pink — pinker, away from Red
  { id: 'nickc', name: 'Nick Cinotti', initials: 'NC', colour: '#FCFB72' }, // Yellow — brighter and PALER, which is what separates it from Gold
  { id: 'vin', name: 'Vin Cinotti', initials: 'VC', colour: '#FFFFFF' }, // White
  { id: 'nickl', name: 'Nick Lenker', initials: 'NL', colour: '#647793' }, // Silver — darkened hard, so White stays white
];

/** Identifies a member in an error message: name, id, and position, so a validation
 *  failure points straight at the offending row without needing to open the file. */
function describe(member: RosterMember, index: number): string {
  const name = member.name.trim().length > 0 ? member.name : '(empty name)';
  return `"${name}" (id "${member.id}", index ${index})`;
}

/** Throws if any two members share a value for `key`, naming both offenders. */
function assertUnique(
  members: readonly RosterMember[],
  key: (member: RosterMember) => string,
  ruleLabel: string,
): void {
  const firstIndexByValue = new Map<string, number>();
  members.forEach((member, index) => {
    const value = key(member);
    const firstIndex = firstIndexByValue.get(value);
    if (firstIndex !== undefined) {
      throw new Error(
        `Roster validation failed (${ruleLabel} must be unique): ${describe(member, index)} ` +
          `shares ${ruleLabel} "${value}" with ${describe(members[firstIndex]!, firstIndex)}.`,
      );
    }
    firstIndexByValue.set(value, index);
  });
}

/**
 * Validates a roster against the seven rules the website depends on, throwing on the
 * first violation found and naming the offending member.
 *
 * Two members sharing initials — or a colour, or an id — would silently render two
 * identical labels or ball colours in a live battle. That kind of collision is nearly
 * impossible to spot on screen once it's live, so it must fail here, loudly, at load,
 * rather than at render.
 */
export function validateRoster(members: readonly RosterMember[]): void {
  if (members.length !== REQUIRED_MEMBER_COUNT) {
    throw new Error(
      `Roster validation failed (exactly ${REQUIRED_MEMBER_COUNT} members required): got ${members.length}.`,
    );
  }

  members.forEach((member, index) => {
    if (member.name.trim().length === 0) {
      throw new Error(`Roster validation failed (name must be non-empty): ${describe(member, index)}.`);
    }
    if (!INITIALS_PATTERN.test(member.initials)) {
      throw new Error(
        `Roster validation failed (initials must be exactly two uppercase characters): ` +
          `${describe(member, index)} has initials "${member.initials}".`,
      );
    }
    if (!HEX_COLOUR_PATTERN.test(member.colour)) {
      throw new Error(
        `Roster validation failed (colour must be a valid #RRGGBB hex): ` +
          `${describe(member, index)} has colour "${member.colour}".`,
      );
    }
  });

  assertUnique(members, (member) => member.id, 'id');
  assertUnique(members, (member) => member.initials, 'initials');
  assertUnique(members, (member) => member.colour, 'colour');
}

validateRoster(ROSTER);

/**
 * Converts roster members to the shape `EventConfig.members` expects, preserving order,
 * id, name and colour. `initials` is dropped — the simulation never reads it; only the
 * website does.
 */
export function toEventMembers(members: readonly RosterMember[] = ROSTER): EventMember[] {
  return members.map(({ id, name, colour }) => ({ id, name, colour }));
}
