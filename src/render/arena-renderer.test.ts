// @vitest-environment jsdom
//
// Not for the DOM — every test below is a pure function. It is for the IMPORT: this file
// reaches `src/render/`, which pulls in pixi.js, and pixi touches `navigator` at module
// load. Node only defines `navigator` globally from v21, so under vitest's default `node`
// environment this file passes on a modern local Node and dies on CI's Node 20 with
// `ReferenceError: navigator is not defined`. jsdom supplies the global and makes the
// result independent of whichever Node is running.
import { describe, it, expect } from 'vitest';
import {
  DARK_BOT_LUMINANCE,
  healthBarColour,
  killFeedLine,
  needsBrightOutline,
  resolveBotVisual,
} from './arena-renderer';
import { ROSTER } from '../config/roster';

/**
 * These are the pure, DOM/WebGL-free pieces of `arena-renderer.ts` — the visual-identity
 * resolution rule and the kill feed's line-building — pulled out specifically so they can
 * be checked directly under plain jsdom (which has no WebGL context, so `createArenaRenderer`
 * itself cannot be exercised here; see `canvasSupportsWebGL`). Same split `forge.ts` uses
 * for `slotLabelsFor`/`stepForgeRun` versus the renderer-mounting code around them.
 */

function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** The module's own `luminance` is private; this mirrors it so the tests can state their
 *  expectations in terms of brightness rather than opaque hex values. */
function luminanceOf(colour: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

describe('resolveBotVisual', () => {
  it('returns the supplied visual for that index when one exists', () => {
    const visuals = [
      { colour: 0x123456, label: 'AB' },
      { colour: 0x654321, label: 'CD' },
    ];
    expect(resolveBotVisual(0, visuals)).toEqual(visuals[0]);
    expect(resolveBotVisual(1, visuals)).toEqual(visuals[1]);
  });

  it('falls back to a placeholder colour and a 1-based index label when no visuals are supplied', () => {
    const visual = resolveBotVisual(4, undefined);
    expect(visual.label).toBe('5');
    expect(Number.isInteger(visual.colour)).toBe(true);
  });

  it('falls back the same way when a visuals array is supplied but this index is missing from it', () => {
    const visual = resolveBotVisual(2, []);
    expect(visual.label).toBe('3');
  });
});

describe('needsBrightOutline / DARK_BOT_LUMINANCE', () => {
  it("is true for Tommy's near-black roster colour — the one member the design spec calls out by name", () => {
    const tommy = ROSTER.find((member) => member.id === 'tommy')!;
    expect(needsBrightOutline(hexToNumber(tommy.colour))).toBe(true);
  });

  it('is false for a bright roster colour', () => {
    const vin = ROSTER.find((member) => member.id === 'vin')!; // white
    expect(needsBrightOutline(hexToNumber(vin.colour))).toBe(false);
  });

  it('the threshold sits strictly between black and white', () => {
    expect(DARK_BOT_LUMINANCE).toBeGreaterThan(0);
    expect(DARK_BOT_LUMINANCE).toBeLessThan(1);
  });
});

describe('healthBarColour', () => {
  it('leaves a colour that is already bright enough completely untouched', () => {
    for (const id of ['vin', 'nickc', 'spencer']) {
      const colour = hexToNumber(ROSTER.find((member) => member.id === id)!.colour);
      expect(healthBarColour(colour)).toBe(colour);
    }
  });

  it("lifts Tommy's near-black colour to something actually visible on a 4px bar", () => {
    const tommy = hexToNumber(ROSTER.find((member) => member.id === 'tommy')!.colour);
    expect(healthBarColour(tommy)).not.toBe(tommy);
    expect(luminanceOf(healthBarColour(tommy))).toBeGreaterThan(luminanceOf(tommy));
  });

  it('guarantees every roster colour clears the legibility floor — the point of the helper', () => {
    for (const member of ROSTER) {
      const bar = healthBarColour(hexToNumber(member.colour));
      // Rounding to whole channels can land a hair under the target; a fraction of a
      // percent of brightness is not what makes a bar readable, so allow for it.
      expect(luminanceOf(bar)).toBeGreaterThan(0.44);
    }
  });

  it('handles pure black, which cannot be brightened by scaling at all', () => {
    // Scaling multiplies channels, so 0x000000 is a fixed point and only the blend
    // toward white can rescue it. No member is pure black today, but the helper must not
    // silently return an invisible bar if one ever is.
    expect(luminanceOf(healthBarColour(0x000000))).toBeGreaterThan(0.44);
  });

  it('stays within valid 24-bit colour range for every roster colour', () => {
    for (const member of ROSTER) {
      const bar = healthBarColour(hexToNumber(member.colour));
      expect(bar).toBeGreaterThanOrEqual(0);
      expect(bar).toBeLessThanOrEqual(0xffffff);
      expect(Number.isInteger(bar)).toBe(true);
    }
  });
});

describe('killFeedLine', () => {
  const labelFor = (botId: string): string => ({ 'bot-0': 'PS', 'bot-1': 'TM' })[botId] ?? '?';

  it('reads a fall as unattributed, worded distinctly from a hazard kill', () => {
    expect(killFeedLine({ botId: 'bot-0', cause: 'fell', byId: null }, labelFor)).toBe('PS fell');
  });

  it('reads an unattributed "destroyed" (a hazard kill — byId null, cause destroyed) distinctly from a fall', () => {
    const line = killFeedLine({ botId: 'bot-0', cause: 'destroyed', byId: null }, labelFor);
    expect(line).toBe('PS destroyed');
    expect(line).not.toContain('fell');
    expect(line).not.toContain('by');
  });

  it('attributes a bot-caused kill to the attacker', () => {
    expect(killFeedLine({ botId: 'bot-0', cause: 'destroyed', byId: 'bot-1' }, labelFor)).toBe(
      'PS eliminated by TM',
    );
  });
});
