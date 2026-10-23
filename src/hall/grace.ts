import { GRACE_MS } from '../shared/constants';

/**
 * 断线宽限与睡痕的判定（见 `docs/design/10-hall-runtime.md` §6）。
 *
 * 宽限只有一根时间轴：**床位行的 `last_seen_at` + 有没有活连接**。曾经另存一份内存宽限记录（位置与目标
 * 从连接附加数据整份抄一份），现在没有了：对象空闲约 10 秒就会休眠，被驱逐时连 `close` 事件都不给，
 * 那份记录何时生效无法预测。代价是地上的人断网重连落在床边（或出生点）而不是原地
 * ——即硬纪律第 10 条的可接受降级。
 */

/** 床位行上的占用者：宽限推导与快照补录共用同一份查询结果。 */
export interface OccupiedBedRow {
  bedNo: number;
  /** 只可能是这两种：睡痕行已经不需要推导了 */
  state: 'lying' | 'asleep';
  ownerUserId: string;
  /** 最近一次上床时的昵称快照（睡痕条目显示用） */
  ownerName: string | null;
  ownerAppearance: string | null;
  /** 最后一次在线时刻（认领 / 连接建立 / 断开时写）。为空只可能是历史行 */
  lastSeenAt: number | null;
}

/**
 * 占用者在宽限里的阶段：人还在线 / 还在宽限内 / 宽限已过（该变睡痕了）。
 */
export type GraceVerdict = 'online' | 'waiting' | 'expired';

/**
 * 下一批宽限到期的时刻交给 `scheduler.ts` 的事件堆统管（见 `10-hall-runtime.md` §4.4）；
 * 这里只负责判定「这个占用者现在处于宽限的哪个阶段」。
 */
export function graceVerdict(row: OccupiedBedRow, live: ReadonlySet<string>, now: number): GraceVerdict {
  if (live.has(row.ownerUserId)) return 'online';
  // 快照字段缺失的历史行按「还没到期」处理：宁可晚一点判成睡痕，不可误伤正在床上的人
  if (row.lastSeenAt === null || now < row.lastSeenAt + GRACE_MS) return 'waiting';
  return 'expired';
}
