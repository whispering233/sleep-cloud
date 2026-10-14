import { GRACE_MS } from '../shared/constants';
import type { ConnectionState } from './connection';

/**
 * 断线宽限与睡痕的判定（见 `docs/design/10-hall-runtime.md` §6）。
 *
 * 关连接那一刻，位置与目标还在连接附加数据上，连接一销毁就读不到了 → **同一步整份抄进宽限记录**。
 * 记录只放内存：宽限内的位置丢失是可接受的降级（硬纪律第 9 条），而**床上的人**在记录丢失后
 * 仍能从床位行推导出来（`state` + `last_seen_at` + 无活连接），所以睡痕不会漏。
 */
export interface GraceSession {
  connection: ConnectionState;
  expiresAt: number;
}

/** 床位行上的占用者：宽限推导与快照补录共用同一份查询结果。 */
export interface OccupiedBedRow {
  bedNo: number;
  /** 只可能是这两种：睡痕行已经不需要推导了 */
  state: 'lying' | 'asleep';
  ownerUserId: string;
  /** 最近一次上床时的昵称快照（睡痕条目显示用） */
  ownerName: string | null;
  ownerAppearance: string | null;
  /** 最后一次在线时刻（连接建立/断开时写）。为空只可能是历史行 */
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
