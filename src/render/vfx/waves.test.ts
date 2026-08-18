import { describe, it, expect } from 'vitest';
import {
  WAVE_CAPACITY,
  WAVE_END_RADIUS,
  WAVE_LIFE_TICKS,
  WAVE_MAX_WIDTH,
  WAVE_START_RADIUS,
  createWaveField,
  waveAlpha,
  waveRadius,
  waveWidth,
} from './waves';

const live = (f: ReturnType<typeof createWaveField>) => f.waves.filter((w) => w.active);

describe('emitting', () => {
  it('starts a wave where it is asked to', () => {
    const f = createWaveField();
    expect(f.emit(100, 250, 1)).toBe(true);
    expect(live(f)).toHaveLength(1);
    expect(live(f)[0]).toMatchObject({ x: 100, y: 250, age: 0 });
  });

  it('clamps intensity rather than trusting it', () => {
    const f = createWaveField();
    f.emit(0, 0, 40);
    f.emit(0, 0, -3);
    expect(live(f).map((w) => w.intensity)).toEqual([1, 0]);
  });

  it('ignores nonsense instead of emitting a NaN ring', () => {
    const f = createWaveField();
    expect(f.emit(Number.NaN, 0, 1)).toBe(false);
    expect(f.emit(0, Number.NaN, 1)).toBe(false);
    expect(f.emit(0, 0, Number.NaN)).toBe(false);
    expect(live(f)).toHaveLength(0);
  });

  it('never exceeds its capacity, however many fire at once', () => {
    const f = createWaveField(4);
    for (let i = 0; i < 50; i++) f.emit(i, 0, 1);
    expect(live(f).length).toBeLessThanOrEqual(4);
  });

  it('recycles the OLDEST when full, so the newest shove is the one on screen', () => {
    const f = createWaveField(2);
    f.emit(1, 0, 1);
    f.advance();
    f.advance();
    f.emit(2, 0, 1);
    f.emit(3, 0, 1); // pool full — must displace the wave emitted at x=1
    expect(live(f).map((w) => w.x).sort()).toEqual([2, 3]);
  });

  it('holds enough waves for the ability to overlap itself', () => {
    // Six activations per life, ten bots. Simultaneous shockwaves are rare and must not
    // silently drop the one a viewer is looking at.
    expect(WAVE_CAPACITY).toBeGreaterThanOrEqual(10);
  });
});

describe('ageing out', () => {
  it('retires a wave once its life is up', () => {
    const f = createWaveField();
    f.emit(0, 0, 1);
    for (let i = 0; i < WAVE_LIFE_TICKS; i++) f.advance();
    expect(live(f)).toHaveLength(0);
  });

  it('is over fast — a shove is instant, a lingering field is the EMP', () => {
    expect(WAVE_LIFE_TICKS).toBeLessThan(40); // under two thirds of a second at 60Hz
  });

  it('clears everything', () => {
    const f = createWaveField();
    f.emit(0, 0, 1);
    f.clear();
    expect(live(f)).toHaveLength(0);
  });
});

describe('the front', () => {
  it('starts at the edge of the machine and travels outward', () => {
    expect(waveRadius(0)).toBeCloseTo(WAVE_START_RADIUS, 5);
    expect(waveRadius(WAVE_LIFE_TICKS)).toBeCloseTo(WAVE_END_RADIUS, 5);
  });

  it('never moves backwards', () => {
    let previous = -1;
    for (let age = 0; age <= WAVE_LIFE_TICKS; age++) {
      const r = waveRadius(age);
      expect(r, `age ${age}`).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('decelerates, which is what separates a released front from a growing circle', () => {
    // Eased out: more than half the distance is covered in the first half of the life.
    const half = waveRadius(WAVE_LIFE_TICKS / 2) - WAVE_START_RADIUS;
    const all = waveRadius(WAVE_LIFE_TICKS) - WAVE_START_RADIUS;
    expect(half / all).toBeGreaterThan(0.6);
  });

  it('travels further when the shove is harder', () => {
    expect(waveRadius(WAVE_LIFE_TICKS, 1)).toBeGreaterThan(waveRadius(WAVE_LIFE_TICKS, 0.3));
  });

  it('covers enough floor to look like the cause of the shove', () => {
    // The ability pushes every bot near the caster. A ring smaller than a bot or two would
    // read as decoration sitting on top of a shove rather than as the shove itself.
    expect(WAVE_END_RADIUS).toBeGreaterThan(120);
  });
});

describe('the fade', () => {
  it('holds briefly, then falls away', () => {
    expect(waveAlpha(0)).toBeGreaterThan(0.9);
    expect(waveAlpha(WAVE_LIFE_TICKS)).toBe(0);
    expect(waveAlpha(WAVE_LIFE_TICKS * 0.5)).toBeLessThan(waveAlpha(WAVE_LIFE_TICKS * 0.2));
  });

  it('stays within range whatever it is handed', () => {
    for (const age of [-10, 0, 5, 5000, Number.NaN]) {
      expect(waveAlpha(age), String(age)).toBeGreaterThanOrEqual(0);
      expect(waveAlpha(age), String(age)).toBeLessThanOrEqual(1);
    }
  });
});

describe('the thickness', () => {
  it('thins as the front expands — the same energy around a longer circumference', () => {
    expect(waveWidth(0)).toBeGreaterThan(waveWidth(WAVE_LIFE_TICKS));
    expect(waveWidth(0)).toBeLessThanOrEqual(WAVE_MAX_WIDTH);
  });

  it('never thins to nothing before it has finished fading', () => {
    // A hairline that is still 40% opaque reads as a rendering artefact rather than a wave.
    for (let age = 0; age <= WAVE_LIFE_TICKS; age++) {
      expect(waveWidth(age), `age ${age}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('determinism', () => {
  it('gives identical geometry for identical input, every time', () => {
    // The site has a Replay button. A wave that expanded differently on the second viewing
    // would undermine the claim the whole event rests on.
    for (let age = 0; age <= WAVE_LIFE_TICKS; age++) {
      expect(waveRadius(age, 0.7)).toBe(waveRadius(age, 0.7));
      expect(waveAlpha(age, 0.7)).toBe(waveAlpha(age, 0.7));
      expect(waveWidth(age, 0.7)).toBe(waveWidth(age, 0.7));
    }
  });
});
