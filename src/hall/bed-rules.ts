import type { ErrorCode } from '../shared/error-code';
import type { BedRow } from './bed-store';

/**
 * 躺下的五重校验（顺序即优先级，语义见 `docs/api/error-code.md`）：
 *
 * 1. 床号合法（`3001`）
 * 2. 自己不在床上（`3004`）
 * 3. 床未被占用（`3002`——**未过期的**睡痕才算占用）
 * 4. 床属于自己或尚未被认领（`3003`——**未过期的**归属才算有主）
 * 5. 可认领的床，且我还没有床（`3007`——一人一床，不能换床）
 *
 * 两点容易写反：
 * - **没有行 = 无主空床**（惰性行，见 `docs/db/schema.md` §2）：`bed === undefined` 不是「床号不存在」，
 *   床号是否存在只看 `bedCount`；`3001` 只由越界造成。
 * - 「过期」两个前缀由调用方在取行时按时间戳推导（`bed-store.effectiveBed`），所以这里只看制度事实。
 */
export type LieVerdict = { ok: true; claiming: boolean } | { ok: false; code: ErrorCode };

export function checkLie(input: {
  bedNo: number;
  /** 当前床位数（级容量）：床号 ≥ 它就是越界 */
  bedCount: number;
  inBed: boolean;
  userId: string;
  bed?: BedRow;
  /** 我当前拥有的、**归属未过期**的床号（由调用方走唯一索引查库给出） */
  ownedBedNo?: number;
}): LieVerdict {
  if (!Number.isInteger(input.bedNo) || input.bedNo < 0 || input.bedNo >= input.bedCount) {
    return { ok: false, code: '3001' };
  }
  if (input.inBed) return { ok: false, code: '3004' };

  // 无行 = 无主空床（没有谁认领过它）：可认领
  const bed = input.bed;
  if (bed && bed.state !== 'empty') return { ok: false, code: '3002' };
  if (bed && bed.ownerUserId !== null && bed.ownerUserId !== input.userId) return { ok: false, code: '3003' };

  const claimable = !bed || bed.ownerUserId === null;
  // 可认领的床 + 我已经有一张床 = 一人一床（能走到这个分支就说明这张床不是我自己那张）
  if (claimable && input.ownedBedNo !== undefined) return { ok: false, code: '3007' };

  return { ok: true, claiming: claimable };
}

/** 已经在自己床上时，客户端仍可能重复点同一张床：那是 `3002`（床被自己占着）还是 `3004`（已在床上）？ */
export function lieVerdictFor(input: Parameters<typeof checkLie>[0]): LieVerdict {
  // 优先级：已经在床上先报「已在床上」，否则客户端点自己躺着的那张床会得到「床被占」这种绕的话
  if (input.inBed) return { ok: false, code: '3004' };
  return checkLie(input);
}