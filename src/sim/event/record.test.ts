import { describe, it, expect } from 'vitest';
import { createRecord, verifyRecord } from './record';
import type { EventMember } from './event';

function makeMembers(count = 10): EventMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    name: `Member ${i + 1}`,
    colour: '#336699',
  }));
}

const baseInput = {
  leagueId: 'league-1',
  label: 'Test event',
  masterSeed: 42,
  recordedAt: '2026-08-05T00:00:00.000Z',
};

describe('createRecord / verifyRecord', () => {
  it(
    'a fresh record verifies',
    () => {
      const record = createRecord({ ...baseInput, members: makeMembers() });
      const check = verifyRecord(record);
      expect(check.valid).toBe(true);
      expect(check.actualChecksum).toBe(record.checksum);
    },
    30000,
  );

  it(
    'a record whose checksum is corrupted fails verification',
    () => {
      const record = createRecord({ ...baseInput, members: makeMembers() });
      const corrupted = { ...record, checksum: 'deadbeef' };
      expect(verifyRecord(corrupted).valid).toBe(false);
    },
    30000,
  );

  it(
    'verifies identically on repeat runs',
    () => {
      const record = createRecord({ ...baseInput, members: makeMembers() });
      const first = verifyRecord(record);
      const second = verifyRecord(record);
      expect(first).toEqual(second);
    },
    60000,
  );

  it(
    'changing the roster changes the checksum',
    () => {
      const membersA = makeMembers();
      const membersB = makeMembers();
      membersB[0] = { ...membersB[0]!, id: 'someone-else', name: 'A Different Member' };

      const recordA = createRecord({ ...baseInput, members: membersA });
      const recordB = createRecord({ ...baseInput, members: membersB });

      expect(recordA.checksum).not.toBe(recordB.checksum);
      // The record recorded for roster A must not verify against roster B either.
      expect(verifyRecord({ ...recordA, members: membersB }).valid).toBe(false);
    },
    60000,
  );
});
