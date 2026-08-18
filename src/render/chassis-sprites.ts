/**
 * Chassis sprites — the SPR 1 trial.
 *
 * Optional artwork that replaces a chassis's flat vector body on the build reveal only. The
 * arena is deliberately untouched: this is a timeboxed experiment, and the point of confining
 * it to one screen is that abandoning it costs one import.
 *
 * **Discovered by glob, not by import.** `materials.ts` names each of its files in a static
 * `import`, which is right for assets that ship with the repo — Vite hashes them and a typo is
 * a build error. It is exactly wrong here, because these files may not exist yet: a static
 * import of a missing PNG fails the build, so the trial would have to be all-or-nothing.
 * `import.meta.glob` instead means the set of sprites is whatever is in the folder. Drop one in
 * and that chassis gets it; the other five keep the vector body they have today. Drop none in
 * and this module is inert — which is the state it ships in.
 *
 * **Tinted, so light and greyscale.** Same constraint as the armour textures and the same
 * reason: `tint` multiplies and can only darken, so anything with colour of its own turns a
 * member's identity to mud. See `docs/sprite-prompts.md`.
 *
 * **Not part of the checksum, not part of the simulation.** A sprite changes what a bot looks
 * like on one screen. It cannot change what a bot does, and no file here is read by anything
 * under `src/sim/`.
 */

import { Assets, type Texture } from 'pixi.js';

/**
 * Every sprite in `./sprites/`, as a URL, keyed by path.
 *
 * **WebP, not PNG**, though both are accepted so a freshly generated file can be dropped in and
 * looked at before it is converted. The three trial sprites arrived as 1254x1254 PNGs totalling
 * 6.5 MB, against 321 KB for every armour and floor texture the site ships combined. Cropped to
 * their opaque bounds, resized to 768 (which is the portrait's own size on a retina display, so
 * nothing is thrown away that anybody could see) and saved as WebP at quality 90, the same three
 * are 435 KB -- 93.5% smaller. Measured on visible pixels only, that quality setting costs 40.6 dB
 * PSNR, or an RMSE of 2.4 on scuffed metal; measuring RGB across the transparent region as well
 * makes it look far worse than it is, because the colour under a zero alpha is meaningless.
 *
 * They are also fetched at the build reveal rather than at boot, since `mountBotPortraitStage` is
 * where the load is kicked off -- so this weight never delays the landing screen or the Forge.
 *
 * `query: '?url'` keeps this to a string per file rather than pulling the images into the
 * module graph, and `eager: true` resolves the map at build time — the set of files is known
 * statically even though the individual names are not.
 */
const SPRITE_URLS = import.meta.glob<string>('./sprites/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** `./sprites/chassis-wedge.webp` -> `chassis-wedge`, which is the part id the tables use. */
function chassisIdFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.(png|webp)$/i, '');
}

/** Chassis id -> sprite URL, for whatever happens to be in the folder. */
const URL_BY_CHASSIS: ReadonlyMap<string, string> = new Map(
  Object.entries(SPRITE_URLS).map(([path, url]) => [chassisIdFromPath(path), url]),
);

const loaded = new Map<string, Texture>();

/** The in-flight load, so every caller awaits the same work — see `materials.ts` for why this
 *  is a stored promise rather than a `started` boolean. */
let pending: Promise<void> | null = null;

/**
 * Loads whatever sprites exist. Resolves when they have all settled, and never rejects.
 *
 * With an empty folder this resolves immediately and `chassisSprite` returns null forever,
 * which is the same answer the site gave before this file existed.
 */
export function loadChassisSprites(): Promise<void> {
  if (pending !== null) return pending;

  const each = [...URL_BY_CHASSIS].map(async ([chassisId, url]) => {
    try {
      const texture = (await Assets.load(url)) as Texture;
      // A texture that loaded without a usable source would draw as a blank rectangle over the
      // chassis — worse than not drawing at all, because it hides the working vector body.
      if (texture?.source) loaded.set(chassisId, texture);
    } catch {
      // Swallowed deliberately: a missing or broken sprite means the vector chassis, which is
      // a perfectly good bot and the one every member had until this trial.
    }
  });

  pending = Promise.all(each).then(() => undefined);
  return pending;
}

/**
 * The sprite for a chassis, or null.
 *
 * Null is the normal answer, not an error: before loading finishes, for any chassis with no
 * file, and for every chassis while the folder is empty. Callers must treat it as "draw the
 * vector body".
 */
export function chassisSprite(chassisId: string): Texture | null {
  return loaded.get(chassisId) ?? null;
}

/** Which chassis have a sprite file present. For tests and for reporting what the trial
 *  actually covers — note this is what is on DISK, not what has finished loading. */
export function spritedChassisIds(): string[] {
  return [...URL_BY_CHASSIS.keys()].sort();
}

/** True when no sprite files exist at all, i.e. the trial has not started. Lets the portrait
 *  skip the load entirely rather than awaiting a promise that resolves over nothing. */
export function spritesAbsent(): boolean {
  return URL_BY_CHASSIS.size === 0;
}

/** Test seam: forgets what has loaded and allows loading to be started again. */
export function resetChassisSpritesForTest(): void {
  loaded.clear();
  pending = null;
}
