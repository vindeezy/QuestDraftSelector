import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { partsFor } from '../sim/parts/tables';
import { chassisSprite, spritedChassisIds, spritesAbsent } from './chassis-sprites';

const SPRITE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'sprites');

/** Every image in the sprite folder, with its size on disk. */
function spriteFiles(): { name: string; ext: string; bytes: number }[] {
  return readdirSync(SPRITE_DIR)
    .filter((name) => /\.(png|webp)$/i.test(name))
    .map((name) => ({
      name,
      ext: extname(name).toLowerCase(),
      bytes: statSync(join(SPRITE_DIR, name)).size,
    }));
}

const CHASSIS_IDS = new Set(partsFor('chassis').map((p) => p.id));

describe('discovering sprite files', () => {
  it('only claims chassis ids that actually exist', () => {
    // The trap this exists for, and it is a silent one. The loader keys on the FILENAME, so a
    // sprite saved as `wedge.png` or `chassis-wedges.png` loads fine, matches no chassis, and
    // draws nothing — and the owner concludes the sprite experiment failed when what actually
    // failed was a filename. Vacuous while the folder is empty, which is the point: it starts
    // guarding the moment there is something to guard.
    for (const id of spritedChassisIds()) {
      expect(CHASSIS_IDS.has(id), `no chassis named "${id}" — check the filename`).toBe(true);
    }
  });

  it('agrees with itself about whether any sprites exist', () => {
    expect(spritesAbsent()).toBe(spritedChassisIds().length === 0);
  });

  it('returns null for a chassis with no sprite, rather than throwing', () => {
    // Null is the supported answer and the shipped one: it means "draw the vector body",
    // which is what every bot did before this trial and what they all do again if it is
    // abandoned.
    expect(chassisSprite('chassis-does-not-exist')).toBeNull();
  });

  it('returns null for every chassis before anything has loaded', () => {
    // `loadChassisSprites` is never called in this environment, so this also pins the
    // "textures are not ready yet" path that the real screen hits on first paint.
    for (const id of CHASSIS_IDS) {
      expect(chassisSprite(id), id).toBeNull();
    }
  });
});

describe('what actually ships', () => {
  /**
   * Per-file ceiling. The three trial sprites land at 117-181 KB after conversion, so this
   * leaves real headroom while still catching the failure it exists for: the same three
   * arrived as 1254x1254 PNGs of 1.7-2.8 MB each, and committing them would have put 6.5 MB
   * of chassis art on a site whose entire armour and floor texture set is 321 KB.
   */
  const MAX_SPRITE_BYTES = 300 * 1024;

  it('keeps every sprite under the size ceiling', () => {
    for (const file of spriteFiles()) {
      expect(
        file.bytes,
        `${file.name} is ${Math.round(file.bytes / 1024)} KB — run: python tools/convert-sprites.py`,
      ).toBeLessThanOrEqual(MAX_SPRITE_BYTES);
    }
  });

  it('ships WebP, not the raw generated PNG', () => {
    // `.png` still LOADS on purpose, so a fresh generation can be dropped in and looked at
    // before it is converted. This is the gate that stops one being committed that way — the
    // conversion also crops the transparent margin, without which the art draws inset from
    // its own outline.
    for (const file of spriteFiles()) {
      expect(file.ext, `${file.name} — run: python tools/convert-sprites.py`).toBe('.webp');
    }
  });
});

describe('what the trial covers', () => {
  it('never sprites a chassis that no member in the event actually has', () => {
    // Box is the live example: it exists, it is implemented, and seed 43000236 rolled it for
    // nobody. A Box sprite could not be looked at on any screen, so shipping one would be
    // download weight for an image the site cannot display — the same mistake `weapon-steel`
    // made before it was wired up. Deliberately checked against the CHASSIS TABLE plus a
    // hand-maintained list rather than against the record, because this file must not import
    // the event runner.
    const NEVER_ROLLED = new Set(['chassis-box']);
    for (const id of spritedChassisIds()) {
      expect(NEVER_ROLLED.has(id), `${id} is not rolled by any member in the official event`).toBe(
        false,
      );
    }
  });
});
