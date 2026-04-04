import React, { useState, useEffect } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, db } from '../firebase';
import { Session } from '../types';
import { LogOut, Map as MapIcon, Plus, User as UserIcon } from 'lucide-react';

export function MenuScreen({ user, onLogout, onCreateSession, onJoinSession }: { user: FirebaseUser, onLogout: () => void, onCreateSession: () => void, onJoinSession: (id: string) => void }) {
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
              <UserIcon className="w-5 h-5 text-orange-500" />
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
