export const GAME_WIDTH = 1200;
export const GAME_HEIGHT = 800;

export const PLAYER_COLORS = {
  player1: '#3B82F6', // Blue
  player2: '#EF4444', // Red
};

export const UNIT_CONFIG = {
  BASE_HP: 100,
  BASE_SPEED: 2,
  BASE_ATTACK_RADIUS_RATIO: 2.5, // Visible attack radius
  SUPPORT_RADIUS_RATIO: 1.5, // Radius within which allies combine HP
  HP_TO_RADIUS_RATIO: 0.5,
  COMBAT_BASE_DAMAGE: 0.2, // Base HP drain per frame
  MIN_HP: 10,
  MAX_HP: 2000,
  ARTILLERY_COOLDOWN: 15000, // 15 seconds in ms
  ARTILLERY_ATTACK_RADIUS_RATIO: 24, // Triple the previous 8
  AIRCRAFT_SPEED: 6,
  AIRCRAFT_AMMO_BOMBS: 2,
  AIRCRAFT_AMMO_MISSILES: 2,
  AIRCRAFT_LAUNCH_DISTANCE: 200,
  AIRCRAFT_REFUEL_TIME: 10000, // 10 seconds
  PROJECTILE_SPEED_MISSILE: 12,
  PROJECTILE_SPEED_BOMB: 6, // Half of missile speed
  PROJECTILE_DAMAGE_BOMB: 150, // More damage
  PROJECTILE_DAMAGE_MISSILE: 100,
  PROJECTILE_BUILDING_MULTIPLIER_BOMB: 2.5, // Bombs are very effective against buildings
  PROJECTILE_BUILDING_MULTIPLIER_MISSILE: 1.2,
  AA_COOLDOWN: 2000, // 2 seconds between shots
  AA_HIT_CHANCE: 75, // 75% chance to destroy target
  AA_ATTACK_RADIUS_RATIO: 24, // Reduced from 48 to 24
  DEFAULT_AA_EFFICIENCY: 75, // Default hit chance
};

export const TERRAIN_SPEED_MULTIPLIERS = {
  ROAD: 1.5,
  DEFAULT: 1.0,
  FOREST: 0.6,
  WATER: 0.4,
  MOUNTAIN: 0.2,
};

export const INITIAL_UNITS_PER_PLAYER = 5;

export const BUILDING_CONFIG = {
  BASE_HP: 500,
  WIDTH: 60,
  HEIGHT: 60,
  OCCUPY_RADIUS: 40, // Distance to enter a building
};
