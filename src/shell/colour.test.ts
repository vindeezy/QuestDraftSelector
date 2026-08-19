import { describe, it, expect } from 'vitest';
import { ROSTER } from '../config/roster';
import { isDarkColour, readableInkFor } from './colour';

/** WCAG relative luminance and contrast, duplicated here on purpose: a test that imports the
 *  implementation's own maths would agree with it however wrong it is. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('ink on a member swatch', () => {
  it('clears 4.5:1 for every member in the roster', () => {
    // The invariant, and the one the previous rule broke. Initials on a swatch are small
    // bold text, so 4.5 applies rather than the 3.0 large-text allowance.
    for (const member of ROSTER) {
      const ratio = contrast(readableInkFor(member.colour), member.colour);
      expect(ratio, `${member.id} (${member.colour})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks the better of the two inks, not the one a luma threshold suggests', () => {
    // Pat's green is the case that exposed it: luma 0.497, a hair under the old 0.55 line,
    // so the threshold took the LIGHT ink and landed at 2.56:1. Measured directly, dark ink
    // on that green is 7.04. This asserts the choice is made by measurement.
    const pat = ROSTER.find((m) => m.id === 'pat')!;
    const chosen = readableInkFor(pat.colour);
    const other = chosen === '#000000' ? '#ffffff' : '#000000';
    expect(contrast(chosen, pat.colour)).toBeGreaterThan(contrast(other, pat.colour));
    expect(contrast(chosen, pat.colour)).toBeGreaterThan(4.5);
  });

  it('never returns anything but the two inks it measured', () => {
    for (const member of ROSTER) {
      expect(['#000000', '#ffffff']).toContain(readableInkFor(member.colour));
    }
  });

  it('puts dark ink on the bright members and light ink on the dark ones', () => {
    // A sanity check that the comparison has not been inverted: whatever the maths, white
    // text must not end up on Vin's white bot.
    expect(readableInkFor('#ffffff')).toBe('#000000');
    expect(readableInkFor('#000000')).toBe('#ffffff');
    const vin = ROSTER.find((m) => m.id === 'vin')!;
    const tommy = ROSTER.find((m) => m.id === 'tommy')!;
    expect(readableInkFor(vin.colour)).toBe('#000000');
    expect(readableInkFor(tommy.colour)).toBe('#ffffff');
  });
});

describe('which swatches need a ring', () => {
  it('catches the darkest member and nobody else', () => {
    // The ring exists so a near-black swatch reads as a colour rather than a hole. Exactly
    // one roster colour should need it; if a second ever does, the palette drifted dark.
    const ringed = ROSTER.filter((m) => isDarkColour(m.colour));
    expect(ringed.map((m) => m.id)).toEqual(['tommy']);
  });
});
