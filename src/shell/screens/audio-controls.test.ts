// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioBus } from '../../audio/context';
import { mountAudioControls, mountPauseControl, mountReplayControl } from './audio-controls';

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

describe('the replay control', () => {
  it('stays hidden until the thing worth replaying has finished', () => {
    // A control that does nothing yet is worse than one that is not there.
    const replay = mountReplayControl(host, () => {});
    const button = host.querySelector<HTMLButtonElement>('[data-role="replay"]')!;
    expect(button.hidden).toBe(true);

    replay.reveal();
    expect(button.hidden).toBe(false);
  });

  it('calls back when pressed, and cleans up', () => {
    let replayed = 0;
    const replay = mountReplayControl(host, () => { replayed++; });
    replay.reveal();
    host.querySelector<HTMLButtonElement>('[data-role="replay"]')!.click();
    expect(replayed).toBe(1);

    replay.destroy();
    expect(host.querySelector('[data-role="replay"]')).toBeNull();
  });
});

describe('the pause control', () => {
  it('is not offered before there is anything to pause', () => {
    // The battle waits on its own BEGIN. A Pause offered first could be pressed and then
    // RESUMED, which would start the fight early.
    const pause = mountPauseControl(host, () => {});
    expect(host.querySelector<HTMLButtonElement>('[data-role="pause"]')!.hidden).toBe(true);
    pause.reveal();
    expect(host.querySelector<HTMLButtonElement>('[data-role="pause"]')!.hidden).toBe(false);
  });

  it('toggles, and reports each change once', () => {
    const seen: boolean[] = [];
    const pause = mountPauseControl(host, (p) => seen.push(p));
    pause.reveal();
    const button = host.querySelector<HTMLButtonElement>('[data-role="pause"]')!;

    button.click();
    expect(pause.paused).toBe(true);
    button.click();
    expect(pause.paused).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('clears the paused flag when it is hidden', () => {
    // A battle that ends while paused must not leave the flag set for whatever shows it next.
    const pause = mountPauseControl(host, () => {});
    pause.reveal();
    host.querySelector<HTMLButtonElement>('[data-role="pause"]')!.click();
    expect(pause.paused).toBe(true);

    pause.conceal();
    expect(pause.paused).toBe(false);
  });
});
