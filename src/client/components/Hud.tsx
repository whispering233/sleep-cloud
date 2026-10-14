import { useEffect, useState } from 'react';

import { dayLabel, hudViewOf, sameHudView } from '../hud-view';
import type { HudView } from '../hud-view';
import { getState, subscribe } from '../store';

/** 昼夜重算周期：一天翻两次色，一分钟看一次已经足够及时。 */
const DAY_RECHECK_MS = 60_000;

/**
 * 顶部的极简信息条（见 `docs/ui/DESIGN.md`）：大区名、自己昵称、床号、在线人数、当前昼夜。
 * **只吃 `HudView` 的几个字段**：位置节拍每 100 ms 通知一次 store，用不上的变化不能变成重渲染。
 */
export function Hud() {
  const [view, setView] = useState<HudView>(() => hudViewOf(getState(), Date.now()));

  useEffect(() => {
    const sync = (): void => {
      const next = hudViewOf(getState(), Date.now());
      setView((prev) => (sameHudView(prev, next) ? prev : next));
    };
    sync();
    const unsubscribe = subscribe(sync);
    // 画布是逐帧推导昼夜的，所以世界自己会翻色；DOM 这边没有别的东西会通知它，
    // 因此这是页面上唯一允许的定时器（只重算这一个字段），卸载时立即清除。
    const timer = setInterval(sync, DAY_RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return (
    <header className={view.day ? 'hud hud-day' : 'hud'}>
      {view.hallName ? <span>{view.hallName}</span> : null}
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
      <span>{dayLabel(view.day)}</span>
    </header>
  );
}