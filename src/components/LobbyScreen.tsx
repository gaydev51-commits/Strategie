import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Session, PlayerID } from '../types';
import { LogOut, User as UserIcon, Loader2, Check, Play } from 'lucide-react';

export function LobbyScreen({ user, session, onSelectTeam, onToggleReady, onStart, onLeave }: { user: FirebaseUser, session: Session, onSelectTeam: (team: PlayerID) => void, onToggleReady: () => void, onStart: () => void, onLeave: () => void }) {
  const players = Object.values(session.players) as any[];
  const myPlayer = session.players[user.uid];
  const isHost = session.createdBy === user.uid;
  
  const hasTwoPlayers = players.length === 2;
  const allTeamsSelected = players.every(p => p.team);
  const differentTeams = hasTwoPlayers && players[0].team !== players[1].team;
  const allReady = players.every(p => p.ready);
  
  const canStart = hasTwoPlayers && allTeamsSelected && differentTeams && allReady;

  const requirements = [
    { label: "Two players in lobby", met: hasTwoPlayers },
    { label: "Both teams selected", met: allTeamsSelected },
    { label: "Different teams chosen", met: differentTeams },
    { label: "Both players ready", met: allReady },
  ];

  // For Android/Mobile, sometimes onClick is better handled with a slight delay or ensuring no hover interference
  const handleStart = async (e: React.MouseEvent | React.TouchEvent) => {
    // e.preventDefault(); // Removed to avoid potential issues with click events on some browsers
    console.log("handleStart triggered", { canStart, isHost });
    if (canStart && isHost) {
      console.log("Start button clicked, calling onStart");
      try {
        await onStart();
      } catch (error: any) {
        console.error("LobbyScreen: onStart failed", error);
        alert("Error starting game: " + (error.message || "Unknown error"));
      }
    } else {
      console.log("Start button clicked but canStart or isHost is false", { canStart, isHost });
      if (!isHost) alert("Only the host can start the battle.");
      else if (!canStart) alert("Requirements not met yet.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Game Lobby</h2>
            <button onClick={onLeave} className="text-zinc-500 hover:text-white flex items-center gap-2 p-2">
              <LogOut className="w-4 h-4" />
              Leave
            </button>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8">
            {[1, 2].map(i => {
              const player = players[i-1];
              return (
                <div key={i} className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center p-6 relative transition-all ${player ? 'bg-zinc-800/50 border-orange-500/50' : 'bg-zinc-900/50 border-zinc-800 border-dashed'}`}>
                  {player ? (
                    <>
                      {player.ready && (
                        <div className="absolute top-4 right-4 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider animate-pulse">
                          Ready
                        </div>
                      )}
                      <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center mb-4 shadow-inner">
                        <UserIcon className="w-8 h-8 text-zinc-400" />
                      </div>
                      <span className="font-bold text-center truncate w-full">{player.displayName}</span>
                      <span className={`text-xs mt-2 px-3 py-1 rounded-full font-medium ${player.team ? (player.team === 'player1' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400') : 'bg-zinc-800 text-zinc-500'}`}>
                        {player.team ? (player.team === 'player1' ? 'Team Blue' : 'Team Red') : 'Selecting team...'}
                      </span>
                    </>
                  ) : (
                    <div className="text-zinc-600 flex flex-col items-center">
                      <Loader2 className="w-8 h-8 animate-spin mb-2 opacity-20" />
                      <span className="text-sm font-medium">Waiting for player...</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Requirements Checklist */}
          <div className="bg-black/20 rounded-2xl p-4 mb-8 border border-zinc-800/50">
            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Battle Readiness</h4>
            <div className="grid grid-cols-2 gap-2">
              {requirements.map((req, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center ${req.met ? 'bg-green-500/20 text-green-500' : 'bg-zinc-800 text-zinc-600'}`}>
                    {req.met ? <Check className="w-3 h-3" /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </div>
                  <span className={req.met ? 'text-zinc-300' : 'text-zinc-600'}>{req.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex gap-4">
              <button 
                onClick={() => onSelectTeam('player1')}
                disabled={players.some(p => p.uid !== user.uid && p.team === 'player1')}
                className={`flex-1 py-4 rounded-xl font-bold border-2 transition-all active:scale-95 ${myPlayer.team === 'player1' ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-blue-500/50 disabled:opacity-20 disabled:cursor-not-allowed'}`}
              >
                Join Blue Team
              </button>
              <button 
                onClick={() => onSelectTeam('player2')}
                disabled={players.some(p => p.uid !== user.uid && p.team === 'player2')}
                className={`flex-1 py-4 rounded-xl font-bold border-2 transition-all active:scale-95 ${myPlayer.team === 'player2' ? 'bg-red-600 border-red-400 text-white shadow-[0_0_20px_rgba(220,38,38,0.3)]' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-red-500/50 disabled:opacity-20 disabled:cursor-not-allowed'}`}
              >
                Join Red Team
              </button>
            </div>

            <button 
              onClick={onToggleReady}
              className={`w-full py-4 rounded-xl font-bold border-2 transition-all active:scale-95 ${myPlayer.ready ? 'bg-green-600 border-green-400 text-white shadow-[0_0_20px_rgba(22,163,74,0.3)]' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-green-500/50'}`}
            >
              {myPlayer.ready ? 'I am Ready!' : 'Mark as Ready'}
            </button>

            {isHost && (
              <button 
                onClick={handleStart}
                disabled={!canStart}
                className={`w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 touch-manipulation ${canStart ? 'bg-white text-black hover:bg-zinc-200 shadow-[0_0_30px_rgba(255,255,255,0.2)] cursor-pointer' : 'bg-zinc-800 text-zinc-600 border border-zinc-700 cursor-not-allowed'}`}
              >
                <Play className={`w-5 h-5 ${canStart ? 'fill-current' : ''}`} />
                Start Battle
              </button>
            )}
            {!isHost && (
              <div className="text-center text-zinc-500 text-sm italic py-2">
                {canStart ? 'Host is about to start the battle...' : 'Waiting for battle requirements to be met...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
