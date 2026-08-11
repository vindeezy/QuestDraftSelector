import { describe, it, expect } from 'vitest';
import { ROSTER } from '../config/roster';
import { officialRecord } from './checksum-gate';

/**
 * The recorded event carries its own copy of the roster, and the checksum gate verifies
 * the record against THAT copy rather than against `src/config/roster.ts`. That is the
 * right call — the gate's job is to prove the recorded event still reproduces, and it
 * should not fail merely because someone renamed a member.
 *
 * But it leaves a gap this test closes. The site reads names and colours from two places:
 * the name-select screen offers `ROSTER`, while the battles show whoever the record was
 * drawn for. If those drift apart, a member picks "Vin Cinotti" and then watches a bot
 * labelled something else — the checksum still passes, the site still loads, and the only
 * symptom is that the event is quietly about the wrong people.
 *
 * That is exactly what happened once: the first official record was saved before
 * `src/config/roster.ts` existed, so it held ten generated "Member N" placeholders.
 * Nothing caught it. Re-record with `npm run record -- --save <seed>` if this fails.
 */
describe('the official record and the roster config', () => {
  it('describe the same ten people, in the same order', () => {
    const record = officialRecord();
    expect(record.members.length).toBe(ROSTER.length);

    record.members.forEach((recorded, i) => {
      const configured = ROSTER[i]!;
      expect(recorded.id).toBe(configured.id);
      expect(recorded.name).toBe(configured.name);
      expect(recorded.colour).toBe(configured.colour);
    });
  });

  it('contains no placeholder names', () => {
    // The specific shape the stale record had, called out by name so a regression is
    // recognisable rather than just "a test failed".
    for (const member of officialRecord().members) {
      expect(member.name).not.toMatch(/^Member \d+$/);
    }
  });
});
