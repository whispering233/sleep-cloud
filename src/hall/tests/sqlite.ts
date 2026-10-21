/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />
import { DatabaseSync } from 'node:sqlite';

import {
  ADMIN_AUDIT_TABLE_SQL,
  BED_INDEX_SQL,
  BED_TABLE_SQL,
  BLOCK_TABLE_SQL,
  IDENTITY_INDEX_SQL,
  IDENTITY_TABLE_SQL,
  META_TABLE_SQL,
  REPORT_INDEX_SQL,
  REPORT_TABLE_SQL,
} from '../schema';

/**
 * 判定写在 SQL 里的那些函数（`bed-store.ts`）用**真 SQL** 测：用本机 Node 自带的 `node:sqlite`
 * 把同一份 DDL 建起来直接跑（不引依赖、不需要 workerd）。适配器只为抹平游标形状差异。
 *
 * 要求：Node 带 `node:sqlite`（v22.x 已无需 flag）；更老的 Node 跑不了这些文件。
 */
export function freshSql(): SqlStorage {
  const db = new DatabaseSync(':memory:');
  db.exec(BED_TABLE_SQL);
  for (const statement of BED_INDEX_SQL) db.exec(statement);
  db.exec(META_TABLE_SQL);
  db.exec(IDENTITY_TABLE_SQL);
  for (const statement of IDENTITY_INDEX_SQL) db.exec(statement);
  db.exec(BLOCK_TABLE_SQL);
  db.exec(ADMIN_AUDIT_TABLE_SQL);
  db.exec(REPORT_TABLE_SQL);
  for (const statement of REPORT_INDEX_SQL) db.exec(statement);

  return {
    exec: (query: string, ...bindings: unknown[]) => {
      const statement = db.prepare(query);
      // `SELECT` / `... RETURNING` 才有行；其余是写语句（写语句要看 `changes`）
      if (/^\s*(select|with)\b/i.test(query) || /returning/i.test(query)) {
        const rows = statement.all(...(bindings as never[]));
        return {
          toArray: () => rows,
          one: () => rows[0],
          rowsWritten: 0,
        };
      }
      const info = statement.run(...(bindings as never[]));
      return {
        toArray: () => [],
        one: () => {
          throw new Error('写语句没有行');
        },
        rowsWritten: Number(info.changes),
      };
    },
  } as unknown as SqlStorage;
}

/** 直接读原始行（绕开按时间戳推导的那一层）：确认写对了每一列。 */
export function rawRow(sql: SqlStorage, bedNo: number): Record<string, unknown> | undefined {
  return sql
    .exec(
      `SELECT state, owner_user_id, owner_name, owner_appearance, claimed_at, last_seen_at,
        sleep_started_at, updated_at FROM bed WHERE bed_no = ?`,
      bedNo,
    )
    .toArray()[0];
}

export interface BedFields {
  state: string;
  ownerUserId?: string | null;
  name?: string | null;
  /** 认领时刻；缺省即 `NULL`（历史行，冷却据此视为无冷却） */
  claimedAt?: number | null;
  lastSeenAt?: number | null;
  sleepStartedAt?: number | null;
  updatedAt: number;
}

/** 直接插行，绕开状态机：测的是 SQL 谓词本身，不是上层怎么写出这些行。 */
export function insertBed(sql: SqlStorage, bedNo: number, fields: BedFields): void {
  sql.exec(
    `INSERT INTO bed (bed_no, state, owner_user_id, owner_name, owner_appearance,
      claimed_at, last_seen_at, sleep_started_at, updated_at)
     VALUES (?, ?, ?, ?, 'boy', ?, ?, ?, ?)`,
    bedNo,
    fields.state,
    fields.ownerUserId ?? null,
    fields.name ?? (fields.ownerUserId ? '夜猫' : null),
    fields.claimedAt ?? null,
    fields.lastSeenAt ?? null,
    fields.sleepStartedAt ?? null,
    fields.updatedAt,
  );
}