import { describe, it, expect } from 'vitest';
import { createAudioBus } from './context';
import { PALETTE, SOUND_IDS, playSound, type SoundId } from './palette';

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
      'heavyClang', 'sawBuzz', 'spinnerWhine', 'discWhirr', 'flameWhoosh', 'bluntImpact',
      // one per ability
      'electricZap', 'nitroWhoosh', 'oilSplat', 'shockwaveBoom', 'repairChime',
      'adrenalineRise', 'smokeHiss',
      // one per hazard family
      'flameHiss', 'sawGrind', 'crusherSlam', 'shellImpact',
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
