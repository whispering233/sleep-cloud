import { useEffect, useRef, useState } from 'react';

import type { SessionView } from '../shared/http-api';
import { loadSession } from './api';
import { setSound as setSoundAudio } from './audio';
import { AboutOverlay } from './components/AboutOverlay';
import { ChatPanel } from './components/ChatPanel';
import { EntryOverlay } from './components/EntryOverlay';
import type { EntryBlock } from './components/EntryOverlay';
import { Hud } from './components/Hud';
import { LotOverlay } from './components/LotOverlay';
import { Toast } from './components/Toast';
import { ToneLayer } from './components/ToneLayer';
import { WorldCanvas } from './components/WorldCanvas';
import { trackComposerFocus } from './focus';
import { trackKeyboard } from './keyboard';
import { getState, setComposer, subscribe } from './store';
import type { AboutSource } from './store';
import { connectHall } from './ws';

/**
 * 页面骨架：世界层铺满视口（DOM 界面浮在它之上，只占边缘）。
 * 入场层每次进厅前都出现；进厅之后才建连——昵称只在建连之前改变，所以协议里不需要「改名」消息。
 */
export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  /** 入场前的拦截（`/api/me` 的 `2002` 厅满 / `5002` 封禁）：不让人建连再被踢 */
  const [entryBlock, setEntryBlock] = useState<EntryBlock | undefined>(undefined);
  const [entered, setEntered] = useState(false);
  /** 说明面板：`null` = 关着，否则是打开的原因（自动 / 手动） */
  const [aboutOpen, setAboutOpen] = useState<AboutSource | null>(() => getState().aboutOpen);
  /** 求签页开着（`docs/design/110-lot.md` §2）：页面自己的三态不住 store，只有开关在这里 */
  const [lotOpen, setLotOpen] = useState(() => getState().lotOpen);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessionRes = await loadSession();
      if (cancelled) return;
      if (sessionRes.data) setSession(sessionRes.data);
      if (sessionRes.code === '2002') setEntryBlock({ code: '2002' });
      else if (sessionRes.code === '5002') setEntryBlock({ code: '5002', untilAt: sessionRes.data?.untilAt ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 说明面板与求签页的开关只改 store 那一个字段（`aboutOpen` / `lotOpen`）：App 只负责按它选页面态
  useEffect(() => {
    setAboutOpen(getState().aboutOpen);
    setLotOpen(getState().lotOpen);
    return subscribe((state) => {
      setAboutOpen((prev) => (prev === state.aboutOpen ? prev : state.aboutOpen));
      setLotOpen((prev) => (prev === state.lotOpen ? prev : state.lotOpen));
    });
  }, []);

  const layoutVersion = session?.layoutVersion;

  // 软键盘：只把「视觉视口被 pan 了多少」写到 `.app-shell` 的 transform 上（不改尺寸，见 `./keyboard.ts`）
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
      if (state.connection === 'offline' || state.connection === 'halted') setComposer({ kind: 'offline' });
    });
  }, []);

  // 雨声跟着**声音开关**走（与天气无关）：只在状态变化时驱动一次（音频不进逐帧路径）
  useEffect(() => {
    if (!entered) return undefined;
    let last = getState().sound;
    setSoundAudio(last);
    return subscribe((state) => {
      if (state.sound === last) return;
      last = state.sound;
      setSoundAudio(state.sound);
    });
  }, [entered]);

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
        </>
      ) : null}

      {/* 页面态顺序：说明面板 → 入场层 → 大厅（面板开着时入场层不显示）。层级靠 DOM 顺序、
          不加 `z-index`：它在聊天面板之后、`tone-layer` 之前，所以人工路径下三档减光照旧盖得住它 */}
      {session && aboutOpen ? <AboutOverlay source={aboutOpen} /> : null}

      {session && !entered && !aboutOpen ? (
        <EntryOverlay
          session={session}
          block={entryBlock}
          onDone={(next) => {
            setSession(next);
            setEntered(true);
          }}
        />
      ) : null}

      {/* 求签页：挂在入场层之后、`tone-layer` 之前——三档减光照旧盖得住它，不造第二套明暗语义
          （`docs/design/110-lot.md` §3） */}
      {entered && lotOpen ? <LotOverlay /> : null}

      {/* 三档减光：入场层不参与档位，所以只挂在 `entered` 之后 */}
      {entered ? <ToneLayer /> : null}
    </div>
  );
}