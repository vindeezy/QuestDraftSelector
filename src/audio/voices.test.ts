import { describe, it, expect } from 'vitest';
import { SOUND_IDS } from './palette';
import { MAX_DECAY_S } from './synth';
import {
  DEFAULT_CAP, EXEMPT, GLOBAL_CAP, admit, capFor, emptyState, lifetimeMs, remember,
  type VoiceRequest, type VoiceState,
} from './voices';

/**
 * The module that stops a brawl becoming noise.
 *
 * Pure on purpose, and built before anything is audible, because "does a ten-bot scrum turn
 * to mush" is not a question you can answer by listening once — by the time it sounds wrong
 * in the lab the fix is a rewrite. Here it is a measurement.
 */

const hit = (intensity: number, pan = 0): VoiceRequest => ({ id: 'metallicTick', intensity, pan });
const boom = (intensity: number): VoiceRequest => ({ id: 'deepBoom', intensity });
const elimination = (): VoiceRequest => ({ id: 'explosion', intensity: 1 });

/** A state in which every sound is already at its cap. */
function saturatedState(now = 0): VoiceState {
  let state = emptyState();
  for (const id of ['metallicTick', 'deepBoom', 'explosion'] as const) {
    for (let i = 0; i < capFor(id) + 5; i++) state = remember(state, id, now);
  }
  return state;
}

describe('coalescing within a frame', () => {
  it('collapses several of the same sound in one frame into one, at the loudest intensity', () => {
    const { kept } = admit([hit(0.2), hit(0.9), hit(0.4)], emptyState(), 0);
    expect(kept.length).toBe(1);
    expect(kept[0]!.intensity).toBeCloseTo(0.9);
  });

  it('keeps the whole loudest request, so pan comes from the blow that mattered', () => {
    const { kept } = admit([hit(0.2, -0.9), hit(0.8, 0.6)], emptyState(), 0);
    expect(kept[0]!.pan).toBeCloseTo(0.6);
  });

  it('keeps different sounds in the same frame', () => {
    expect(admit([hit(0.5), boom(1)], emptyState(), 0).kept.length).toBe(2);
  });

  it('coalesces exempt sounds too — two eliminations in one frame are one explosion', () => {
    const { kept } = admit([elimination(), elimination()], emptyState(), 0);
    expect(kept.length).toBe(1);
  });
});

describe('caps', () => {
  it('caps how many of one sound can be alive at once', () => {
    let state = emptyState();
    for (let i = 0; i < 20; i++) state = remember(state, 'metallicTick', i);
    expect(admit([hit(0.5)], state, 20).kept.length).toBe(0);
  });

  it('always admits an elimination — the loudest moment is never dropped', () => {
    expect(admit([elimination()], saturatedState(), 0).kept.length).toBe(1);
  });

  it('exempts every sound the spec calls a moment, not a texture', () => {
    for (const id of EXEMPT) {
      expect(admit([{ id, intensity: 1 }], saturatedState(), 0).kept, id).toHaveLength(1);
    }
  });

  it('frees a slot once a voice has finished ringing', () => {
    let state = emptyState();
    for (let i = 0; i < DEFAULT_CAP; i++) state = remember(state, 'metallicTick', 0);

    expect(admit([hit(0.5)], state, 10).kept.length).toBe(0);
    expect(admit([hit(0.5)], state, lifetimeMs('metallicTick') + 1).kept.length).toBe(1);
  });

  it('ties the window to how long a sound can actually ring', () => {
    // Not an arbitrary number: a voice occupies a slot for exactly as long as the synthesis
    // layer says its tail can last, so retuning the tails cannot silently change the mix.
    expect(lifetimeMs('metallicTick')).toBeCloseTo(MAX_DECAY_S * 1000);
  });
});

describe('the global cap', () => {
  // Per-sound caps alone do not bound the total: a battle uses about eight distinct sounds,
  // and measuring the real recorded event found 26-31 voices ringing at once. These tests
  // pin the fix, because it is invisible until it is gone.
  const many = (n: number): VoiceRequest[] =>
    SOUND_IDS.slice(0, n).map((id, i) => ({ id, intensity: 0.1 + i / 100 }));

  it('bounds how many voices ring at once across ALL sounds', () => {
    const { kept } = admit(many(SOUND_IDS.length), emptyState(), 0);
    expect(kept.length).toBeLessThanOrEqual(GLOBAL_CAP);
  });

  it('stays bounded frame after frame, not just on the first one', () => {
    // Counts only the sounds the cap governs. Exempt sounds are deliberately unbounded — the
    // fight is not allowed to silence a kill — which is safe because there are at most nine
    // eliminations in a battle. A sound that fired every frame must never be made exempt.
    let state = emptyState();
    for (let frame = 0; frame < 60; frame++) {
      const out = admit(many(SOUND_IDS.length), state, frame * 16.67);
      state = out.state;
      let ringing = 0;
      for (const [id, times] of state.live) if (!EXEMPT.has(id)) ringing += times.length;
      expect(ringing, `frame ${frame}`).toBeLessThanOrEqual(GLOBAL_CAP);
    }
  });

  it('drops the quietest requests first, not whichever came first', () => {
    // The heavy blow that caused the scrum must survive the scrum.
    const quiet: VoiceRequest[] = SOUND_IDS.filter((id) => !EXEMPT.has(id))
      .map((id) => ({ id, intensity: 0.05 }));
    const loud: VoiceRequest = { id: 'crusherSlam', intensity: 1 };

    const { kept } = admit([...quiet, loud], emptyState(), 0);
    expect(kept.map((k) => k.id)).toContain('crusherSlam');
  });

  it('lets an elimination through even when the global budget is spent', () => {
    let state = emptyState();
    for (let i = 0; i < GLOBAL_CAP * 2; i++) {
      state = admit(SOUND_IDS.map((id) => ({ id, intensity: 0.5 })), state, 0).state;
    }
    expect(admit([elimination()], state, 0).kept.length).toBe(1);
  });
});

describe('state', () => {
  it('records what it admitted, so the caller cannot forget to', () => {
    const first = admit([hit(0.5)], emptyState(), 0);
    expect(first.kept.length).toBe(1);

    // Same frame time, a second call: the first one is still ringing and counted.
    let state = first.state;
    for (let i = 0; i < DEFAULT_CAP; i++) state = admit([hit(0.5)], state, 0).state;
    expect(admit([hit(0.5)], state, 0).kept.length).toBe(0);
  });

  it('never mutates the state it was given', () => {
    const before = emptyState();
    admit([hit(0.5), boom(1), elimination()], before, 0);
    expect(admit([hit(0.5)], before, 0).kept.length).toBe(1);
  });

  it('does not grow without bound as a long battle runs', () => {
    // A three-minute battle is ~10,800 frames. If expired voices were never pruned, this
    // would be a slow leak in the one place that runs every frame of every battle.
    let state = emptyState();
    for (let frame = 0; frame < 10_800; frame++) {
      state = admit([hit(0.5), boom(0.5)], state, frame * 16.67).state;
    }
    const total = [...state.live.values()].reduce((sum, times) => sum + times.length, 0);
    expect(total).toBeLessThanOrEqual(DEFAULT_CAP * 2);
  });
});

describe('a realistic brawl', () => {
  it('thins a scrum instead of playing every hit', () => {
    // Ten bots in a pile: several weapon hits and collisions every frame for two seconds.
    // Without capping this is 720 voices, which is mush. The requirement is not a specific
    // number, it is that the count is bounded by the caps rather than by the fight.
    let state = emptyState();
    let played = 0;
    for (let frame = 0; frame < 120; frame++) {
      const requests = [hit(0.4), hit(0.7), hit(0.3), boom(0.5), boom(0.9), hit(0.6)];
      const result = admit(requests, state, frame * 16.67);
      state = result.state;
      played += result.kept.length;
    }

    const seconds = 120 * 16.67 / 1000;
    const ceiling = Math.ceil(seconds * 1000 / lifetimeMs('metallicTick')) * DEFAULT_CAP * 2;
    expect(played).toBeLessThanOrEqual(ceiling);
    expect(played).toBeGreaterThan(0); // thinned, not silenced
  });
});

describe('robustness', () => {
  it('handles an empty frame', () => {
    expect(admit([], emptyState(), 0).kept).toEqual([]);
  });

  it('tolerates a nonsense intensity rather than trusting the caller', () => {
    const { kept } = admit([{ id: 'metallicTick', intensity: Number.NaN }], emptyState(), 0);
    expect(kept.length).toBe(1);
    expect(Number.isFinite(kept[0]!.intensity)).toBe(true);
  });
});
