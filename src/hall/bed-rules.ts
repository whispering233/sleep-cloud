import { BED_SWITCH_COOLDOWN_MS } from '../shared/constants';
import type { ErrorCode } from '../shared/error-code';
import type { BedRow } from './bed-store';

/**
 * 躺下的五重校验（顺序即优先级，语义见 `docs/api/error-code.md`）：
 *
 * 1. 床号合法（`3001`）
 * 2. 点的**不是**自己正躺着的那张床（`3004`——点别的床都是换床，服务端会先自动起身走过去）
 * 3. 床未被占用（`3002`——睡痕也算占用，它没有 TTL）
 * 4. 床属于自己或尚未被认领（`3003`——**未过期的**归属才算有主）
 * 5. 距上次认领不足 10 秒且目标是另一张无主床（`3008`——**换床冷却**，一人一床仍靠唯一索引兜底）
 *
 * `3004` 必须排在 `3002` 之前：在床上点自己正躺着的那张床时，那张床行正显示「被我自己占着」，
 * 后判会得到「床被占」这种绕的话。
 *
 * 两点容易写反：
 * - **没有行 = 无主空床**（惰性行，见 `docs/db/schema.md` §2）：`bed === undefined` 不是「床号不存在」，
 *   床号是否存在只看 `bedCount`；`3001` 只由越界造成。
 * - 「过期」两个前缀由调用方在取行时按时间戳推导（`bed-store.effectiveBed`），所以这里只看制度事实。
 */
export type LieVerdict =
  | { ok: true; claiming: boolean; /** 换床时要释放的旧床号（广播 `owned:false` 用） */ releasingBedNo?: number }
  | { ok: false; code: ErrorCode };

export function checkLie(input: {
  bedNo: number;
  /** 当前床位数（级容量）：床号 ≥ 它就是越界 */
  bedCount: number;
  inBed: boolean;
  /** 我正躺着的那张床（不在床上时没有）：`3004` 只对「点它」报——点别的床是换床，要自动起身 */
  currentBedNo?: number;
  userId: string;
  bed?: BedRow;
  /** 我当前拥有的、**归属未过期**的那张床（由调用方走唯一索引查库给出） */
  owned?: { bedNo: number; claimedAt: number | null };
  now: number;
}): LieVerdict {
  if (!Number.isInteger(input.bedNo) || input.bedNo < 0 || input.bedNo >= input.bedCount) {
    return { ok: false, code: '3001' };
  }
  if (input.inBed && input.currentBedNo === input.bedNo) return { ok: false, code: '3004' };

  // 无行 = 无主空床（没有谁认领过它）：可认领
  const bed = input.bed;
  if (bed && bed.state !== 'empty') return { ok: false, code: '3002' };
  if (bed && bed.ownerUserId !== null && bed.ownerUserId !== input.userId) return { ok: false, code: '3003' };

  const claimable = !bed || bed.ownerUserId === null;
  // 能走到这个分支就说明这张床不是我自己那张（那张不可认领），所以有主 + 可认领 = 换床
  if (claimable && input.owned !== undefined) {
    // `claimed_at` 为空是历史行：视为无冷却，不能用旧数据卡住人
    const { claimedAt } = input.owned;
    if (claimedAt !== null && input.now - claimedAt < BED_SWITCH_COOLDOWN_MS) return { ok: false, code: '3008' };
  }

  return claimable ? { ok: true, claiming: true, releasingBedNo: input.owned?.bedNo } : { ok: true, claiming: false };
}

