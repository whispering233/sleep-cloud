import { describe, expect, it } from 'vitest';

import { BED_OWNERSHIP_TTL_MS } from '../../shared/constants';
import { HALL_LEVELS } from '../../shared/layout';
import {
  effectivelyOwned,
  findOwnedBed,
  listExpiredOwnerships,
  listOccupiedBeds,
  listOwnedBeds,
  listTraceBeds,
  outerRingBusy,
  ownershipAlive,
  putInBed,
  readBed,
  readMeta,
  releaseExpiredOwnerships,
  smallestClaimableBed,
  usedBedCount,
  writeBedCount,
  writeDailyWakeAt,
} from '../bed-store';
import { META_KEYS } from '../schema';
import { freshSql, insertBed, rawRow } from './sqlite';

const NOW = Date.parse('2025-07-01T12:00:00Z');
/** 前几档容量由级表推导（`docs/design/20-layout.md` §3.1），不在测试里写死。 */
const FIRST = (HALL_LEVELS[0] as { capacity: number }).capacity;
const SECOND = (HALL_LEVELS[1] as { capacity: number }).capacity;
const THIRD = (HALL_LEVELS[2] as { capacity: number }).capacity;
const LAST = (HALL_LEVELS[HALL_LEVELS.length - 1] as { capacity: number }).capacity;
const claim = (bedNo: number, userId: string, name = '夜猫') =>
  ({ bedNo, userId, name, appearance: 'boy', now: NOW, claiming: true }) as const;

/** 床位行数（只用于断言：产品代码里已经没有「有主床数」这个量了）。 */
const bedRowCount = (sql: SqlStorage): number =>
  sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM bed').one().n;

/** 库里存着的 `meta.bed_count`（断言「写回了」，与 `readMeta` 的返回值分开看）。 */
const storedBedCount = (sql: SqlStorage): number =>
  sql.exec<{ value: number }>('SELECT value FROM meta WHERE key = ?', META_KEYS.bedCount).one().value;

/** 写入计数：包一层 `exec` 数出所有非 `SELECT` 语句（断言「读到合法值时一次库都不写」）。 */
function countingSql(sql: SqlStorage): { sql: SqlStorage; writes: () => number } {
  let writes = 0;
  const counting = {
    exec: (query: string, ...bindings: SqlStorageValue[]) => {
      if (!/^\s*(select|with)\b/i.test(query)) writes += 1;
      return sql.exec(query, ...bindings);
    },
  } as unknown as SqlStorage;
  return { sql: counting, writes: () => writes };
}

describe('惰性行：没有行 = 无主空床', () => {
  it('新厅一行床位行都没有，出生点直接是床号 0', () => {
    const sql = freshSql();
    expect(bedRowCount(sql)).toBe(0);
    expect(readBed(sql, 0, NOW)).toBeUndefined();
  });

  it('认领才诞生行；再认领一张就多一行（行数 = 有主或有占用的床）', () => {
    const sql = freshSql();
    putInBed(sql, claim(5, 'u_a'));
    expect(rawRow(sql, 5)).toMatchObject({ state: 'lying', owner_user_id: 'u_a' });
    putInBed(sql, claim(0, 'u_b'));
    expect(bedRowCount(sql)).toBe(2);
  });

  it('编号最小的可认领床会跳过有主、有占用、睡痕的那些（30 天释放留下的坑会被新人补上）', () => {
    const sql = freshSql();
    insertBed(sql, 0, { state: 'empty', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 1, { state: 'asleep', ownerUserId: 'u_b', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 2, { state: 'trace', ownerUserId: 'u_c', lastSeenAt: NOW - 1000, updatedAt: NOW - 1000 });
    expect(smallestClaimableBed(sql, FIRST, NOW)).toBe(3);
  });

  it('归属已过期（行还没被释放）的床仍可认领；没有这一类坑时才真的没位子', () => {
    const sql = freshSql();
    insertBed(sql, 0, { state: 'asleep', ownerUserId: 'u_here', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 1, { state: 'empty', ownerUserId: 'u_gone', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1, updatedAt: NOW });
    expect(smallestClaimableBed(sql, 2, NOW)).toBe(1); // 过期归属不算占用

    releaseExpiredOwnerships(sql, NOW); // 释放之后仍然可认领，只是行变干净了
    expect(rawRow(sql, 1)).toMatchObject({ owner_user_id: null });
    expect(smallestClaimableBed(sql, 2, NOW)).toBe(1);

    // 1 号床换成一张睡痕（有占用）→ 两张床都忙，没有可认领的床
    sql.exec(
      "UPDATE bed SET state = 'trace', owner_user_id = 'u_b', last_seen_at = ?, updated_at = ? WHERE bed_no = 1",
      NOW,
      NOW - 1000,
    );
    expect(smallestClaimableBed(sql, 2, NOW)).toBeUndefined();
  });
});

describe('meta：bed_count / daily_wake_at', () => {
  it('床位数缺失时按需推导一次并写回（MAX(bed_no) 反推所属的档）', () => {
    const sql = freshSql();
    insertBed(sql, 200, { state: 'empty', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 3, { state: 'empty', ownerUserId: 'u_b', lastSeenAt: NOW, updatedAt: NOW });

    // 床号 200 只能装进第 3 档（12×18 = 216），不是「最大床号 + 1」
    expect(readMeta(sql)).toEqual({ bedCount: THIRD, dailyWakeAt: undefined });
    // 写回了：第二次读不再重算
    expect(sql.exec<{ value: number }>('SELECT value FROM meta WHERE key = ?', META_KEYS.bedCount).one().value).toBe(THIRD);
  });

  it('一行都没有的厅推导成第 1 级', () => {
    const sql = freshSql();
    expect(readMeta(sql)).toEqual({ bedCount: FIRST, dailyWakeAt: undefined });
  });

  it('已在级表里的值原样返回，且不写库', () => {
    const sql = freshSql();
    writeBedCount(sql, THIRD);
    const counted = countingSql(sql);

    expect(readMeta(counted.sql).bedCount).toBe(THIRD);
    expect(counted.writes()).toBe(0);
    writeBedCount(counted.sql, FIRST); // 夹具自检：写入真会被数到
    expect(counted.writes()).toBe(1);
  });

  it('级表残留（114 / 208）→ 归一到能装下它的最小那一档并写回', () => {
    const sql = freshSql();
    writeBedCount(sql, 114);
    expect(readMeta(sql).bedCount).toBe(FIRST); // 9×13 = 117
    expect(storedBedCount(sql)).toBe(FIRST);

    writeBedCount(sql, 208);
    expect(readMeta(sql).bedCount).toBe(THIRD); // 12×18 = 216
    expect(storedBedCount(sql)).toBe(THIRD);
  });

  it('残留值比既有床小时仍取不小于 MAX(bed_no) + 1 的那一档（既有床不失去几何）', () => {
    const sql = freshSql();
    insertBed(sql, SECOND, { state: 'lying', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
    writeBedCount(sql, 114);

    // 床号 150 装不进第 1 档（117），也不在第 2 档（150 只到 149）→ 必须升到第 3 档
    expect(readMeta(sql).bedCount).toBe(THIRD);
    expect(storedBedCount(sql)).toBe(THIRD);
  });

  it('高于末档（9790）→ 夹到末档并写回（多出来的床位行成为不可见、不可用的残留）', () => {
    const sql = freshSql();
    writeBedCount(sql, 9790);
    expect(readMeta(sql).bedCount).toBe(LAST); // 81×118 = 9558
    expect(storedBedCount(sql)).toBe(LAST);
  });

  it('daily_wake_at 缺失 = 从未结算；写回后读得回来（每日唤醒用它实现「一天最多降一级」）', () => {
    const sql = freshSql();
    expect(readMeta(sql).dailyWakeAt).toBeUndefined();

    writeDailyWakeAt(sql, NOW);
    expect(readMeta(sql).dailyWakeAt).toBe(NOW);
  });

  it('认领只写床位行，不写任何计数；升级只写 bed_count（不写床位行）', () => {
    const sql = freshSql();
    putInBed(sql, claim(0, 'u_a'));
    expect(rawRow(sql, 0)).toMatchObject({ owner_user_id: 'u_a' });

    const rowsBefore = bedRowCount(sql);
    writeBedCount(sql, SECOND);
    expect(bedRowCount(sql)).toBe(rowsBefore); // 升级不加行
    expect(readMeta(sql).bedCount).toBe(SECOND);
  });
});

describe('睡痕：没有 TTL，跟归属同寿（30 天释放才消失）', () => {
  it('睡痕算占用：读出来是 trace，也占着床', () => {
    const sql = freshSql();
    const tracedAt = NOW - 1000;
    insertBed(sql, 4, { state: 'trace', ownerUserId: 'u_a', lastSeenAt: tracedAt, updatedAt: tracedAt });

    expect(readBed(sql, 4, NOW)?.state).toBe('trace');
    expect(listTraceBeds(sql)).toEqual([{ bedNo: 4, userId: 'u_a', name: '夜猫', appearance: 'boy' }]);
  });

  it('睡痕远超 12 小时仍是占用（没有 TTL，唯一的时间轴是 30 天归属释放）', () => {
    const sql = freshSql();
    const tracedAt = NOW - 20 * 24 * 3600_000; // 二十天前就离开，仍在 30 天归属期内
    insertBed(sql, 4, { state: 'trace', ownerUserId: 'u_a', lastSeenAt: tracedAt, updatedAt: tracedAt });

    expect(readBed(sql, 4, NOW)).toMatchObject({ state: 'trace', ownerUserId: 'u_a' });
    expect(listTraceBeds(sql)).toHaveLength(1);
    expect(listOwnedBeds(sql, NOW)).toEqual([4]);
    expect(findOwnedBed(sql, 'u_a', NOW)?.bedNo).toBe(4);
    expect(usedBedCount(sql, NOW)).toBe(1); // 二十天前的睡痕仍然算「已用」
  });

  it('睡痕只随 30 天归属释放消失：行变 empty，位图与睡痕列表都不再有它', () => {
    const sql = freshSql();
    const tracedAt = NOW - BED_OWNERSHIP_TTL_MS - 1;
    insertBed(sql, 4, { state: 'trace', ownerUserId: 'u_a', lastSeenAt: tracedAt, updatedAt: tracedAt });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([4]);
    releaseExpiredOwnerships(sql, NOW);
    expect(rawRow(sql, 4)).toMatchObject({ state: 'empty', owner_user_id: null });
    expect(listTraceBeds(sql)).toEqual([]);
    expect(listOwnedBeds(sql, NOW)).toEqual([]);
  });

  it('本人回来认领新床：名下那条没人释放的行先让开（否则撞一人一床的唯一索引）', () => {
    const sql = freshSql();
    insertBed(sql, 4, {
      state: 'trace',
      ownerUserId: 'u_a',
      lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1,
      updatedAt: NOW - BED_OWNERSHIP_TTL_MS - 1,
    });

    putInBed(sql, claim(9, 'u_a')); // 唯一索引不会拦下
    expect(readBed(sql, 9, NOW)).toMatchObject({ state: 'lying', ownerUserId: 'u_a' });
    expect(rawRow(sql, 4)).toMatchObject({ state: 'empty', owner_user_id: null });
    expect(bedRowCount(sql)).toBe(2); // 让开的那行还在，只是变成无主空床
  });
});

describe('归属：过期同样是读取时推导', () => {
  it('`last_seen_at` 为空 = 已过期（认领必然写它，空只可能是历史/异常行）', () => {
    expect(ownershipAlive(null, NOW)).toBe(false);
    expect(ownershipAlive(NOW, NOW)).toBe(true);
  });

  it('有效归属 = 归属未过期（睡痕不影响归属：它没有 TTL）', () => {
    const owned = { state: 'empty', last_seen_at: NOW, updated_at: NOW };
    expect(effectivelyOwned(owned as never, NOW)).toBe(true);
    expect(effectivelyOwned({ ...owned, last_seen_at: null } as never, NOW)).toBe(false);
    expect(effectivelyOwned({ ...owned, last_seen_at: NOW - BED_OWNERSHIP_TTL_MS - 1 } as never, NOW)).toBe(false);
    expect(effectivelyOwned({ ...owned, state: 'trace' } as never, NOW)).toBe(true);
  });

  it('正好 30 天不算超期，多 1 毫秒算（取行与释放是同一条边）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'empty', ownerUserId: 'u_edge', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS, updatedAt: NOW });
    insertBed(sql, 2, { state: 'empty', ownerUserId: 'u_gone', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1, updatedAt: NOW });
    insertBed(sql, 3, { state: 'empty', ownerUserId: 'u_recent', lastSeenAt: NOW - 1000, updatedAt: NOW });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([2]);
    expect(listOwnedBeds(sql, NOW)).toEqual([1, 3]);
    expect(findOwnedBed(sql, 'u_gone', NOW)).toBeUndefined();
    expect(readBed(sql, 2, NOW)?.ownerUserId).toBeNull(); // 过期 → 视为无主（可认领）

    releaseExpiredOwnerships(sql, NOW);
    expect(rawRow(sql, 2)).toMatchObject({
      state: 'empty',
      owner_user_id: null,
      owner_name: null,
      claimed_at: null,
      last_seen_at: null,
      sleep_started_at: null,
    });
    expect(rawRow(sql, 1)?.owner_user_id).toBe('u_edge');
    expect(listOwnedBeds(sql, NOW)).toEqual([1, 3]); // 只释放了那一行
  });

  it('已经躺下但在线的人不会被误释放（last_seen_at 是新的）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'asleep', ownerUserId: 'u_here', lastSeenAt: NOW - 500, updatedAt: NOW });
    expect(listExpiredOwnerships(sql, NOW)).toEqual([]);
  });

  it('释放只动超期那几行，未到期的行原样留着', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'empty', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 2, { state: 'trace', ownerUserId: 'u_b', lastSeenAt: null, updatedAt: NOW });

    releaseExpiredOwnerships(sql, NOW);
    expect(rawRow(sql, 1)?.owner_user_id).toBe('u_a');
    expect(rawRow(sql, 2)?.owner_user_id).toBeNull(); // `last_seen_at` 为空 = 已过期
  });
});

describe('降级判据：外圈那一圈全无主且无占用', () => {
  it('一行都没有的外圈 → 不忙', () => {
    const sql = freshSql();
    insertBed(sql, 0, { state: 'asleep', ownerUserId: 'u_inner', lastSeenAt: NOW, updatedAt: NOW });
    expect(outerRingBusy(sql, FIRST, SECOND, NOW)).toBe(false);
  });

  it('外圈有人（哪怕 29 天没回来）→ 忙，这一级保留', () => {
    const sql = freshSql();
    insertBed(sql, 130, { state: 'empty', ownerUserId: 'u_absent', lastSeenAt: NOW - 29 * 24 * 3600_000, updatedAt: NOW });
    expect(outerRingBusy(sql, FIRST, SECOND, NOW)).toBe(true);
  });

  it('外圈只有过期归属 → 不忙', () => {
    const sql = freshSql();
    insertBed(sql, 120, { state: 'empty', ownerUserId: 'u_gone', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1, updatedAt: NOW });
    expect(outerRingBusy(sql, FIRST, SECOND, NOW)).toBe(false);
  });

  it('外圈有睡痕（哪怕二十天前）→ 忙（睡痕也算占用，没有 TTL）', () => {
    const sql = freshSql();
    const tracedAt = NOW - 20 * 24 * 3600_000;
    insertBed(sql, 121, { state: 'trace', ownerUserId: 'u_trace', lastSeenAt: tracedAt, updatedAt: tracedAt });
    expect(outerRingBusy(sql, FIRST, SECOND, NOW)).toBe(true);
  });
});

describe('占用行与归属行', () => {
  it('`listOccupiedBeds` 只取 lying/asleep（睡痕走 `listTraceBeds`）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'lying', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 2, { state: 'asleep', ownerUserId: 'u_b', lastSeenAt: NOW, updatedAt: NOW });
    insertBed(sql, 3, { state: 'trace', ownerUserId: 'u_c', lastSeenAt: NOW, updatedAt: NOW });

    expect(listOccupiedBeds(sql).map((row) => [row.bedNo, row.state])).toEqual([
      [1, 'lying'],
      [2, 'asleep'],
    ]);
  });
});