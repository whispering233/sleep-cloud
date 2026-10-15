import { describe, expect, it } from 'vitest';

import { BED_OWNERSHIP_TTL_MS } from '../../shared/constants';
import { HALL_LEVELS } from '../../shared/layout';
import { smallestClaimableBed } from '../bed-store';
import { isHallFull, nextLevelCapacity, previousLevelCapacity } from '../level-rules';
import { freshSql, insertBed } from './sqlite';

const CAPACITIES = HALL_LEVELS.map((level) => level.capacity);
const TOP = CAPACITIES[CAPACITIES.length - 1] as number;
const NOW = Date.parse('2025-07-01T12:00:00Z');

/** 「有没有可认领的床」＝**与出生点同一个查询**（`smallestClaimableBed`，`10-hall-runtime.md` §9）。 */
const hasClaimableBed = (sql: SqlStorage, bedCount: number): boolean =>
  smallestClaimableBed(sql, bedCount, NOW) !== undefined;

/** 把 `bedCount` 张床全部写成有效归属；`expiredBedNo` 那张写成 30 天没回来的过期归属。 */
function claimAll(sql: SqlStorage, bedCount: number, expiredBedNo?: number): void {
  for (let bedNo = 0; bedNo < bedCount; bedNo += 1) {
    const expired = bedNo === expiredBedNo;
    insertBed(sql, bedNo, {
      state: 'empty',
      ownerUserId: `u_${bedNo}`,
      lastSeenAt: expired ? NOW - BED_OWNERSHIP_TTL_MS - 1 : NOW,
      updatedAt: NOW,
    });
  }
}

describe('升级判据（入场前判定）：没有可认领的床', () => {
  it('114 张床全被认领 → 没有可认领的床 → 取下一档容量', () => {
    const sql = freshSql();
    claimAll(sql, 114);
    expect(hasClaimableBed(sql, 114)).toBe(false);
    expect(nextLevelCapacity(114, hasClaimableBed(sql, 114))).toBe(161);
  });

  it('还有空床 → 不升', () => {
    const sql = freshSql();
    claimAll(sql, 113);
    expect(nextLevelCapacity(114, hasClaimableBed(sql, 114))).toBeUndefined();
  });

  it('其中一张的归属已过期（30 天没回来、行还没被释放）→ 仍可认领：不升', () => {
    const sql = freshSql();
    claimAll(sql, 114, 113);
    expect(smallestClaimableBed(sql, 114, NOW)).toBe(113);
    expect(nextLevelCapacity(114, hasClaimableBed(sql, 114))).toBeUndefined();
  });

  it('触顶（已经是最后一档 9790）→ undefined，由厅满判定回 2002', () => {
    expect(TOP).toBe(9790);
    expect(nextLevelCapacity(TOP, false)).toBeUndefined();
  });

  it('每一档都恰好跳到下一档（级表升序，没有跳档）', () => {
    for (const capacity of CAPACITIES.slice(0, -1)) {
      expect(nextLevelCapacity(capacity, false)).toBe(CAPACITIES[CAPACITIES.indexOf(capacity) + 1]);
    }
  });
});

describe('厅满判据（2002）：触顶且没有可认领的床', () => {
  it('触顶且每一张床都有主或有占用 → 厅满', () => {
    const sql = freshSql();
    claimAll(sql, TOP);
    expect(isHallFull(TOP, hasClaimableBed(sql, TOP))).toBe(true);
  });

  it('触顶但还有一张未释放的过期归属 → 不算满（不把人挡在门外）', () => {
    const sql = freshSql();
    claimAll(sql, TOP, TOP - 1);
    expect(isHallFull(TOP, hasClaimableBed(sql, TOP))).toBe(false);
  });

  it('没触顶就不算满：还有地方可长（该走升级那条路）', () => {
    const sql = freshSql();
    claimAll(sql, 114);
    expect(isHallFull(114, hasClaimableBed(sql, 114))).toBe(false);
  });
});

describe('缩级判据（每日唤醒评估）', () => {
  it('外圈全无主且无占用 → 上一档容量', () => {
    expect(previousLevelCapacity(161, false)).toBe(114);
    expect(previousLevelCapacity(208, false)).toBe(161);
    expect(previousLevelCapacity(9790, false)).toBe(7144);
  });

  it('外圈有人（哪怕 29 天没回来、哪怕只留下一张未过期睡痕）→ 保留，不缩级', () => {
    expect(previousLevelCapacity(161, true)).toBeUndefined();
    expect(previousLevelCapacity(9790, true)).toBeUndefined();
  });

  it('已经是最小档（114）→ 不缩', () => {
    expect(previousLevelCapacity(114, false)).toBeUndefined();
  });

  it('一天只跳一档：208 缩到 161，而不是直接缩到底', () => {
    expect(previousLevelCapacity(208, false)).toBe(161);
  });
});