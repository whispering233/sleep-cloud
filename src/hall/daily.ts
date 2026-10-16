import { DAILY_WAKE_UTC_HOUR } from '../shared/constants';

/**
 * 每日唤醒的排期（见 `docs/design/10-hall-runtime.md` §7）。**时刻固定 UTC，不涉及任何时区换算**
 * （厅时区与昼夜概念已删除，见 `docs/design/config.md` §2）。
 *
 * 每日唤醒只做两件事：**归属释放** + **缩级评估**；睡痕过期改由读取时推导，所以没有清理任务。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function atUtcHour(now: number, dayOffset: number): number {
  const day = new Date(now);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + dayOffset, DAILY_WAKE_UTC_HOUR);
}

/** 下一个 `DAILY_WAKE_UTC_HOUR` 点；今天这一点已过（或正好到点）则取明天。 */
export function nextDailyWakeAt(now: number): number {
  const today = atUtcHour(now, 0);
  return today > now ? today : today + MS_PER_DAY;
}

/**
 * 最近一个已经到过的 `DAILY_WAKE_UTC_HOUR` 点（正好到点就是它本身）。
 *
 * 实例重建时排这个时刻而不是「下一个」：到期事件堆只在内存里，而 20:00 唤醒的是新实例——
 * 只排「下一个」会让这次唤醒什么都不做（堆顶在未来）。已经过点 → `runDueEvents()` 当场补跑，
 * 补跑是幂等的（释放与缩级都按同一套判据重算）。
 */
export function previousDailyWakeAt(now: number): number {
  const today = atUtcHour(now, 0);
  return today <= now ? today : today - MS_PER_DAY;
}

/**
 * 此刻该不该结算那个 20:00（`docs/design/10-hall-runtime.md` §7）：`stored` 是**已经结算过的边界**
 * （`meta.daily_wake_at`），缺失视为「从未结算」。
 *
 * 这条约束是「一天最多降一级」的落地点：对象被驱逐后重建时堆是空的，若此刻已经越过一个 20:00
 * 就该补上；但**同一个 20:00 只结算一次**——否则缩级会变成「每个对象生命周期一次」，
 * 忙厅里一夜能连降好几档（208 → 161 → 114）。
 */
export function shouldSettleDaily(now: number, stored: number | undefined): boolean {
  return stored === undefined || stored < previousDailyWakeAt(now);
}