/**
 * Chassis and weapon sprites — the SPR 1 trial, and its follow-on.
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

/**
 * The weapons, in their own subfolder.
 *
 * A separate glob rather than a recursive one, because the two sets are keyed on different
 * part tables and a weapon file that landed in the chassis map would silently match nothing.
 * The chassis pattern is a single `*`, so it never reaches in here by accident.
 */
const WEAPON_URLS = import.meta.glob<string>('./sprites/weapons/*.{png,webp}', {
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

/**
 * Weapon key -> sprite URL.
 *
 * Keyed on the file's own stem rather than the weapon's part id, because one of them is not a
 * weapon at all: `weapon-hammer-head` is the hammer's HEAD, and the hammer's arm stays vector
 * so it can go on foreshortening as the weapon lifts. Mapping that file onto `weapon-hammer`
 * would put a sprite over the whole weapon and lose the two-piece motion that makes a crush
 * read from an overhead camera.
 */
const URL_BY_WEAPON: ReadonlyMap<string, string> = new Map(
  Object.entries(WEAPON_URLS).map(([path, url]) => [chassisIdFromPath(path), url]),
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

  const each = [...URL_BY_CHASSIS, ...URL_BY_WEAPON].map(async ([chassisId, url]) => {
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

/**
 * The sprite for a weapon, or null.
 *
 * `key` is the file stem, not always a part id — see `URL_BY_WEAPON`. Null means "draw the
 * vector weapon", which is what every weapon did before this existed and what any weapon
 * without a file still does.
 */
export function weaponSprite(key: string): Texture | null {
  return loaded.get(key) ?? null;
}

/** Which weapon sprites are present on disk. */
export function spritedWeaponKeys(): string[] {
  return [...URL_BY_WEAPON.keys()].sort();
}

/** True when no sprite files exist at all, i.e. the trial has not started. Lets the portrait
 *  skip the load entirely rather than awaiting a promise that resolves over nothing. */
export function spritesAbsent(): boolean {
  return URL_BY_CHASSIS.size === 0 && URL_BY_WEAPON.size === 0;
}

/**
 * Whether the arena draws sprited machines. On, unless `?vectorbots` says otherwise.
 *
 * This shipped after being prototyped behind a flag and watched both ways, and the flag has
 * been inverted rather than deleted so there is still a way back on the night if anything
 * about the sprited arena ever looks wrong in the room.
 *
 * **What it cost, measured, and what was done about it.** Sprites multiply every member's
 * colour down, and on the one screen where ten machines have to be told apart at a glance the
 * worst-separated pair fell from dE 23.1 to 16.9 — a 27% loss, landing on the pairs already
 * fought over (Tommy/Nick Lenker and Spencer/Rob). That was the real objection, and it is
 * answered in `arena-renderer.ts` by dropping the armour GRAIN in the arena rather than by
 * giving up the look: sprite without grain measures 22.3, within 3.5% of the vector arena, and
 * the second-worst pair actually improves. The material still shows on the build reveal, which
 * is the screen that asks what a machine is made of; at forty pixels the grain was invisible
 * anyway, so the separation was being spent on texture nobody could resolve.
 *
 * **What it did not cost.** Ten masked containers were supposed to add ten stencil operations a
 * frame. Measured over a real battle: median 1.9ms / worst 13.7ms vector against median 1.7ms /
 * worst 6.1ms sprited — no difference beyond this machine's run-to-run noise, with the cleaner
 * tail belonging to the sprites. That objection did not survive a profiler and is recorded here
 * so it does not get re-argued from memory.
 */
export function battleSpritesEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    return !new URL(window.location.href).searchParams.has('vectorbots');
  } catch {
    // A malformed URL is not a reason to draw a different battle than everyone else sees.
    return true;
  }
}

/** Test seam: forgets what has loaded and allows loading to be started again. */
export function resetChassisSpritesForTest(): void {
  loaded.clear();
  pending = null;
}
