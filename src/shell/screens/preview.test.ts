// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ROSTER } from '../../config/roster';
import { anonymiseFor } from '../../config/anonymise';
import { mountPreview, nextPreviewHref, parsePreviewRequest, previewVisuals } from './preview';

const SEED_A = 43000236;
const SEED_B = 21000073;

describe('parsePreviewRequest', () => {
  it('returns null when no preview is asked for', () => {
    expect(parsePreviewRequest('')).toBeNull();
    expect(parsePreviewRequest('?reset')).toBeNull();
  });

  it('reads the seed and defaults to the first battle', () => {
    expect(parsePreviewRequest(`?preview=${SEED_A}`)).toEqual({ seed: SEED_A, battleIndex: 0 });
  });

  it('reads a battle number as a 0-based index', () => {
    expect(parsePreviewRequest(`?preview=${SEED_A}&battle=2`)).toEqual({ seed: SEED_A, battleIndex: 1 });
    expect(parsePreviewRequest(`?preview=${SEED_A}&battle=3`)).toEqual({ seed: SEED_A, battleIndex: 2 });
  });

  it('falls back to the first battle on a nonsense battle number, rather than refusing', () => {
    for (const bad of ['0', '4', 'x', '-1', '2.5']) {
      expect(parsePreviewRequest(`?preview=${SEED_A}&battle=${bad}`)).toEqual({ seed: SEED_A, battleIndex: 0 });
    }
  });

  it('refuses a seed that is not a positive integer', () => {
    for (const bad of ['0', '-5', 'abc', '', '1.5']) {
      expect(parsePreviewRequest(`?preview=${bad}`)).toBeNull();
    }
  });
});

describe('previewVisuals', () => {
  it('labels entrants with the same A-J shuffle the seed reports use', () => {
    const expected = anonymiseFor(SEED_A, ROSTER.length);
    expect(previewVisuals(SEED_A, ROSTER.length).map((v) => v.label)).toEqual(expected);
  });

  it('gives every entrant a distinct letter and colour', () => {
    const visuals = previewVisuals(SEED_A, ROSTER.length);
    expect(new Set(visuals.map((v) => v.label)).size).toBe(ROSTER.length);
    expect(new Set(visuals.map((v) => v.colour)).size).toBe(ROSTER.length);
  });

  it('never uses a roster colour — those would name half the field on sight', () => {
    const roster = new Set(ROSTER.map((m) => parseInt(m.colour.slice(1), 16)));
    for (const visual of previewVisuals(SEED_A, ROSTER.length)) {
      expect(roster.has(visual.colour)).toBe(false);
    }
  });

  it('shuffles differently per seed, so a letter means nothing across candidates', () => {
    expect(previewVisuals(SEED_A, ROSTER.length).map((v) => v.label)).not.toEqual(
      previewVisuals(SEED_B, ROSTER.length).map((v) => v.label),
    );
  });
});

describe('nextPreviewHref', () => {
  it('walks battles 1 -> 2 -> 3 within a seed', () => {
    expect(nextPreviewHref({ seed: SEED_A, battleIndex: 0 }, [])).toBe(`?preview=${SEED_A}&battle=2`);
    expect(nextPreviewHref({ seed: SEED_A, battleIndex: 1 }, [])).toBe(`?preview=${SEED_A}&battle=3`);
  });

  it('rolls on to the other candidate after the third battle', () => {
    expect(nextPreviewHref({ seed: SEED_A, battleIndex: 2 }, [SEED_A, SEED_B])).toBe(`?preview=${SEED_B}&battle=1`);
  });

  it('stops when there is nowhere left to go', () => {
    expect(nextPreviewHref({ seed: SEED_A, battleIndex: 2 }, [SEED_A])).toBeNull();
  });
});

describe('mountPreview', () => {
  const mount = (battleIndex: number) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const teardown = mountPreview(container, { seed: SEED_A, battleIndex }, [SEED_A, SEED_B]);
    return { container, teardown };
  };

  it('names the seed and battle without naming a single member', () => {
    const { container, teardown } = mount(0);
    const text = container.textContent ?? '';
    expect(text).toContain(String(SEED_A));
    expect(text).toContain('battle 1 of 3');
    for (const member of ROSTER) {
      expect(text, `leaked ${member.name}`).not.toContain(member.name);
      // Initials are matched as standalone words, not as substrings: "BEGIN" contains
      // "EG", and a naive `toContain` fails on the button label rather than on a leak.
      expect(new RegExp(`\\b${member.initials}\\b`).test(text), `leaked ${member.initials}`).toBe(false);
    }
    teardown();
  });

  it('waits behind a BEGIN gate rather than starting on its own', () => {
    const { container, teardown } = mount(0);
    expect(container.querySelector('[data-role="begin"]')).not.toBeNull();
    teardown();
  });

  it('offers the next battle, hidden until the current one finishes', () => {
    const { container, teardown } = mount(0);
    const next = container.querySelector<HTMLAnchorElement>('[data-role="next"]')!;
    expect(next.getAttribute('href')).toBe(`?preview=${SEED_A}&battle=2`);
    expect(next.classList.contains('is-hidden')).toBe(true);
    teardown();
  });

  it('rolls on to the other candidate from the last battle', () => {
    const { container, teardown } = mount(2);
    expect(container.querySelector<HTMLAnchorElement>('[data-role="next"]')!.getAttribute('href')).toBe(
      `?preview=${SEED_B}&battle=1`,
    );
    teardown();
  });

  it('tears down cleanly without having started', () => {
    const { teardown } = mount(1);
    expect(() => teardown()).not.toThrow();
  });
});
