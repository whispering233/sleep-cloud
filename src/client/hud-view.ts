import { displayBedNoOf } from '../shared/layout';
import type { BedDirection } from './world/rules';
import type { ClientState } from './store';

/**
 * HUD 的**派生视图**（纯函数，可单测）。
 *
 * 只吃这几个字段：位置节拍每 100 ms 通知一次 store，用不上的变化不该触发渲染
 * （与 `ChatPanel` 的 `viewOf` / `sameView` 同一模式，见 `AGENTS.md` 硬纪律 17）。
 */
export interface HudView {
  /** 我的床号（**归属**，不是占用；**显示值**，= 内部床号 + 1）：还没有这张床时这一项不显示 */
  bedNo?: number;
  /** 我的床在可用视口里的方位；在视野内（或还没有床）为 `undefined`，那一项不补字形 */
  bedDirection?: BedDirection;
  /** 服务端算的在线人数；快照还没到时不知道 */
  online?: number;
}

export function hudViewOf(state: ClientState): HudView {
  const ownedBedNo = state.me?.ownedBedNo;
  return {
    bedNo: ownedBedNo === undefined ? undefined : displayBedNoOf(ownedBedNo),
    bedDirection: state.bedDirection,
    online: state.hall?.online,
  };
}

/** 字段逐个比较：只有它们真的变了才换掉视图对象（对象身份用于 React 的 `useState`）。 */
export function sameHudView(a: HudView, b: HudView): boolean {
  return a.bedNo === b.bedNo && a.bedDirection === b.bedDirection && a.online === b.online;
}
