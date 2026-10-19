import { useEffect, useRef, useState } from 'react';

import type { SessionView } from '../shared/http-api';
import { loadSession } from './api';
import { ChatPanel } from './components/ChatPanel';
import { EntryOverlay } from './components/EntryOverlay';
import { Hud } from './components/Hud';
import { Toast } from './components/Toast';
import { ToneLayer } from './components/ToneLayer';
import { WorldCanvas } from './components/WorldCanvas';
import { trackComposerFocus } from './focus';
import { trackKeyboard } from './keyboard';
import { getState, setComposer, subscribe } from './store';
import { connectHall } from './ws';

/**
 * 页面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层每次进厅前都出现；进厅之后才建连——昵称只在建连之前改变，所以协议里不需要「改名」消息。
 */
export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
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

  // 软键盘：视口缩小量与 pan 写到 `.app-shell` 上（画布与面板同吃这一份，见 `./keyboard.ts`）
  useEffect(() => {
    const shell = shellRef.current;
    return shell ? trackKeyboard(shell) : undefined;
  }, []);

  // 输入会话的入口：可编辑控件拿焦点（`docs/design/60-interaction-shell.md` §2）
  useEffect(() => {
    const shell = shellRef.current;
    return shell ? trackComposerFocus(shell) : undefined;
  }, []);

  // 断线也退场：那一刻没有可发的东西，界面先把世界还给人。只在**转入** `offline` 那一次过状态机
  // （位置节拍每秒十次，每次都比一遍是白费）
  useEffect(() => {
    let last = getState().connection;
    return subscribe((state) => {
      if (state.connection === last) return;
      last = state.connection;
      if (state.connection === 'offline') setComposer({ kind: 'offline' });
    });
  }, []);

  useEffect(() => {
    if (!entered || !layoutVersion) return;
    return connectHall({ layoutVersion });
  }, [entered, layoutVersion]);

  return (
    <div className="app-shell" ref={shellRef}>
      <WorldCanvas />

      {entered ? (
        <>
          <div className="hud-stack">
            <Hud />

            <Toast />
          </div>

          <ChatPanel />

          {/* 三档减光：入场层不参与档位，所以只挂在 `entered` 之后 */}
          <ToneLayer />
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