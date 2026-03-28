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
  MIN_HP: 5,
  MAX_HP: 2000,
};

export const TERRAIN_SPEED_MULTIPLIERS = {
  ROAD: 1.5,
  DEFAULT: 1.0,
  FOREST: 0.6,
  WATER: 0.4,
  MOUNTAIN: 0.2,
};

export const INITIAL_UNITS_PER_PLAYER = 5;
