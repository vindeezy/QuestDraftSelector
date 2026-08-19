// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { boot } from './boot';
import { runEvent, type EventMember } from '../sim/event/event';
import { loadProgress, recordBeatReached, claimMember } from './progress';
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

    expect(check?.ok).toBe(false);
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

    expect(check?.ok).toBe(true);
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

describe('the ?reset escape hatch', () => {
  // Built from jsdom's own origin rather than hardcoded: `replaceState` refuses to cross
  // origins, and the test environment's URL is not the dev server's.
  const RESET_URL = new URL('/?reset', window.location.href).toString();
  const PLAIN_URL = new URL('/', window.location.href).toString();

  // `claimMember` validates against the real roster, so this uses a real member id rather
  // than the two-member fixture the checksum tests above run on.
  const CLAIMED = 'paden';

  function seedSomeProgress(masterSeed: number): void {
    recordBeatReached(masterSeed, 'name-select');
    claimMember(masterSeed, CLAIMED);
    window.localStorage.setItem(`questDraftSelector:v1:${masterSeed}:hasCompletedOnce`, 'true');
  }

  it('wipes the watch AND the completion unlock, so review starts genuinely fresh', async () => {
    const record = makeValidRecord();
    seedSomeProgress(record.masterSeed);
    window.history.replaceState(null, '', RESET_URL);

    await boot(makeContainer(), record);

    const after = loadProgress(record.masterSeed);
    expect(after.claimedMemberId).toBeNull();
    expect(after.furthestBeat).toBe('landing');
    expect(after.hasCompletedOnce).toBe(false);
  });

  it('strips the parameter from the URL, so a refresh does not wipe progress again', async () => {
    // The trap this guards: leaving `?reset` in the address bar makes the reset sticky.
    // Every reload would wipe progress, so a viewer could never get past the landing screen
    // by refreshing — the first thing anyone tries when a page looks stuck.
    const record = makeValidRecord();
    window.history.replaceState(null, '', RESET_URL);

    await boot(makeContainer(), record);

    expect(new URL(window.location.href).searchParams.has('reset')).toBe(false);
  });

  it('leaves progress alone when the parameter is absent', async () => {
    const record = makeValidRecord();
    window.history.replaceState(null, '', PLAIN_URL);
    seedSomeProgress(record.masterSeed);

    await boot(makeContainer(), record);

    const after = loadProgress(record.masterSeed);
    expect(after.claimedMemberId).toBe(CLAIMED);
    expect(after.hasCompletedOnce).toBe(true);
  });

  it('does not reset when the checksum gate blocks — a bad event stays blocked', async () => {
    // Order matters: resetting before the gate would let `?reset` quietly paper over a
    // mismatched event instead of surfacing it.
    const record = makeValidRecord();
    seedSomeProgress(record.masterSeed);
    window.history.replaceState(null, '', RESET_URL);

    const check = await boot(makeContainer(), { ...record, checksum: 'wrong' });

    expect(check?.ok).toBe(false);
    expect(loadProgress(record.masterSeed).claimedMemberId).toBe(CLAIMED);
  });
});

describe('the removed ?sounds route', () => {
  // The sound lab was a listening tool for one person, mounted at `?sounds`, and FIN 1
  // deleted it. This is the test that used to prove it mounted, inverted to prove it no
  // longer does — kept rather than deleted because the interesting risk did not leave with
  // the lab. Somebody has that URL in their history, and an unknown query parameter has to
  // be ignored on the way to the walkthrough rather than mounting nothing and leaving a
  // blank screen on draft night.
  it('falls through to the normal walkthrough instead of mounting anything', async () => {
    const container = makeContainer();
    window.history.replaceState(null, '', '/?sounds');

    const check = await boot(container);

    // A real gate result, not null: the checksum gate now runs like any other visit.
    expect(check?.ok).toBe(true);
    expect(container.querySelector('.lab')).toBeNull();
    expect(container.dataset.beat).toBeDefined();

    window.history.replaceState(null, '', '/');
  });
});
