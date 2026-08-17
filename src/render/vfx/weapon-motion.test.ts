import { describe, it, expect } from 'vitest';
import { edgeScale, hammerPose, hammerProgress, spinAngle } from './weapon-motion';

/**
 * The shape of each motion, asserted rather than eyeballed.
 *
 * This is the file that makes weapon animation checkable without a browser — which matters,
 * because the alternative is watching a two-minute battle hoping a hammer connects while it
 * is on screen, and a hammer lands about one blow every two seconds.
 */

/** Samples a whole hammer stroke. */
function stroke(steps = 60) {
  return Array.from({ length: steps + 1 }, (_, i) => hammerPose(i / steps));
}

describe('the hammer crush', () => {
  it('starts and ends at rest, so it can fire again without a jump', () => {
    for (const pose of [hammerPose(0), hammerPose(1)]) {
      expect(pose.reach).toBeCloseTo(1, 2);
      expect(pose.size).toBeCloseTo(1, 2);
    }
  });

  it('collapses the arm almost to nothing at the top, so the head can hide it', () => {
    // The counter-intuitive half of the projection. Seen from above, a hammer rearing up gets
    // shorter, not longer -- and a haft standing straight up projects to a POINT. Leaving the
    // arm at, say, 60% would keep it sticking out from under the head the whole way up, which
    // is what made the first attempt read as a shrug rather than a swing.
    const poses = stroke();
    const shortest = Math.min(...poses.map((p) => p.reach));
    expect(shortest).toBeLessThan(0.2);
  });

  it('makes the head bigger at the top, which is the cue that sells "up"', () => {
    // Foreshortening alone reads as the hammer retracting into the bot. Growing it says the
    // head is nearer the camera.
    const poses = stroke();
    const biggest = Math.max(...poses.map((p) => p.size));
    expect(biggest).toBeGreaterThan(1.2);
  });

  it('is at its shortest exactly when it is at its biggest — the top of the lift', () => {
    const poses = stroke();
    const shortestAt = poses.indexOf(poses.reduce((a, b) => (b.reach < a.reach ? b : a)));
    const biggestAt = poses.indexOf(poses.reduce((a, b) => (b.size > a.size ? b : a)));
    expect(Math.abs(shortestAt - biggestAt)).toBeLessThanOrEqual(1);
  });

  it('falls faster than it lifts, because a crush is not symmetrical', () => {
    const poses = stroke(100);
    const top = poses.indexOf(poses.reduce((a, b) => (b.size > a.size ? b : a)));
    // Back to roughly full reach after the top: that is the landing.
    const landed = poses.findIndex((p, i) => i > top && p.reach > 0.98);
    expect(landed).toBeGreaterThan(top);
    expect(landed - top).toBeLessThan(top);
  });

  it('squashes below rest on landing, so the bottom reads as an impact', () => {
    const poses = stroke(100);
    const smallest = Math.min(...poses.map((p) => p.size));
    expect(smallest).toBeLessThan(0.95);
  });

  it('never inverts or vanishes, whatever it is handed', () => {
    for (const p of [-5, 0, 0.5, 1, 40, Number.NaN]) {
      const pose = hammerPose(p);
      expect(pose.reach, String(p)).toBeGreaterThan(0.1);
      expect(pose.size, String(p)).toBeGreaterThan(0.1);
    }
  });
});

describe('the hammer landing on the beat', () => {
  const STROKE = 26;

  /** The pose a bot's hammer shows `ticksToStrike` ticks before it may strike. */
  const at = (ticksToStrike: number) => hammerPose(hammerProgress(ticksToStrike, STROKE));

  it('lands its smash exactly ON the strike, not after it', () => {
    // The point of the whole exercise. At the strike tick the head is down: full reach, and
    // squashing rather than raised.
    const landing = at(0);
    expect(landing.reach).toBeCloseTo(1, 2);
    expect(landing.size).toBeLessThanOrEqual(1);
  });

  it('is at the top of its lift BEFORE the strike, so the blow is telegraphed', () => {
    const raised = at(4);
    expect(raised.reach).toBeLessThan(0.85);
    expect(raised.size).toBeGreaterThan(1.1);
  });

  it('rests when a strike is far off, so an idle bot is not pumping its hammer', () => {
    for (const far of [20, 30, 200]) {
      const pose = at(far);
      expect(pose.reach, `${far} ticks out`).toBeCloseTo(1, 2);
      expect(pose.size, `${far} ticks out`).toBeCloseTo(1, 2);
    }
  });

  it('rests once the strike is long past, which is how disengaging ends the swing', () => {
    // A bot that stops connecting leaves `nextAttackTick` in the past forever. It must settle,
    // not keep cycling.
    for (const past of [-30, -100, -5000]) {
      const pose = at(past);
      expect(pose.reach, `${past}`).toBeCloseTo(1, 2);
      expect(pose.size, `${past}`).toBeCloseTo(1, 2);
    }
  });

  it('runs forward through the stroke as the strike approaches', () => {
    const seen = Array.from({ length: 40 }, (_, i) => hammerProgress(20 - i, STROKE));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!, `tick ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it('survives nonsense by resting rather than by collapsing the weapon', () => {
    expect(hammerProgress(Number.NaN, STROKE)).toBe(1);
    expect(hammerProgress(5, 0)).toBe(1);
  });
});

describe('spin', () => {
  it('turns steadily and stays bounded over a long battle', () => {
    expect(spinAngle(0, 0.4)).toBe(0);
    expect(spinAngle(1, 0.4)).toBeCloseTo(0.4);
    // Three minutes at 60Hz would otherwise accumulate thousands of radians.
    for (const tick of [10_000, 100_000]) {
      const a = spinAngle(tick, 0.42);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  it('survives nonsense rather than rotating a weapon to NaN', () => {
    expect(spinAngle(Number.NaN, 0.4)).toBe(0);
  });
});

describe('the vertical spinner edge', () => {
  it('thins and swells twice per revolution rather than rotating', () => {
    const samples = Array.from({ length: 200 }, (_, t) => edgeScale(t, 0.42));
    expect(Math.min(...samples)).toBeLessThan(0.35);
    expect(Math.max(...samples)).toBeGreaterThan(0.95);
  });

  it('never disappears, because a weapon that flickers out reads as a bug', () => {
    for (let t = 0; t < 500; t++) {
      expect(edgeScale(t, 0.42), `tick ${t}`).toBeGreaterThan(0.15);
    }
    expect(edgeScale(Number.NaN, 0.42)).toBe(1);
  });
});
