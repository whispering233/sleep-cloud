import type { ClientState } from './store';
import { isDaytime } from './world/rules';

/**
 * HUD 的**派生视图**（纯函数，可单测）。
 *
 * 只吃这几个字段：位置节拍每 100 ms 通知一次 store，用不上的变化不该触发渲染
 * （与 `ChatPanel` 的 `viewOf` / `sameView` 同一模式，见 `AGENTS.md` 硬纪律 14）。
 */
export interface HudView {
  hallName?: string;
  nickname?: string;
  /** 我的床号（**归属**，不是占用）：还没有这张床时这一项不显示 */
  bedNo?: number;
  /** 服务端算的在线人数；快照还没到时不知道 */
  online?: number;
  day: boolean;
}

export function hudViewOf(state: ClientState, now: number): HudView {
  return {
    hallName: state.hall?.name,
    nickname: state.me?.name,
    bedNo: state.me?.ownedBedNo,
    online: state.hall?.online,
    // 昼夜与画布共用同一条规则：厅是共享空间，物理上只能有一片天空
    day: isDaytime(state.hall?.timezone ?? 'UTC', now),
  };
}

/** 字段逐个比较：只有它们真的变了才换掉视图对象（对象身份用于 React 的 `useState`）。 */
export function sameHudView(a: HudView, b: HudView): boolean {
  return (
    a.hallName === b.hallName &&
    a.nickname === b.nickname &&
    a.bedNo === b.bedNo &&
    a.online === b.online &&
    a.day === b.day
  );
}

/** 昼夜文案：只有两个值，与两组令牌配色一一对应。 */
export function dayLabel(day: boolean): string {
  return day ? '白天' : '夜晚';
}