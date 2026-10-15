import { useEffect, useState } from 'react';

import type { SessionView } from '../shared/http-api';
import { loadSession } from './api';
import { ChatPanel } from './components/ChatPanel';
import { EntryOverlay } from './components/EntryOverlay';
import { Hud } from './components/Hud';
import { Toast } from './components/Toast';
import { WorldCanvas } from './components/WorldCanvas';
import { connectHall } from './ws';

/**
 * 页面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层每次进厅前都出现；进厅之后才建连——昵称只在建连之前改变，所以协议里不需要「改名」消息。
 */
export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  /** 入场前的厅满判定（`/api/me` 的 `2002`）：厅满了就不让人建连再被踢 */
  const [full, setFull] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessionRes = await loadSession();
      if (cancelled) return;
      if (sessionRes.data) setSession(sessionRes.data);
      setFull(sessionRes.code === '2002');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const layoutVersion = session?.layoutVersion;

  useEffect(() => {
    if (!entered || !layoutVersion) return;
    return connectHall({ layoutVersion });
  }, [entered, layoutVersion]);

  return (
    <div className="app-shell">
      <WorldCanvas />

      {entered ? (
        <>
          <div className="hud-stack">
            <Hud />

            <Toast />
          </div>

          <ChatPanel />
        </>
      ) : null}

      {session && !entered ? (
        <EntryOverlay
          session={session}
          blocked={full}
          onDone={(next) => {
            setSession(next);
            setEntered(true);
          }}
        />
      ) : null}
    </div>
  );
}