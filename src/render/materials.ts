/**
 * The material textures, and which part wears which.
 *
 * Four decisions worth knowing about before changing anything here.
 *
 * **They load in the background and nothing waits for them.** Loading starts at boot but is
 * never awaited: the first beat that needs a texture is the build reveal, ten beats and several
 * minutes of Forge into the walkthrough, so there is no plausible way to arrive before 320 KB
 * has arrived. Blocking the landing screen on them would be paying a real cost to prevent an
 * impossible problem. `textureFor` simply returns null until they land, and a null texture draws
 * flat colour — exactly what the site did before this file existed.
 *
 * **A failure is not an error.** A texture that 404s, decodes wrong, or is blocked by a network
 * hiccup on draft night must leave a working site rather than a broken one. Every path here ends
 * in null rather than a throw, and null is a supported way to draw a bot.
 *
 * **They are tinted, so they are light.** `tint` multiplies, which can only darken. Every
 * texture in `src/render/textures/` was generated deliberately light and desaturated so the
 * member's colour survives being multiplied through it — see `docs/texture-prompts.md`. This is
 * why carbon fibre, which is nearly black in reality, ships as mid-grey.
 *
 * **JPEG, not PNG.** The plan said PNG; these are photographic surfaces with no transparency,
 * where JPEG is several times smaller for no visible loss. 512x512 at quality 80 puts the whole
 * set at 321 KB, against 1.6 MB for the equivalent PNGs.
 */

import { Assets, type Texture } from 'pixi.js';

// Imported rather than referenced by path, so Vite hashes them for cache-busting and applies
// the `/QuestDraftSelector/` base prefix the GitHub Pages build needs. A hardcoded string would
// work in dev and 404 in production, which is the worst of the available failure modes.
import alloyUrl from './textures/armour-alloy.jpg';
import aluminiumUrl from './textures/armour-aluminium.jpg';
import carbonUrl from './textures/armour-carbon-fibre.jpg';
import uraniumUrl from './textures/armour-depleted-uranium.jpg';
import steelUrl from './textures/armour-hardened-steel.jpg';
import compositeUrl from './textures/armour-spiked-composite.jpg';
import titaniumUrl from './textures/armour-titanium.jpg';
import weaponSteelUrl from './textures/weapon-steel.jpg';

/** A material's name. One per armour part, plus the shared weapon metal. */
export type MaterialName =
  | 'alloy'
  | 'aluminium'
  | 'carbon'
  | 'uranium'
  | 'steel'
  | 'composite'
  | 'titanium'
  | 'weapon';

const URLS: Record<MaterialName, string> = {
  alloy: alloyUrl,
  aluminium: aluminiumUrl,
  carbon: carbonUrl,
  uranium: uraniumUrl,
  steel: steelUrl,
  composite: compositeUrl,
  titanium: titaniumUrl,
  weapon: weaponSteelUrl,
};

/**
 * Which armour part is made of what.
 *
 * Keyed on the part id rather than the slot index, because slot indices are a fact about the
 * Plinko board's ordering and would silently point at the wrong material if that table were
 * ever reordered. An id cannot drift.
 */
const ARMOUR_MATERIAL: Record<string, MaterialName> = {
  'armour-depleted-uranium': 'uranium',
  'armour-carbon-fibre': 'carbon',
  'armour-alloy': 'alloy',
  'armour-aluminium': 'aluminium',
  'armour-titanium': 'titanium',
  'armour-hardened-steel': 'steel',
  'armour-spiked-composite': 'composite',
};

const loaded = new Map<MaterialName, Texture>();

/**
 * The in-flight load, kept so every caller awaits the SAME work.
 *
 * A boolean `started` flag would be a trap: the second caller would get an
 * already-resolved promise while the first was still downloading, and would carry on believing
 * the textures were ready. Returning the stored promise means `await loadMaterials()` is a real
 * guarantee no matter who calls it or when.
 */
let pending: Promise<void> | null = null;

/**
 * Starts loading every material, once, and resolves when they have all settled.
 *
 * Deliberately never rejects, so a caller may await it without a failed download becoming an
 * unhandled rejection that takes out the boot sequence.
 */
export function loadMaterials(): Promise<void> {
  if (pending !== null) return pending;

  const each = Object.entries(URLS).map(async ([name, url]) => {
    try {
      const texture = (await Assets.load(url)) as Texture;
      // A texture that loaded but has no usable source is worse than one that failed outright,
      // because it would draw as a blank rectangle over the chassis rather than falling back.
      if (texture?.source) loaded.set(name as MaterialName, texture);
    } catch {
      // Swallowed on purpose. See the module comment: a missing material is a bot drawn in flat
      // colour, which is a perfectly good bot.
    }
  });

  pending = Promise.all(each).then(() => undefined);
  return pending;
}

/** The material an armour part is made of, or null for a part with no mapping. */
export function materialForArmour(partId: string): MaterialName | null {
  return ARMOUR_MATERIAL[partId] ?? null;
}

/**
 * The texture for a material, or null if it has not loaded or failed to.
 *
 * Null is the normal, supported answer — before loading finishes, and forever in any environment
 * without a GPU. Callers must treat it as "draw flat colour", never as an error.
 */
export function textureFor(material: MaterialName | null): Texture | null {
  if (material === null) return null;
  return loaded.get(material) ?? null;
}

/** The texture an armour part wears, going straight from part id to texture. */
export function armourTexture(partId: string): Texture | null {
  return textureFor(materialForArmour(partId));
}

/** Every material name, for tests and for anything that wants to enumerate them. */
export const MATERIAL_NAMES = Object.keys(URLS) as MaterialName[];

/** Test seam: forgets what has loaded and allows loading to be started again. */
export function resetMaterialsForTest(): void {
  loaded.clear();
  pending = null;
}
