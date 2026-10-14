/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { BED_OWNERSHIP_TTL_MS } from '../../shared/constants';
import {
  clearAllTraceBeds,
  listExpiredOwnerships,
  listTraceBeds,
  readBed,
  releaseExpiredOwnerships,
} from '../bed-store';
import { BED_INDEX_SQL, BED_TABLE_SQL } from '../schema';

/**
 * 清理谓词的**真 SQL** 测试（`docs/design/10-hall-runtime.md` §7）。
 *
 * 判定写在 SQL 里，用纯函数测等于测了一份没人跑的副本；这里用本机 Node 自带的 `node:sqlite`
 * 把同一张表建起来直接跑（不引依赖、不需要 workerd）。适配器只为抹平游标形状差异。
 *
 * 要求：Node 带 `node:sqlite`（本机 v22.x 已无需 flag）；更老的 Node 跑不了这个文件。
 */

const BOUNDARY = Date.parse('2025-07-01T00:00:00Z'); // 该厅当天 08:00（Asia/Shanghai）
const NOW = BOUNDARY + 3 * 60 * 60 * 1000; // 补跑发生在三小时后：now 与 boundary 不能是同一个值

type Sql = Parameters<typeof readBed>[0];

function freshSql(): Sql {
  const db = new DatabaseSync(':memory:');
  db.exec(BED_TABLE_SQL);
  for (const statement of BED_INDEX_SQL) db.exec(statement);
  // 游标是急切的：`all()` 对写语句也会执行（无 RETURNING 时返回空行），SELECT 则拿回行
  return {
    exec: (query: string, ...bindings: unknown[]) => {
      const rows = db.prepare(query).all(...(bindings as never[]));
      return { toArray: () => rows };
    },
  } as unknown as Sql;
}

/** 原始行（含 `readBed` 不投影的那几列）：确认清理写对了每一列，而不只是投影出来的 5 列。 */
function rawRow(sql: Sql, bedNo: number): Record<string, unknown> {
  return sql
    .exec(
      `SELECT state, owner_user_id, owner_name, owner_tz, claimed_at, last_seen_at, sleep_started_at, updated_at
       FROM bed WHERE bed_no = ?`,
      bedNo,
    )
    .toArray()[0] as Record<string, unknown>;
}

interface BedFields {
  state: string;
  ownerUserId?: string | null;
  lastSeenAt?: number | null;
  sleepStartedAt?: number | null;
  updatedAt: number;
}

/** 直接插行，绕开状态机：本文件测的是 SQL 谓词本身，不是上层怎么写出这些行。 */
function insertBed(sql: Sql, bedNo: number, fields: BedFields): void {
  sql.exec(
    `INSERT INTO bed (bed_no, state, owner_user_id, owner_name, owner_appearance, owner_tz,
      last_seen_at, sleep_started_at, updated_at)
     VALUES (?, ?, ?, ?, 'a1', 'Asia/Shanghai', ?, ?, ?)`,
    bedNo,
    fields.state,
    fields.ownerUserId ?? null,
    fields.ownerUserId === undefined || fields.ownerUserId === null ? null : '夜猫',
    fields.lastSeenAt ?? null,
    fields.sleepStartedAt ?? null,
    fields.updatedAt,
  );
}

describe('睡痕清空（真 SQL）', () => {
  it('只清 updated_at 早于边界的行，且清空后归属仍在', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'trace', ownerUserId: 'u_missed', updatedAt: BOUNDARY - 1 }); // 本该在日界前清掉
    insertBed(sql, 2, { state: 'trace', ownerUserId: 'u_edge', updatedAt: BOUNDARY }); // 正好日界 → 留
    insertBed(sql, 3, { state: 'trace', ownerUserId: 'u_tonight', updatedAt: BOUNDARY + 1 }); // 当晚 → 留
    insertBed(sql, 4, { state: 'lying', ownerUserId: 'u_lying', updatedAt: BOUNDARY - 1000 }); // 不是睡痕
    insertBed(sql, 5, { state: 'asleep', ownerUserId: 'u_asleep', updatedAt: BOUNDARY - 1000 });

    expect(listTraceBeds(sql, BOUNDARY).map((row) => row.bedNo)).toEqual([1]);

    clearAllTraceBeds(sql, NOW, BOUNDARY);

    expect(readBed(sql, 1)).toMatchObject({ state: 'empty', ownerUserId: 'u_missed' });
    expect(readBed(sql, 2)?.state).toBe('trace');
    expect(readBed(sql, 3)?.state).toBe('trace');
    expect(readBed(sql, 4)?.state).toBe('lying');
    expect(readBed(sql, 5)?.state).toBe('asleep');
  });

  it('清空睡痕会清掉 sleep_started_at 并刷新 updated_at，不留半截状态', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'trace', ownerUserId: 'u_a', updatedAt: BOUNDARY - 1, sleepStartedAt: NOW - 10_000 });

    clearAllTraceBeds(sql, NOW, BOUNDARY);

    const row = readBed(sql, 1);
    expect(row?.state).toBe('empty');
    expect(row?.ownerUserId).toBe('u_a'); // 归属保留：睡痕清理不夺床
    expect(rawRow(sql, 1)).toMatchObject({ state: 'empty', sleep_started_at: null, updated_at: NOW });
  });

  it('归属为空的历史睡痕行照样被清，但列出来时归属是 null（调用方据此不发 leave）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'trace', ownerUserId: null, updatedAt: BOUNDARY - 1 });

    expect(listTraceBeds(sql, BOUNDARY)).toEqual([{ bedNo: 1, ownerUserId: null }]);

    clearAllTraceBeds(sql, NOW, BOUNDARY);
    expect(readBed(sql, 1)?.state).toBe('empty');
  });

  it('一条睡痕都不该清时不命中任何行（实例重建的补跑是常态）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'trace', ownerUserId: 'u_tonight', updatedAt: BOUNDARY + 1 });

    expect(listTraceBeds(sql, BOUNDARY)).toEqual([]);
    clearAllTraceBeds(sql, NOW, BOUNDARY);
    expect(readBed(sql, 1)?.state).toBe('trace');
  });
});

describe('30 天归属释放（真 SQL）', () => {
  it('正好 30 天不算超期，多 1 毫秒算', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'empty', ownerUserId: 'u_edge', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS, updatedAt: NOW });
    insertBed(sql, 2, { state: 'empty', ownerUserId: 'u_gone', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1, updatedAt: NOW });
    insertBed(sql, 3, { state: 'empty', ownerUserId: 'u_recent', lastSeenAt: NOW - 1000, updatedAt: NOW });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([2]);

    releaseExpiredOwnerships(sql, NOW);
    expect(readBed(sql, 1)?.ownerUserId).toBe('u_edge');
    expect(readBed(sql, 3)?.ownerUserId).toBe('u_recent');
    expect(readBed(sql, 2)?.ownerUserId).toBeNull();
  });

  it('last_seen_at 为空的有主床也释放，且归属字段与占用一起清干净', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'trace', ownerUserId: 'u_history', lastSeenAt: null, updatedAt: NOW, sleepStartedAt: NOW });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([1]);

    releaseExpiredOwnerships(sql, NOW);
    expect(rawRow(sql, 1)).toMatchObject({
      state: 'empty',
      owner_user_id: null,
      owner_name: null,
      owner_tz: null,
      claimed_at: null,
      last_seen_at: null,
      sleep_started_at: null,
      updated_at: NOW,
    });
    expect(readBed(sql, 1)).toEqual({
      bedNo: 1,
      state: 'empty',
      ownerUserId: null,
      ownerName: null,
      ownerAppearance: null,
    });
  });

  it('无主的床不会进释放批次（空床不是超期归属）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'empty', ownerUserId: null, updatedAt: NOW - BED_OWNERSHIP_TTL_MS * 2 });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([]);
  });

  it('已经躺下但在线的人不会被误释放（last_seen_at 是新的）', () => {
    const sql = freshSql();
    insertBed(sql, 1, { state: 'asleep', ownerUserId: 'u_here', lastSeenAt: NOW - 500, updatedAt: NOW });

    expect(listExpiredOwnerships(sql, NOW)).toEqual([]);
  });
});
