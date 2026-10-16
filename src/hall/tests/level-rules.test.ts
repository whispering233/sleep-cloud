import { describe, expect, it, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `broadcast.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { BED_OWNERSHIP_TTL_MS, GROW_USED_RATIO, HALL_ID, SHRINK_USED_RATIO } from '../../shared/constants';
import { HALL_LEVELS } from '../../shared/layout';
import type { DownstreamMessage } from '../../shared/protocol';
import { outerRingBusy, readMeta, smallestClaimableBed, usedBedCount, writeBedCount } from '../bed-store';
import { Hall } from '../hall';
import { isHallFull, nextLevelCapacity, previousLevelCapacity } from '../level-rules';
import { freshSql, insertBed } from './sqlite';

/** 全部容量都由级表推导（`docs/design/20-layout.md` §3.1），不再在测试里写死数字。 */
const CAPACITIES = HALL_LEVELS.map((level) => level.capacity);
const FIRST = CAPACITIES[0] as number;
const SECOND = CAPACITIES[1] as number;
const THIRD = CAPACITIES[2] as number;
const TOP = CAPACITIES[CAPACITIES.length - 1] as number;
const BEFORE_TOP = CAPACITIES[CAPACITIES.length - 2] as number;
const NOW = Date.parse('2025-07-01T12:00:00Z');

/** 一张有主的床。`lastSeenAt` 早于 TTL 就是「30 天没回来」的过期归属（行还在）。 */
function own(sql: SqlStorage, bedNo: number, lastSeenAt = NOW): void {
  insertBed(sql, bedNo, { state: 'empty', ownerUserId: `u_${bedNo}`, lastSeenAt, updatedAt: NOW });
}

/** 把前 `count` 张床（`0`…`count-1`）写成有主；`expiredBedNo` 那张写成过期归属。 */
function claim(sql: SqlStorage, count: number, expiredBedNo?: number): void {
  for (let bedNo = 0; bedNo < count; bedNo += 1) {
    own(sql, bedNo, bedNo === expiredBedNo ? NOW - BED_OWNERSHIP_TTL_MS - 1 : NOW);
  }
}

/** 「有没有可认领的床」＝ `hall.ts` 里的那一行：已用床数 < 本档容量。 */
const hasClaimableBed = (sql: SqlStorage, bedCount: number): boolean => usedBedCount(sql, NOW) < bedCount;

/** 三个阈值口径：`atGrow` 恰好达线、`belowGrow` 差一张、`atShrink` 恰好是 50%（不算「低于 50%」）。 */
const atGrow = (bedCount: number): number => Math.ceil(bedCount * GROW_USED_RATIO);
const belowGrow = (bedCount: number): number => atGrow(bedCount) - 1;
const atShrink = (bedCount: number): number => Math.ceil(bedCount * SHRINK_USED_RATIO);

describe('升级判据（入场前判定）：已用率 ≥ 75% 就提前扩容', () => {
  it('已用 74% 不升、75% 升一档（117 床上就是 87 张 vs 88 张）', () => {
    expect(belowGrow(FIRST)).toBe(87);
    expect(atGrow(FIRST)).toBe(88);
    expect(belowGrow(FIRST) / FIRST).toBeLessThan(GROW_USED_RATIO);
    expect(atGrow(FIRST) / FIRST).toBeGreaterThanOrEqual(GROW_USED_RATIO);

    expect(nextLevelCapacity(FIRST, belowGrow(FIRST))).toBeUndefined();
    expect(nextLevelCapacity(FIRST, atGrow(FIRST))).toBe(SECOND);
  });

  it('已用床数由 `bedBusy` 数出来（不是「没有空位」）：87 张不升、加到 88 张才升', () => {
    const sql = freshSql();
    claim(sql, 87);
    expect(usedBedCount(sql, NOW)).toBe(87);
    expect(nextLevelCapacity(FIRST, usedBedCount(sql, NOW))).toBeUndefined();

    own(sql, 87); // 第 88 张
    expect(usedBedCount(sql, NOW)).toBe(88);
    expect(nextLevelCapacity(FIRST, usedBedCount(sql, NOW))).toBe(SECOND);
  });

  it('其中一张的归属已过期（30 天没回来、行还没被释放）→ 不算已用：88 张回到 87 → 不升', () => {
    const sql = freshSql();
    claim(sql, 88, 87);
    expect(usedBedCount(sql, NOW)).toBe(87);
    expect(smallestClaimableBed(sql, FIRST, NOW)).toBe(87); // 与「已用床数 < 容量」同一个谓词
    expect(nextLevelCapacity(FIRST, usedBedCount(sql, NOW))).toBeUndefined();
  });

  it('触顶（已经是最后一档）→ undefined，由厅满判定回 2002', () => {
    expect(TOP).toBe(9558);
    expect(nextLevelCapacity(TOP, TOP)).toBeUndefined();
    expect(nextLevelCapacity(TOP, 0)).toBeUndefined();
  });

  it('每一档都恰好跳到下一档（级表升序，没有跳档）', () => {
    for (const capacity of CAPACITIES.slice(0, -1)) {
      expect(nextLevelCapacity(capacity, capacity)).toBe(CAPACITIES[CAPACITIES.indexOf(capacity) + 1]);
    }
  });
});

describe('厅满判据（2002）：触顶且没有空闲床位', () => {
  it('触顶且已用床数占满整档 → 厅满', () => {
    const sql = freshSql();
    claim(sql, TOP);
    expect(usedBedCount(sql, NOW)).toBe(TOP);
    expect(hasClaimableBed(sql, TOP)).toBe(false);
    expect(smallestClaimableBed(sql, TOP, NOW)).toBeUndefined(); // 与出生点同一个查询，结论一致
    expect(isHallFull(TOP, hasClaimableBed(sql, TOP))).toBe(true);
  });

  it('触顶但还有一张未释放的过期归属 → 不算满（不把人挡在门外）', () => {
    const sql = freshSql();
    claim(sql, TOP, TOP - 1);
    expect(usedBedCount(sql, NOW)).toBe(TOP - 1);
    expect(isHallFull(TOP, hasClaimableBed(sql, TOP))).toBe(false);
  });

  it('没触顶就不算满：还有地方可长（该走升级那条路）', () => {
    const sql = freshSql();
    claim(sql, FIRST);
    expect(hasClaimableBed(sql, FIRST)).toBe(false);
    expect(isHallFull(FIRST, hasClaimableBed(sql, FIRST))).toBe(false);
  });
});

describe('缩级判据（每日唤醒评估）：已用率 < 50% 且外圈全空', () => {
  it('外圈空但已用 51% 不降、49% 降一档（150 床上就是 77 张 vs 73 张）', () => {
    expect(Math.ceil(SECOND * 0.51)).toBe(77);
    expect(Math.floor(SECOND * 0.49)).toBe(73);
    expect(previousLevelCapacity(SECOND, 77, false)).toBeUndefined();
    expect(previousLevelCapacity(SECOND, 73, false)).toBe(FIRST);
  });

  it('恰好 50% 不算「低于 50%」→ 不降', () => {
    expect(atShrink(SECOND)).toBe(75);
    expect(previousLevelCapacity(SECOND, atShrink(SECOND), false)).toBeUndefined();
    expect(previousLevelCapacity(SECOND, atShrink(SECOND) - 1, false)).toBe(FIRST);
  });

  it('两个条件都由 SQL 数出：已用 70 张 + 外圈一张有主 → 不降；外圈空才降', () => {
    const sql = freshSql();
    claim(sql, 70);
    expect(previousLevelCapacity(SECOND, usedBedCount(sql, NOW), outerRingBusy(sql, FIRST, SECOND, NOW))).toBe(FIRST);

    own(sql, SECOND - 1); // 外圈（[117, 150)）里的一张
    expect(usedBedCount(sql, NOW)).toBe(71); // 仍低于 50%：只剩外圈那一条拦着
    expect(71 / SECOND).toBeLessThan(SHRINK_USED_RATIO);
    expect(outerRingBusy(sql, FIRST, SECOND, NOW)).toBe(true);
    expect(previousLevelCapacity(SECOND, usedBedCount(sql, NOW), outerRingBusy(sql, FIRST, SECOND, NOW))).toBeUndefined();
  });

  it('外圈有人（哪怕 29 天没回来、哪怕只留下一张未过期睡痕）→ 保留，不缩级（任何比率都不降）', () => {
    for (const used of [0, 1, atShrink(SECOND) - 1, SECOND]) {
      expect(previousLevelCapacity(SECOND, used, true)).toBeUndefined();
      expect(previousLevelCapacity(TOP, used, true)).toBeUndefined();
    }
  });

  it('已经是最小档 → 不缩', () => {
    expect(previousLevelCapacity(FIRST, 0, false)).toBeUndefined();
  });

  it('一天只跳一档：不是直接缩到底', () => {
    expect(previousLevelCapacity(THIRD, 0, false)).toBe(SECOND);
    expect(previousLevelCapacity(TOP, 0, false)).toBe(BEFORE_TOP);
  });
});

describe('滞回自洽（§8 的推导）：两个阈值成对，不会自激', () => {
  it('每一档扩完后的已用率都 < 升阈值（扩一次不会连跳两档）', () => {
    for (const capacity of CAPACITIES.slice(0, -1)) {
      const used = atGrow(capacity);
      const grown = nextLevelCapacity(capacity, used);
      expect(grown).toBeDefined();
      expect(used / (grown as number)).toBeLessThan(GROW_USED_RATIO);
    }
  });

  it('每一档缩完后的已用率都 < 升阈值（缩一次不会立刻又够扩）', () => {
    for (const capacity of CAPACITIES.slice(1)) {
      const used = atShrink(capacity) - 1; // 刚好低于缩阈值
      const shrunk = previousLevelCapacity(capacity, used, false);
      expect(shrunk).toBeDefined();
      expect(used / (shrunk as number)).toBeLessThan(GROW_USED_RATIO);
    }
  });

  it('那条推导本身：缩阈值 × 最小级表步长 < 升阈值', () => {
    for (let index = 1; index < CAPACITIES.length; index += 1) {
      const step = (CAPACITIES[index] as number) / (CAPACITIES[index - 1] as number);
      expect(SHRINK_USED_RATIO * step).toBeLessThan(GROW_USED_RATIO);
    }
  });
});

/** 一条已握手、能收下广播的假连接（与 `broadcast.test.ts` 同一个形状）。 */
class FakeSocket {
  readonly received: string[] = [];
  readonly readyState = 1;

  deserializeAttachment(): unknown {
    return { ready: true };
  }

  send(payload: string): void {
    this.received.push(payload);
  }
}

/** 升级路径是私有的：运行时按名字取，不为测试放宽成 public。 */
function grow(hall: Hall): boolean {
  return (hall as unknown as { growIfNeeded: () => boolean }).growIfNeeded();
}

test('117 床 + 88 张有主（75%）→ 入场前升级，只发一条 resize 到 150', () => {
  const sql = freshSql();
  writeBedCount(sql, FIRST);
  const now = Date.now(); // `growIfNeeded` 吃的是真实 `Date.now()`：归属不能写成「过去」
  for (let bedNo = 0; bedNo < 88; bedNo += 1) own(sql, bedNo, now);
  const socket = new FakeSocket();
  const hall = new Hall(
    { id: { name: HALL_ID }, storage: { sql }, getWebSockets: () => [socket] } as never,
    {} as never,
  );

  expect(readMeta(sql).bedCount).toBe(FIRST);
  expect(grow(hall)).toBe(true);

  expect(readMeta(sql).bedCount).toBe(SECOND);
  const resize: DownstreamMessage = { t: 'resize', bedCount: SECOND };
  expect(socket.received).toEqual([JSON.stringify(resize)]); // 只发一条

  // 反例回归：扩完已用率降到 58.7%，同一档不连跳
  expect(usedBedCount(sql, Date.now())).toBe(88);
  expect(grow(hall)).toBe(false);
  expect(socket.received).toHaveLength(1);
});