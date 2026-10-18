import { useEffect, useState } from 'react';

import { hudViewOf, sameHudView } from '../hud-view';
import type { HudView } from '../hud-view';
import { getState, subscribe } from '../store';

/**
 * HUD 的派生视图订阅：位置节拍每 100 ms 通知一次 store，用不上的变化不能变成重渲染
 * （视图本身是纯函数，见 `hud-view.ts`；顶部显示条与动作行共用这一份）。
 */
export function useHudView(): HudView {
  const [view, setView] = useState<HudView>(() => hudViewOf(getState()));

  useEffect(() => {
    const sync = (): void => setView((prev) => (sameHudView(prev, hudViewOf(getState())) ? prev : hudViewOf(getState())));
    sync();
    return subscribe(sync);
  }, []);

  return view;
}

/**
 * 顶部的极简信息条，**只放显示性信息**：`在线 n` / `空床 n` / `延迟 n ms`，左对齐、单行
 * （`docs/ui/DESIGN.md` 的 `hud` 行）。可点击组（床号 / `GO` / 缩放胶囊）与设置齿轮**不在这里**
 * ——它们住在 `chat-panel` 的动作行（见 `ActionRow`）。
 *
 * 「延迟」**常驻**——没有样本时显示 `—`；样本来自聊天回投与**按需探活的 `pong`**（所以回到前台 /
 * 恢复联网后它会自己刷新一次），但它仍不是常驻心跳：不聊天、也不切前后台时就停在上一个数。
 * 不显示昵称（我知道我是谁）、不显示厅名（只有一个厅），版本号也不常驻（进齿轮浮层）。
 */
export function Hud() {
  const view = useHudView();

  return (
    <header className="hud">
      {/* 显示组：纯文字，缺值的一项不占位（快照还没到时不知道就不说）。
          延迟常驻：没有样本时是 `—`，因为「量过但久没量」和「从来没量过」都还是同一个信息 */}
      <div className="hud-info">
        {view.online !== undefined ? (
          <span>
            在线 <span className="hud-numeric">{view.online}</span>
          </span>
        ) : null}
        {view.emptyBeds !== undefined ? (
          <span>
            空床 <span className="hud-numeric">{view.emptyBeds}</span>
          </span>
        ) : null}
        <span>
          延迟 <span className="hud-numeric">{view.rttMs === undefined ? '—' : `${view.rttMs} ms`}</span>
        </span>
      </div>
    </header>
  );
}
