import { useEffect, useRef, useState } from 'react';

import { resumeHall, suspendHall } from '../audio';
import { sendAct } from '../ws';
import { createGameHost } from '../games/host';
import type { GameHost } from '../games/host';
import { GAMES } from '../games/registry';
import { closeGames, subscribe } from '../store';
import { pauseWorld, resumeWorld } from '../world-handle';
import { PrimaryAction } from './PrimaryAction';

/**
 * 游戏页（`docs/design/110-games-page.md`）：整屏一页纯程序化的观赏物，跟大厅无关，也拿不到大厅的任何数据。
 * 壳 / 卡片 / 标题复用入场层那套（`.entry-overlay` / `.entry-card` / `.entry-title`）——它就是第三种
 * 「临时整屏页」，不再造第二套排版。`App.tsx` 里挂在聊天面板之后、说明面板之前，层级靠 DOM 顺序，
 * 所以三档减光照旧盖得住它（明暗只有一层，不给这一页开例外）。
 *
 * **只有两个出口**：左上「离开」胶囊与 `Esc`，都走 `closeGames()`（幂等）。离开只发一条 `act: 'hall'`——
 * 大厅的连接还在，人只是暂时不看厅里（§6 那一条在场声明；其余一律不发）。安卓返回键直接离开站点
 * （不做 `history` 条目，§2）。
 * 游戏只可能在 `composer === 'idle'` 时被打开（非空闲态右端被「收起」占位），所以这里不需要退场逻辑。
 */
export function GamesOverlay() {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<GameHost | undefined>(undefined);
  /** 有一个游戏在台上时列表收起：列表只是「选哪一个」的那一下，选中后整页就交给舞台 */
  const [playing, setPlaying] = useState(false);
  /** 焦点给「离开」：整页盖住大厅，焦点留在被盖住的聊天面板上会让 `Tab` 走进看不见的按钮 */
  const leaveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // `preventScroll`：`.entry-overlay` 自己可滚，默认的聚焦会把列表一次跳到最下面
    leaveRef.current?.focus({ preventScroll: true });
  }, []);

  // 让位（§5）：这一页盖着大厅的整段时间里大厅不必推进——世界层只停渲染循环（**位置与状态一个字节都不改**），
  // 雨声一起挂起（没建 context 就什么都不做、不改偏好）。卸载时成对恢复：`wake(true)` 不吃暂停期间累积的 `delta`
  // 在场状态跟着这一页的生死走（§6）：进 / 出**各一次**，不随后续任何重渲染重发
  useEffect(() => {
    pauseWorld();
    suspendHall();
    sendAct('game');
    return () => {
      resumeWorld();
      resumeHall();
      sendAct('hall');
    };
  }, []);

  // 停住（封禁 / 被顶替 / 布局版本不符）必须先把这一页收掉：整屏页会把提示条与入场层盖住，
  // 人那一刻只看到一片游戏、看不到自己为什么被踢。**只看 `halted`**——普通断线不该把人从游戏里踢出去
  useEffect(
    () =>
      subscribe((state) => {
        if (state.connection === 'halted') closeGames();
      }),
    [],
  );

  // `Esc` 与「离开」是**同一个出口**（`closeGames` 幂等，重复触发没有代价）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeGames();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 舞台跟这一页同生共死：页面一卸载就 `dispose` 挂着的游戏并清空容器（§4 的外壳契约）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const host = createGameHost(stage);
    hostRef.current = host;
    return () => {
      host.close();
      hostRef.current = undefined;
    };
  }, []);

  return (
    <div className="entry-overlay games-page" data-playing={playing ? 'true' : undefined}>
      <div className="entry-card">
        <h1 className="entry-title">游戏</h1>

        {GAMES.length === 0 ? (
          // 空态只为将来兜底（首版就有条目，列表不会空着）
          <p className="games-empty">还在做</p>
        ) : (
          <ul className="games-list">
            {GAMES.map((entry) => (
              <li key={entry.id}>
                {/* 整行可点 = 描边胶囊（可点的才画成胶囊）。`pointerdown` 拦默认行为：
                    挂上游戏那一刻整页盖过来，聚焦触发的 `focusout` 对账会当场换位（硬纪律 35） */}
                <button
                  type="button"
                  className="hud-action games-entry"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    hostRef.current?.show(entry);
                    setPlaying(true);
                  }}
                >
                  <span>{entry.title}</span>
                  <span className="games-entry-blurb">{entry.blurb}</span>
                  {entry.base.w > entry.base.h ? <span className="games-entry-wide">横屏更好</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 舞台铺满整页、裁掉溢出。空着时整块透明且不吃点击（列表照常可点）；挂上游戏后只有那块
          `games-stage-inner` 吃点击，而列表已经收起（`data-playing`）。在卡片之后、出口之前——
          于是游戏画在列表之上，而出口仍在最上面。基准尺寸与等比缩放由 `host.ts` 现算 */}
      <div className="games-stage" ref={stageRef} />

      <PrimaryAction ref={leaveRef} className="games-leave" onClick={closeGames}>
        离开
      </PrimaryAction>
    </div>
  );
}
