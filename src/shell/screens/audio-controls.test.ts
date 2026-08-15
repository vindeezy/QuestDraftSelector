// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioBus } from '../../audio/context';
import { mountAudioControls } from './audio-controls';

/** A bus with no real context, as in jsdom or a browser that blocks audio. */
function silentBus() {
  return createAudioBus({
    factory: () => {
      throw new Error('no audio in this test');
    },
  });
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('the audio controls', () => {
  it('mutes and unmutes', () => {
    const bus = silentBus();
    mountAudioControls({ bus, host });
    const mute = host.querySelector<HTMLButtonElement>('.audio-controls__mute')!;

    mute.click();
    expect(bus.muted).toBe(true);
    mute.click();
    expect(bus.muted).toBe(false);
  });

  it('unmutes when the slider is moved, because that is what moving it means', () => {
    const bus = silentBus();
    mountAudioControls({ bus, host });
    host.querySelector<HTMLButtonElement>('.audio-controls__mute')!.click();
    expect(bus.muted).toBe(true);

    const slider = host.querySelector<HTMLInputElement>('.audio-controls__slider')!;
    slider.value = '0.6';
    slider.dispatchEvent(new Event('input'));

    expect(bus.muted).toBe(false);
    expect(bus.volume).toBeCloseTo(0.6);
  });

  it('opens at the volume the bus already has, so moving between screens keeps the choice', () => {
    const bus = silentBus();
    bus.setVolume(0.3);
    mountAudioControls({ bus, host });
    expect(host.querySelector<HTMLInputElement>('.audio-controls__slider')!.value).toBe('0.3');
  });

  it('tears down cleanly', () => {
    const teardown = mountAudioControls({ bus: silentBus(), host });
    expect(host.querySelector('.audio-controls')).not.toBeNull();
    teardown();
    expect(host.querySelector('.audio-controls')).toBeNull();
  });
});
