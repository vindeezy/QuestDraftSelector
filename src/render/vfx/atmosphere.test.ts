import { describe, it, expect } from 'vitest';
import type { Effect, EffectKind } from '../../sim/arena/effects';
import {
  CALM,
  GLOW_CEILING,
  GLOW_DECAY_SECONDS,
  absorb,
  closingIn,
  fade,
} from './atmosphere';

const fx = (kind: EffectKind, intensity = 1): Effect => ({
  kind,
  x: 0,
  y: 0,
  intensity,
  botId: 'bot-0',
});

describe('what lights the room', () => {
  it('is lit hardest, and reddest, by an elimination', () => {
    const elim = absorb(CALM, [fx('elimination')]);
    const hit = absorb(CALM, [fx('weaponHit')]);
    expect(elim.glow).toBeGreaterThan(hit.glow);
    expect(elim.heat).toBe(1);
    expect(hit.heat).toBe(0);
  });

  it('ignores collisions entirely', () => {
    // Bots collide roughly eight hundred times a battle. A room that pulsed on every one of
    // them would be a room with a fault in the wiring.
    expect(absorb(CALM, [fx('collision')])).toEqual(CALM);
  });

  it('takes the strongest event of the frame rather than adding them up', () => {
    // Three eliminations at once is a bigger moment, not three times the light — the same
    // rule `shake` follows in the renderer.
    const many = absorb(CALM, [fx('elimination'), fx('elimination'), fx('elimination')]);
    const one = absorb(CALM, [fx('elimination')]);
    expect(many.glow).toBeCloseTo(one.glow, 6);
  });

  it('never exceeds its ceiling, whatever arrives', () => {
    const hammered = absorb(CALM, Array.from({ length: 40 }, () => fx('elimination', 5)));
    expect(hammered.glow).toBeLessThanOrEqual(GLOW_CEILING);
  });

  it('scales with how hard the event was', () => {
    expect(absorb(CALM, [fx('hazardHit', 0.2)]).glow)
      .toBeLessThan(absorb(CALM, [fx('hazardHit', 1)]).glow);
  });

  it('does not let a weak event dim a bright one still burning', () => {
    const bright = absorb(CALM, [fx('elimination')]);
    const after = absorb(bright, [fx('weaponHit', 0.1)]);
    expect(after.glow).toBe(bright.glow);
    expect(after.heat).toBe(1);
  });
});

describe('going out', () => {
  it('fades to nothing within its decay window', () => {
    const lit = absorb(CALM, [fx('elimination')]);
    expect(fade(lit, GLOW_DECAY_SECONDS).glow).toBe(0);
  });

  it('stays red as it goes out rather than cooling through orange', () => {
    // Cooling on the way down would read as a second, different event.
    const lit = absorb(CALM, [fx('elimination')]);
    const dimming = fade(lit, GLOW_DECAY_SECONDS / 3);
    expect(dimming.glow).toBeGreaterThan(0);
    expect(dimming.heat).toBe(1);
  });

  it('drops heat only once the light is actually gone', () => {
    const lit = absorb(CALM, [fx('elimination')]);
    expect(fade(lit, GLOW_DECAY_SECONDS * 2)).toEqual({ glow: 0, heat: 0 });
  });

  it('ignores a nonsense delta instead of jumping', () => {
    const lit = absorb(CALM, [fx('elimination')]);
    expect(fade(lit, Number.NaN)).toEqual(lit);
    expect(fade(lit, -1)).toEqual(lit);
  });
});

describe('the room closing in', () => {
  it('is full at the start and dimmest at the last pair', () => {
    expect(closingIn(10, 10)).toBeCloseTo(1, 6);
    expect(closingIn(2, 10)).toBeCloseTo(0.55, 6);
  });

  it('darkens monotonically as the floor empties', () => {
    let previous = Infinity;
    for (let living = 10; living >= 2; living--) {
      const value = closingIn(living, 10);
      expect(value, `${living} alive`).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('never goes dark enough to hide the room', () => {
    for (let living = 10; living >= 0; living--) {
      expect(closingIn(living, 10)).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('does nothing in a match too small to have a run of eliminations', () => {
    expect(closingIn(2, 2)).toBe(1);
    expect(closingIn(1, 1)).toBe(1);
  });
});
