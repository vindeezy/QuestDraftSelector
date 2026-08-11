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
 * The colours are first-draft values, deliberately adjusted from the plain named colour
 * where the plain version risked being confusable with another member's in motion at
 * small size. Record here, not just in a commit message, because the next person to touch
 * this file needs to know these hexes are not arbitrary:
 *
 * - **Black (`#1C1F26`)** sits on the arena's dark slate floor (`#35424f`). The hex alone
 *   is not enough to keep it legible there — it needs a light outline applied at render
 *   time, or it disappears into the background. That outline is a rendering requirement
 *   this file cannot enforce; note it here so whoever wires bot/ball tinting doesn't skip
 *   it for this one member.
 * - **Gold (`#D9A520`) and Yellow (`#FFE81F`)** were pushed apart deliberately. The plain
 *   named versions of gold and yellow sit close enough in hue that at 40-unit bot size, in
 *   motion, they read as the same colour.
 * - **White (`#FFFFFF`) and Silver (`#9FB0C0`)** have the same problem for the same
 *   reason — silver here is cooled and darkened so it reads as its own colour rather than
 *   a dirty white.
 *
 * These are first-draft values. The only test that matters for them is looking at all ten
 * colours together on screen, at actual bot size, in motion — not as static swatches — and
 * that check has not been done yet. Revisit these hexes once it has.
 */
export const ROSTER: readonly RosterMember[] = [
  { id: 'paden', name: 'Paden Simmons', initials: 'PS', colour: '#2E6FF2' }, // Blue
  { id: 'tommy', name: 'Tommy McCormick', initials: 'TM', colour: '#1C1F26' }, // Black — needs a light outline at render time, see comment above
  { id: 'colby', name: 'Colby Thompson', initials: 'CT', colour: '#E03131' }, // Red
  { id: 'pat', name: 'Pat Driscoll', initials: 'PD', colour: '#2FB344' }, // Green
  { id: 'spencer', name: 'Spencer Lalk', initials: 'SL', colour: '#FF7A18' }, // Orange
  { id: 'rob', name: 'Rob Arena', initials: 'RA', colour: '#D9A520' }, // Gold — pushed apart from Yellow, see comment above
  { id: 'erik', name: 'Erik Gundersen', initials: 'EG', colour: '#FF3FA4' }, // Hot Pink
  { id: 'nickc', name: 'Nick Cinotti', initials: 'NC', colour: '#FFE81F' }, // Yellow — pushed apart from Gold, see comment above
  { id: 'vin', name: 'Vin Cinotti', initials: 'VC', colour: '#FFFFFF' }, // White
  { id: 'nickl', name: 'Nick Lenker', initials: 'NL', colour: '#9FB0C0' }, // Silver — cooled/darkened from plain silver, see comment above
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
