import { always, cycle } from './activation';
import { Surface, type SurfaceValue } from './surface';
import { ZoneShape, type Zone } from './zone';
import type { Emitter } from './projectile';

/**
 * The twelve named hazard presets, entirely as data.
 *
 * The Arena Builder reads this table to populate its palette. Every field on a preset is
 * overridable per placement — a preset is a starting point, not a constraint — which is
 * why adding a thirteenth hazard is a new row here rather than new code.
 *
 * Position and heading are deliberately absent: those come from where the admin drops the
 * hazard in the builder, not from the preset.
 */
export const HazardCategory = {
  Surface: 0,
  Zone: 1,
  Emitter: 2,
} as const;

export type HazardCategoryValue = (typeof HazardCategory)[keyof typeof HazardCategory];

export const HAZARD_NAMES = [
  'tar',
  'ice',
  'gravel',
  'conveyor',
  'saw',
  'flameJet',
  'spikeStrip',
  'crusher',
  'airBlaster',
  'electricPanel',
  'cannon',
  'laser',
] as const;

export type HazardName = (typeof HAZARD_NAMES)[number];

export interface HazardPreset {
  label: string;
  category: HazardCategoryValue;
  surface?: SurfaceValue;
  zone?: Omit<Zone, 'id' | 'x' | 'y' | 'heading'>;
  emitter?: Omit<Emitter, 'id' | 'x' | 'y' | 'heading' | 'wasActive'>;
}

const PRESETS: Record<HazardName, HazardPreset> = {
  // --- Surfaces --------------------------------------------------------
  tar: {
    label: 'Tar',
    category: HazardCategory.Surface,
    surface: Surface.Tar,
  },
  ice: {
    label: 'Ice',
    category: HazardCategory.Surface,
    surface: Surface.Ice,
  },
  gravel: {
    label: 'Gravel',
    category: HazardCategory.Surface,
    surface: Surface.Gravel,
  },
  conveyor: {
    label: 'Conveyor',
    category: HazardCategory.Surface,
    // Defaults to east; the builder lets the admin pick a direction, which selects one
    // of the four conveyor surface values.
    surface: Surface.ConveyorE,
  },

  // --- Zones -------------------------------------------------------------
  saw: {
    label: 'Saw Blade',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Circle,
      reach: 28,
      halfWidth: 0,
      damagePerTick: 0.55,
      knockback: 0.9,
      activation: always(),
    },
  },
  flameJet: {
    label: 'Flame Jet',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Cone,
      reach: 110,
      halfWidth: 26,
      damagePerTick: 0.4,
      knockback: 0.25,
      activation: cycle(180, 70),
    },
  },
  spikeStrip: {
    label: 'Spike Strip',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Circle,
      reach: 30,
      halfWidth: 0,
      damagePerTick: 0.35,
      // Zero knockback: a floor you must not stand on, not a thing that throws you.
      knockback: 0,
      activation: always(),
    },
  },
  crusher: {
    label: 'Crusher',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Circle,
      reach: 45,
      halfWidth: 0,
      damagePerTick: 1.4,
      knockback: 2.2,
      // Heaviest hitter, slowest cycle: a rare, dramatic slam.
      activation: cycle(240, 25),
    },
  },
  airBlaster: {
    label: 'Air Blaster',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Cone,
      reach: 140,
      halfWidth: 34,
      // Zero damage, largest knockback: purely positional. Its job is flinging bots
      // into OTHER hazards, not wearing them down.
      damagePerTick: 0,
      knockback: 2.6,
      activation: cycle(150, 45),
    },
  },
  electricPanel: {
    label: 'Electric Panel',
    category: HazardCategory.Zone,
    zone: {
      shape: ZoneShape.Circle,
      reach: 40,
      halfWidth: 0,
      damagePerTick: 0.5,
      // Zero knockback: a floor that periodically kills, not something that throws you.
      knockback: 0,
      activation: cycle(200, 60),
    },
  },

  // --- Emitters ------------------------------------------------------------
  cannon: {
    label: 'Cannon',
    category: HazardCategory.Emitter,
    emitter: {
      speed: 14,
      damage: 18,
      radius: 6,
      // activeTicks: 1 is deliberate — emitters fire on the rising edge of activation,
      // so a one-tick active window fires exactly one shot per period.
      activation: cycle(200, 1),
    },
  },
  laser: {
    label: 'Laser',
    category: HazardCategory.Emitter,
    emitter: {
      speed: 26,
      damage: 9,
      radius: 3,
      activation: cycle(90, 1),
    },
  },
};

/**
 * Returns a fresh copy of the named preset.
 *
 * Deep enough to matter: a shallow spread of the outer object would still share the
 * nested `zone`/`emitter`/`activation` objects with the table, so mutating a placement's
 * geometry (e.g. bumping `reach`) would silently corrupt every future placement of the
 * same preset.
 */
export function hazardPreset(name: HazardName): HazardPreset {
  const preset = PRESETS[name];
  const copy: HazardPreset = {
    label: preset.label,
    category: preset.category,
  };
  if (preset.surface !== undefined) {
    copy.surface = preset.surface;
  }
  if (preset.zone !== undefined) {
    copy.zone = { ...preset.zone, activation: { ...preset.zone.activation } };
  }
  if (preset.emitter !== undefined) {
    copy.emitter = { ...preset.emitter, activation: { ...preset.emitter.activation } };
  }
  return copy;
}
