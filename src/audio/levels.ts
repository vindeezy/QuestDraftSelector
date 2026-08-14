import { PALETTE, SOUND_IDS, TARGET_PEAK, VOICE_TRIM, playSound, type SoundId } from './palette';
import { createAudioBus } from './context';
import { lifetimeMs } from './voices';

/**
 * Measuring how loud the palette actually is.
 *
 * This exists because loudness turned out to be unguessable. The same `gain` number produces
 * a seventeen-fold difference in level through different primitives, so a palette tuned by
 * reading the code ended up spanning 46dB with the most frequent sound in the show near the
 * bottom and one weapon 25dB above it. None of that was visible in the source, in the tests,
 * or in the mix metrics — only in the rendered waveform.
 *
 * `TARGET_PEAK` says how loud a voice should be, `VOICE_TRIM` is the correction that gets it
 * there, and this reports whether the two still agree. Run it after changing any voice: a
 * retuned voice whose trim was not updated is silently the wrong size, and the symptom is
 * "the sound is harsh" three rounds later.
 *
 * Rendering is offline, so this is exact rather than an estimate, and needs no speakers.
 *
 * One caveat worth knowing before trusting a suggestion: a voice that is badly too loud is
 * already being squashed by the master limiter when it is measured, so its peak understates
 * how loud it really is and one pass will not be enough. Apply, press the button again, and
 * repeat until nothing is flagged. Two passes has always been enough so far.
 */

export interface VoiceLevel {
  id: SoundId;
  /** Peak amplitude at intensity 1, with the current trim applied. */
  peak: number;
  /** The trim currently in `VOICE_TRIM`. */
  trim: number;
  /** What the trim should be for this voice to hit its target. */
  suggested: number;
  /** How far off it is, in decibels. Positive means too loud. */
  driftDb: number;
  /** How long the voice is actually audible for. */
  audibleMs: number;
  /** The slot length `voices.ts` reserves for it. */
  reservedMs: number;
}

/** Builds an offline context. Injected because `OfflineAudioContext` is browser-only. */
export type OfflineFactory = (seconds: number, sampleRate: number) => OfflineAudioContext;

const SAMPLE_RATE = 44100;
const RENDER_SECONDS = 1.2;

/**
 * How many renders to average per voice.
 *
 * Noise-based voices start at a random offset into the shared noise buffer, so a single
 * render's peak swings by several decibels — enough to send this tool chasing a difference
 * that is not there. Averaging a few passes makes the number stable enough to trim against.
 */
const RENDER_PASSES = 5;

/**
 * How far a trim may drift before it is worth reporting.
 *
 * 1.5dB, which is a little above this tool's own repeatability rather than a claim about
 * hearing. Even averaged over `RENDER_PASSES`, noise-based voices land about a decibel apart
 * between runs, and a threshold tighter than that flags three different voices every time it
 * is pressed — a tool that always reports a problem gets ignored, including on the day it is
 * right. Set against a problem that was 25dB, this has room to spare.
 */
export const DRIFT_TOLERANCE_DB = 1.5;

/**
 * How far a voice may outlast its reserved slot before it is reported.
 *
 * A voice's tail decays asymptotically, so the last few milliseconds are inaudible in any
 * real mix and chasing them would flag everything. 25ms is well short of a frame and a half.
 */
export const LENGTH_TOLERANCE_MS = 25;

async function peakOf(id: SoundId, createOffline: OfflineFactory): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < RENDER_PASSES; pass++) total += await peakOnce(id, createOffline);
  return total / RENDER_PASSES;
}

/**
 * How long the voice can still be heard, in milliseconds.
 *
 * Measured against a floor rather than against true silence, because an exponential release
 * never quite reaches zero and would otherwise report the full render length every time.
 */
const AUDIBLE_FLOOR = 0.0008;

async function audibleMsOf(id: SoundId, createOffline: OfflineFactory): Promise<number> {
  const ctx = createOffline(RENDER_SECONDS, SAMPLE_RATE);
  const bus = createAudioBus({ factory: () => ctx as unknown as AudioContext });
  bus.unlock();
  playSound(bus, id, { intensity: 1 });

  const samples = (await ctx.startRendering()).getChannelData(0);
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]!) > AUDIBLE_FLOOR) return (i / SAMPLE_RATE) * 1000;
  }
  return 0;
}

async function peakOnce(id: SoundId, createOffline: OfflineFactory): Promise<number> {
  const ctx = createOffline(RENDER_SECONDS, SAMPLE_RATE);
  const bus = createAudioBus({ factory: () => ctx as unknown as AudioContext });
  bus.unlock();
  playSound(bus, id, { intensity: 1 });

  const rendered = await ctx.startRendering();
  const samples = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]!);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/** Every voice, loudest first. */
export async function measureVoiceLevels(createOffline: OfflineFactory): Promise<VoiceLevel[]> {
  const levels: VoiceLevel[] = [];

  for (const id of SOUND_IDS) {
    const peak = await peakOf(id, createOffline);
    const trim = VOICE_TRIM[id];
    // A silent voice cannot be corrected by scaling, so report it as-is rather than
    // suggesting an infinite trim.
    const suggested = peak > 0 ? trim * (TARGET_PEAK[id] / peak) : trim;
    levels.push({
      id,
      peak,
      trim,
      suggested,
      driftDb: peak > 0 ? 20 * Math.log10(peak / TARGET_PEAK[id]) : 0,
      audibleMs: await audibleMsOf(id, createOffline),
      reservedMs: lifetimeMs(id),
    });
  }

  return levels.sort((a, b) => b.peak - a.peak);
}

/** A fixed-width table, ready to paste into `VOICE_TRIM`. */
export function formatLevels(levels: readonly VoiceLevel[]): string {
  const width = Math.max(...SOUND_IDS.map((id) => id.length));
  const rows = levels.map((level) => {
    const loud = Math.abs(level.driftDb) > DRIFT_TOLERANCE_DB ? '  <-- retrim' : '';
    // A voice that outlives its slot is the mush bug: the mixer frees the slot and admits
    // another while this one is still sounding. Worth shouting about, and invisible otherwise.
    const long = level.audibleMs > level.reservedMs + LENGTH_TOLERANCE_MS
      ? `  <-- OUTLIVES ITS SLOT by ${Math.round(level.audibleMs - level.reservedMs)}ms`
      : '';
    const flag = loud + long;
    return (
      `${level.id.padEnd(width)}  peak ${level.peak.toFixed(4)}` +
      `  target ${TARGET_PEAK[level.id].toFixed(4)}` +
      `  ${level.driftDb >= 0 ? '+' : ''}${level.driftDb.toFixed(1)}dB` +
      `  trim ${level.trim.toFixed(2)} -> ${level.suggested.toFixed(2)}${flag}`
    );
  });
  const off = levels.filter((l) => Math.abs(l.driftDb) > DRIFT_TOLERANCE_DB).length;
  const overlong = levels.filter((l) => l.audibleMs > l.reservedMs + LENGTH_TOLERANCE_MS).length;
  return [
    `${SOUND_IDS.length} voices, ${Object.keys(PALETTE).length} in the palette, ` +
      `${off} needing a retrim, ${overlong} outliving their slot`,
    ...rows,
  ].join('\n');
}
