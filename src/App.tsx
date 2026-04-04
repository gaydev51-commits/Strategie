/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sword, Shield, Activity, Users, Target, MousePointer2, Plus, Minus, LogIn, LogOut, Play, Map as MapIcon, Loader2, User as UserIcon, Clock } from 'lucide-react';
import { PlayerID, Unit, Player, GameState, EnvironmentObject, Building, HeightArea, Session } from './types.ts';
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_COLORS, UNIT_CONFIG, INITIAL_UNITS_PER_PLAYER, TERRAIN_SPEED_MULTIPLIERS, BUILDING_CONFIG } from './constants.ts';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, where, addDoc, serverTimestamp, User, OperationType, handleFirestoreError, createUserWithEmailAndPassword, signInWithEmailAndPassword } from './firebase';

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
    pendingTargetX: x,
    pendingTargetY: y,
    lastAttackTime: (isArtillery || isAircraft || isAA) ? 0 : undefined,
    aircraftState: isAircraft ? 'idle' : undefined,
    pendingAircraftState: isAircraft ? 'idle' : undefined,
    ammo: isAircraft ? { bombs: UNIT_CONFIG.AIRCRAFT_AMMO_BOMBS, missiles: UNIT_CONFIG.AIRCRAFT_AMMO_MISSILES } : undefined,
    selectedWeapon: isAircraft ? 'both' : undefined,
    canAttackAir: isAA,
    airAttackEfficiency: isAA ? UNIT_CONFIG.DEFAULT_AA_EFFICIENCY : 0,
  };
};

const createInitialGameState = (): GameState => {
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
  
  for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
    const type = i === 0 ? 'amphibious' : i === 1 ? 'artillery' : i === 2 ? 'aa' : 'infantry';
    units.push(createUnit(`p1-${i}`, 'player1', 100 + Math.random() * 100, 100 + Math.random() * 600, 100, type));
  }
  const p1Aircraft = createUnit('p1-air-1', 'player1', 125, 330, 100, 'aircraft');
  p1Aircraft.baseRunwayId = 'runway-1';
  units.push(p1Aircraft);
  
  for (let i = 0; i < INITIAL_UNITS_PER_PLAYER; i++) {
    const type = i === 0 ? 'amphibious' : i === 1 ? 'artillery' : i === 2 ? 'aa' : 'infantry';
    units.push(createUnit(`p2-${i}`, 'player2', 1000 + Math.random() * 100, 100 + Math.random() * 600, 100, type));
  }
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
    tick: 0,
    nextTickTime: Date.now() + 5000,
  };
};

// --- Main Component ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        if (u) {
          // Ensure user exists in Firestore
          const userRef = doc(db, 'users', u.uid);
          let userSnap;
          try {
            userSnap = await getDoc(userRef);
          } catch (err: any) {
            console.error("Failed to get user doc:", err);
            // If we can't even read our own user doc, it's a rules issue
            if (err.message.includes('permission-denied') || err.code === 'permission-denied') {
              alert("Database access denied for your account. Please check your Firestore Security Rules in the Firebase Console.");
            }
            throw err;
          }

          if (!userSnap.exists()) {
            try {
              await setDoc(userRef, {
                uid: u.uid,
                displayName: u.displayName || u.email?.split('@')[0] || 'Player',
                email: u.email || '',
                photoURL: u.photoURL || '',
                createdAt: serverTimestamp()
              });
            } catch (err: any) {
              console.error("Failed to create user doc:", err);
              if (err.message.includes('permission-denied') || err.code === 'permission-denied') {
                alert("Database access denied when creating your profile. Please check your Firestore Security Rules.");
              }
              throw err;
            }
          }
          setUser(u);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
        // Don't immediately nullify user if it's just a database error, 
        // but we need the user doc for the app to function.
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentSessionId) {
      setSession(null);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'sessions', currentSessionId), (doc) => {
      if (doc.exists()) {
        const data = { id: doc.id, ...doc.data() } as Session;
        if (data.status === 'finished') {
          setCurrentSessionId(null);
        } else {
          setSession(data);
        }
      } else {
        setCurrentSessionId(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `sessions/${currentSessionId}`);
    });

    return unsubscribe;
  }, [currentSessionId]);

  const handleLogin = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (error: any) {
      console.error("Login failed", error);
      let message = "Login failed. Please check your credentials.";
      if (error.code === 'auth/user-not-found') message = "No account found with this email. Please sign up first.";
      if (error.code === 'auth/wrong-password') message = "Incorrect password.";
      if (error.code === 'auth/invalid-email') message = "Invalid email format.";
      throw new Error(message);
    }
  };

  const handleSignUp = async (email: string, pass: string, displayName: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
      const u = userCredential.user;
      // Immediately set the display name in Firestore
      const userRef = doc(db, 'users', u.uid);
      await setDoc(userRef, {
        uid: u.uid,
        displayName: displayName || email.split('@')[0],
        email: u.email,
        photoURL: u.photoURL || '',
        createdAt: serverTimestamp()
      });
    } catch (error: any) {
      console.error("Sign up failed", error);
      let message = "Sign up failed: " + (error.message || "Unknown error");
      if (error.code === 'auth/email-already-in-use') message = "This email is already registered. Try logging in.";
      if (error.code === 'auth/weak-password') message = "Password should be at least 6 characters.";
      if (error.code === 'auth/invalid-email') message = "Invalid email format.";
      if (error.code === 'auth/operation-not-allowed') message = "Email/Password login is not enabled in Firebase Console. Go to Authentication -> Sign-in method and enable it.";
      if (error.code === 'permission-denied') message = "Database access denied. Please check Firestore rules.";
      throw new Error(message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentSessionId(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const createSession = async () => {
    if (!user) return;
    try {
      const sessionsRef = collection(db, 'sessions');
      const newDocRef = doc(sessionsRef); // Pre-generate ID
      const sessionData = {
        id: newDocRef.id,
        mapId: 'test-map',
        status: 'waiting',
        players: {
          [user.uid]: {
            uid: user.uid,
            displayName: user.displayName || 'Anonymous',
            team: null,
            joinedAt: new Date().toISOString(),
            ready: true, // Host is ready by default
            lastSeen: serverTimestamp()
          }
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        createdBy: user.uid
      };
      await setDoc(newDocRef, sessionData);
      setCurrentSessionId(newDocRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sessions');
    }
  };

  const joinSession = async (sessionId: string) => {
    if (!user) return;
    try {
      const sessionRef = doc(db, 'sessions', sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (sessionSnap.exists()) {
        const data = sessionSnap.data() as Session;
        if (Object.keys(data.players).length < 2) {
          await updateDoc(sessionRef, {
            [`players.${user.uid}`]: {
              uid: user.uid,
              displayName: user.displayName || 'Anonymous',
              team: null,
              joinedAt: new Date().toISOString(),
              ready: false,
              lastSeen: serverTimestamp()
            },
            updatedAt: serverTimestamp(),
            lastActiveAt: serverTimestamp()
          });
          setCurrentSessionId(sessionId);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
    }
  };

  const leaveSession = async () => {
    if (!user || !currentSessionId || !session) return;
    try {
      const sessionRef = doc(db, 'sessions', currentSessionId);
      const updatedPlayers = { ...session.players };
      delete updatedPlayers[user.uid];

      if (Object.keys(updatedPlayers).length === 0) {
        // Delete session if last player leaves
        // Note: In a real app, you might want a cloud function for this
        // but for now we'll try to delete it directly.
        // If it fails due to rules, it will be cleaned up by the timeout.
        try {
          // We can't easily delete from client if rules are strict, 
          // but we can set status to finished or similar.
          await updateDoc(sessionRef, { status: 'finished', updatedAt: serverTimestamp() });
        } catch (e) {
          console.error("Failed to mark session as finished", e);
        }
      } else {
        // If host leaves, assign new host or close session
        const isHost = session.createdBy === user.uid;
        if (isHost) {
          // Close session if host leaves
          await updateDoc(sessionRef, { status: 'finished', updatedAt: serverTimestamp() });
        } else {
          // Just remove the player
          const updateData: any = {
            updatedAt: serverTimestamp(),
            lastActiveAt: serverTimestamp()
          };
          updateData[`players.${user.uid}`] = null; // This is how you delete a field in updateDoc
          // Actually, use deleteField() from firebase/firestore if available, 
          // but we don't have it imported. We can use a trick or just overwrite the whole players object.
          const newPlayers = { ...session.players };
          delete newPlayers[user.uid];
          await updateDoc(sessionRef, { players: newPlayers, updatedAt: serverTimestamp() });
        }
      }
      setCurrentSessionId(null);
    } catch (error) {
      console.error("Leave session failed", error);
      setCurrentSessionId(null);
    }
  };

  const selectTeam = async (team: PlayerID) => {
    if (!user || !currentSessionId || !session) return;
    
    // Check if team is already taken
    const otherPlayer = Object.values(session.players).find((p: any) => p.uid !== user.uid) as any;
    if (otherPlayer && otherPlayer.team === team) {
      alert("This team is already taken!");
      return;
    }

    try {
      const sessionRef = doc(db, 'sessions', currentSessionId);
      await updateDoc(sessionRef, {
        [`players.${user.uid}.team`]: team,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sessions/${currentSessionId}`);
    }
  };

  const toggleReady = async () => {
    if (!user || !currentSessionId || !session) return;
    const myPlayer = session.players[user.uid];
    try {
      const sessionRef = doc(db, 'sessions', currentSessionId);
      await updateDoc(sessionRef, {
        [`players.${user.uid}.ready`]: !myPlayer.ready,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sessions/${currentSessionId}`);
    }
  };

  const startGame = async () => {
    if (!user || !currentSessionId || !session) return;
    
    // Only host can start
    if (session.createdBy !== user.uid) return;

    const playerIds = Object.keys(session.players);
    if (playerIds.length !== 2) {
      alert("Waiting for another player...");
      return;
    }

    const p1 = session.players[playerIds[0]];
    const p2 = session.players[playerIds[1]];
    
    if (!p1.team || !p2.team) {
      alert("Both players must select a team!");
      return;
    }
    
    if (p1.team === p2.team) {
      alert("Players must be on different teams!");
      return;
    }

    if (!p1.ready || !p2.ready) {
      alert("Both players must be ready!");
      return;
    }

    try {
      const sessionRef = doc(db, 'sessions', currentSessionId);
      const initialGameState = createInitialGameState();
      await updateDoc(sessionRef, {
        status: 'playing',
        gameState: initialGameState,
        updatedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sessions/${currentSessionId}`);
    }
  };

  // Heartbeat effect
  useEffect(() => {
    if (!user || !currentSessionId) return;
    
    const interval = setInterval(async () => {
      try {
        const sessionRef = doc(db, 'sessions', currentSessionId);
        await updateDoc(sessionRef, {
          [`players.${user.uid}.lastSeen`]: serverTimestamp(),
          lastActiveAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Heartbeat failed", error);
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [user, currentSessionId]);

  // Timeout check effect
  useEffect(() => {
    if (!session || !user) return;
    
    const checkTimeout = () => {
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;
      const lastActive = session.lastActiveAt?.toMillis?.() || session.lastActiveAt || now;
      
      if (now - lastActive > fifteenMinutes) {
        console.log("Session timed out due to inactivity");
        leaveSession();
      }
    };

    const interval = setInterval(checkTimeout, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [session, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onLogin={handleLogin} onSignUp={handleSignUp} />;
  }

  if (!currentSessionId) {
    return <MenuScreen user={user} onLogout={handleLogout} onCreateSession={createSession} onJoinSession={joinSession} />;
  }

  if (session?.status === 'waiting') {
    return <LobbyScreen user={user} session={session} onSelectTeam={selectTeam} onToggleReady={toggleReady} onStart={startGame} onLeave={leaveSession} />;
  }

  if (session?.status === 'playing') {
    return <Game session={session} user={user} onExit={leaveSession} />;
  }

  return null;
}

// --- Sub-Components ---

function AuthScreen({ onLogin, onSignUp }: { onLogin: (email: string, pass: string) => Promise<void>, onSignUp: (email: string, pass: string, displayName: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (isLogin) {
        await onLogin(email, password);
      } else {
        if (!displayName.trim()) {
          throw new Error("Please enter a display name.");
        }
        await onSignUp(email, password, displayName);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8"
      >
        <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <Sword className="w-8 h-8 text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2 text-center">Strategy IO</h1>
        <p className="text-zinc-400 mb-8 text-center text-sm">Command your units and conquer the map.</p>
        
        {error && (
          <div className="space-y-2 mb-6">
            <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-4 rounded-xl flex items-center gap-3">
              <Activity className="w-4 h-4 shrink-0" />
              {error}
            </div>
            <p className="text-[10px] text-zinc-600 text-center font-mono uppercase tracking-widest">
              Debug Info: {error.includes('auth/') ? error : 'Check Firebase Console'}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Display Name</label>
              <input 
                type="text" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
                placeholder="Commander Name"
                required={!isLogin}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
              placeholder="your@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
              placeholder="Min 6 characters"
              required
            />
          </div>
          
          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-orange-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 hover:bg-orange-600 transition-colors mt-2 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {isLogin ? 'Login' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            className="text-orange-500 text-sm font-medium hover:underline"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Login"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function MenuScreen({ user, onLogout, onCreateSession, onJoinSession }: { user: User, onLogout: () => void, onCreateSession: () => void, onJoinSession: (id: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'sessions'), where('status', '==', 'waiting'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;
      const s: Session[] = [];
      snapshot.forEach(doc => {
        const data = doc.data() as Session;
        const lastActive = data.lastActiveAt?.toMillis?.() || data.lastActiveAt || 0;
        // Only show sessions active in the last 15 minutes
        if (now - lastActive < fifteenMinutes) {
          s.push({ id: doc.id, ...data } as Session);
        }
      });
      setSessions(s);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-orange-500 flex items-center justify-center bg-zinc-800">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-6 h-6 text-orange-500" />
              )}
            </div>
            <div>
              <h2 className="font-bold text-lg">{user.displayName || user.email?.split('@')[0] || 'Player'}</h2>
              <p className="text-zinc-500 text-sm">Ready for battle</p>
            </div>
          </div>
          <button onClick={onLogout} className="p-2 hover:bg-zinc-900 rounded-lg text-zinc-400">
            <LogOut className="w-6 h-6" />
          </button>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          <section>
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-orange-500" />
              Available Maps
            </h3>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="aspect-video bg-zinc-800 rounded-xl mb-4 flex items-center justify-center">
                <span className="text-zinc-500 italic">Test Map Preview</span>
              </div>
              <h4 className="font-bold text-lg mb-2">Test Map Alpha</h4>
              <p className="text-zinc-400 text-sm mb-6">A balanced battlefield with roads, forests, and a central water obstacle.</p>
              <button 
                onClick={onCreateSession}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Create Session
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Users className="w-5 h-5 text-orange-500" />
              Active Lobbies
            </h3>
            <div className="space-y-4">
              {sessions.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 border-dashed rounded-2xl p-12 text-center text-zinc-500">
                  No active lobbies. Create one to start!
                </div>
              ) : (
                sessions.map(s => (
                  <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold">Lobby by {(Object.values(s.players)[0] as any).displayName}</h4>
                      <p className="text-zinc-500 text-sm">{Object.keys(s.players).length}/2 players</p>
                    </div>
                    <button 
                      onClick={() => onJoinSession(s.id)}
                      disabled={Object.keys(s.players).length >= 2}
                      className="bg-zinc-800 hover:bg-zinc-700 px-6 py-2 rounded-lg font-bold disabled:opacity-50"
                    >
                      Join
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function LobbyScreen({ user, session, onSelectTeam, onToggleReady, onStart, onLeave }: { user: User, session: Session, onSelectTeam: (team: PlayerID) => void, onToggleReady: () => void, onStart: () => void, onLeave: () => void }) {
  const players = Object.values(session.players);
  const myPlayer = session.players[user.uid];
  const isHost = session.createdBy === user.uid;
  const canStart = players.length === 2 && players.every(p => p.team && p.ready) && players[0].team !== players[1].team;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Game Lobby</h2>
            <button onClick={onLeave} className="text-zinc-500 hover:text-white">Leave</button>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-12">
            {[1, 2].map(i => {
              const player = players[i-1];
              return (
                <div key={i} className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center p-6 relative ${player ? 'bg-zinc-800/50 border-orange-500/50' : 'bg-zinc-900/50 border-zinc-800 border-dashed'}`}>
                  {player ? (
                    <>
                      {player.ready && (
                        <div className="absolute top-4 right-4 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                          Ready
                        </div>
                      )}
                      <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center mb-4">
                        <UserIcon className="w-8 h-8 text-zinc-400" />
                      </div>
                      <span className="font-bold text-center">{player.displayName}</span>
                      <span className={`text-xs mt-2 px-3 py-1 rounded-full ${player.team ? (player.team === 'player1' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400') : 'bg-zinc-700 text-zinc-500'}`}>
                        {player.team ? (player.team === 'player1' ? 'Team Blue' : 'Team Red') : 'Selecting...'}
                      </span>
                    </>
                  ) : (
                    <div className="text-zinc-600 flex flex-col items-center">
                      <Loader2 className="w-8 h-8 animate-spin mb-2" />
                      <span className="text-sm">Waiting for player...</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-6">
            <div className="flex gap-4">
              <button 
                onClick={() => onSelectTeam('player1')}
                disabled={players.some(p => p.uid !== user.uid && p.team === 'player1')}
                className={`flex-1 py-4 rounded-xl font-bold border-2 transition-all ${myPlayer.team === 'player1' ? 'bg-blue-500 border-blue-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-blue-500/50 disabled:opacity-20 disabled:cursor-not-allowed'}`}
              >
                Join Blue Team
              </button>
              <button 
                onClick={() => onSelectTeam('player2')}
                disabled={players.some(p => p.uid !== user.uid && p.team === 'player2')}
                className={`flex-1 py-4 rounded-xl font-bold border-2 transition-all ${myPlayer.team === 'player2' ? 'bg-red-500 border-red-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-red-500/50 disabled:opacity-20 disabled:cursor-not-allowed'}`}
              >
                Join Red Team
              </button>
            </div>

            <button 
              onClick={onToggleReady}
              className={`w-full py-4 rounded-xl font-bold border-2 transition-all ${myPlayer.ready ? 'bg-green-500 border-green-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-green-500/50'}`}
            >
              {myPlayer.ready ? 'I am Ready!' : 'Mark as Ready'}
            </button>

            {isHost && (
              <button 
                onClick={onStart}
                disabled={!canStart}
                className="w-full bg-white text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Play className="w-5 h-5 fill-current" />
                Start Battle
              </button>
            )}
            {!isHost && (
              <div className="text-center text-zinc-500 text-sm italic">
                Waiting for host to start the game...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Game({ session, user, onExit }: { session: Session, user: User, onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const myTeam = session.players[user.uid].team as PlayerID;
  const isHost = session.createdBy === user.uid;

  const [gameState, setGameState] = useState<GameState>(() => {
    // If session has gameState, use it, otherwise initialize (should only happen for host if not yet synced)
    if (session.gameState) return session.gameState;
    return createInitialGameState();
  });

  const gameStateRef = useRef<GameState>(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Sync with Firestore - Client side
  useEffect(() => {
    if (isHost || !session?.gameState) return;
    setGameState(session.gameState);
  }, [session?.gameState, isHost]);

  // Sync with Firestore - Host side (merging client targets)
  useEffect(() => {
    if (!isHost || !session?.clientTargets) return;
    
    setGameState(prev => {
      const nextUnits = [...prev.units];
      let changed = false;
      Object.entries(session.clientTargets!).forEach(([unitId, targets]: [string, any]) => {
        const unitIndex = nextUnits.findIndex(u => u.id === unitId);
        // Only merge if it's NOT the host's unit (host handles its own units locally)
        if (unitIndex !== -1 && nextUnits[unitIndex].ownerId !== myTeam) {
          const unit = nextUnits[unitIndex];
          if (unit.pendingTargetX !== targets.pendingTargetX || unit.pendingTargetY !== targets.pendingTargetY || unit.pendingAircraftState !== targets.pendingAircraftState) {
            nextUnits[unitIndex] = { 
              ...unit, 
              pendingTargetX: targets.pendingTargetX, 
              pendingTargetY: targets.pendingTargetY,
              pendingAttackPoint: targets.pendingAttackPoint,
              pendingAircraftState: targets.pendingAircraftState || unit.pendingAircraftState,
              occupyingBuildingId: undefined 
            };
            changed = true;
          }
        }
      });
      return changed ? { ...prev, units: nextUnits } : prev;
    });
  }, [session?.clientTargets, isHost, myTeam]);

  // Host updates Firestore periodically
  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(async () => {
      try {
        await updateDoc(doc(db, 'sessions', session.id), {
          gameState: gameStateRef.current,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Sync failed", error);
      }
    }, 500); // Sync every 500ms for better responsiveness
    return () => clearInterval(interval);
  }, [isHost, session.id]);

  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [activePlayer, setActivePlayer] = useState<PlayerID>(myTeam);
  const [selectionBox, setSelectionBox] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const lastMousePos = useRef<{ x: number, y: number } | null>(null);

  // --- Game Loop ---

  useEffect(() => {
    if (!isHost) return; // Only host runs the game logic
    let animationFrameId: number;

    const update = () => {
      setGameState((prev) => {
        const now = Date.now();
        const isTick = now >= prev.nextTickTime;
        
        const nextUnits = prev.units.map(u => {
          const unit = { ...u };
          if (isTick) {
            // Apply pending commands on tick
            if (unit.pendingTargetX !== undefined) unit.targetX = unit.pendingTargetX;
            if (unit.pendingTargetY !== undefined) unit.targetY = unit.pendingTargetY;
            if (unit.pendingAttackPoint !== undefined) unit.attackPoint = unit.pendingAttackPoint;
            if (unit.pendingAircraftState !== undefined) unit.aircraftState = unit.pendingAircraftState;
          }
          return unit;
        });

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

        // 3. Combat Logic (Only on Ticks)
        const damageToApply: Record<string, number> = {};
        const buildingDamageToApply: Record<string, number> = {};

        if (isTick) {
          // Handle Projectile Impacts
          prev.airProjectiles.forEach(p => {
            const dist = getDistance(p.x, p.y, p.targetX, p.targetY);
            if (dist < p.speed * 10) { // Increased tolerance for tick-based impact
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

          // --- Artillery Attacks ---
          nextUnits.forEach(unit => {
            // Anti-Air Logic
            if (unit.canAttackAir && unit.airAttackEfficiency !== undefined) {
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

            if (unit.unitType === 'artillery' && unit.lastAttackTime !== undefined) {
              // Artillery attacks every tick if target in range
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
                  const damage1to2 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad1HP / (squad2HP || 1)) * 50; // Scaled for 5s tick
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
                  const directDamage = UNIT_CONFIG.COMBAT_BASE_DAMAGE * 2 * 50;
                  damageToApply[u2.id] = (damageToApply[u2.id] || 0) + directDamage;
                }
                if (u2.unitType !== 'artillery' && u2.unitType !== 'aircraft' && u2.unitType !== 'aa' && (u1.unitType === 'artillery' || u1.unitType === 'aa') && u2CanReach) {
                  const directDamage = UNIT_CONFIG.COMBAT_BASE_DAMAGE * 2 * 50;
                  damageToApply[u1.id] = (damageToApply[u1.id] || 0) + directDamage;
                }

                // Squad 2 attacks Squad 1 (if squad 2 has non-artillery/AA units AND can reach)
                if (squad2HP > 0 && u1.unitType !== 'artillery' && u1.unitType !== 'aircraft' && u1.unitType !== 'aa' && u2CanReach) {
                  const damage2to1 = UNIT_CONFIG.COMBAT_BASE_DAMAGE * (squad2HP / (squad1HP || 1)) * 50;
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
          tick: isTick ? prev.tick + 1 : prev.tick,
          nextTickTime: isTick ? now + 5000 : prev.nextTickTime,
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

    // Draw pending targets for selected units
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    gameState.units.forEach(unit => {
      if (selectedUnitIds.has(unit.id)) {
        // Line to pending target
        if (unit.pendingTargetX !== undefined && unit.pendingTargetY !== undefined && 
            (unit.pendingTargetX !== unit.targetX || unit.pendingTargetY !== unit.targetY)) {
          ctx.beginPath();
          ctx.moveTo(unit.x, unit.y);
          ctx.lineTo(unit.pendingTargetX, unit.pendingTargetY);
          ctx.stroke();

          // Small cross at pending target
          ctx.beginPath();
          const size = 5 / zoom;
          ctx.moveTo(unit.pendingTargetX - size, unit.pendingTargetY - size);
          ctx.lineTo(unit.pendingTargetX + size, unit.pendingTargetY + size);
          ctx.moveTo(unit.pendingTargetX + size, unit.pendingTargetY - size);
          ctx.lineTo(unit.pendingTargetX - size, unit.pendingTargetY + size);
          ctx.stroke();
        }

        // Line to pending attack point for aircraft
        if (unit.unitType === 'aircraft' && unit.pendingAttackPoint) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)'; // Red-500 with opacity
          ctx.beginPath();
          ctx.moveTo(unit.x, unit.y);
          ctx.lineTo(unit.pendingAttackPoint.x, unit.pendingAttackPoint.y);
          ctx.stroke();
          
          // Target circle at pending attack point
          ctx.beginPath();
          ctx.arc(unit.pendingAttackPoint.x, unit.pendingAttackPoint.y, 10 / zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        }
      }
    });
    ctx.setLineDash([]);

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
            unit.ownerId === myTeam &&
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

    const updates: Record<string, any> = {};

    const nextUnits = gameState.units.map(unit => {
      if (selectedUnitIds.has(unit.id)) {
        const index = selectedUnits.findIndex(u => u.id === unit.id);
        const offset = offsets[index] || { dx: 0, dy: 0 };
        
        let targetX = x + offset.dx;
        let targetY = y + offset.dy;

        const building = gameState.buildings.find(b => 
          targetX >= b.x && targetX <= b.x + b.width &&
          targetY >= b.y && targetY <= b.y + b.height
        );

        if (building) {
          targetX = building.x + building.width / 2;
          targetY = building.y + building.height / 2;
        }

        targetX = Math.max(unit.radius, Math.min(GAME_WIDTH - unit.radius, targetX));
        targetY = Math.max(unit.radius, Math.min(GAME_HEIGHT - unit.radius, targetY));

        let pendingAircraftState = unit.aircraftState;
        let pendingAttackPoint = unit.attackPoint;

        if (unit.unitType === 'aircraft') {
          if (unit.aircraftState === 'idle' || unit.aircraftState === 'returning' || unit.aircraftState === 'flyingToTarget') {
            pendingAircraftState = 'takingOff';
            pendingAttackPoint = { x, y };
          }
        }

        updates[unit.id] = { pendingTargetX: targetX, pendingTargetY: targetY, pendingAttackPoint, pendingAircraftState };
        return { ...unit, pendingTargetX: targetX, pendingTargetY: targetY, pendingAttackPoint, pendingAircraftState, occupyingBuildingId: undefined };
      }
      return unit;
    });

    if (isHost) {
      setGameState(prev => ({ ...prev, units: nextUnits }));
    } else {
      // Client updates clientTargets in Firestore
      const sessionRef = doc(db, 'sessions', session.id);
      const clientTargets: Record<string, any> = {};
      Object.entries(updates).forEach(([id, data]) => {
        clientTargets[`clientTargets.${id}`] = data;
      });
      updateDoc(sessionRef, clientTargets);
    }
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
                    pendingAttackPoint: { x, y },
                    pendingAircraftState: 'takingOff'
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

              return { ...unit, pendingTargetX: targetX, pendingTargetY: targetY, occupyingBuildingId: undefined };
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
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-zinc-900/50 border-b border-zinc-800 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Sword className="w-6 h-6 text-orange-500" />
            <h1 className="text-xl font-bold tracking-tight uppercase italic">Strategy IO</h1>
          </div>
          <div className="h-6 w-px bg-zinc-800 mx-2" />
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
              <span className="text-sm font-mono font-medium">{gameState.players.player1.score}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
              <span className="text-sm font-mono font-medium">{gameState.players.player2.score}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-full border border-zinc-700/50">
            <Users className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
              {myTeam === 'player1' ? 'Blue Team' : 'Red Team'}
            </span>
          </div>
          <button 
            onClick={onExit}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
          >
            Exit Game
          </button>
        </div>
      </header>

      {/* Main Game Area - Full Screen */}
      <main className="relative flex-1 bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
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
          <div className="absolute top-6 right-6 z-20 flex flex-col gap-2 items-end">
            {/* Tick Countdown */}
            <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 flex flex-col items-center min-w-[120px]">
              <div className="text-[8px] text-white/40 uppercase tracking-widest font-bold mb-1">Command Window</div>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-blue-400" />
                <span className="text-lg font-bold font-mono text-white">
                  {Math.max(0, (gameState.nextTickTime - Date.now()) / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="w-full h-1 bg-white/10 rounded-full mt-2 overflow-hidden">
                <motion.div 
                  className="h-full bg-blue-500"
                  initial={false}
                  animate={{ 
                    width: `${Math.max(0, Math.min(100, ((gameState.nextTickTime - Date.now()) / 5000) * 100))}%` 
                  }}
                  transition={{ duration: 0.1, ease: "linear" }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-2">
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
