import { describe, it, expect } from 'vitest';
import { checkRecord, officialRecord, checkOfficialRecord } from './checksum-gate';
import { runEvent, type EventMember } from '../sim/event/event';
import type { EventRecord } from '../sim/event/record';

const MEMBERS: EventMember[] = [
  { id: 'a', name: 'Alpha', colour: '#e6194b' },
  { id: 'b', name: 'Bravo', colour: '#3cb44b' },
  { id: 'c', name: 'Charlie', colour: '#ffe119' },
];

function makeRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  const masterSeed = overrides.masterSeed ?? 12345;
  const members = overrides.members ?? MEMBERS;
  const result = runEvent({ masterSeed, members });
  return {
    version: 1,
    leagueId: 'test-league',
    label: 'test record',
    masterSeed,
    members,
    checksum: result.checksum,
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('checkRecord', () => {
  it('agrees when the recorded checksum matches a fresh run of the same seed and roster', () => {
    const record = makeRecord();
    const check = checkRecord(record);
    expect(check.ok).toBe(true);
    expect(check.actualChecksum).toBe(check.expectedChecksum);
    expect(check.record).toBe(record);
  });

  it('disagrees when the checksum field has been tampered with', () => {
    const record = makeRecord({ checksum: 'deadbeef' });
    const check = checkRecord(record);
    expect(check.ok).toBe(false);
    expect(check.expectedChecksum).toBe('deadbeef');
    expect(check.actualChecksum).not.toBe('deadbeef');
  });

  it('disagrees when the roster embedded in the record no longer matches what produced the checksum', () => {
    // Build a record honestly, then swap in a different roster afterwards -- standing
    // in for `src/sim/` changing (or the record being edited) after the fact, which is
    // exactly the case the gate exists to catch.
    const honest = makeRecord();
    const tampered: EventRecord = {
      ...honest,
      members: [...MEMBERS.slice(0, 2), { id: 'd', name: 'Delta', colour: '#4363d8' }],
    };
    const check = checkRecord(tampered);
    expect(check.ok).toBe(false);
  });
});

describe('officialRecord', () => {
  it('loads a structurally valid EventRecord from data/official-event.json', () => {
    const record = officialRecord();
    expect(record.version).toBe(1);
    expect(Number.isInteger(record.masterSeed)).toBe(true);
    expect(record.masterSeed).toBeGreaterThan(0);
    expect(record.members).toHaveLength(10);
    expect(typeof record.checksum).toBe('string');
    expect(record.checksum.length).toBeGreaterThan(0);
  });
});

describe('checkOfficialRecord', () => {
  it('checks the same record officialRecord() returns, deterministically', () => {
    // Not asserting `ok` either way here: whether the shipped record currently
    // verifies is a fact about `data/official-event.json`'s contents (an admin
    // artifact), not about this function's logic -- that's covered by `checkRecord`'s
    // own tests above with fixtures this suite controls. What must hold regardless is
    // that checking the same record twice agrees with itself.
    const first = checkOfficialRecord();
    const second = checkOfficialRecord();
    expect(second.ok).toBe(first.ok);
    expect(second.actualChecksum).toBe(first.actualChecksum);
    expect(first.record).toEqual(officialRecord());
  });
});
