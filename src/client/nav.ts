/**
 * 分层页面的返回栈（`docs/design/140-games-page.md` §2）：`大厅 ← 列表 ← 具体页`，每层一条 `history` 条目。
 *
 * 只做一件事：把「现在在哪一层」写进 `history.state`（`{ sc: 'games', level }`）。**唯一碰 `history` 的
 * 地方**——store 是纯状态模块（被 ws 等模块 import），历史 API 只活在这里。
 * `popstate` 是唯一的状态来源：页内按钮与 `Esc` 只调 `back()`，弹栈后的层级由这里通知订阅者。
 */

/** 游戏页的两层：`list` = 列表，`game` = 某一款游戏（整页交给舞台，零 chrome） */
export type NavLevel = 'list' | 'game';

type MarkedState = { sc: 'games'; level: NavLevel };

/** `history.state` → 层级。本模块的标记以外（含 `null`）一律 `undefined` = 大厅 */
export function levelOf(state: unknown): NavLevel | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const marked = state as Partial<MarkedState>;
  if (marked.sc !== 'games') return undefined;
  return marked.level === 'list' || marked.level === 'game' ? marked.level : undefined;
}

/** 当前条目的层级；单测跑在 Node 上（没有 `history`），拿不到就是大厅 */
function currentLevel(): NavLevel | undefined {
  return typeof globalThis.history === 'undefined' ? undefined : levelOf(globalThis.history.state);
}

/** 大厅之上压了几层（一层一条，所以层级与条数一一对应） */
export function depth(): number {
  const level = currentLevel();
  return level === 'game' ? 2 : level === 'list' ? 1 : 0;
}

/** 进入下一层：只在这一刻压一条 */
export function pushLevel(level: NavLevel): void {
  history.pushState({ sc: 'games', level } satisfies MarkedState, '');
}

/** 回一层。`steps` 只给「强制关页」用（一次退回大厅）；0 不做事——`history.go(0)` 是刷新 */
export function back(steps = 1): void {
  if (steps > 0) history.go(-steps);
}

/** 订阅弹栈：`popstate` 是唯一的状态来源。返回退订 */
export function onPop(handler: (level: NavLevel | undefined) => void): () => void {
  const listener = (event: PopStateEvent): void => handler(levelOf(event.state));
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

// 刷新时浏览器会把当前条目的 `state` 带回来：加载时归位到大厅，否则那一层的标记会一直挂着
// （刷新一律回大厅，不恢复游戏页）
if (currentLevel() !== undefined) history.replaceState(null, '');
