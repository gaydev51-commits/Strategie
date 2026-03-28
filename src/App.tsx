/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sword, Shield, Activity, Users, Target, MousePointer2, Plus, Minus } from 'lucide-react';
import { PlayerID, Unit, Player, GameState, EnvironmentObject } from './types.ts';
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_COLORS, UNIT_CONFIG, INITIAL_UNITS_PER_PLAYER, TERRAIN_SPEED_MULTIPLIERS } from './constants.ts';

// --- Helper Functions ---

const getDistance = (x1: number, y1: number, x2: number, y2: number) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

const getRadiusFromHP = (hp: number) => {
  return Math.sqrt(hp) * 2; // Adjusted for visibility
};

const createUnit = (id: string, ownerId: PlayerID, x: number, y: number, hp: number): Unit => {
  const radius = getRadiusFromHP(hp);
  return {
    id,
    ownerId,
    unitType: 'infantry',
    x,
    y,
    hp,
    maxHp: hp,
    radius,
    speed: UNIT_CONFIG.BASE_SPEED,
    attackRadius: radius * UNIT_CONFIG.BASE_ATTACK_RADIUS_RATIO,
    targetX: x,
    targetY: y,
  };
};

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>(() => {
    const units: Unit[] = [];
    
    // Initial units for Player 1 (Left side)
    for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
      units.push(createUnit(`p1-${i}`, 'player1', 100 + Math.random() * 100, 100 + Math.random() * 600, 100));
    }
    
    // Initial units for Player 2 (Right side)
    for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
      units.push(createUnit(`p2-${i}`, 'player2', 1000 + Math.random() * 100, 100 + Math.random() * 600, 100));
    }

    const environmentObjects: EnvironmentObject[] = [
      { id: 'road-1', type: 'road', x: 0, y: 380, width: 1200, height: 40 },
      { id: 'road-2', type: 'road', x: 580, y: 0, width: 40, height: 800 },
    ];

    return {
      units,
      players: {
        player1: { id: 'player1', color: PLAYER_COLORS.player1, score: 0 },
        player2: { id: 'player2', color: PLAYER_COLORS.player2, score: 0 },
      },
      environmentObjects,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      combatEffects: [],
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
        const nextCombatEffects = prev.combatEffects
          .map(e => ({ ...e, lifetime: e.lifetime - 1 }))
          .filter(e => e.lifetime > 0);
        
        // 1. Movement and Separation
        nextUnits.forEach((unit) => {
          // Determine terrain speed multiplier
          let speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.DEFAULT;
          const isOnRoad = prev.environmentObjects.some(obj => 
            obj.type === 'road' &&
            unit.x >= obj.x && unit.x <= obj.x + obj.width &&
            unit.y >= obj.y && unit.y <= obj.y + obj.height
          );
          
          if (isOnRoad) {
            speedMultiplier = TERRAIN_SPEED_MULTIPLIERS.ROAD;
          }

          // Calculate movement vector
          const distToTarget = getDistance(unit.x, unit.y, unit.targetX, unit.targetY);
          let moveX = 0;
          let moveY = 0;

          if (distToTarget > 2) {
            const angle = Math.atan2(unit.targetY - unit.y, unit.targetX - unit.x);
            moveX = Math.cos(angle) * unit.speed * speedMultiplier;
            moveY = Math.sin(angle) * unit.speed * speedMultiplier;
          }

          // Separation force (push away from other units)
          let separationX = 0;
          let separationY = 0;
          const separationRadius = 5; // Extra buffer space

          nextUnits.forEach((other) => {
            if (unit.id === other.id) return;
            const dist = getDistance(unit.x, unit.y, other.x, other.y);
            const minDist = unit.radius + other.radius + separationRadius;

            if (dist < minDist) {
              const angle = Math.atan2(unit.y - other.y, unit.x - other.x);
              const pushStrength = (minDist - dist) / minDist;
              separationX += Math.cos(angle) * pushStrength * 2;
              separationY += Math.sin(angle) * pushStrength * 2;
            }
          });

          unit.x += moveX + separationX;
          unit.y += moveY + separationY;

          // Keep within bounds
          unit.x = Math.max(unit.radius, Math.min(GAME_WIDTH - unit.radius, unit.x));
          unit.y = Math.max(unit.radius, Math.min(GAME_HEIGHT - unit.radius, unit.y));

          unit.radius = getRadiusFromHP(unit.hp);
          unit.attackRadius = unit.radius * UNIT_CONFIG.BASE_ATTACK_RADIUS_RATIO;
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

        for (let i = 0; i < nextUnits.length; i++) {
          for (let j = i + 1; j < nextUnits.length; j++) {
            const u1 = nextUnits[i];
            const u2 = nextUnits[j];
            if (u1.ownerId === u2.ownerId) continue;

            const dist = getDistance(u1.x, u1.y, u2.x, u2.y);
            const attackDist = u1.attackRadius + u2.attackRadius;

            if (dist < attackDist) {
              // Combat occurs
              const squad1 = squads[u1.id];
              const squad2 = squads[u2.id];

              const squad1HP = Array.from(squad1).reduce((sum, id) => sum + (nextUnits.find(u => u.id === id)?.hp || 0), 0);
              const squad2HP = Array.from(squad2).reduce((sum, id) => sum + (nextUnits.find(u => u.id === id)?.hp || 0), 0);

              // Squad 1 attacks Squad 2
              // Damage is proportional to HP ratio
              const damage1to2 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad1HP / squad2HP);
              const damage2to1 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad2HP / squad1HP);

              // Distribute damage among squad members
              squad2.forEach(id => damageToApply[id] = (damageToApply[id] || 0) + damage1to2 / squad2.size);
              squad1.forEach(id => damageToApply[id] = (damageToApply[id] || 0) + damage2to1 / squad1.size);

              // Visual Effect (only every few frames)
              if (Math.random() > 0.8) {
                nextCombatEffects.push({
                  fromX: u1.x,
                  fromY: u1.y,
                  toX: u2.x,
                  toY: u2.y,
                  color: prev.players[u1.ownerId].color,
                  lifetime: 10,
                });
                nextCombatEffects.push({
                  fromX: u2.x,
                  fromY: u2.y,
                  toX: u1.x,
                  toY: u1.y,
                  color: prev.players[u2.ownerId].color,
                  lifetime: 10,
                });
              }
            }
          }
        }

        // Apply damage
        Object.keys(damageToApply).forEach(id => {
          const unit = nextUnits.find(u => u.id === id);
          if (unit) unit.hp -= damageToApply[id];
        });

        // 4. Cleanup dead units
        const filteredUnits = nextUnits.filter(u => u.hp > UNIT_CONFIG.MIN_HP);

        return {
          ...prev,
          units: filteredUnits,
          combatEffects: nextCombatEffects,
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
      
      // Attack radius (visible circle)
      ctx.strokeStyle = `${color}44`;
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, unit.attackRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Unit body
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, unit.radius, 0, Math.PI * 2);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.radius + 4 / zoom, 0, Math.PI * 2);
        ctx.stroke();
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

    setGameState(prev => ({
      ...prev,
      units: prev.units.map(unit => {
        if (selectedUnitIds.has(unit.id)) {
          return { ...unit, targetX: x, targetY: y };
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
        // Move selected units
        setGameState(prev => ({
          ...prev,
          units: prev.units.map(unit => {
            if (selectedUnitIds.has(unit.id)) {
              return { ...unit, targetX: x, targetY: y };
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

      {/* Main Game Area */}
      <main className="pt-20 md:pt-24 p-4 md:p-6 flex flex-col items-center justify-center min-h-screen">
        <div className="relative group w-full max-w-[1200px]">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-red-500/20 rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition duration-1000"></div>
          <div className="relative bg-[#111] rounded-xl border border-white/10 overflow-hidden shadow-2xl">
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
              className="cursor-crosshair block touch-none"
              style={{ width: '100%', height: 'auto', aspectRatio: `${GAME_WIDTH}/${GAME_HEIGHT}` }}
            />
          </div>
          
          {/* Zoom & Pan Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2">
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
            <div className="bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-center">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Stats Overlay */}
          <div className="absolute bottom-4 left-4 right-4 md:bottom-6 md:left-6 md:right-6 flex justify-end items-end pointer-events-none">
              <AnimatePresence>
                {selectedUnitIds.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    className="bg-white/10 backdrop-blur-xl p-3 md:p-4 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-4 md:gap-6"
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
                  </motion.div>
                )}
              </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer / Stats */}
      <footer className="fixed bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none">
        <div className="bg-black/40 backdrop-blur-sm px-6 py-2 rounded-full border border-white/5 text-[10px] text-white/20 uppercase tracking-[0.3em] font-medium">
          Strategic Combat Simulation • Real-time Physics
        </div>
      </footer>
    </div>
  );
}
