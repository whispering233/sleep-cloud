import { useEffect, useState } from 'react';

import type { HallSummary, SessionView } from '../shared/http-api';
import { loadHalls, loadSession } from './api';
import { EntryOverlay } from './components/EntryOverlay';
import { PrimaryAction } from './components/PrimaryAction';
import { TextInput } from './components/TextInput';

/**
 * 页面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层每次进厅前都出现；会连接、走动与聊天在后续卡片接上。
 */
export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [halls, setHalls] = useState<HallSummary[]>([]);
  const [entered, setEntered] = useState(false);
  const [draft, setDraft] = useState('');

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

  return (
    <div className="app-shell">
      {/* 世界层：PixiJS 画布将挂在这里（画布不参与 DOM 界面渲染） */}
      <div className="world-layer" aria-hidden="true" />

      {entered ? (
        <>
          <header className="hud">
            <span>{hall?.name ?? ''}</span>
            {session?.nickname ? <span>{session.nickname}</span> : null}
          </header>

          <section className="chat-panel" aria-label="聊天">
            <TextInput
              className="chat-composer-input"
              value={draft}
              placeholder="说点什么…"
              aria-label="聊天输入框"
              enterKeyHint="send"
              onChange={(event) => setDraft(event.target.value)}
            />
            <PrimaryAction className="chat-composer-send" type="button">
              发送
            </PrimaryAction>
          </section>
        </>
      ) : null}

      {session && !entered ? (
        <EntryOverlay session={session} halls={halls} onDone={(next) => {
          setSession(next);
          setEntered(true);
        }} />
      ) : null}
    </div>
  );
}
