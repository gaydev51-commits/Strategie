/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sword, Shield, Activity, Users, Target, MousePointer2, Plus, Minus } from 'lucide-react';
import { PlayerID, Unit, Player, GameState, EnvironmentObject, Building, HeightArea } from './types.ts';
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_COLORS, UNIT_CONFIG, INITIAL_UNITS_PER_PLAYER, TERRAIN_SPEED_MULTIPLIERS, BUILDING_CONFIG } from './constants.ts';

// --- Helper Functions ---

const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

const getRadiusFromHP = (hp: number) => {
  return Math.sqrt(hp) * 2; // Adjusted for visibility
};

const getFormationOffsets = (count: number, spacing: number = 50) => {
  const offsets: { dx: number, dy: number }[] = [];
  if (count <= 1) return [{ dx: 0, dy: 0 }];

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    offsets.push({
      dx: (c - (cols - 1) / 2) * spacing,
      dy: (r - (rows - 1) / 2) * spacing
    });
  }
  return offsets;
};

const createUnit = (id: string, ownerId: PlayerID, x: number, y: number, hp: number, unitType: string = 'infantry'): Unit => {
  const radius = getRadiusFromHP(hp);
  const isAmphibious = unitType === 'amphibious';
  const isArtillery = unitType === 'artillery';
  const isAircraft = unitType === 'aircraft';
  const isAA = unitType === 'aa';
  
  const attackRadiusRatio = isArtillery 
    ? UNIT_CONFIG.ARTILLERY_ATTACK_RADIUS_RATIO 
    : isAA
      ? UNIT_CONFIG.AA_ATTACK_RADIUS_RATIO
      : isAircraft
        ? 1 // Aircraft uses attackPoint, not radius for engagement
        : UNIT_CONFIG.BASE_ATTACK_RADIUS_RATIO;

  let speed = UNIT_CONFIG.BASE_SPEED;
  if (isArtillery || isAA) speed *= 0.5;
  if (isAircraft) speed = UNIT_CONFIG.AIRCRAFT_SPEED;

  return {
    id,
    ownerId,
    unitType,
    x,
    y,
    hp,
    maxHp: hp,
    radius,
    speed,
    canCrossWater: isAmphibious || isAircraft,
    waterSpeedMultiplier: isAircraft ? 1.0 : (isAmphibious ? 0.5 : 0),
    attackRadius: radius * attackRadiusRatio,
    targetX: x,
    targetY: y,
    lastAttackTime: (isArtillery || isAircraft || isAA) ? 0 : undefined,
    aircraftState: isAircraft ? 'idle' : undefined,
    ammo: isAircraft ? { bombs: UNIT_CONFIG.AIRCRAFT_AMMO_BOMBS, missiles: UNIT_CONFIG.AIRCRAFT_AMMO_MISSILES } : undefined,
    selectedWeapon: isAircraft ? 'both' : undefined,
    canAttackAir: isAA,
    airAttackEfficiency: isAA ? UNIT_CONFIG.DEFAULT_AA_EFFICIENCY : 0,
  };
};

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>(() => {
    const units: Unit[] = [];

    const environmentObjects: EnvironmentObject[] = [
      { id: 'road-1', type: 'road', x: 0, y: 380, width: 1200, height: 40 },
      { id: 'road-2', type: 'road', x: 580, y: 0, width: 40, height: 800 },
      { id: 'forest-1', type: 'forest', x: 200, y: 100, width: 200, height: 200 },
      { id: 'forest-2', type: 'forest', x: 800, y: 500, width: 250, height: 200 },
      { id: 'water-1', type: 'water', x: 400, y: 500, width: 400, height: 150 },
      { id: 'runway-1', type: 'runway', x: 50, y: 300, width: 150, height: 60 },
      { id: 'runway-2', type: 'runway', x: 1000, y: 300, width: 150, height: 60 },
    ];
    
    // Initial units for Player 1 (Left side)
    for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
      const type = i === 0 ? 'amphibious' : i === 1 ? 'artillery' : i === 2 ? 'aa' : 'infantry';
      units.push(createUnit(`p1-${i}`, 'player1', 100 + Math.random() * 100, 100 + Math.random() * 600, 100, type));
    }
    // Add an aircraft for player 1
    const p1Aircraft = createUnit('p1-air-1', 'player1', 125, 330, 100, 'aircraft');
    p1Aircraft.baseRunwayId = 'runway-1';
    units.push(p1Aircraft);
    
    // Initial units for Player 2 (Right side)
    for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
      const type = i === 0 ? 'amphibious' : i === 1 ? 'artillery' : i === 2 ? 'aa' : 'infantry';
      units.push(createUnit(`p2-${i}`, 'player2', 1000 + Math.random() * 100, 100 + Math.random() * 600, 100, type));
    }
    // Add an aircraft for player 2
    const p2Aircraft = createUnit('p2-air-1', 'player2', 1075, 330, 100, 'aircraft');
    p2Aircraft.baseRunwayId = 'runway-2';
    units.push(p2Aircraft);

    const buildings: Building[] = [
      { id: 'building-1', x: 300, y: 300, width: BUILDING_CONFIG.WIDTH, height: BUILDING_CONFIG.HEIGHT, hp: BUILDING_CONFIG.BASE_HP, maxHp: BUILDING_CONFIG.BASE_HP },
      { id: 'building-2', x: 900, y: 300, width: BUILDING_CONFIG.WIDTH, height: BUILDING_CONFIG.HEIGHT, hp: BUILDING_CONFIG.BASE_HP, maxHp: BUILDING_CONFIG.BASE_HP },
      { id: 'building-3', x: 600, y: 150, width: BUILDING_CONFIG.WIDTH, height: BUILDING_CONFIG.HEIGHT, hp: BUILDING_CONFIG.BASE_HP, maxHp: BUILDING_CONFIG.BASE_HP },
    ];

    const heightAreas: HeightArea[] = [
      { id: 'height-1', x: 50, y: 50, width: 150, height: 150, elevation: 15 },
      { id: 'height-2', x: 1000, y: 50, width: 150, height: 150, elevation: 25 },
      { id: 'height-3', x: 50, y: 600, width: 150, height: 150, elevation: 35 },
      { id: 'height-4', x: 1000, y: 600, width: 150, height: 150, elevation: 45 },
    ];

    return {
      units,
      players: {
        player1: { id: 'player1', color: PLAYER_COLORS.player1, score: 0 },
        player2: { id: 'player2', color: PLAYER_COLORS.player2, score: 0 },
      },
      environmentObjects,
      buildings,
      heightAreas,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      combatEffects: [],
      airProjectiles: [],
    };
  });

  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [activePlayer, setActivePlayer] = useState<PlayerID>('player1');
  const [selectionBox, setSelectionBox] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const lastMousePos = useRef<{ x: number, y: number } | null>(null);

  // --- Game Loop ---

  useEffect(() => {
    let animationFrameId: number;

    const update = () => {
      setGameState((prev) => {
        const nextUnits = prev.units.map(u => ({ ...u }));
        const nextBuildings = prev.buildings.map(b => ({ ...b }));
        const nextCombatEffects = prev.combatEffects
          .map(e => ({ ...e, lifetime: e.lifetime - 1 }))
          .filter(e => e.lifetime > 0);
        
        const nextAirProjectiles = prev.airProjectiles
          .map(p => {
            const angle = Math.atan2(p.targetY - p.y, p.targetX - p.x);
            const dist = getDistance(p.x, p.y, p.targetX, p.targetY);
            if (dist < p.speed) {
              return { ...p, x: p.targetX, y: p.targetY, lifetime: 0 };
            }
            return {
              ...p,
              x: p.x + Math.cos(angle) * p.speed,
              y: p.y + Math.sin(angle) * p.speed,
              lifetime: p.lifetime - 1
            };
          })
          .filter(p => p.lifetime > 0);

        // Sync building occupants with unit states
        nextBuildings.forEach(b => b.occupantId = undefined);
        nextUnits.forEach(u => {
          if (u.occupyingBuildingId) {
            const b = nextBuildings.find(building => building.id === u.occupyingBuildingId);
            if (b) b.occupantId = u.id;
          }
        });

        // 1. Movement and Separation
        nextUnits.forEach((unit) => {
          if (unit.unitType === 'aircraft') {
            // Aircraft State Machine
            const runway = prev.environmentObjects.find(obj => obj.id === unit.baseRunwayId);
            const runwayX = runway ? runway.x + runway.width / 2 : unit.x;
            const runwayY = runway ? runway.y + runway.height / 2 : unit.y;

            switch (unit.aircraftState) {
              case 'idle':
                // Stay at runway
                unit.x = runwayX;
                unit.y = runwayY;
                break;
              case 'takingOff':
                unit.aircraftState = 'flyingToTarget';
                break;
              case 'flyingToTarget':
                if (unit.attackPoint) {
                  const dist = getDistance(unit.x, unit.y, unit.attackPoint.x, unit.attackPoint.y);
                  if (dist < UNIT_CONFIG.AIRCRAFT_LAUNCH_DISTANCE) {
                    unit.aircraftState = 'attacking';
                  } else {
                    const angle = Math.atan2(unit.attackPoint.y - unit.y, unit.attackPoint.x - unit.x);
                    unit.x += Math.cos(angle) * unit.speed;
                    unit.y += Math.sin(angle) * unit.speed;
                  }
                } else {
                  unit.aircraftState = 'returning';
                }
                break;
              case 'attacking':
                if (unit.attackPoint && unit.ammo && unit.selectedWeapon) {
                  const weapon = unit.selectedWeapon;
                  const weaponsToLaunch: ('bomb' | 'missile')[] = [];
                  if (weapon === 'both') {
                    if (unit.ammo.bombs > 0) weaponsToLaunch.push('bomb');
                    if (unit.ammo.missiles > 0) weaponsToLaunch.push('missile');
                  } else {
                    if (unit.ammo[weapon === 'bomb' ? 'bombs' : 'missiles'] > 0) {
                      weaponsToLaunch.push(weapon as 'bomb' | 'missile');
                    }
                  }

                  weaponsToLaunch.forEach(w => {
                    // Launch projectile
                    nextAirProjectiles.push({
                      id: `proj-${Date.now()}-${Math.random()}`,
                      ownerId: unit.ownerId,
                      type: w,
                      x: unit.x,
                      y: unit.y,
                      targetX: unit.attackPoint!.x,
                      targetY: unit.attackPoint!.y,
                      speed: w === 'bomb' ? UNIT_CONFIG.PROJECTILE_SPEED_BOMB : UNIT_CONFIG.PROJECTILE_SPEED_MISSILE,
                      damage: w === 'bomb' ? UNIT_CONFIG.PROJECTILE_DAMAGE_BOMB : UNIT_CONFIG.PROJECTILE_DAMAGE_MISSILE,
                      lifetime: 200
                    });
                    unit.ammo![w === 'bomb' ? 'bombs' : 'missiles']--;
                  });
                }
                unit.aircraftState = 'returning';
                break;
              case 'returning':
                const distToBase = getDistance(unit.x, unit.y, runwayX, runwayY);
                if (distToBase < 10) {
                  unit.aircraftState = 'landing';
                } else {
                  const angle = Math.atan2(runwayY - unit.y, runwayX - unit.x);
                  unit.x += Math.cos(angle) * unit.speed;
                  unit.y += Math.sin(angle) * unit.speed;
                }
                break;
              case 'landing':
                unit.x = runwayX;
                unit.y = runwayY;
                unit.lastAttackTime = Date.now(); // Use for refueling timer
                unit.aircraftState = 'refueling';
                break;
              case 'refueling':
                if (Date.now() - (unit.lastAttackTime || 0) > UNIT_CONFIG.AIRCRAFT_REFUEL_TIME) {
                  unit.ammo = { bombs: UNIT_CONFIG.AIRCRAFT_AMMO_BOMBS, missiles: UNIT_CONFIG.AIRCRAFT_AMMO_MISSILES };
                  unit.aircraftState = 'idle';
                }
                break;
            }
            return; // Skip normal movement/separation for aircraft
          }

          // Retreat logic: if HP is low, move towards home base
          const isLowHP = unit.hp < unit.maxHp * 0.25;
          let effectiveTargetX = unit.targetX;
          let effectiveTargetY = unit.targetY;

          if (isLowHP && !unit.occupyingBuildingId) {
            // Move towards starting side
            effectiveTargetX = unit.ownerId === 'player1' ? 50 : GAME_WIDTH - 50;
            // Stay at current Y or move towards center Y
            effectiveTargetY = unit.y + (GAME_HEIGHT / 2 - unit.y) * 0.01;
          }

          // If unit is in a building, it doesn't move and stays at building center
          if (unit.occupyingBuildingId) {
            const building = nextBuildings.find(b => b.id === unit.occupyingBuildingId);
            if (building) {
              unit.x = building.x + building.width / 2;
              unit.y = building.y + building.height / 2;
              return;
            } else {
              // Building destroyed
              unit.occupyingBuildingId = undefined;
            }
          }

          // Check if unit should enter a building
          const nearbyBuilding = nextBuildings.find(b => 
            !b.occupantId && 
            getDistance(effectiveTargetX, effectiveTargetY, b.x + b.width / 2, b.y + b.height / 2) < 5 &&
            getDistance(unit.x, unit.y, b.x + b.width / 2, b.y + b.height / 2) < BUILDING_CONFIG.OCCUPY_RADIUS
          );

          if (nearbyBuilding) {
            unit.occupyingBuildingId = nearbyBuilding.id;
            nearbyBuilding.occupantId = unit.id;
            unit.x = nearbyBuilding.x + nearbyBuilding.width / 2;
            unit.y = nearbyBuilding.y + nearbyBuilding.height / 2;
            unit.targetX = unit.x;
            unit.targetY = unit.y;
            return;
          }
          // Determine terrain speed multiplier
          let speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.DEFAULT;
          
          const currentTerrain = prev.environmentObjects.find(obj => 
            unit.x >= obj.x && unit.x <= obj.x + obj.width &&
            unit.y >= obj.y && unit.y <= obj.y + obj.height
          );

          const isInWater = currentTerrain?.type === 'water';

          if (currentTerrain) {
            switch (currentTerrain.type) {
              case 'road':
                speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.ROAD;
                break;
              case 'forest':
                speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.FOREST;
                break;
              case 'water':
                if (unit.canCrossWater) {
                  speedMultiplier = unit.waterSpeedMultiplier ?? TERRAIN_SPEED_MULTIPLIERS.WATER;
                } else {
                  // Non-swimmers struggle in water but can move to get out
                  speedMultiplier = 0.5;
                }
                break;
              case 'mountain':
                speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.MOUNTAIN;
                break;
            }
          }

          // Calculate movement vector
          const distToTarget = getDistance(unit.x, unit.y, effectiveTargetX, effectiveTargetY);
          let moveX = 0;
          let moveY = 0;

          if (distToTarget > 2) {
            const angle = Math.atan2(effectiveTargetY - unit.y, effectiveTargetX - unit.x);
            const desiredMoveX = Math.cos(angle) * unit.speed * speedMultiplier;
            const desiredMoveY = Math.sin(angle) * unit.speed * speedMultiplier;

            // Prevent non-swimmers from ENTERING water from land
            if (!unit.canCrossWater && !isInWater) {
              const nextX = unit.x + desiredMoveX;
              const nextY = unit.y + desiredMoveY;
              const nextTerrain = prev.environmentObjects.find(obj => 
                nextX >= obj.x && nextX <= obj.x + obj.width &&
                nextY >= obj.y && nextY <= obj.y + obj.height
              );
              
              if (nextTerrain?.type === 'water') {
                // Block movement into water
                moveX = 0;
                moveY = 0;
              } else {
                moveX = desiredMoveX;
                moveY = desiredMoveY;
              }
            } else {
              moveX = desiredMoveX;
              moveY = desiredMoveY;
            }
          }

          // Separation force (push away from other units)
          let separationX = 0;
          let separationY = 0;
          const separationRadius = 20; // Increased for even more personal space

          nextUnits.forEach((other) => {
            if (unit.id === other.id) return;
            const dist = getDistance(unit.x, unit.y, other.x, other.y);
            const minDist = unit.radius + other.radius + separationRadius;

            if (dist < minDist) {
              const angle = Math.atan2(unit.y - other.y, unit.x - other.x);
              const pushStrength = (minDist - dist) / minDist;
              // Softer push for smoother movement
              separationX += Math.cos(angle) * pushStrength * 1.2;
              separationY += Math.sin(angle) * pushStrength * 1.2;
            }
          });

          // Prevent non-swimmers from being pushed into water by separation
          if (!unit.canCrossWater && !isInWater) {
            const nextX = unit.x + moveX + separationX;
            const nextY = unit.y + moveY + separationY;
            const nextTerrain = prev.environmentObjects.find(obj => 
              nextX >= obj.x && nextX <= obj.x + obj.width &&
              nextY >= obj.y && nextY <= obj.y + obj.height
            );
            
            if (nextTerrain?.type === 'water') {
              separationX = 0;
              separationY = 0;
            }
          }

          unit.x += moveX + separationX;
          unit.y += moveY + separationY;

          // Keep within bounds
          unit.x = Math.max(unit.radius, Math.min(GAME_WIDTH - unit.radius, unit.x));
          unit.y = Math.max(unit.radius, Math.min(GAME_HEIGHT - unit.radius, unit.y));

          unit.radius = getRadiusFromHP(unit.hp);
          
          // Use maxHp for attack radius calculation so units don't lose range as they shrink
          const potentialRadius = getRadiusFromHP(unit.maxHp);
          const attackRadiusRatio = unit.unitType === 'artillery' 
            ? UNIT_CONFIG.ARTILLERY_ATTACK_RADIUS_RATIO 
            : unit.unitType === 'aa'
              ? UNIT_CONFIG.AA_ATTACK_RADIUS_RATIO
              : UNIT_CONFIG.BASE_ATTACK_RADIUS_RATIO;
          
          const baseAttackRadius = potentialRadius * attackRadiusRatio;
          
          // Check if unit is on a height area
          const heightArea = prev.heightAreas.find(area => 
            unit.x >= area.x && unit.x <= area.x + area.width &&
            unit.y >= area.y && unit.y <= area.y + area.height
          );

          if (heightArea) {
            // Increase attack radius by elevation percentage
            unit.attackRadius = Math.round(baseAttackRadius * (1 + heightArea.elevation / 100));
          } else {
            unit.attackRadius = Math.round(baseAttackRadius);
          }
        });

        // 2. Identify Squads (Allied units close to each other)
        const squads: Record<string, Set<string>> = {};
        const visited = new Set<string>();

        nextUnits.forEach(u1 => {
          if (visited.has(u1.id)) return;
          const squad = new Set<string>();
          const queue = [u1.id];
          visited.add(u1.id);

          while (queue.length > 0) {
            const currentId = queue.shift()!;
            squad.add(currentId);
            const currentUnit = nextUnits.find(u => u.id === currentId)!;

            nextUnits.forEach(u2 => {
              if (u1.ownerId === u2.ownerId && !visited.has(u2.id)) {
                const dist = getDistance(currentUnit.x, currentUnit.y, u2.x, u2.y);
                const supportDist = (currentUnit.radius + u2.radius) * UNIT_CONFIG.SUPPORT_RADIUS_RATIO;
                if (dist < supportDist) {
                  visited.add(u2.id);
                  queue.push(u2.id);
                }
              }
            });
          }
          squad.forEach(id => squads[id] = squad);
        });

        // 3. Combat Logic
        const damageToApply: Record<string, number> = {};
        const buildingDamageToApply: Record<string, number> = {};

        // Handle Projectile Impacts
        prev.airProjectiles.forEach(p => {
          const dist = getDistance(p.x, p.y, p.targetX, p.targetY);
          if (dist < p.speed) {
            // Impact!
            const impactRadius = p.type === 'bomb' ? 50 : 20;
            const buildingMultiplier = p.type === 'bomb' ? UNIT_CONFIG.PROJECTILE_BUILDING_MULTIPLIER_BOMB : UNIT_CONFIG.PROJECTILE_BUILDING_MULTIPLIER_MISSILE;

            // 1. Damage Buildings first
            nextBuildings.forEach(b => {
              if (getDistance(b.x + b.width / 2, b.y + b.height / 2, p.targetX, p.targetY) < impactRadius) {
                buildingDamageToApply[b.id] = (buildingDamageToApply[b.id] || 0) + p.damage * buildingMultiplier;
              }
            });

            // 2. Damage Units (only if NOT in a building)
            nextUnits.forEach(u => {
              if (u.ownerId !== p.ownerId && getDistance(u.x, u.y, p.targetX, p.targetY) < impactRadius) {
                if (!u.occupyingBuildingId) {
                  damageToApply[u.id] = (damageToApply[u.id] || 0) + p.damage;
                }
              }
            });

            // Visual effect for impact
            for (let i = 0; i < 5; i++) {
              nextCombatEffects.push({
                fromX: p.targetX, fromY: p.targetY,
                toX: p.targetX + (Math.random() - 0.5) * 40,
                toY: p.targetY + (Math.random() - 0.5) * 40,
                color: '#FFA500',
                lifetime: 15
              });
            }
          }
        });

        const now = Date.now();

        // --- Artillery Attacks ---
        nextUnits.forEach(unit => {
          // Anti-Air Logic
          if (unit.canAttackAir && unit.airAttackEfficiency !== undefined) {
            if (now - (unit.lastAttackTime || 0) >= UNIT_CONFIG.AA_COOLDOWN) {
              // Priority 1: Projectiles (incoming threats)
              let targetProjectile = null;
              for (const p of nextAirProjectiles) {
                if (p.ownerId !== unit.ownerId) {
                  const dist = getDistance(unit.x, unit.y, p.x, p.y);
                  if (dist < unit.attackRadius) {
                    targetProjectile = p;
                    break;
                  }
                }
              }

              if (targetProjectile) {
                unit.lastAttackTime = now;
                // Visual tracer
                nextCombatEffects.push({
                  fromX: unit.x, fromY: unit.y,
                  toX: targetProjectile.x, toY: targetProjectile.y,
                  color: '#FFFF00',
                  lifetime: 10
                });

                if (Math.random() * 100 < unit.airAttackEfficiency) {
                  targetProjectile.lifetime = 0; // Intercepted
                  nextCombatEffects.push({
                    fromX: targetProjectile.x, fromY: targetProjectile.y,
                    toX: targetProjectile.x + (Math.random() - 0.5) * 20,
                    toY: targetProjectile.y + (Math.random() - 0.5) * 20,
                    color: '#FFA500',
                    lifetime: 15
                  });
                }
              } else {
                // Priority 2: Aircraft
                let targetAircraft = null;
                for (const other of nextUnits) {
                  if (other.unitType === 'aircraft' && other.ownerId !== unit.ownerId && other.aircraftState !== 'idle' && other.aircraftState !== 'refueling') {
                    const dist = getDistance(unit.x, unit.y, other.x, other.y);
                    if (dist < unit.attackRadius) {
                      targetAircraft = other;
                      break;
                    }
                  }
                }

                if (targetAircraft) {
                  unit.lastAttackTime = now;
                  // Visual tracer
                  nextCombatEffects.push({
                    fromX: unit.x, fromY: unit.y,
                    toX: targetAircraft.x, toY: targetAircraft.y,
                    color: '#FFFF00',
                    lifetime: 10
                  });

                  if (Math.random() * 100 < unit.airAttackEfficiency) {
                    targetAircraft.hp = 0;
                    for (let i = 0; i < 10; i++) {
                      nextCombatEffects.push({
                        fromX: targetAircraft.x, fromY: targetAircraft.y,
                        toX: targetAircraft.x + (Math.random() - 0.5) * 60,
                        toY: targetAircraft.y + (Math.random() - 0.5) * 60,
                        color: '#FF0000',
                        lifetime: 20
                      });
                    }
                  }
                }
              }
            }
          }

          if (unit.unitType === 'artillery' && unit.lastAttackTime !== undefined) {
            if (now - unit.lastAttackTime >= UNIT_CONFIG.ARTILLERY_COOLDOWN) {
              // Find closest enemy unit or building in range
              let closestTarget: { id: string, type: 'unit' | 'building', dist: number } | null = null;

              // Check units
              nextUnits.forEach(other => {
                if (other.ownerId !== unit.ownerId && other.hp > 0 && other.unitType !== 'aircraft') {
                  const dist = getDistance(unit.x, unit.y, other.x, other.y);
                  if (dist < unit.attackRadius) {
                    if (!closestTarget || dist < closestTarget.dist) {
                      closestTarget = { id: other.id, type: 'unit', dist };
                    }
                  }
                }
              });

              // Check buildings
              nextBuildings.forEach(b => {
                if (b.hp > 0 && b.occupantId) {
                  const occupant = nextUnits.find(u => u.id === b.occupantId);
                  if (occupant && occupant.ownerId !== unit.ownerId) {
                    const dist = getDistance(unit.x, unit.y, b.x + b.width / 2, b.y + b.height / 2);
                    if (dist < unit.attackRadius) {
                      if (!closestTarget || dist < closestTarget.dist) {
                        closestTarget = { id: b.id, type: 'building', dist };
                      }
                    }
                  }
                }
              });

              if (closestTarget) {
                const target = closestTarget as { id: string, type: 'unit' | 'building', dist: number };
                const damage = unit.hp; // Damage equals current HP
                
                if (target.type === 'unit') {
                  const targetUnit = nextUnits.find(u => u.id === target.id);
                  if (targetUnit) {
                    if (targetUnit.occupyingBuildingId) {
                      buildingDamageToApply[targetUnit.occupyingBuildingId] = (buildingDamageToApply[targetUnit.occupyingBuildingId] || 0) + damage;
                    } else {
                      damageToApply[target.id] = (damageToApply[target.id] || 0) + damage;
                    }
                    
                    // Visual Effect
                    nextCombatEffects.push({
                      fromX: unit.x, fromY: unit.y,
                      toX: targetUnit.x, toY: targetUnit.y,
                      color: prev.players[unit.ownerId].color,
                      lifetime: 30, // Longer lifetime for artillery
                    });
                  }
                } else {
                  buildingDamageToApply[target.id] = (buildingDamageToApply[target.id] || 0) + damage;
                  const b = nextBuildings.find(obj => obj.id === target.id);
                  if (b) {
                    nextCombatEffects.push({
                      fromX: unit.x, fromY: unit.y,
                      toX: b.x + b.width / 2, toY: b.y + b.height / 2,
                      color: prev.players[unit.ownerId].color,
                      lifetime: 30,
                    });
                  }
                }
                unit.lastAttackTime = now;
              }
            }
          }
        });

        // --- Squad Combat ---
        for (let i = 0; i < nextUnits.length; i++) {
          for (let j = i + 1; j < nextUnits.length; j++) {
            const u1 = nextUnits[i];
            const u2 = nextUnits[j];
            if (u1.ownerId === u2.ownerId) continue;
            
            const dist = getDistance(u1.x, u1.y, u2.x, u2.y);
            
            // Engagement check: combat only happens if at least one unit can reach the other
            const u1CanReach = dist < u1.attackRadius;
            const u2CanReach = dist < u2.attackRadius;

            if (u1CanReach || u2CanReach) {
              // Combat occurs
              const squad1 = squads[u1.id];
              const squad2 = squads[u2.id];

              // Artillery doesn't contribute to squad HP for dealing damage, 
              // but it can be a target.
              const getSquadHP = (squad: Set<string>) => Array.from(squad).reduce((sum, id) => {
                const u = nextUnits.find(unit => unit.id === id);
                if (!u || u.unitType === 'artillery' || u.unitType === 'aa') return sum; // Artillery and AA don't help in ground offensive
                let hp = u.hp;
                if (u.occupyingBuildingId) {
                  const b = nextBuildings.find(building => building.id === u.occupyingBuildingId);
                  if (b) hp += b.hp;
                }
                return sum + hp;
              }, 0);

              const squad1HP = getSquadHP(squad1);
              const squad2HP = getSquadHP(squad2);

              // Squad 1 attacks Squad 2 (if squad 1 has non-artillery/AA units AND can reach)
              if (squad1HP > 0 && u2.unitType !== 'artillery' && u2.unitType !== 'aircraft' && u2.unitType !== 'aa' && u1CanReach) {
                const damage1to2 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad1HP / (squad2HP || 1));
                squad2.forEach(id => {
                  const u = nextUnits.find(unit => unit.id === id);
                  if (u?.unitType === 'artillery' || u?.unitType === 'aircraft' || u?.unitType === 'aa') return; 
                  if (u?.occupyingBuildingId) {
                    buildingDamageToApply[u.occupyingBuildingId] = (buildingDamageToApply[u.occupyingBuildingId] || 0) + damage1to2 / squad2.size;
                  } else {
                    damageToApply[id] = (damageToApply[id] || 0) + damage1to2 / squad2.size;
                  }
                });
              }

              // Direct damage to artillery/AA only if attacker can reach it
              if (u1.unitType !== 'artillery' && u1.unitType !== 'aircraft' && u1.unitType !== 'aa' && (u2.unitType === 'artillery' || u2.unitType === 'aa') && u1CanReach) {
                const directDamage = UNIT_CONFIG.COMBAT_BASE_DAMAGE * 2;
                damageToApply[u2.id] = (damageToApply[u2.id] || 0) + directDamage;
              }
              if (u2.unitType !== 'artillery' && u2.unitType !== 'aircraft' && u2.unitType !== 'aa' && (u1.unitType === 'artillery' || u1.unitType === 'aa') && u2CanReach) {
                const directDamage = UNIT_CONFIG.COMBAT_BASE_DAMAGE * 2;
                damageToApply[u1.id] = (damageToApply[u1.id] || 0) + directDamage;
              }

              // Squad 2 attacks Squad 1 (if squad 2 has non-artillery/AA units AND can reach)
              if (squad2HP > 0 && u1.unitType !== 'artillery' && u1.unitType !== 'aircraft' && u1.unitType !== 'aa' && u2CanReach) {
                const damage2to1 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad2HP / (squad1HP || 1));
                squad1.forEach(id => {
                  const u = nextUnits.find(unit => unit.id === id);
                  if (u?.unitType === 'artillery' || u?.unitType === 'aircraft' || u?.unitType === 'aa') return;
                  if (u?.occupyingBuildingId) {
                    buildingDamageToApply[u.occupyingBuildingId] = (buildingDamageToApply[u.occupyingBuildingId] || 0) + damage2to1 / squad1.size;
                  } else {
                    damageToApply[id] = (damageToApply[id] || 0) + damage2to1 / squad1.size;
                  }
                });
              }

              // Visual Effect (only for non-artillery/aircraft/AA units, artillery/AA has its own logic)
              if (Math.random() > 0.8 && u1.unitType !== 'artillery' && u1.unitType !== 'aircraft' && u1.unitType !== 'aa' && u2.unitType !== 'artillery' && u2.unitType !== 'aircraft' && u2.unitType !== 'aa') {
                if (u1CanReach) {
                  nextCombatEffects.push({
                    fromX: u1.x, fromY: u1.y,
                    toX: u2.x, toY: u2.y,
                    color: prev.players[u1.ownerId].color,
                    lifetime: 10,
                  });
                }
                if (u2CanReach) {
                  nextCombatEffects.push({
                    fromX: u2.x, fromY: u2.y,
                    toX: u1.x, toY: u1.y,
                    color: prev.players[u2.ownerId].color,
                    lifetime: 10,
                  });
                }
              }
            }
          }
        }

        // Apply damage
        Object.keys(damageToApply).forEach(id => {
          const unit = nextUnits.find(u => u.id === id);
          if (unit) unit.hp -= damageToApply[id];
        });

        Object.keys(buildingDamageToApply).forEach(id => {
          const building = nextBuildings.find(b => b.id === id);
          if (building) {
            building.hp -= buildingDamageToApply[id];
            if (building.hp <= 0) {
              // Building destroyed
              const occupant = nextUnits.find(u => u.occupyingBuildingId === building.id);
              if (occupant) {
                occupant.occupyingBuildingId = undefined;
                // Excess damage goes to unit
                occupant.hp += building.hp; // building.hp is negative here
              }
              building.occupantId = undefined;
            }
          }
        });

        // 4. Cleanup dead units and buildings
        const filteredUnits = nextUnits.filter(u => u.hp > UNIT_CONFIG.MIN_HP);
        const filteredBuildings = nextBuildings.filter(b => b.hp > 0);

        return {
          ...prev,
          units: filteredUnits,
          buildings: filteredBuildings,
          combatEffects: nextCombatEffects,
          airProjectiles: nextAirProjectiles,
        };
      });

      animationFrameId = requestAnimationFrame(update);
    };

    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // --- Rendering ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // Apply camera transformation
    // We want the zoom to center on the current view or a specific point
    // For simplicity, we'll just scale and translate
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);

    // Draw environment objects (Runways first)
    gameState.environmentObjects.forEach(obj => {
      if (obj.type === 'runway') {
        ctx.fillStyle = '#333';
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // Draw dashed lines
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([10, 10]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(obj.x + 10, obj.y + obj.height / 2);
        ctx.lineTo(obj.x + obj.width - 10, obj.y + obj.height / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Draw height areas
    gameState.heightAreas.forEach(area => {
      let color = '#22c55e'; // 1-20 Green
      if (area.elevation > 40) color = '#78350f'; // 40-50 Brown
      else if (area.elevation > 30) color = '#f97316'; // 30-40 Orange
      else if (area.elevation > 20) color = '#eab308'; // 20-30 Yellow

      ctx.fillStyle = color + '44'; // 44 is hex for ~25% opacity
      ctx.fillRect(area.x, area.y, area.width, area.height);
      
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(area.x, area.y, area.width, area.height);

      // Draw elevation label
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.max(10, 14 / zoom)}px Inter`;
      ctx.textAlign = 'left';
      ctx.fillText(`Elev: ${area.elevation}`, area.x + 5, area.y + 20 / zoom);
    });

    // Draw environment objects (Roads first)
    gameState.environmentObjects.forEach(obj => {
      if (obj.type === 'road') {
        ctx.fillStyle = '#222';
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // Draw road markings
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.setLineDash([20, 20]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (obj.width > obj.height) {
          // Horizontal road
          ctx.moveTo(obj.x, obj.y + obj.height / 2);
          ctx.lineTo(obj.x + obj.width, obj.y + obj.height / 2);
        } else {
          // Vertical road
          ctx.moveTo(obj.x + obj.width / 2, obj.y);
          ctx.lineTo(obj.x + obj.width / 2, obj.y + obj.height);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (obj.type === 'forest') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'; // Green-500 with opacity
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // Draw some "trees" (dots)
        ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
        const seed = obj.id.split('-')[1] || '0';
        const count = 30;
        for (let i = 0; i < count; i++) {
          const tx = obj.x + (Math.abs(Math.sin(i * 12.3 + parseInt(seed))) * obj.width);
          const ty = obj.y + (Math.abs(Math.cos(i * 45.6 + parseInt(seed))) * obj.height);
          ctx.beginPath();
          ctx.arc(tx, ty, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (obj.type === 'water') {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'; // Blue-500 with opacity
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
        
        // Draw some "waves"
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
        ctx.lineWidth = 1;
        const waveCount = 4;
        for (let i = 0; i < waveCount; i++) {
          const wy = obj.y + (i + 1) * (obj.height / (waveCount + 1));
          ctx.beginPath();
          ctx.moveTo(obj.x, wy);
          for (let x = 0; x <= obj.width; x += 20) {
            const offset = Math.sin(x * 0.05 + Date.now() * 0.002) * 5;
            ctx.lineTo(obj.x + x, wy + offset);
          }
          ctx.stroke();
        }
      }
    });

    // Draw buildings
    gameState.buildings.forEach(building => {
      ctx.fillStyle = '#444';
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      ctx.fillRect(building.x, building.y, building.width, building.height);
      ctx.strokeRect(building.x, building.y, building.width, building.height);

      // Building HP bar
      const hpWidth = (building.hp / building.maxHp) * building.width;
      ctx.fillStyle = '#333';
      ctx.fillRect(building.x, building.y - 10, building.width, 4);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(building.x, building.y - 10, hpWidth, 4);

      // Occupant indicator
      if (building.occupantId) {
        const occupant = gameState.units.find(u => u.id === building.occupantId);
        if (occupant) {
          ctx.fillStyle = gameState.players[occupant.ownerId].color;
          ctx.beginPath();
          ctx.arc(building.x + building.width / 2, building.y + building.height / 2, 10, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1 / zoom; // Keep grid lines thin
    for (let x = 0; x < GAME_WIDTH; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GAME_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < GAME_HEIGHT; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(GAME_WIDTH, y);
      ctx.stroke();
    }

    // Draw support lines (allies helping each other)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.setLineDash([2, 4]);
    gameState.units.forEach(u1 => {
      gameState.units.forEach(u2 => {
        if (u1.id < u2.id && u1.ownerId === u2.ownerId) {
          const dist = getDistance(u1.x, u1.y, u2.x, u2.y);
          const supportDist = (u1.radius + u2.radius) * UNIT_CONFIG.SUPPORT_RADIUS_RATIO;
          if (dist < supportDist) {
            ctx.beginPath();
            ctx.moveTo(u1.x, u1.y);
            ctx.lineTo(u2.x, u2.y);
            ctx.stroke();
          }
        }
      });
    });
    ctx.setLineDash([]);

    // Draw units
    gameState.units.forEach((unit) => {
      const isSelected = selectedUnitIds.has(unit.id);
      const color = gameState.players[unit.ownerId].color;
      
      // Attack radius (visible circle) - Skip for aircraft unless it's AA
      if (unit.unitType !== 'aircraft') {
        ctx.strokeStyle = `${color}44`;
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.attackRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Unit body
      ctx.fillStyle = color;
      if (unit.unitType === 'artillery') {
        // Draw artillery as a square
        ctx.fillRect(unit.x - unit.radius, unit.y - unit.radius, unit.radius * 2, unit.radius * 2);
        
        // Cooldown indicator
        if (unit.lastAttackTime !== undefined) {
          const now = Date.now();
          const elapsed = now - unit.lastAttackTime;
          const progress = Math.min(1, elapsed / UNIT_CONFIG.ARTILLERY_COOLDOWN);
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(unit.x - unit.radius, unit.y + unit.radius + 2, unit.radius * 2, 4);
          ctx.fillStyle = progress === 1 ? '#22c55e' : '#eab308';
          ctx.fillRect(unit.x - unit.radius, unit.y + unit.radius + 2, unit.radius * 2 * progress, 4);
        }
      } else if (unit.unitType === 'aa') {
        // Draw AA as a diamond
        ctx.save();
        ctx.translate(unit.x, unit.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-unit.radius, -unit.radius, unit.radius * 2, unit.radius * 2);
        ctx.restore();
        
        // Cooldown indicator
        if (unit.lastAttackTime !== undefined) {
          const now = Date.now();
          const elapsed = now - unit.lastAttackTime;
          const progress = Math.min(1, elapsed / UNIT_CONFIG.AA_COOLDOWN);
          
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.fillRect(unit.x - unit.radius, unit.y + unit.radius + 2, unit.radius * 2, 4);
          ctx.fillStyle = progress === 1 ? '#22c55e' : '#3b82f6';
          ctx.fillRect(unit.x - unit.radius, unit.y + unit.radius + 2, unit.radius * 2 * progress, 4);
        }
      } else if (unit.unitType === 'aircraft') {
        // Draw aircraft as a triangle/plane
        ctx.save();
        ctx.translate(unit.x, unit.y);
        
        // Rotate towards target if flying
        if (unit.aircraftState === 'flyingToTarget' && unit.attackPoint) {
          const angle = Math.atan2(unit.attackPoint.y - unit.y, unit.attackPoint.x - unit.x);
          ctx.rotate(angle);
        } else if (unit.aircraftState === 'returning') {
          const runway = gameState.environmentObjects.find(obj => obj.id === unit.baseRunwayId);
          if (runway) {
            const angle = Math.atan2((runway.y + runway.height / 2) - unit.y, (runway.x + runway.width / 2) - unit.x);
            ctx.rotate(angle);
          }
        }
        
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-10, -10);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-10, 10);
        ctx.closePath();
        ctx.fill();
        
        // Selected highlight
        if (isSelected) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / zoom;
          ctx.stroke();
        }
        
        ctx.restore();

        // Ammo indicator
        if (unit.ammo) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.font = `${Math.max(6, 8 / zoom)}px Inter`;
          ctx.textAlign = 'center';
          ctx.fillText(`B:${unit.ammo.bombs} M:${unit.ammo.missiles}`, unit.x, unit.y - 15 / zoom);
        }
        
        // State indicator
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `${Math.max(5, 7 / zoom)}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillText(unit.aircraftState.toUpperCase(), unit.x, unit.y + 20 / zoom);
      } else {
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Amphibious indicator
      if (unit.canCrossWater) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.radius - 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2 / zoom;
        if (unit.unitType === 'artillery') {
          ctx.strokeRect(unit.x - unit.radius - 4 / zoom, unit.y - unit.radius - 4 / zoom, (unit.radius + 4 / zoom) * 2, (unit.radius + 4 / zoom) * 2);
        } else {
          ctx.beginPath();
          ctx.arc(unit.x, unit.y, unit.radius + 4 / zoom, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // HP Text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.max(8, 12 / zoom)}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillText(Math.floor(unit.hp).toString(), unit.x, unit.y + (4 / zoom));
    });

    // Draw combat effects (bullets/beams)
    gameState.combatEffects.forEach(effect => {
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 2 / zoom;
      ctx.globalAlpha = effect.lifetime / 10;
      ctx.beginPath();
      ctx.moveTo(effect.fromX, effect.fromY);
      ctx.lineTo(effect.toX, effect.toY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Draw selection box
    if (selectionBox) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.strokeRect(
        selectionBox.x1,
        selectionBox.y1,
        selectionBox.x2 - selectionBox.x1,
        selectionBox.y2 - selectionBox.y1
      );
      ctx.setLineDash([]);
    }

    // Draw air projectiles
    gameState.airProjectiles.forEach(p => {
      ctx.fillStyle = p.type === 'bomb' ? '#555' : '#f00';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.type === 'bomb' ? 4 : 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Trail
      ctx.strokeStyle = p.type === 'bomb' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 0, 0, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const angle = Math.atan2(p.targetY - p.y, p.targetX - p.x);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(angle) * 10, p.y - Math.sin(angle) * 10);
      ctx.stroke();
    });

    ctx.restore();
  }, [gameState, selectedUnitIds, selectionBox, zoom, camera]);

  // --- Input Handlers ---

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    // 1. Map screen pixels to canvas pixels
    const canvasX = (clientX - rect.left) * (GAME_WIDTH / rect.width);
    const canvasY = (clientY - rect.top) * (GAME_HEIGHT / rect.height);
    
    // 2. Map canvas pixels to game units (accounting for zoom and camera)
    return {
      x: (canvasX / zoom) + camera.x,
      y: (canvasY / zoom) + camera.y
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    if (e.button === 0) { // Left click
      setIsDragging(true);
      setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
    } else if (e.button === 1) { // Middle click for panning
      setIsPanning(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && lastMousePos.current) {
      const dx = (e.clientX - lastMousePos.current.x) * (GAME_WIDTH / (canvasRef.current?.offsetWidth || 1)) / zoom;
      const dy = (e.clientY - lastMousePos.current.y) * (GAME_HEIGHT / (canvasRef.current?.offsetHeight || 1)) / zoom;
      
      setCamera(prev => ({
        x: prev.x - dx,
        y: prev.y - dy
      }));
      
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDragging || !selectionBox) return;
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);
    setSelectionBox(prev => prev ? { ...prev, x2: x, y2: y } : null);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button === 0) {
      if (selectionBox) {
        const xMin = Math.min(selectionBox.x1, selectionBox.x2);
        const xMax = Math.max(selectionBox.x1, selectionBox.x2);
        const yMin = Math.min(selectionBox.y1, selectionBox.y2);
        const yMax = Math.max(selectionBox.y1, selectionBox.y2);

        const newSelected = new Set<string>();
        gameState.units.forEach((unit) => {
          if (
            unit.ownerId === activePlayer &&
            unit.x >= xMin && unit.x <= xMax &&
            unit.y >= yMin && unit.y <= yMax
          ) {
            newSelected.add(unit.id);
          }
        });
        setSelectedUnitIds(newSelected);
      }
      setIsDragging(false);
      setSelectionBox(null);
    } else if (e.button === 1) {
      setIsPanning(false);
    }
    lastMousePos.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = getCanvasCoords(e.clientX, e.clientY);

    const selectedUnits = gameState.units.filter(u => selectedUnitIds.has(u.id));
    const offsets = getFormationOffsets(selectedUnits.length);

    setGameState(prev => ({
      ...prev,
      units: prev.units.map(unit => {
        if (selectedUnitIds.has(unit.id)) {
          if (unit.unitType === 'aircraft') {
            // Aircraft targeting
            if (unit.aircraftState === 'idle' || unit.aircraftState === 'returning' || unit.aircraftState === 'flyingToTarget') {
              return {
                ...unit,
                attackPoint: { x, y },
                aircraftState: 'takingOff'
              };
            }
            return unit;
          }

          const index = selectedUnits.findIndex(u => u.id === unit.id);
          const offset = offsets[index] || { dx: 0, dy: 0 };
          
          let targetX = x + offset.dx;
          let targetY = y + offset.dy;

          // If target is inside a building, snap to building center
          const building = prev.buildings.find(b => 
            targetX >= b.x && targetX <= b.x + b.width &&
            targetY >= b.y && targetY <= b.y + b.height
          );

          if (building) {
            targetX = building.x + building.width / 2;
            targetY = building.y + building.height / 2;
          }

          // Clamp targets to game bounds
          targetX = Math.max(unit.radius, Math.min(GAME_WIDTH - unit.radius, targetX));
          targetY = Math.max(unit.radius, Math.min(GAME_HEIGHT - unit.radius, targetY));

          return { ...unit, targetX, targetY, occupyingBuildingId: undefined }; // Moving resets occupancy intent
        }
        return unit;
      })
    }));
  };

  // --- Touch Handlers ---

  const touchStartPos = useRef<{ x: number, y: number } | null>(null);
  const isTouchSelection = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const { x, y } = getCanvasCoords(touch.clientX, touch.clientY);
    touchStartPos.current = { x, y };
    lastMousePos.current = { x: touch.clientX, y: touch.clientY };
    isTouchSelection.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    const touch = e.touches[0];
    const { x, y } = getCanvasCoords(touch.clientX, touch.clientY);

    if (panMode) {
      if (lastMousePos.current) {
        const dx = (touch.clientX - lastMousePos.current.x) * (GAME_WIDTH / (canvasRef.current?.offsetWidth || 1)) / zoom;
        const dy = (touch.clientY - lastMousePos.current.y) * (GAME_HEIGHT / (canvasRef.current?.offsetHeight || 1)) / zoom;
        
        setCamera(prev => ({
          x: prev.x - dx,
          y: prev.y - dy
        }));
        
        lastMousePos.current = { x: touch.clientX, y: touch.clientY };
      }
      return;
    }

    const dist = getDistance(touchStartPos.current.x, touchStartPos.current.y, x, y);
    if (dist > 15) {
      isTouchSelection.current = true;
      setSelectionBox({
        x1: touchStartPos.current.x,
        y1: touchStartPos.current.y,
        x2: x,
        y2: y
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;

    if (isTouchSelection.current && selectionBox) {
      // Finalize selection
      const xMin = Math.min(selectionBox.x1, selectionBox.x2);
      const xMax = Math.max(selectionBox.x1, selectionBox.x2);
      const yMin = Math.min(selectionBox.y1, selectionBox.y2);
      const yMax = Math.max(selectionBox.y1, selectionBox.y2);

      const newSelected = new Set<string>();
      gameState.units.forEach((unit) => {
        if (
          unit.ownerId === activePlayer &&
          unit.x >= xMin && unit.x <= xMax &&
          unit.y >= yMin && unit.y <= yMax
        ) {
          newSelected.add(unit.id);
        }
      });
      setSelectedUnitIds(newSelected);
    } else {
      // It was a tap
      const { x, y } = touchStartPos.current;

      if (selectedUnitIds.size > 0) {
        // Move selected units in formation
        const selectedUnits = gameState.units.filter(u => selectedUnitIds.has(u.id));
        const offsets = getFormationOffsets(selectedUnits.length);

        setGameState(prev => ({
          ...prev,
          units: prev.units.map(unit => {
            if (selectedUnitIds.has(unit.id)) {
              if (unit.unitType === 'aircraft') {
                if (unit.aircraftState === 'idle' || unit.aircraftState === 'returning' || unit.aircraftState === 'flyingToTarget') {
                  return {
                    ...unit,
                    attackPoint: { x, y },
                    aircraftState: 'takingOff'
                  };
                }
                return unit;
              }

              const index = selectedUnits.findIndex(u => u.id === unit.id);
              const offset = offsets[index] || { dx: 0, dy: 0 };
              
              let targetX = x + offset.dx;
              let targetY = y + offset.dy;

              // If target is inside a building, snap to building center
              const building = prev.buildings.find(b => 
                targetX >= b.x && targetX <= b.x + b.width &&
                targetY >= b.y && targetY <= b.y + b.height
              );

              if (building) {
                targetX = building.x + building.width / 2;
                targetY = building.y + building.height / 2;
              }

              // Clamp targets to game bounds
              targetX = Math.max(unit.radius, Math.min(GAME_WIDTH - unit.radius, targetX));
              targetY = Math.max(unit.radius, Math.min(GAME_HEIGHT - unit.radius, targetY));

              return { ...unit, targetX, targetY, occupyingBuildingId: undefined };
            }
            return unit;
          })
        }));
      } else {
        // Try to select single unit under tap
        const unitUnderTap = gameState.units.find(u => 
          u.ownerId === activePlayer && 
          getDistance(u.x, u.y, x, y) < u.radius + 10
        );
        if (unitUnderTap) {
          setSelectedUnitIds(new Set([unitUnderTap.id]));
        } else {
          setSelectedUnitIds(new Set());
        }
      }
    }

    setSelectionBox(null);
    touchStartPos.current = null;
    isTouchSelection.current = false;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30 touch-none">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-10 p-4 md:p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sword className="w-5 h-5 md:w-6 md:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight uppercase italic leading-none">Strategy IO</h1>
            <p className="text-[8px] md:text-[10px] text-white/40 uppercase tracking-widest font-mono">Alpha v0.1.0</p>
          </div>
        </div>

        <div className="hidden md:flex gap-8 items-center bg-white/5 px-8 py-3 rounded-full border border-white/10">
          <div className={`flex items-center gap-3 transition-opacity ${activePlayer === 'player1' ? 'opacity-100' : 'opacity-30'}`}>
            <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
            <span className="text-sm font-bold uppercase tracking-wider">Player 1</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className={`flex items-center gap-3 transition-opacity ${activePlayer === 'player2' ? 'opacity-100' : 'opacity-30'}`}>
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
            <span className="text-sm font-bold uppercase tracking-wider">Player 2</span>
          </div>
        </div>

        <div className="flex gap-2 md:gap-4">
          <button 
            onClick={() => setActivePlayer('player1')}
            className={`px-3 py-2 md:px-4 md:py-2 rounded-lg text-[10px] md:text-xs font-bold uppercase tracking-widest transition-all ${activePlayer === 'player1' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            P1
          </button>
          <button 
            onClick={() => setActivePlayer('player2')}
            className={`px-3 py-2 md:px-4 md:py-2 rounded-lg text-[10px] md:text-xs font-bold uppercase tracking-widest transition-all ${activePlayer === 'player2' ? 'bg-red-600 text-white shadow-lg shadow-red-500/20' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
          >
            P2
          </button>
        </div>
      </header>

      {/* Main Game Area - Full Screen */}
      <main className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Terrain Legend - Adjusted for Overlay */}
          <div className="absolute bottom-6 left-6 z-20 flex flex-wrap gap-3 md:gap-4 p-3 bg-black/40 backdrop-blur-md rounded-xl border border-white/5 text-[8px] md:text-[10px] uppercase tracking-widest font-bold text-white/60">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#222] border border-white/10" />
              <span>Road (1.5x)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-green-500/20 border border-green-500/30" />
              <span>Forest (0.6x)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-blue-500/30 border border-blue-500/40" />
              <span>Water (Blocked/0.5x)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full border border-white" />
              <span>Amphibious</span>
            </div>
          </div>

          <div className="relative w-full h-full flex items-center justify-center p-2 md:p-4">
            <div className="relative w-full h-full max-w-full max-h-full flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={GAME_WIDTH}
                height={GAME_HEIGHT}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="cursor-crosshair block touch-none shadow-2xl border border-white/5 bg-[#111]"
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '100%', 
                  width: 'auto', 
                  height: 'auto',
                  aspectRatio: `${GAME_WIDTH}/${GAME_HEIGHT}`,
                  objectFit: 'contain'
                }}
              />
            </div>
          </div>
          
          {/* Zoom & Pan Controls - Adjusted for Overlay */}
          <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2">
            <button
              onClick={() => setZoom(prev => Math.min(prev + 0.2, 3))}
              className="p-3 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 hover:bg-white/10 transition-all pointer-events-auto"
              title="Zoom In"
            >
              <Plus className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => setZoom(prev => Math.max(prev - 0.2, 0.5))}
              className="p-3 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 hover:bg-white/10 transition-all pointer-events-auto"
              title="Zoom Out"
            >
              <Minus className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setCamera({ x: 0, y: 0 });
              }}
              className="p-3 bg-black/60 backdrop-blur-md rounded-xl border border-white/10 hover:bg-white/10 transition-all pointer-events-auto"
              title="Reset View"
            >
              <Target className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => setPanMode(!panMode)}
              className={`p-3 backdrop-blur-md rounded-xl border transition-all pointer-events-auto ${panMode ? 'bg-blue-600 border-blue-400' : 'bg-black/60 border-white/10 hover:bg-white/10'}`}
              title="Pan Mode (Touch)"
            >
              <MousePointer2 className="w-5 h-5 text-white" />
            </button>
            <div className="bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-center text-white/60">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Stats Overlay */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <AnimatePresence>
                {selectedUnitIds.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    className="bg-white/10 backdrop-blur-xl p-3 md:p-4 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-4 md:gap-6 pointer-events-auto"
                  >
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="p-1.5 md:p-2 bg-white/10 rounded-lg">
                        <Users className="w-4 h-4 md:w-5 md:h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-[8px] md:text-[10px] text-white/40 uppercase tracking-widest font-bold">Selected</div>
                        <div className="text-sm md:text-lg font-bold font-mono">{selectedUnitIds.size}</div>
                      </div>
                    </div>
                    <div className="w-px h-6 md:h-8 bg-white/10" />
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="p-1.5 md:p-2 bg-white/10 rounded-lg">
                        <Activity className="w-4 h-4 md:w-5 md:h-5 text-green-400" />
                      </div>
                      <div>
                        <div className="text-[8px] md:text-[10px] text-white/40 uppercase tracking-widest font-bold">Total HP</div>
                        <div className="text-sm md:text-lg font-bold font-mono">
                          {Math.floor(gameState.units.filter(u => selectedUnitIds.has(u.id)).reduce((acc, u) => acc + u.hp, 0))}
                        </div>
                      </div>
                    </div>

                    {/* Aircraft Weapon Selection */}
                    {(() => {
                      const selectedAircraft = gameState.units.filter(u => selectedUnitIds.has(u.id) && u.unitType === 'aircraft');
                      if (selectedAircraft.length === 0) return null;
                      
                      const firstAircraft = selectedAircraft[0];
                      const currentWeapon = firstAircraft.selectedWeapon;
                      const bombsAmmo = firstAircraft.ammo?.bombs || 0;
                      const missilesAmmo = firstAircraft.ammo?.missiles || 0;

                      return (
                        <>
                          <div className="w-px h-6 md:h-8 bg-white/10" />
                          <div className="flex flex-col gap-1">
                            <div className="text-[8px] text-white/40 uppercase tracking-widest font-bold mb-1">Ordnance</div>
                            <div className="flex gap-2">
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setGameState(prev => ({
                                    ...prev,
                                    units: prev.units.map(u => selectedUnitIds.has(u.id) && u.unitType === 'aircraft' ? { ...u, selectedWeapon: 'bomb' } : u)
                                  }));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex flex-col items-center min-w-[60px] cursor-pointer ${
                                  currentWeapon === 'bomb'
                                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/20'
                                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                                }`}
                              >
                                <span>Bombs</span>
                                <span className="text-[8px] opacity-60">({bombsAmmo})</span>
                              </button>
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setGameState(prev => ({
                                    ...prev,
                                    units: prev.units.map(u => selectedUnitIds.has(u.id) && u.unitType === 'aircraft' ? { ...u, selectedWeapon: 'missile' } : u)
                                  }));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex flex-col items-center min-w-[60px] cursor-pointer ${
                                  currentWeapon === 'missile'
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-900/20'
                                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                                }`}
                              >
                                <span>Missiles</span>
                                <span className="text-[8px] opacity-60">({missilesAmmo})</span>
                              </button>
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setGameState(prev => ({
                                    ...prev,
                                    units: prev.units.map(u => selectedUnitIds.has(u.id) && u.unitType === 'aircraft' ? { ...u, selectedWeapon: 'both' } : u)
                                  }));
                                }}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex flex-col items-center min-w-[60px] cursor-pointer ${
                                  currentWeapon === 'both'
                                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                                }`}
                              >
                                <span>Both</span>
                                <span className="text-[8px] opacity-60">({Math.min(bombsAmmo, missilesAmmo)})</span>
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
          </div>
        </div>
      </main>

    </div>
  );
}
