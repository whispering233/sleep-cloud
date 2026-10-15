import type { ErrorCode } from '../shared/error-code';
import type { BedRow } from './bed-store';

/**
 * 躺下的五重校验（顺序即优先级，语义见 `docs/api/error-code.md`）：
 *
 * 1. 床号合法（`3001`）
 * 2. 自己不在床上（`3004`）
 * 3. 床未被占用（`3002`——睡痕也算占用）
 * 4. 床属于自己或尚未被认领（`3003`）
 * 5. 可认领的床，且我还没有床（`3007`——一人一床，不能换床）
 */
export type LieVerdict = { ok: true; claiming: boolean } | { ok: false; code: ErrorCode };

export function checkLie(input: {
  bedNo: number;
  capacity: number;
  inBed: boolean;
  userId: string;
  bed?: BedRow;
  /** 我当前拥有的、**归属未过期**的床号（由调用方走唯一索引查库给出） */
  ownedBedNo?: number;
}): LieVerdict {
  if (!Number.isInteger(input.bedNo) || input.bedNo < 0 || input.bedNo >= input.capacity) {
    return { ok: false, code: '3001' };
  }
  if (input.inBed) return { ok: false, code: '3004' };

  const bed = input.bed;
  if (!bed) return { ok: false, code: '3001' };
  if (bed.state !== 'empty') return { ok: false, code: '3002' };
  if (bed.ownerUserId !== null && bed.ownerUserId !== input.userId) return { ok: false, code: '3003' };
  // 可认领的床 + 我已经有一张床 = 一人一床（能走到这个分支就说明这张床不是我自己那张）
  if (bed.ownerUserId === null && input.ownedBedNo !== undefined) return { ok: false, code: '3007' };

  return { ok: true, claiming: bed.ownerUserId === null };
}

/** 已经在自己床上时，客户端仍可能重复点同一张床：那是 `3002`（床被自己占着）还是 `3004`（已在床上）？ */
export function lieVerdictFor(input: {
  bedNo: number;
  capacity: number;
  inBed: boolean;
  userId: string;
  bed?: BedRow;
  /** 我当前拥有的、**归属未过期**的床号（由调用方走唯一索引查库给出） */
  ownedBedNo?: number;
}): LieVerdict {
  // 优先级：已经在床上先报「已在床上」，否则客户端点自己躺着的那张床会得到「床被占」这种绕的话
  if (input.inBed) return { ok: false, code: '3004' };
  return checkLie(input);
}
