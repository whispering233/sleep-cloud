import type { ClientState } from './store';

/**
 * 氛围明暗（**没有昼夜**）。
 *
 * 明暗**不来自时钟**，而来自「这个厅自己的事实」：全厅困倦度。时钟驱动的周期性明暗会被读成
 * 「昼夜替身」，正是本设计要取消的东西（见 `docs/design/00-master-design.md` §5.4）。
 */

/** 缓动的时间常数：约 1.5 秒收敛（见 `docs/ui/DESIGN.md`「明暗的边界」）。 */
export const AMBIENCE_TIME_CONSTANT_MS = 500;

/**
 * 全厅困倦度：`(睡着 + 睡痕) / (在线 + 睡痕)`，夹在 0~1。
 *
 * - `0` = 都醒着 → 最亮档（地板 `primary`）；`1` = 都睡下了 → 最暗档（地板 `primary-dim`）
 * - **空厅兜底 0**（分母为 0 时不把画面压暗）
 * - 分母用「在线 + 睡痕」：睡痕的人已经离线，不在 `online` 里
 * - `lying`（睁眼躺着）不算困倦——那是「睡不着的人」的真实状态
 */
export function drowsinessOf(state: Pick<ClientState, 'people' | 'me' | 'hall'>): number {
  let asleep = state.me?.state === 'asleep' ? 1 : 0;
  let trace = 0;
  for (const person of state.people.values()) {
    if (person.state === 'asleep') asleep += 1;
    else if (person.state === 'trace') trace += 1;
  }
  const total = (state.hall?.online ?? 0) + trace;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (asleep + trace) / total));
}

/** `t ∈ [0,1]`：逐通道在 `from` 与 `to` 之间插值（每通道四舍五入到整数，便于「没变就不重画」）。 */
export function ambienceColor(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * k);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** 朝目标色靠近一帧（按 dt 的指数缓动，帧率无关）：相等时直接返回目标色。 */
export function approachColor(current: number, target: number, dtMs: number): number {
  if (current === target) return target;
  // 指数缓动：`t = 1 − e^{−dt/τ}`（帧率无关；一步走完与多步小走在同一段时间后落点相同）
  const t = 1 - Math.exp(-Math.max(0, dtMs) / AMBIENCE_TIME_CONSTANT_MS);
  const next = ambienceColor(current, target, t);
  if (next !== current) return next;
  // 量化到 1/255 之后一步不足一格：直接朝目标挪一格，否则会永远停在差 1 的地方
  return stepOneToward(current, target);
}

/** 每个通道朝目标走 1（已相等的通道不动）。只为 `approachColor` 的量化尾巴服务。 */
function stepOneToward(current: number, target: number): number {
  const channel = (shift: number): number => {
    const a = (current >> shift) & 0xff;
    const b = (target >> shift) & 0xff;
    return a === b ? a : a + Math.sign(b - a);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}