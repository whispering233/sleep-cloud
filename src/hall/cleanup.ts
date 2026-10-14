import { SLEEP_TRACE_CLEAR_HOUR } from '../shared/constants';
import type { DownstreamMessage } from '../shared/protocol';

/**
 * 每日清理的**排期与判定**（见 `docs/design/10-hall-runtime.md` §7）。
 * 只放纯函数：SQL 在 `bed-store.ts`，广播在 `hall.ts`。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 某个时刻在该时区的墙上时间，折算成「当作 UTC 看」的毫秒（与 `at` 的差就是时区偏移）。 */
function wallTimeAt(timezone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
}

/**
 * 厅时区**下一个** `SLEEP_TRACE_CLEAR_HOUR` 点的 epoch 毫秒；今天这一点已过（或正好到点）则取明天。
 * 作为「每日清理」事件进到期事件堆；执行完再排下一天。
 */
export function nextCleanupAt(timezone: string, now: number): number {
  return cleanupAt(timezone, now, +1);
}

/**
 * 厅时区**最近一个**已经到过的 `SLEEP_TRACE_CLEAR_HOUR` 点的 epoch 毫秒（正好到点就是它本身）。
 *
 * 实例重建时排这个时刻（见 §7）：堆只在内存里，而 08:00 唤醒的是新实例——只排「下一个」会让
 * 当天这次清理永远不发生。已经过了 → 当成到期事件当场补跑，再由 `runCleanup` 排下一天。
 */
export function previousCleanupAt(timezone: string, now: number): number {
  return cleanupAt(timezone, now, -1);
}

/**
 * 两个方向的共同实现：`direction` 为 +1 取下一个、-1 取最近一个。
 *
 * 偏移由 `Intl.DateTimeFormat` 读墙上时间得到，并且**校正两轮**：第一轮的候选时刻可能落在夏令时
 * 切换另一侧的偏移里（例如柏林 3 月 29 日夜里推出来的「明天 08:00」第一轮用的是 +01:00，
 * 而那个时刻已经是 +02:00）。第二轮的偏移取自候选时刻本身。
 *
 * shortcut: 两轮校正只在「本地 08:00 距切换瞬间 ≥ 2 小时」时必然收敛；注册表里的三个厅切换都发生在
 * 本地 02:00–03:00，满足。加新时区时先复算，切换点落在本地 06:00–10:00 的时区要改成迭代到收敛。
 */
function cleanupAt(timezone: string, now: number, direction: 1 | -1): number {
  const at = Math.floor(now / 1000) * 1000; // 秒以下没有意义：时区偏移永远是整分钟
  const wallNow = wallTimeAt(timezone, at);
  const wall = new Date(wallNow);

  // 墙上时间加减一天仍是同一个钟点（墙上毫秒是「naive」的，不受夏令时影响）
  let target = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), SLEEP_TRACE_CLEAR_HOUR);
  if (direction > 0 ? target <= wallNow : target > wallNow) target += direction * MS_PER_DAY;

  const guess = target - (wallNow - at);
  return target - (wallTimeAt(timezone, guess) - guess);
}

/**
 * 清理要发的下行消息：睡痕逐人一条 `leave`（床仍是他的，淡轮廓不动），
 * 归属释放逐床一条 `bed`（`owned: false`，轮廓消失）。
 *
 * 归属为空的历史睡痕行跳过——**不能发出 `id: null`**；两个任务都没命中时（补跑是常态）返回空数组。
 *
 * `leave` 也带 `online`（与 §4 一致）：睡痕本来就不在线，所以这个数是当下的人数，清理不改变它。
 */
export function cleanupMessages(
  traceOwners: readonly (string | null)[],
  releasedBedNos: readonly number[],
  online: number,
): DownstreamMessage[] {
  const messages: DownstreamMessage[] = [];
  for (const owner of traceOwners) {
    if (owner !== null) messages.push({ t: 'leave', id: owner, online });
  }
  for (const bedNo of releasedBedNos) messages.push({ t: 'bed', bedNo, owned: false });
  return messages;
}
