import { describe, it, expect } from 'vitest';
import { createAudioBus } from './context';
import { PALETTE, SOUND_IDS, TARGET_PEAK, VOICE_TRIM, playSound, type SoundId } from './palette';

/**
 * What a sound SOUNDS like cannot be tested here — that is the sound lab's job, and the
 * whole reason the lab is built before any of this is wired into a battle.
 *
 * What can be tested is the contract every consumer relies on: the registry is complete and
 * unique, and every voice survives being called on a bus that has no context. That second
 * one matters more than it looks. A viewer who never presses BEGIN, or a browser that
 * refuses to construct an AudioContext, must still get a working walkthrough — so a voice
 * has to be a silent no-op rather than a thrown error inside an animation frame.
 */

/** A bus that was never unlocked: `ctx` and `masterGain` are both null. */
function silentBus() {
  return createAudioBus({
    factory: () => {
      throw new Error('no audio in this test');
    },
  });
}

describe('the palette registry', () => {
  it('lists every voice exactly once', () => {
    expect(SOUND_IDS.length).toBe(new Set(SOUND_IDS).size);
    expect(SOUND_IDS.length).toBe(Object.keys(PALETTE).length);
  });

  it('has a voice for every id it advertises', () => {
    for (const id of SOUND_IDS) {
      expect(typeof PALETTE[id], id).toBe('function');
    }
  });

  it('covers every weapon, ability and hazard family the classifier will need', () => {
    // Named explicitly rather than counted, so deleting a voice that SND 5 depends on fails
    // here with the missing name rather than later with a silent fallback.
    const required: SoundId[] = [
      // one per weapon
      'crushingBlow', 'sawBuzz', 'barSmash', 'spinnerBite', 'flameWhoosh', 'heavyClang',
      // one per ability
      'electricZap', 'nitroWhoosh', 'oilSplat', 'shockwaveBoom', 'repairChime',
      'adrenalineRise', 'smokeHiss',
      // one per hazard family
      'flameBillow', 'sawGrind', 'crusherSlam', 'shellImpact',
      // general
      'metallicTick', 'dullThud', 'explosion', 'deepBoom', 'mechanicalClunk', 'pegPing',
    ];
    for (const id of required) {
      expect(SOUND_IDS, `${id} is missing from the palette`).toContain(id);
    }
  });
});

describe('playing on a bus with no context', () => {
  it('never throws, for any voice, at any intensity', () => {
    const bus = silentBus();
    bus.unlock(); // the factory throws; the bus stays silent by design

    for (const id of SOUND_IDS) {
      for (const intensity of [0, 0.5, 1]) {
        expect(() => playSound(bus, id, { intensity, pan: 0.5, pitch: 0.5 }), id).not.toThrow();
      }
    }
  });

  it('never throws when called with no options at all', () => {
    const bus = silentBus();
    for (const id of SOUND_IDS) {
      expect(() => playSound(bus, id), id).not.toThrow();
    }
  });

  it('tolerates out-of-range values rather than trusting the caller', () => {
    const bus = silentBus();
    expect(() => playSound(bus, 'metallicTick', { intensity: 9, pan: -12, pitch: 4 })).not.toThrow();
    expect(() => playSound(bus, 'pegPing', { pitch: -1 })).not.toThrow();
  });
});

describe('levels', () => {
  it('has a target and a trim for every voice', () => {
    // A voice with no entry falls back to nothing and plays at whatever its internal gains
    // happen to produce, which is exactly how the palette came to span 46dB.
    for (const id of SOUND_IDS) {
      expect(TARGET_PEAK[id], `${id} has no target`).toBeGreaterThan(0);
      expect(VOICE_TRIM[id], `${id} has no trim`).toBeGreaterThan(0);
    }
  });

  it('keeps the sounds heard most often below the sounds heard rarely', () => {
    // dullThud fires ~800 times a battle and explosion nine times. If that ordering ever
    // inverts, the collisions become the battle.
    expect(TARGET_PEAK.dullThud).toBeLessThan(TARGET_PEAK.metallicTick);
    expect(TARGET_PEAK.pegPing).toBeLessThan(TARGET_PEAK.metallicTick);
    expect(TARGET_PEAK.explosion).toBeGreaterThan(TARGET_PEAK.metallicTick);
  });

  it('applies the trim, so a voice cannot be played at its raw level by accident', () => {
    const played: Array<{ trim?: number }> = [];
    const bus = createAudioBus({ factory: () => { throw new Error('silent'); } });
    const original = PALETTE.metallicTick;
    try {
      (PALETTE as Record<string, unknown>)['metallicTick'] = (_b: unknown, o: { trim?: number }) => played.push(o);
      playSound(bus, 'metallicTick', { intensity: 1 });
    } finally {
      (PALETTE as Record<string, unknown>)['metallicTick'] = original;
    }
    expect(played[0]?.trim).toBe(VOICE_TRIM.metallicTick);
  });
});
