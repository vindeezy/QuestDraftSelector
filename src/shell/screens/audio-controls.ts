import type { AudioBus } from '../../audio/context';

/**
 * Volume and mute, for any screen that makes a noise.
 *
 * Draft night is ten people in a room around one screen, and somebody will want it quieter —
 * or off, because they are talking, or because they have already watched it once. That is the
 * whole requirement, so the control is deliberately small and always in the same corner
 * rather than being a settings panel.
 *
 * It reads its initial position from the bus rather than assuming full volume, so moving
 * between the Forge and a battle does not silently reset a choice the viewer already made.
 * The bus is a single shared instance for the whole event, which is what makes that work.
 */

const STEP = 0.05;

export interface AudioControlsOptions {
  bus: AudioBus;
  /** Where the controls mount. Appended, never replacing what is already there. */
  host: HTMLElement;
}

/** Renders the controls and returns a teardown that removes them. */
export function mountAudioControls(options: AudioControlsOptions): () => void {
  const { bus, host } = options;

  const root = document.createElement('div');
  root.className = 'audio-controls';

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'audio-controls__mute';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'audio-controls__slider';
  slider.min = '0';
  slider.max = '1';
  slider.step = String(STEP);
  slider.value = String(bus.volume);
  slider.setAttribute('aria-label', 'Volume');

  const paint = (): void => {
    mute.textContent = bus.muted ? '🔇' : '🔊';
    mute.setAttribute('aria-label', bus.muted ? 'Unmute' : 'Mute');
    mute.classList.toggle('is-muted', bus.muted);
    // Disabled rather than hidden while muted: hiding it would make the slider jump around
    // as the button is pressed, and the position is worth being able to see either way.
    slider.disabled = bus.muted;
  };

  mute.addEventListener('click', () => {
    bus.setMuted(!bus.muted);
    paint();
  });

  slider.addEventListener('input', () => {
    bus.setVolume(Number(slider.value));
    // Moving the slider while muted is a clear enough request to hear something.
    if (bus.muted) {
      bus.setMuted(false);
      paint();
    }
  });

  paint();
  root.appendChild(mute);
  root.appendChild(slider);
  host.appendChild(root);

  return () => root.remove();
}
