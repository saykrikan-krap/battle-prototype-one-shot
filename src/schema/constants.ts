import type { Side, UnitType } from "./types";

export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 8;

export const TILE_LIMITS = {
  maxUnitsPerTile: 4,
  maxSizePerTile: 10
};

export const TIME_LIMIT_TICKS = 2000;

export const TICK_SPEEDS = [10, 20, 40] as const;

export const UNIT_SIZES: Record<UnitType, number> = {
  Infantry: 2,
  Archer: 2,
  Cavalry: 3,
  Mage: 2
};

export const UNIT_COSTS: Record<UnitType, { move: number; attack: number; wait: number }> = {
  Infantry: { move: 6, attack: 12, wait: 1 },
  Archer: { move: 6, attack: 14, wait: 1 },
  Cavalry: { move: 4, attack: 12, wait: 1 },
  Mage: { move: 6, attack: 16, wait: 1 }
};

export const UNIT_RANGES: Record<UnitType, number> = {
  Infantry: 1,
  Archer: 5,
  Cavalry: 1,
  Mage: 6
};

export const PROJECTILE_SPEED: Record<"Arrow" | "Fireball", number> = {
  Arrow: 2,
  Fireball: 3
};

export const DEPLOYMENT_COLUMNS: Record<Side, { start: number; end: number }> = {
  Red: { start: 0, end: 2 },
  Blue: { start: 9, end: 11 }
};

export const MIN_RANGED_DISTANCE = 1;

export const STALL_TICKS = 200;
