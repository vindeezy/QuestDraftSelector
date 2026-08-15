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


/**
 * A Replay button that appears only once the thing worth replaying has finished.
 *
 * Hidden until `reveal()` is called, rather than disabled, because a control that does
 * nothing yet is worse than one that is not there: a viewer three seconds into a battle
 * should not be looking at a greyed-out Replay wondering what it wants from them.
 *
 * Replaying re-renders the beat rather than rewinding anything. The simulation is
 * deterministic and driven by a recorded seed, so running it again produces exactly the
 * fight that just happened — there is no state to rewind and nothing that can diverge.
 */
export interface ReplayControl {
  /** Show the button. Safe to call more than once. */
  reveal(): void;
  /** Remove it. */
  destroy(): void;
}

export function mountReplayControl(host: HTMLElement, onReplay: () => void): ReplayControl {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn beat-nav-btn replay-btn';
  button.dataset.role = 'replay';
  button.textContent = '↻ Replay';
  button.setAttribute('aria-label', 'Watch this again from the start');
  button.hidden = true;
  button.addEventListener('click', onReplay);
  host.appendChild(button);

  return {
    reveal() {
      button.hidden = false;
    },
    destroy() {
      button.remove();
    },
  };
}

/**
 * Pause and resume, for the battles.
 *
 * Only the battles have one. A Forge board takes ten seconds and pausing it would be
 * fidgeting; a battle runs for two minutes with ten people watching, and somebody will want
 * to stop and argue about what just happened.
 *
 * The playhead is the simulation's own tick count, so pausing is genuinely free: nothing
 * advances, the audio mixer's clock stops with it, and resuming continues from exactly where
 * it stopped with no drift to correct. A wall-clock playhead would have needed the elapsed
 * pause subtracting out of it.
 */
export interface PauseControl {
  readonly paused: boolean;
  /** Show the button. The battle waits on its own BEGIN, and a Pause offered before there is
   *  anything to pause could be pressed and then RESUMED, starting the fight early. */
  reveal(): void;
  /** Hide it again — there is nothing to pause once the match is over. */
  conceal(): void;
  /** Removes the button. */
  destroy(): void;
}

export function mountPauseControl(host: HTMLElement, onChange: (paused: boolean) => void): PauseControl {
  let paused = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn beat-nav-btn pause-btn';
  button.dataset.role = 'pause';
  const paint = (): void => {
    button.textContent = paused ? '▶ Resume' : '❚❚ Pause';
    button.setAttribute('aria-label', paused ? 'Resume the battle' : 'Pause the battle');
    button.classList.toggle('is-paused', paused);
  };
  button.addEventListener('click', () => {
    paused = !paused;
    paint();
    onChange(paused);
  });
  paint();
  button.hidden = true;
  host.appendChild(button);

  return {
    get paused() {
      return paused;
    },
    reveal() {
      button.hidden = false;
    },
    conceal() {
      button.hidden = true;
      // Cleared as it goes, so a battle that finishes while paused cannot leave the flag set
      // for whatever reveals it next.
      paused = false;
      paint();
    },
    destroy() {
      button.remove();
    },
  };
}
