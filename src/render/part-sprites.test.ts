import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { partsFor } from '../sim/parts/tables';
import {
  chassisSprite,
  spritedChassisIds,
  spritedWeaponKeys,
  spritesAbsent,
  weaponSprite,
} from './part-sprites';

const SPRITE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'sprites');

/** Every image under the sprite folder, weapons included, with its size on disk. */
function spriteFiles(dir = SPRITE_DIR): { name: string; ext: string; bytes: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    // Recursive on purpose: the weapons live in their own subfolder, and a guard that only
    // looked at the top level would wave through exactly the 2 MB PNGs it exists to catch.
    if (entry.isDirectory()) return spriteFiles(full);
    if (!/\.(png|webp)$/i.test(entry.name)) return [];
    return [{ name: entry.name, ext: extname(entry.name).toLowerCase(), bytes: statSync(full).size }];
  });
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

describe('the weapon sprites', () => {
  const WEAPON_IDS = new Set(partsFor('weapon').map((p) => p.id));

  it("only claims weapons that exist, allowing the hammer's head as its own piece", () => {
    // Same silent trap as the chassis: the loader keys on the FILENAME, so a misnamed file
    // loads fine, matches nothing and draws nothing. `weapon-hammer-head` is the one legal
    // name that is not itself a part id — the hammer's head is sprited separately so the arm
    // beneath it can still foreshorten.
    for (const key of spritedWeaponKeys()) {
      const isPart = WEAPON_IDS.has(key);
      const isHammerHead = key === 'weapon-hammer-head';
      expect(isPart || isHammerHead, `no weapon named "${key}" — check the filename`).toBe(true);
    }
  });

  it('returns null for a weapon with no sprite, rather than throwing', () => {
    expect(weaponSprite('weapon-does-not-exist')).toBeNull();
  });

  it('never sprites the hammer as one rigid piece', () => {
    // `weapon-hammer.webp` would cover the whole weapon, head and arm together, and the crush
    // would become a swing — the arm has to collapse under the head for the motion to read
    // from an overhead camera at all.
    expect(spritedWeaponKeys()).not.toContain('weapon-hammer');
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
