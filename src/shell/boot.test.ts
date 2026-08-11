// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { boot } from './boot';
import { runEvent, type EventMember } from '../sim/event/event';
import type { EventRecord } from '../sim/event/record';

const MEMBERS: EventMember[] = [
  { id: 'a', name: 'Alpha', colour: '#e6194b' },
  { id: 'b', name: 'Bravo', colour: '#3cb44b' },
];

function makeValidRecord(): EventRecord {
  const masterSeed = 555;
  const result = runEvent({ masterSeed, members: MEMBERS });
  return {
    version: 1,
    leagueId: 'test-league',
    label: 'test record',
    masterSeed,
    members: MEMBERS,
    checksum: result.checksum,
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('boot', () => {
  it('a checksum mismatch blocks with an error instead of rendering the event', async () => {
    const record = makeValidRecord();
    const brokenRecord: EventRecord = { ...record, checksum: 'not-the-real-checksum' };
    const container = makeContainer();

    const check = await boot(container, brokenRecord);

    expect(check.ok).toBe(false);
    expect(container.querySelector('.gate--error')).not.toBeNull();
    expect(container.textContent).toContain("Something's not right");
    // The event itself must never render behind (or instead of) the error.
    expect(container.dataset.beat).toBeUndefined();
    expect(container.querySelector('.screen')).toBeNull();
  });

  it('a matching checksum mounts the router instead of an error', async () => {
    const record = makeValidRecord();
    const container = makeContainer();

    const check = await boot(container, record);

    expect(check.ok).toBe(true);
    expect(container.querySelector('.gate--error')).toBeNull();
    expect(container.dataset.beat).toBe('landing');
  });

  it('shows a loading state before the check resolves', () => {
    const record = makeValidRecord();
    const container = makeContainer();

    void boot(container, record);

    // Synchronous read, before the returned promise has had a chance to resolve.
    expect(container.querySelector('.gate--loading')).not.toBeNull();
    expect(container.textContent).toContain('Assembling the event');
  });
});
