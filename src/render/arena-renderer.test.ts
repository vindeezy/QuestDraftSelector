import { describe, it, expect } from 'vitest';
import { DARK_BOT_LUMINANCE, killFeedLine, needsBrightOutline, resolveBotVisual } from './arena-renderer';
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
