export type PlayerID = 'player1' | 'player2';

export type EnvironmentObjectType = 'road' | 'forest' | 'water' | 'mountain';

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

export interface Unit {
  id: string;
  ownerId: PlayerID;
  unitType: string; // For future admin editor (e.g., 'infantry', 'tank')
  x: number;
  y: number;
  hp: number;
  maxHp: number; // For future admin editor
  radius: number;
  speed: number;
  attackRadius: number;
  targetX: number;
  targetY: number;
}

export interface CombatEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  lifetime: number;
}

export interface GameState {
  units: Unit[];
  players: Record<PlayerID, Player>;
  environmentObjects: EnvironmentObject[];
  width: number;
  height: number;
  combatEffects: CombatEffect[];
}
