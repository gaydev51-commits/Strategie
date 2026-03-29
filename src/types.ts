export type PlayerID = 'player1' | 'player2';

export type EnvironmentObjectType = 'road' | 'forest' | 'water' | 'mountain' | 'runway';

export interface EnvironmentObject {
  id: string;
  type: EnvironmentObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // In radians
}

export interface Player {
  id: PlayerID;
  color: string;
  score: number;
}

export type AircraftState = 'idle' | 'takingOff' | 'flyingToTarget' | 'attacking' | 'returning' | 'landing' | 'refueling';
export type WeaponType = 'bomb' | 'missile' | 'both';

export interface Unit {
  id: string;
  ownerId: PlayerID;
  unitType: string; // 'infantry', 'tank', 'artillery', 'aircraft'
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  canCrossWater: boolean;
  waterSpeedMultiplier?: number;
  attackRadius: number;
  targetX: number;
  targetY: number;
  occupyingBuildingId?: string;
  lastAttackTime?: number;
  
  // Aircraft specific
  aircraftState?: AircraftState;
  ammo?: { bombs: number; missiles: number };
  selectedWeapon?: WeaponType;
  baseRunwayId?: string;
  attackPoint?: { x: number; y: number };
  
  // Anti-air
  canAttackAir?: boolean;
  airAttackEfficiency?: number; // 0 to 100
}

export interface Building {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  occupantId?: string; // ID of the unit currently inside
}

export interface HeightArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  elevation: number; // 1 to 50
}

export interface CombatEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  lifetime: number;
}

export interface AirProjectile {
  id: string;
  ownerId: PlayerID;
  type: WeaponType;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  speed: number;
  damage: number;
  lifetime: number;
}

export interface GameState {
  units: Unit[];
  players: Record<PlayerID, Player>;
  environmentObjects: EnvironmentObject[];
  buildings: Building[];
  heightAreas: HeightArea[];
  width: number;
  height: number;
  combatEffects: CombatEffect[];
  airProjectiles: AirProjectile[];
}
