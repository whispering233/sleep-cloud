import { useEffect, useRef, useState } from 'react';

import { resumeHall, suspendHall } from '../audio';
import { back, depth, onPop, pushLevel } from '../nav';
import type { NavLevel } from '../nav';
import { sendAct } from '../ws';
import { createGameHost } from '../games/host';
import type { GameHost } from '../games/host';
import { GAMES } from '../games/registry';
import { closeGames, subscribe } from '../store';
import { PrimaryAction } from './PrimaryAction';

/**
 * 游戏页（`docs/design/140-games-page.md`）：整屏一页纯程序化的观赏物，跟大厅无关，也拿不到大厅的任何数据。
 * 壳 / 卡片 / 标题复用入场层那套（`.entry-overlay` / `.entry-card` / `.entry-title`）——它就是第三种
 * 「临时整屏页」，不再造第二套排版。`App.tsx` 里挂在聊天面板之后、说明面板之前，层级靠 DOM 顺序，
 * 所以三档减光照旧盖得住它（明暗只有一层，不给这一页开例外）。
 *
 * **返回是一个栈**（§2）：`大厅 ← 列表 ← 具体页`，每层一条 `history` 条目，由 `nav.ts` 管。`popstate` 是
 * 唯一的状态来源——列表的「返回」胶囊、`Esc`、系统返回键都只调 `back()`，退到哪一层由订阅映射回来。
 * **具体页零 chrome**：画面上一个按钮都没有，出口就是系统返回键与 `Esc`（桌面兜底）。
 * 离开只发一条 `act: 'hall'`——大厅的连接还在，人只是暂时不看厅里（§6 那一条在场声明；其余一律不发）。
 * 游戏只可能在 `composer === 'idle'` 时被打开（非空闲态右端被「收起」占位），所以这里不需要退场逻辑。
 */
export function GamesOverlay() {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<GameHost | undefined>(undefined);
  /** 现在在哪一层：`game` 时列表收起、整页交给舞台（零 chrome） */
  const [level, setLevel] = useState<NavLevel>('list');
  /** 列表页的「返回」：整页盖住大厅，焦点留在被盖住的聊天面板上会让 `Tab` 走进看不见的按钮 */
  const leaveRef = useRef<HTMLButtonElement>(null);
  /** 刚点的那一颗条目：从具体页回列表时把焦点还给它（具体页没有可聚焦的东西） */
  const entryRef = useRef<HTMLButtonElement>(null);

  // 返回栈（§2）：进这一页压一层 `list`；门口已经在栈上（浏览器「前进」把页面又打开了）就不重复压。
  // 弹栈后 `undefined` = 大厅，那一层由 `closeGames()` 收掉这一页
  useEffect(() => {
    if (depth() === 0) pushLevel('list');
    return onPop((next) => {
      if (next === undefined) closeGames();
      else setLevel(next);
    });
  }, []);

  useEffect(() => {
    // `preventScroll`：`.entry-overlay` 自己可滚，默认的聚焦会把列表一次跳到最下面
    leaveRef.current?.focus({ preventScroll: true });
  }, []);

  // 让位（§5）：世界层的整帧停渲染由 `App.tsx` 的 `covered` 一处管（游戏页也计入那一块，同入场层 / 说明面板），
  // 所以这里只管雨声（没建 context 就什么都不做、不改偏好）。
  // 在场状态跟着这一页的生死走（§6）：进 / 出**各一次**，不随后续任何重渲染重发
  useEffect(() => {
    suspendHall();
    sendAct('game');
    return () => {
      resumeHall();
      sendAct('hall');
    };
  }, []);

  // 停住（封禁 / 被顶替 / 布局版本不符）必须先把这一页收掉：整屏页会把提示条与入场层盖住，
  // 人那一刻只看到一片游戏、看不到自己为什么被踢。**只看 `halted`**——普通断线不该把人从游戏里踢出去。
  // 先把栈退回大厅：不然留下一层空列表，返回键要多按一次才出得去（§2）
  useEffect(
    () =>
      subscribe((state) => {
        if (state.connection !== 'halted') return;
        back(depth());
        closeGames();
      }),
    [],
  );

  // `Esc` 与「返回」是**同一个出口**：都只调 `back()`，不直接改 store（层级只由 `popstate` 映射回来）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') back();
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

  // 焦点与舞台跟着层级走：具体页把焦点交给舞台（零 chrome，页上没有别的可聚焦的东西）；
  // 回列表时收掉台上那一个（列表只是「选哪一个」的那一下），焦点还给刚点的条目
  useEffect(() => {
    if (level === 'game') {
      stageRef.current?.focus({ preventScroll: true });
      return;
    }
    hostRef.current?.close();
    entryRef.current?.focus({ preventScroll: true });
  }, [level]);

  return (
    <div className="entry-overlay games-page" data-playing={level === 'game' ? 'true' : undefined}>
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
                  onClick={(event) => {
                    entryRef.current = event.currentTarget;
                    hostRef.current?.show(entry);
                    pushLevel('game');
                    setLevel('game');
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

      {/* 舞台铺满整页、裁掉溢出。列表层上它是空的（`host.close()`），挂上游戏后只有那块
          `games-stage-inner` 吃点击。`tabIndex={-1}`：具体页零 chrome，焦点交给这里兜住 `Tab`。
          在卡片之后：游戏正好盖住列表。基准尺寸与等比缩放由 `host.ts` 现算 */}
      <div className="games-stage" ref={stageRef} tabIndex={-1} />

      {/* 只有列表层有可见出口：具体页零 chrome，出口是系统返回键与 `Esc`（§2）。
          `onClick` 必须包一层——直接把事件传给 `back()` 会被当成「退几步」 */}
      {level === 'list' ? (
        <PrimaryAction ref={leaveRef} className="games-leave" onClick={() => back()}>
          返回
        </PrimaryAction>
      ) : null}
    </div>
  );
}
