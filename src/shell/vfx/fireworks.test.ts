import { describe, it, expect } from 'vitest';
import { ROSTER } from '../../config/roster';
import {
  GRAVITY,
  MAX_SPARKS,
  SPARKS_PER_BURST,
  createShow,
  finalePalette,
  fireworkColour,
  isBusy,
  launch,
  sparkAlpha,
  step,
  type Show,
} from './fireworks';

const WARM_WHITE = [255, 236, 214] as const;

function runFor(show: Show, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) step(show, dt);
}

describe('sending one up', () => {
  it('climbs, then bursts at about the height it was aimed at', () => {
    const show = createShow(11);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });

    let highest = 1;
    for (let i = 0; i < 600 && show.shells.length > 0; i++) {
      step(show, 1 / 60);
      const shell = show.shells[0];
      if (shell) highest = Math.min(highest, shell.y);
    }

    expect(show.shells).toHaveLength(0);
    expect(highest).toBeGreaterThan(0.24);
    expect(highest).toBeLessThan(0.36);
  });

  it('bursts at the top of the arc rather than on the way up', () => {
    // The flash has to happen where the eye has followed the shell to.
    const show = createShow(3);
    launch(show, { fromX: 0.5, burstY: 0.25, rgb: [255, 255, 255] });
    while (show.shells.length > 0) {
      const shell = show.shells[0];
      // Still climbing, or gone. Never seen falling.
      if (shell) expect(shell.vy).toBeLessThan(0.001);
      step(show, 1 / 60);
    }
    expect(show.sparks.length).toBe(SPARKS_PER_BURST);
  });

  it('throws a filled sphere of sparks, not a hollow ring', () => {
    // Speed is drawn as sqrt of uniform for exactly this reason: uniform speed puts equal
    // counts in every band, but a band's area grows with its radius, so the middle goes sparse
    // and the burst reads as an expanding hoop.
    const show = createShow(7);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255], spread: 0.4 });
    while (show.shells.length > 0) step(show, 1 / 60);

    const speeds = show.sparks.map((s) => Math.hypot(s.vx, s.vy)).sort((a, b) => a - b);
    const inner = speeds.filter((v) => v < 0.2).length;
    expect(inner / speeds.length).toBeGreaterThan(0.15);
  });

  it('leans the way the shell was travelling', () => {
    // The burst inherits the shell's momentum. Without it, a sphere appears pasted onto
    // something that was moving.
    const show = createShow(5);
    launch(show, { fromX: 0.2, burstY: 0.3, rgb: [255, 255, 255] });
    const drift = show.shells[0]?.vx ?? 0;
    while (show.shells.length > 0) step(show, 1 / 60);

    const meanVx = show.sparks.reduce((sum, s) => sum + s.vx, 0) / show.sparks.length;
    expect(Math.sign(meanVx)).toBe(Math.sign(drift));
  });
});

describe('what goes up', () => {
  it('comes down, and the sky empties', () => {
    const show = createShow(2);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });
    runFor(show, 12);
    expect(isBusy(show)).toBe(false);
  });

  it('accelerates downward once the sparks are falling', () => {
    const show = createShow(9);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });
    while (show.shells.length > 0) step(show, 1 / 60);
    runFor(show, 0.9);
    const falling = show.sparks.filter((s) => s.vy > 0);
    expect(falling.length).toBeGreaterThan(show.sparks.length * 0.5);
  });

  it('never lets drag push a spark backwards, however coarse the step', () => {
    // The explicit form `v *= (1 - DRAG * dt)` reverses as soon as DRAG * dt passes 1. The
    // step clamp makes that unreachable in practice, which is exactly why it needs asserting
    // rather than assuming.
    const show = createShow(4);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });
    while (show.shells.length > 0) step(show, 1 / 60);

    const before = show.sparks.map((s) => ({ vx: s.vx, sign: Math.sign(s.vx) }));
    step(show, 5);
    show.sparks.forEach((spark, i) => {
      const was = before[i];
      if (was && Math.abs(was.vx) > 1e-6) expect(Math.sign(spark.vx)).toBe(was.sign);
    });
  });

  it('ignores a nonsense delta instead of emptying the sky', () => {
    const show = createShow(6);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });
    while (show.shells.length > 0) step(show, 1 / 60);
    const count = show.sparks.length;

    step(show, Number.NaN);
    step(show, -4);
    expect(show.sparks.length).toBe(count);
  });

  it('survives a tab coming back after a minute away', () => {
    // requestAnimationFrame hands back a delta of whole seconds on return. Integrated raw, it
    // would teleport every spark far below the screen and blank the finale in one frame.
    const show = createShow(8);
    launch(show, { fromX: 0.5, burstY: 0.3, rgb: [255, 255, 255] });
    while (show.shells.length > 0) step(show, 1 / 60);
    step(show, 60);
    expect(show.sparks.length).toBeGreaterThan(0);
  });
});

describe('the finale not bringing the page down', () => {
  it('caps how much can be in the air at once', () => {
    const show = createShow(1);
    for (let i = 0; i < 60; i++) launch(show, { fromX: i / 60, burstY: 0.3, rgb: [255, 255, 255] });
    runFor(show, 3);
    expect(show.sparks.length).toBeLessThanOrEqual(MAX_SPARKS);
  });
});

describe('running it twice', () => {
  /**
   * Long enough for the shell to actually reach its apex and burst.
   *
   * Both of these tests first ran at 1.4s, where the shell is still climbing and there are no
   * sparks yet. The "different seed" case caught it by failing on two empty arrays — the
   * "identical seed" case had been passing on those same two empty arrays, proving nothing.
   * Hence `expect(...).not.toHaveLength(0)` below: a determinism test that can pass without
   * comparing anything is worse than no test.
   */
  const PAST_BURST_SECONDS = 2.2;

  it('gives an identical show for the same seed', () => {
    // Draft night is ten people watching one screen, and there is a Replay button.
    const a = createShow(43000236);
    const b = createShow(43000236);
    for (const show of [a, b]) {
      launch(show, { fromX: 0.5, burstY: 0.28, rgb: [255, 255, 255] });
      runFor(show, PAST_BURST_SECONDS);
    }
    expect(a.sparks).not.toHaveLength(0);
    expect(a.sparks.map((s) => [s.x, s.y])).toEqual(b.sparks.map((s) => [s.x, s.y]));
  });

  it('gives a different show for a different seed', () => {
    const a = createShow(1);
    const b = createShow(2);
    for (const show of [a, b]) {
      launch(show, { fromX: 0.5, burstY: 0.28, rgb: [255, 255, 255] });
      runFor(show, PAST_BURST_SECONDS);
    }
    expect(a.sparks).not.toHaveLength(0);
    expect(a.sparks.map((s) => s.x)).not.toEqual(b.sparks.map((s) => s.x));
  });
});

describe('how a spark dies', () => {
  it('burns steady before it goes out, rather than fading from the moment it appears', () => {
    const spark = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 2, rgb: [255, 255, 255] as const, glitter: false };
    expect(sparkAlpha({ ...spark, age: 0 }, 0)).toBeCloseTo(1, 6);
    expect(sparkAlpha({ ...spark, age: 1 }, 0)).toBeCloseTo(1, 6);
    expect(sparkAlpha({ ...spark, age: 2 }, 0)).toBe(0);
  });

  it('never goes brighter as it ages', () => {
    const spark = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1.5, rgb: [255, 255, 255] as const, glitter: false };
    let previous = Infinity;
    for (let age = 0; age <= 1.5; age += 0.05) {
      const a = sparkAlpha({ ...spark, age }, 0);
      expect(a).toBeLessThanOrEqual(previous + 1e-9);
      previous = a;
    }
  });

  it('makes glitter sparks flicker rather than fade smoothly', () => {
    const spark = { x: 0, y: 0, vx: 0, vy: 0, age: 0.9, life: 1.5, rgb: [255, 255, 255] as const, glitter: true };
    const seen = new Set<number>();
    for (let t = 0; t < 0.4; t += 0.005) seen.add(Math.round(sparkAlpha(spark, t) * 20));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('stays within 0 and 1 whatever it is asked', () => {
    for (const glitter of [false, true]) {
      const spark = { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1.4, rgb: [255, 255, 255] as const, glitter };
      for (let age = 0; age <= 1.4; age += 0.02) {
        for (const t of [0, 3.3, 77]) {
          const a = sparkAlpha({ ...spark, age }, t);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('every member getting a visible firework', () => {
  /** WCAG relative luminance. */
  function luminance([r, g, b]: readonly [number, number, number]): number {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  const BG = luminance([12, 14, 17]); // --bg-0

  it('burns brightly against the page for all ten, including the dark ones', () => {
    // The reason `fireworkColour` exists. Tommy's `#3A352E` and Nick Lenker's `#647793` were
    // both picked to sit on an arena floor, and painted raw into the sky they are smudges.
    for (const member of ROSTER) {
      const lit = fireworkColour(member.colour);
      const contrast = (luminance(lit) + 0.05) / (BG + 0.05);
      expect(contrast, `${member.name} (${member.colour})`).toBeGreaterThan(4.5);
    }
  });

  it('keeps each member recognisably their own colour', () => {
    // Lifting must not quietly turn everybody into white. Scaling preserves the ratios between
    // channels, so it preserves hue; blending toward white would not have.
    for (const member of ROSTER) {
      const raw = /^#?([0-9a-f]{6})$/i.exec(member.colour)![1]!;
      const value = parseInt(raw, 16);
      const source: [number, number, number] = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
      const lit = fireworkColour(member.colour);

      const brightest = Math.max(...source);
      if (brightest === 0) continue;
      const gain = 255 / brightest;
      for (let i = 0; i < 3; i++) {
        expect(lit[i], `${member.name} channel ${i}`).toBe(Math.round(source[i]! * gain));
      }
    }
  });

  it('drives every colour up to full range', () => {
    for (const member of ROSTER) {
      expect(Math.max(...fireworkColour(member.colour)), member.name).toBe(255);
    }
  });

  it('falls back to a warm white rather than nothing when handed rubbish', () => {
    expect(fireworkColour('not a colour')).toEqual([...WARM_WHITE]);
    expect(fireworkColour('#000000')).toEqual([...WARM_WHITE]);
    expect(fireworkColour('')).toEqual([...WARM_WHITE]);
  });
});

describe('the finale', () => {
  it('leads with the winner and keeps coming back to them', () => {
    // Otherwise the barrage stops saying who won and becomes an anonymous fountain.
    const palette = finalePalette('#2FB344');
    const winner = fireworkColour('#2FB344');
    expect(palette[0]).toEqual(winner);
    expect(palette.filter((c) => c[0] === winner[0] && c[1] === winner[1] && c[2] === winner[2]).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('mixes in the gold and white a display finishes on', () => {
    const palette = finalePalette('#2FB344');
    expect(palette.length).toBeGreaterThan(4);
    expect(palette.some((c) => c[0] === 255 && c[1] > 200 && c[2] > 200)).toBe(true);
  });
});

describe('gravity', () => {
  it('pulls down the screen, not up it', () => {
    // `y` grows downward here. A sign error would rain sparks into the ceiling.
    expect(GRAVITY).toBeGreaterThan(0);
  });
});

describe('landing the burst with the name', () => {
  /**
   * The draft order launches each shell one reveal-interval EARLY, because a shell takes well
   * over a second to reach its apex. That only works while the flight time stays close to
   * `REVEAL_INTERVAL_MS` — retune `GRAVITY` or the burst heights and the fireworks silently
   * start celebrating the wrong member, in the wrong colour, on the one screen where the
   * colours carry meaning.
   *
   * This is the cross-module invariant that makes the lead-by-one trick correct, so it is
   * pinned here rather than left as a comment.
   */
  function flightSeconds(burstY: number): number {
    const show = createShow(21);
    launch(show, { fromX: 0.5, burstY, rgb: [255, 255, 255] });
    let seconds = 0;
    while (show.shells.length > 0 && seconds < 10) {
      step(show, 1 / 60);
      seconds += 1 / 60;
    }
    return seconds;
  }

  it('takes about one reveal interval to reach the top', () => {
    // BURST_HIGH and BURST_LOW in `fireworks-canvas.ts`.
    for (const burstY of [0.09, 0.32]) {
      const flight = flightSeconds(burstY);
      expect(flight, `burstY ${burstY}`).toBeGreaterThan(1.3);
      expect(flight, `burstY ${burstY}`).toBeLessThan(2);
    }
  });

  it('lands the burst within a third of a second of the name it belongs to', () => {
    const REVEAL_INTERVAL_SECONDS = 1.5;
    for (const burstY of [0.09, 0.2, 0.32]) {
      const lateBy = flightSeconds(burstY) - REVEAL_INTERVAL_SECONDS;
      expect(lateBy, `burstY ${burstY}`).toBeGreaterThan(-0.35);
      expect(lateBy, `burstY ${burstY}`).toBeLessThan(0.35);
    }
  });
});
