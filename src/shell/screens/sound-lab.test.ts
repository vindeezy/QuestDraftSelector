// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioBus } from '../../audio/context';
import { SOUND_IDS } from '../../audio/palette';
import { BRAWL_SEED, labGroups, mountSoundLab } from './sound-lab';
import officialRecord from '../../../data/official-event.json';

/**
 * The lab is a temporary screen, so these tests cover only what would be embarrassing to get
 * wrong: that every sound can actually be heard from it, that it never leaks the draft, and
 * that it survives a browser with no Web Audio at all.
 *
 * What the sounds SOUND like is the whole point of the screen and cannot be tested here. That
 * is the watch gate's job.
 */

/** A bus whose context construction throws — a browser that blocks or lacks Web Audio. */
function silentBus() {
  return createAudioBus({
    factory: () => {
      throw new Error('no audio in this test');
    },
  });
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('the panel', () => {
  it('has a button for every voice in the palette', () => {
    // The lab is the only place any of these can be heard before draft night. A voice with
    // no button is a voice nobody checked.
    const wired = new Set(labGroups().flatMap((group) => group.buttons.map((b) => b.sound)));
    for (const id of SOUND_IDS) {
      expect(wired.has(id), `${id} has no button in the sound lab`).toBe(true);
    }
  });

  it('names weapons and abilities the way the Forge does', () => {
    const weapons = labGroups().find((group) => group.title === 'Weapons')!;
    // Part labels, not part ids — nobody should have to read `weapon-saw-blade` off a button.
    expect(weapons.buttons.map((b) => b.label)).toContain('Saw Blade');
    for (const button of weapons.buttons) {
      expect(button.label, button.sound).not.toMatch(/^weapon-/);
    }
  });

  it('renders a clickable control for each one', () => {
    mountSoundLab({ container, bus: silentBus() });
    const buttons = [...container.querySelectorAll('button[data-sound]')];
    expect(buttons.length).toBe(SOUND_IDS.length);
  });
});

describe('a browser with no Web Audio', () => {
  it('mounts and plays without throwing', () => {
    // A locked-down browser must get a working panel that happens to be silent, not a blank
    // screen — the same rule the rest of the audio layer follows.
    mountSoundLab({ container, bus: silentBus() });
    for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-sound]')) {
      expect(() => button.click(), button.dataset['sound']).not.toThrow();
    }
  });

  it('survives the transport controls too', () => {
    mountSoundLab({ container, bus: silentBus() });
    const mute = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Mute')!;
    expect(() => mute.click()).not.toThrow();
    expect(mute.textContent).toBe('Unmute');
    expect(() => mute.click()).not.toThrow();
    expect(mute.textContent).toBe('Mute');
  });
});

describe('not leaking the draft', () => {
  it('never brawls on the official seed', () => {
    // Same rule as the orientation screen's preview panels: hearing the mix must not let
    // anyone read tomorrow's result. Someone WILL leave this running, and a real fight on the
    // real seed hands them the eliminations in order.
    expect(BRAWL_SEED).not.toBe(officialRecord.masterSeed);
  });
});

describe('teardown', () => {
  it('returns a teardown that can be called before anything started', () => {
    const teardown = mountSoundLab({ container, bus: silentBus() });
    expect(() => teardown()).not.toThrow();
    expect(() => teardown()).not.toThrow();
  });
});
