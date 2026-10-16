import { useEffect, useState } from 'react';

import { hudViewOf, sameHudView } from '../hud-view';
import type { HudView } from '../hud-view';
import { getState, subscribe } from '../store';
import { focusMyBed } from '../world-handle';
import type { BedDirection } from '../world/rules';

/** 离屏方位 → 字形（`docs/ui/DESIGN.md` 的 `hud` 组件行）。 */
const DIRECTION_ARROW: Record<BedDirection, string> = {
  nw: '↖',
  n: '↑',
  ne: '↗',
  e: '→',
  se: '↘',
  s: '↓',
  sw: '↙',
  w: '←',
};

/**
 * 顶部的极简信息条：**我的床号（+ 离屏时的方位字形）+ 在线人数**。
 * **只吃 `HudView` 的三个字段**：位置节拍每 100 ms 通知一次 store，用不上的变化不能变成重渲染。
 * 不显示昵称（我知道我是谁）、不显示厅名（只有一个厅）。
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
      {/* 还没有床就不显示床号：没有内容的一项不占位。方位字形只在床不在可用视口里时出现
          （世界里的暖标记已经够了）；整条可点 = 相机跳到我的床 */}
      {view.bedNo !== undefined ? (
        <button type="button" className="hud-my-bed" aria-label="把我的床移到中央" onClick={() => focusMyBed()}>
          床号 <span className="hud-numeric">{view.bedNo}</span>
          {view.bedDirection !== undefined ? (
            <span aria-hidden="true"> {DIRECTION_ARROW[view.bedDirection]}</span>
          ) : null}
        </button>
      ) : null}
      {view.online !== undefined ? (
        <span>
          在线 <span className="hud-numeric">{view.online}</span>
        </span>
      ) : null}
    </header>
  );
}
