import { describe, it, expect } from 'vitest';
import { ROSTER, validateRoster, toEventMembers, type RosterMember } from './roster';

/** A mutable, deep-enough copy of the real roster to mutate one field at a time without
 *  touching `ROSTER` itself. */
function cloneRoster(): RosterMember[] {
  return ROSTER.map((member) => ({ ...member }));
}

describe('ROSTER', () => {
  it('has exactly ten members', () => {
    expect(ROSTER.length).toBe(10);
  });

  it('passes its own validation (already proven by module load, asserted here too)', () => {
    expect(() => validateRoster(ROSTER)).not.toThrow();
  });

  it('has unique initials across all ten members', () => {
    const initials = ROSTER.map((member) => member.initials);
    expect(new Set(initials).size).toBe(initials.length);
  });

  it('has unique ids across all ten members', () => {
    const ids = ROSTER.map((member) => member.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique colours across all ten members', () => {
    const colours = ROSTER.map((member) => member.colour);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('keeps the two Nicks distinct', () => {
    const nickc = ROSTER.find((member) => member.id === 'nickc');
    const nickl = ROSTER.find((member) => member.id === 'nickl');
    expect(nickc?.name).toBe('Nick Cinotti');
    expect(nickl?.name).toBe('Nick Lenker');
    expect(nickc?.initials).toBe('NC');
    expect(nickl?.initials).toBe('NL');
    expect(nickc?.id).not.toBe(nickl?.id);
  });
});

describe('validateRoster', () => {
  it('rejects a roster that does not have exactly ten members', () => {
    const tooFew = cloneRoster().slice(0, 9);
    expect(() => validateRoster(tooFew)).toThrow(/exactly 10 members/);
  });

  it('rejects a roster with a duplicate id', () => {
    const bad = cloneRoster();
    bad[1] = { ...bad[1]!, id: bad[0]!.id };
    expect(() => validateRoster(bad)).toThrow(/id must be unique/);
    expect(() => validateRoster(bad)).toThrow(/Tommy McCormick/);
  });

  it('rejects a roster with duplicate initials', () => {
    const bad = cloneRoster();
    bad[1] = { ...bad[1]!, initials: bad[0]!.initials };
    expect(() => validateRoster(bad)).toThrow(/initials must be unique/);
    expect(() => validateRoster(bad)).toThrow(/Tommy McCormick/);
  });

  it('rejects a roster with a duplicate colour', () => {
    const bad = cloneRoster();
    bad[1] = { ...bad[1]!, colour: bad[0]!.colour };
    expect(() => validateRoster(bad)).toThrow(/colour must be unique/);
    expect(() => validateRoster(bad)).toThrow(/Tommy McCormick/);
  });

  it('rejects initials that are not exactly two uppercase characters', () => {
    const bad = cloneRoster();
    bad[0] = { ...bad[0]!, initials: 'ps' };
    expect(() => validateRoster(bad)).toThrow(/exactly two uppercase characters/);
    expect(() => validateRoster(bad)).toThrow(/Paden Simmons/);
  });

  it('rejects a colour that is not a valid #RRGGBB hex', () => {
    const bad = cloneRoster();
    bad[0] = { ...bad[0]!, colour: 'blue' };
    expect(() => validateRoster(bad)).toThrow(/valid #RRGGBB hex/);
    expect(() => validateRoster(bad)).toThrow(/Paden Simmons/);
  });

  it('rejects an empty name', () => {
    const bad = cloneRoster();
    bad[0] = { ...bad[0]!, name: '' };
    expect(() => validateRoster(bad)).toThrow(/name must be non-empty/);
    expect(() => validateRoster(bad)).toThrow(/id "paden"/);
  });
});

describe('toEventMembers', () => {
  it('preserves order, id, name and colour', () => {
    const eventMembers = toEventMembers(ROSTER);
    expect(eventMembers.map((member) => member.id)).toEqual(ROSTER.map((member) => member.id));
    expect(eventMembers).toEqual(
      ROSTER.map(({ id, name, colour }) => ({ id, name, colour })),
    );
  });

  it('defaults to the real roster when called with no argument', () => {
    expect(toEventMembers()).toEqual(toEventMembers(ROSTER));
  });

  it('drops initials, which EventMember does not carry', () => {
    const eventMembers = toEventMembers(ROSTER);
    for (const member of eventMembers) {
      expect(member).not.toHaveProperty('initials');
    }
  });
});
