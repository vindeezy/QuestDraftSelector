import { ABILITY_SOUNDS, HAZARD_SOUNDS, WEAPON_SOUNDS, soundFor } from '../../audio/classify';
import { MAX_TONE_CUT, TONE_SHELF_HZ, createAudioBus, type AudioBus } from '../../audio/context';
import { playSound, type SoundId } from '../../audio/palette';
import { GLOBAL_CAP, admit, emptyState, type VoiceRequest, type VoiceState } from '../../audio/voices';
import { ARENA_VARIANTS } from '../../sim/event/arenas';
import { advanceMatch, createMatch, DEFAULT_MATCH } from '../../sim/arena/match';
import { runForgeOnly } from '../../sim/event/event';
import { partAt, slotCountFor } from '../../sim/parts/tables';
import { DEMO_SEED } from '../demo-seed';

/**
 * The sound lab — `?sounds`.
 *
 * Every sound in the spec was written by someone who could not hear any of it. This is the
 * screen where that stops being true. It exists to be listened to once, adjusted, and then
 * deleted in FIN 1; it is not part of the walkthrough, touches no progress state, and is
 * intercepted before the checksum gate.
 *
 * Two halves, and the second matters more:
 *
 * - **Buttons** play one voice at a time, at whatever the intensity slider says. Good for
 *   judging whether a saw sounds like a saw.
 * - **BRAWL** runs a REAL match — real builds, real hazards, real effects — through the real
 *   classifier and the real mixer. That is the only way to answer the question the buttons
 *   cannot: whether ten bots fighting sounds like a fight or like static. It also exercises
 *   the exact path SND 8 wires into the battle screen, so anything broken here is broken
 *   there.
 *
 * The brawl deliberately runs on `DEMO_SEED`, never the official one — the same rule the
 * orientation screen's preview panels follow. Listening to the mix must not leak the draft.
 */

const BRAWL_SECONDS = 20;

/**
 * The seed the brawl fights on.
 *
 * `DEMO_SEED`, never the official one. The lab is a listening tool, and someone using it will
 * leave it running; a real fight on the real seed would hand them the eliminations in order.
 * Exported so `sound-lab.test.ts` can assert this rather than trust it.
 */
export const BRAWL_SEED = DEMO_SEED;
const MS_PER_TICK = 1000 / 60;

interface LabButton {
  label: string;
  sound: SoundId;
}

interface LabGroup {
  title: string;
  note: string;
  buttons: LabButton[];
}

/** Part label for a part id, so a button reads "Saw Blade" rather than `weapon-saw-blade`. */
function labelFor(category: 'weapon' | 'ability', id: string): string {
  for (let slot = 0; slot < slotCountFor(category); slot++) {
    const part = partAt(category, slot);
    if (part.id === id) return part.label;
  }
  return id;
}

/**
 * The panel, derived from the classifier's own tables rather than retyped.
 *
 * This is why `sound-lab.test.ts` can assert that every voice in the palette has a button:
 * a new weapon appears here automatically, and a new voice that belongs to nothing fails the
 * test instead of quietly having no way to be heard before draft night.
 */
export function labGroups(): LabGroup[] {
  return [
    {
      title: 'Weapons',
      note: 'the sound a landed blow makes, by what landed it',
      buttons: [...WEAPON_SOUNDS].map(([id, sound]) => ({ label: labelFor('weapon', id), sound })),
    },
    {
      title: 'Abilities',
      note: 'fired, not landed',
      buttons: [...ABILITY_SOUNDS].map(([id, sound]) => ({ label: labelFor('ability', id), sound })),
    },
    {
      title: 'Hazards',
      note: 'by what the arena hit you with',
      buttons: [...HAZARD_SOUNDS].map(([family, sound]) => ({
        label: family.charAt(0).toUpperCase() + family.slice(1),
        sound,
      })),
    },
    {
      title: 'Moments',
      note: 'the fixed events — an elimination always plays, however loud the fight is',
      buttons: [
        { label: 'Elimination', sound: 'explosion' },
        { label: 'Collision', sound: 'dullThud' },
        { label: 'Cannon fires', sound: 'deepBoom' },
        { label: 'Trapdoor', sound: 'mechanicalClunk' },
        { label: 'Generic hit', sound: 'metallicTick' },
      ],
    },
    {
      title: 'Forge',
      note: 'pitch follows the ball across the board — the slider is pitch here, not intensity',
      buttons: [{ label: 'Peg strike', sound: 'pegPing' }],
    },
  ];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface SoundLabOptions {
  container: HTMLElement;
  /** Injected by tests. Production builds the real one, which stays silent until unlocked. */
  bus?: AudioBus;
  /** The seed the brawl runs. Never the official event's — see the module comment. */
  seed?: number;
}

/**
 * Renders the lab and returns a teardown that stops any running brawl.
 *
 * Returning the teardown rather than relying on the page unloading matters because the brawl
 * is a `requestAnimationFrame` loop that advances a real match: left running it would keep
 * simulating and keep making noise after the panel was gone.
 */
export function mountSoundLab(options: SoundLabOptions): () => void {
  const { container } = options;
  const bus = options.bus ?? createAudioBus();
  const seed = options.seed ?? BRAWL_SEED;

  container.innerHTML = '';
  const root = el('div', 'lab');

  const header = el('header', 'lab__header');
  header.appendChild(el('h1', 'lab__title', 'Sound lab'));
  header.appendChild(el('p', 'lab__lede',
    'Not part of the walkthrough. Click anything to unlock audio, then listen. ' +
    'BRAWL runs a real fight through the real mixer — that is the one that matters.'));
  root.appendChild(header);

  // --- transport ----------------------------------------------------------------------

  const transport = el('div', 'lab__transport');

  const intensityRow = el('label', 'lab__control');
  intensityRow.appendChild(el('span', 'lab__control-label', 'Intensity'));
  const intensity = el('input', 'lab__slider');
  intensity.type = 'range';
  intensity.min = '0';
  intensity.max = '1';
  intensity.step = '0.05';
  intensity.value = '0.7';
  const intensityValue = el('span', 'lab__control-value', '0.70');
  intensity.addEventListener('input', () => {
    intensityValue.textContent = Number(intensity.value).toFixed(2);
  });
  intensityRow.appendChild(intensity);
  intensityRow.appendChild(intensityValue);
  transport.appendChild(intensityRow);

  const volumeRow = el('label', 'lab__control');
  volumeRow.appendChild(el('span', 'lab__control-label', 'Volume'));
  const volume = el('input', 'lab__slider');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(bus.volume);
  const volumeValue = el('span', 'lab__control-value', bus.volume.toFixed(2));
  volume.addEventListener('input', () => {
    bus.setVolume(Number(volume.value));
    volumeValue.textContent = Number(volume.value).toFixed(2);
  });
  volumeRow.appendChild(volume);
  volumeRow.appendChild(volumeValue);
  transport.appendChild(volumeRow);

  // Softness. Here because two rounds of per-voice fixes for "too harsh" both missed, and the
  // person who can actually hear it should be able to find the number rather than describe it.
  // Whatever setting feels right is worth knowing: it says whether the fix belongs in one
  // voice or in the whole palette.
  const toneRow = el('label', 'lab__control');
  toneRow.appendChild(el('span', 'lab__control-label', 'Softness'));
  const tone = el('input', 'lab__slider');
  tone.type = 'range';
  tone.min = '0';
  tone.max = String(MAX_TONE_CUT);
  tone.step = '1';
  tone.value = String(bus.toneCut);
  const toneValue = el('span', 'lab__control-value', `${bus.toneCut}dB`);
  tone.addEventListener('input', () => {
    bus.setToneCut(Number(tone.value));
    toneValue.textContent = `${tone.value}dB`;
  });
  toneRow.appendChild(tone);
  toneRow.appendChild(toneValue);
  toneRow.title = `Decibels taken off everything above ${TONE_SHELF_HZ}Hz.`;
  transport.appendChild(toneRow);

  const mute = el('button', 'lab__button lab__button--toggle', 'Mute');
  mute.type = 'button';
  mute.addEventListener('click', () => {
    bus.setMuted(!bus.muted);
    mute.textContent = bus.muted ? 'Unmute' : 'Mute';
    mute.classList.toggle('is-on', bus.muted);
  });
  transport.appendChild(mute);

  root.appendChild(transport);

  // --- the brawl ----------------------------------------------------------------------

  const brawlRow = el('div', 'lab__brawl');
  const brawl = el('button', 'lab__button lab__button--brawl', 'BRAWL');
  brawl.type = 'button';
  const readout = el('p', 'lab__readout', 'A real ten-bot fight, 20 seconds, through the real mixer.');
  brawlRow.appendChild(brawl);
  brawlRow.appendChild(readout);
  root.appendChild(brawlRow);

  let frame: number | null = null;

  function stopBrawl(): void {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    brawl.textContent = 'BRAWL';
    brawl.classList.remove('is-on');
  }

  function startBrawl(): void {
    bus.unlock();

    // A real match, built exactly as the battle screen builds one. Nothing about this
    // stream is faked, which is the point — a synthesised approximation of "roughly this
    // dense" would be the author guessing at the very thing being checked.
    //
    // `runForgeOnly` rather than `buildsForSeed` because the classifier needs the raw
    // `BotBuild` slot indices to know which weapon each bot is carrying; the assembled bots
    // have already collapsed those into stats.
    const forge = runForgeOnly(seed, 10);
    const builds = forge.builds;
    const match = createMatch({
      ...DEFAULT_MATCH,
      arena: ARENA_VARIANTS[0]!,
      seed: forge.battleSeeds[0]!,
      botCount: 10,
      builds: forge.assembledBots,
    });

    let state: VoiceState = emptyState();
    let tick = 0;
    let played = 0;
    let peak = 0;

    brawl.textContent = 'STOP';
    brawl.classList.add('is-on');

    const step = (): void => {
      if (match.done || tick >= BRAWL_SECONDS * 60) {
        readout.textContent =
          `Done. ${played} voices over ${(tick / 60).toFixed(1)}s ` +
          `(${(played / (tick / 60)).toFixed(1)}/s), peak ${peak} ringing at once ` +
          `of a possible ${GLOBAL_CAP}.`;
        stopBrawl();
        return;
      }

      advanceMatch(match);
      const now = tick * MS_PER_TICK;
      const requests: VoiceRequest[] = match.effects.map((effect) => ({
        id: soundFor(effect, builds),
        intensity: effect.intensity,
        pan: panFor(effect.x, match.arena.grid.width),
      }));

      const result = admit(requests, state, now);
      state = result.state;
      for (const request of result.kept) playSound(bus, request.id, request);

      played += result.kept.length;
      peak = Math.max(peak, [...state.live.values()].reduce((n, times) => n + times.length, 0));
      if (tick % 15 === 0) {
        readout.textContent =
          `${(tick / 60).toFixed(1)}s — ${played} voices, peak ${peak} at once, ` +
          `${match.bots.filter((bot) => bot.health > 0).length} bots left.`;
      }

      tick++;
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
  }

  brawl.addEventListener('click', () => {
    if (frame !== null) {
      stopBrawl();
      readout.textContent = 'Stopped.';
      return;
    }
    startBrawl();
  });

  // --- the palette --------------------------------------------------------------------

  for (const group of labGroups()) {
    const section = el('section', 'lab__group');
    section.appendChild(el('h2', 'lab__group-title', group.title));
    section.appendChild(el('p', 'lab__group-note', group.note));

    const buttons = el('div', 'lab__buttons');
    for (const entry of group.buttons) {
      const button = el('button', 'lab__button', entry.label);
      button.type = 'button';
      button.dataset['sound'] = entry.sound;
      button.addEventListener('click', () => {
        bus.unlock();
        const value = Number(intensity.value);
        playSound(bus, entry.sound, { intensity: value, pitch: value });
      });
      buttons.appendChild(button);
    }
    section.appendChild(buttons);
    root.appendChild(section);
  }

  container.appendChild(root);
  return stopBrawl;
}

/** Event x across the arena mapped to -1..1, so a fight on the left is heard on the left. */
function panFor(x: number, width: number): number {
  if (!Number.isFinite(x) || !(width > 0)) return 0;
  return Math.max(-1, Math.min(1, (x / width) * 2 - 1));
}
