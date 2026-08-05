import { tileIndexAt, type TileGrid } from './tiles';

/**
 * What the floor of a tile is made of.
 *
 * Surfaces are a property of the FLOOR, which is why they live on the tile grid rather
 * than being objects like saws. They change how a bot MOVES; they never damage it.
 */
export const Surface = {
  Plain: 0,
  Tar: 1,
  Ice: 2,
  Gravel: 3,
  ConveyorN: 4,
  ConveyorS: 5,
  ConveyorE: 6,
  ConveyorW: 7,
} as const;

export type SurfaceValue = (typeof Surface)[keyof typeof Surface];

export interface SurfaceEffect {
  /** Multiplies velocity each tick. Below 1 slows the bot. */
  drag: number;
  /** Scales how much sideways velocity grip removes. Below 1 slides, above 1 bites. */
  grip: number;
  /** Constant acceleration applied while on this tile. */
  pushX: number;
  pushY: number;
}

const CONVEYOR_PUSH = 0.16;

const EFFECTS: Record<SurfaceValue, SurfaceEffect> = {
  [Surface.Plain]: { drag: 1, grip: 1, pushX: 0, pushY: 0 },
  // Tar is the anti-retreat surface. Every bot has the same top speed, so a fleeing bot
  // normally cannot be caught; tar is where that stops being true.
  [Surface.Tar]: { drag: 0.9, grip: 1, pushX: 0, pushY: 0 },
  // Ice is what gives the `grip` stat consequences, and therefore what will make Tank
  // Tracks meaningfully different from Omni Wheels.
  [Surface.Ice]: { drag: 1, grip: 0.12, pushX: 0, pushY: 0 },
  // Gravel is the inverse of ice: it costs a little speed and rewards you with grip, so
  // a heavy high-traction build gains an advantage somewhere rather than only losing.
  [Surface.Gravel]: { drag: 0.96, grip: 1.9, pushX: 0, pushY: 0 },
  // Conveyors are positional, not damaging. Point one at a pit and it becomes a trap.
  [Surface.ConveyorN]: { drag: 1, grip: 1, pushX: 0, pushY: -CONVEYOR_PUSH },
  [Surface.ConveyorS]: { drag: 1, grip: 1, pushX: 0, pushY: CONVEYOR_PUSH },
  [Surface.ConveyorE]: { drag: 1, grip: 1, pushX: CONVEYOR_PUSH, pushY: 0 },
  [Surface.ConveyorW]: { drag: 1, grip: 1, pushX: -CONVEYOR_PUSH, pushY: 0 },
};

export function createSurfaceMap(grid: TileGrid): Uint8Array {
  return new Uint8Array(grid.cols * grid.rows).fill(Surface.Plain);
}

export function setSurface(surfaces: Uint8Array, index: number, surface: SurfaceValue): void {
  surfaces[index] = surface;
}

export function surfaceAt(
  grid: TileGrid,
  surfaces: Uint8Array,
  x: number,
  y: number,
): SurfaceValue {
  const index = tileIndexAt(grid, x, y);
  if (index < 0) return Surface.Plain;
  return surfaces[index] as SurfaceValue;
}

export function effectOf(surface: SurfaceValue): SurfaceEffect {
  return EFFECTS[surface] ?? EFFECTS[Surface.Plain];
}
