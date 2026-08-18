import { Surface, effectOf, type SurfaceValue } from '../sim/arena/surface';
import { OIL_COLOR, PLAIN_FLOOR_COLOR, SURFACE_COLOR } from '../render/floor-state';

/**
 * The floor key shown on what-to-expect's "The arenas" panel.
 *
 * Data, not markup, and deliberately in its own module: the screen that renders it imports
 * PixiJS, and this needs to be testable without a canvas. What the tests actually pin is the
 * thing that will go wrong on its own — **drift**. Two kinds:
 *
 * 1. **Colour drift.** Every swatch takes its colour from the renderer's own constants rather
 *    than a hardcoded copy, so a legend that says "ice is this blue" cannot start lying the
 *    next time the floor is retuned. This is why `SURFACE_COLOR` and `PLAIN_FLOOR_COLOR` were
 *    moved out of `arena-renderer.ts` and into the Pixi-free `floor-state.ts`.
 *
 * 2. **Coverage drift.** The key describes exactly the surfaces the three arenas actually
 *    place — today Tar and Ice, and nothing else. `Surface` also defines Gravel and four
 *    conveyors, all of which are real, implemented, and used by ZERO arenas in the event. A
 *    legend listing them would teach the room to look for floors that never appear. The test
 *    walks `ARENA_VARIANTS` and fails if the two sets ever disagree — in either direction, so
 *    adding gravel to an arena later breaks the key rather than silently under-describing it.
 *
 * Oil is the one entry with no arena behind it, and it is here on purpose. It is not scenery:
 * the Oil Slick ability puts it down mid-battle. But it is black, it is on the floor, and bots
 * slide on it, so a viewer reads it as flooring and deserves to know what it is. Its entry says
 * where it comes from rather than pretending it is part of the arena.
 *
 * Deliberately NOT described here: the collapsing floor, and every hazard. The pits are real
 * but rarely decide anything; the saws, flames and cannons explain themselves the first time
 * they fire, and naming Crossfire's hidden traps in advance would give away the one thing that
 * arena is built around.
 */

export interface FloorKeyEntry {
  /** The surface this entry stands for. Oil has no surface of its own — see below. */
  readonly surface: SurfaceValue | null;
  readonly label: string;
  /** 24-bit RGB, taken from the renderer so a swatch can never drift from the floor. */
  readonly colour: number;
  readonly blurb: string;
}

/**
 * Tar's effect is `drag: 0.9` with grip untouched, so it takes speed and leaves steering
 * alone — a bot on tar handles normally and simply cannot get anywhere. That is the honest
 * description, and it is also the useful one: tar is where a fleeing bot gets caught.
 */
const TAR: FloorKeyEntry = {
  surface: Surface.Tar,
  label: 'Tar',
  colour: SURFACE_COLOR[Surface.Tar]!,
  blurb: 'Thick and black. Steering still works — you just cannot get anywhere, which is how a bot that would rather leave ends up in a fight.',
};

/**
 * Ice keeps `drag: 1` and drops grip to 0.12, so nothing slows down; it just stops being able
 * to change direction. Worth saying plainly, because "slippery" reads as "slow" to most people
 * and the opposite is true.
 */
const ICE: FloorKeyEntry = {
  surface: Surface.Ice,
  label: 'Ice',
  colour: SURFACE_COLOR[Surface.Ice]!,
  blurb: 'No grip at all. Nothing slows down — bots simply keep going the way they were already going, whether or not they are still pointing that way.',
};

/**
 * Oil IS ice underneath (`ability.ts` sets `Surface.Ice`, because slippery was already
 * solved), which is exactly why the key has to name it separately: identical behaviour,
 * completely different colour, and a different reason for being there.
 */
const OIL: FloorKeyEntry = {
  surface: null,
  label: 'Oil',
  colour: OIL_COLOR,
  blurb: 'Not built into the arena — someone’s ability dropped it. Slides exactly like ice, and whoever drives through it trails tyre marks until the wheels come clean.',
};

export const FLOOR_KEY: readonly FloorKeyEntry[] = [TAR, ICE, OIL];

/**
 * What each swatch is framed against: the arena's own plain floor.
 *
 * Not decoration — it is the fix for a measured problem. Tar (`0x241a10`) and oil
 * (`0x1a1726`) are very dark, and the key's card sits on `--bg-1`, which is darker still.
 * Measured contrast of the bare swatches against that card was **1.12:1** and **1.09:1** —
 * two black squares. The same two colours against the arena's plain floor measure 2.05:1
 * and 2.11:1, which is exactly why they are perfectly readable during a battle and
 * disappeared in the legend.
 *
 * So the swatch shows each surface the way a viewer will actually meet it: a patch of that
 * surface with the plain floor around it. The legend now carries the same contrast as the
 * thing it describes, rather than a flattering or a hopeless version of it.
 */
export const FLOOR_BACKDROP = PLAIN_FLOOR_COLOR;

/** `#rrggbb` for a key colour, for the swatch's inline style. */
export function swatchHex(colour: number): string {
  return `#${(colour & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** The surfaces the key claims to cover. Oil is excluded — it has no surface of its own, and
 *  the coverage test compares this against what the arenas place. */
export function keyedSurfaces(): Set<SurfaceValue> {
  const out = new Set<SurfaceValue>();
  for (const entry of FLOOR_KEY) if (entry.surface !== null) out.add(entry.surface);
  return out;
}

/** True when `surface` actually changes how a bot moves. Guards against the key one day
 *  describing a surface that is scenery with no effect. */
export function hasMovementEffect(surface: SurfaceValue): boolean {
  const e = effectOf(surface);
  return e.drag !== 1 || e.grip !== 1 || e.pushX !== 0 || e.pushY !== 0;
}
