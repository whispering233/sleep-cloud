import { useEffect, useState } from 'react';

import type { HallSummary, SessionView } from '../shared/http-api';
import { loadHalls, loadSession } from './api';
import { ChatPanel } from './components/ChatPanel';
import { EntryOverlay } from './components/EntryOverlay';
import { WorldCanvas } from './components/WorldCanvas';
import { connectHall } from './ws';

/**
 * 页面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层每次进厅前都出现；进厅之后才建连——昵称只在建连之前改变，所以协议里不需要「改名」消息。
 */
export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [halls, setHalls] = useState<HallSummary[]>([]);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [sessionRes, hallsRes] = await Promise.all([loadSession(), loadHalls()]);
      if (cancelled) return;
      if (sessionRes.data) setSession(sessionRes.data);
      if (hallsRes.data) setHalls(hallsRes.data.halls);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hall = halls.find((item) => item.id === session?.hallId);
  const hallId = session?.hallId;
  const sceneGuid = hall?.sceneGuid;

  useEffect(() => {
    if (!entered || !hallId || !sceneGuid) return;
    return connectHall({ hallId, sceneGuid });
  }, [entered, hallId, sceneGuid]);

  return (
    <div className="app-shell">
      <WorldCanvas />

      {entered ? (
        <>
          <header className="hud">
            <span>{hall?.name ?? ''}</span>
            {session?.nickname ? <span>{session.nickname}</span> : null}
          </header>

          <ChatPanel />
        </>
      ) : null}

      {session && !entered ? (
        <EntryOverlay
          session={session}
          halls={halls}
          onDone={(next) => {
            setSession(next);
            setEntered(true);
          }}
        />
      ) : null}
    </div>
  );
}
