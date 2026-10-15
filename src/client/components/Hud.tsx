import { useEffect, useState } from 'react';

import { hudViewOf, sameHudView } from '../hud-view';
import type { HudView } from '../hud-view';
import { getState, subscribe } from '../store';

/**
 * 顶部的极简信息条：自己昵称、床号、在线人数。
 * **只吃 `HudView` 的几个字段**：位置节拍每 100 ms 通知一次 store，用不上的变化不能变成重渲染。
 */
export function Hud() {
  const [view, setView] = useState<HudView>(() => hudViewOf(getState()));

  useEffect(() => {
    const sync = (): void => setView((prev) => (sameHudView(prev, hudViewOf(getState())) ? prev : hudViewOf(getState())));
    sync();
    return subscribe(sync);
  }, []);

  return (
    <header className="hud">
      {view.nickname ? <span>{view.nickname}</span> : null}
      {/* 还没有床就不显示床号：没有内容的一项不占位 */}
      {view.bedNo !== undefined ? (
        <span>
          床号 <span className="hud-numeric">{view.bedNo}</span>
        </span>
      ) : null}
      {view.online !== undefined ? (
        <span>
          在线 <span className="hud-numeric">{view.online}</span>
        </span>
      ) : null}
    </header>
  );
}