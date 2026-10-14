import type { Appearance } from '../shared/protocol';
import type { OccupiedBedRow } from './grace';

/**
 * 床位占用状态（主体是**一张床**，见 `docs/db/schema.md`）。
 * 没有 `roaming`——人不在床上时那张床就是 `empty`；两个词表不要混用。
 */
export type BedState = 'empty' | 'lying' | 'asleep' | 'trace';

export interface BedRow {
  bedNo: number;
  state: BedState;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerAppearance: string | null;
}

interface RawBedRow {
  /** 平台的 SqlStorage 游标要求行类型满足 `Record<string, SqlStorageValue>` */
  [key: string]: string | number | null;
  bed_no: number;
  state: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_appearance: string | null;
  last_seen_at: number | null;
}

/** 按主键读单行（**不做全表读取**：行读取是最容易被放大到超额的维度）。 */
export function readBed(sql: SqlStorage, bedNo: number): BedRow | undefined {
  const row = sql
    .exec<RawBedRow>(
      'SELECT bed_no, state, owner_user_id, owner_name, owner_appearance FROM bed WHERE bed_no = ?',
      bedNo,
    )
    .toArray()[0];
  return row
    ? {
        bedNo: row.bed_no,
        state: row.state as BedState,
        ownerUserId: row.owner_user_id,
        ownerName: row.owner_name,
        ownerAppearance: row.owner_appearance,
      }
    : undefined;
}

export interface PutInBedInput {
  bedNo: number;
  userId: string;
  /** 当前会话昵称：**每次上床都刷新快照**（它只在被显示时才需要准确，空床不显示名字） */
  name: string;
  appearance: Appearance;
  timezone: string;
  now: number;
  /** 首次认领 */
  claiming: boolean;
}

/** 上床：占用置 `lying`，写名字快照；首次还要认领归属。 */
export function putInBed(sql: SqlStorage, input: PutInBedInput): void {
  if (input.claiming) {
    sql.exec(
      `UPDATE bed SET owner_user_id = ?, owner_name = ?, owner_appearance = ?, owner_tz = ?,
        claimed_at = ?, last_seen_at = ?, state = 'lying', sleep_started_at = ?, updated_at = ?
       WHERE bed_no = ?`,
      input.userId,
      input.name,
      input.appearance,
      input.timezone,
      input.now,
      input.now,
      input.now,
      input.now,
      input.bedNo,
    );
    return;
  }

  sql.exec(
    `UPDATE bed SET owner_name = ?, owner_appearance = ?, owner_tz = ?, last_seen_at = ?,
      state = 'lying', sleep_started_at = ?, updated_at = ?
     WHERE bed_no = ?`,
    input.name,
    input.appearance,
    input.timezone,
    input.now,
    input.now,
    input.now,
    input.bedNo,
  );
}

/** 占用状态变化：清醒度（`lying` ↔ `asleep`）或转睡痕（`trace`）。 */
export function setBedOccupancy(
  sql: SqlStorage,
  bedNo: number,
  state: 'lying' | 'asleep' | 'trace',
  now: number,
): void {
  sql.exec('UPDATE bed SET state = ?, updated_at = ? WHERE bed_no = ?', state, now, bedNo);
}

/**
 * 有占用者的床位（行数 ≈ 当前并发，**不是全表**）：宽限推导与快照补录共用。
 * 睡痕行不在其中——它们不需要推导，直接由 `state` 索引取出来显示。
 */
export function listOccupiedBeds(sql: SqlStorage): OccupiedBedRow[] {
  return sql
    .exec<RawBedRow>(
      `SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at
       FROM bed WHERE state IN ('lying', 'asleep') AND owner_user_id IS NOT NULL`,
    )
    .toArray()
    .map((row) => ({
      bedNo: row.bed_no,
      state: row.state as OccupiedBedRow['state'],
      ownerUserId: row.owner_user_id as string,
      ownerName: row.owner_name,
      ownerAppearance: row.owner_appearance,
      lastSeenAt: row.last_seen_at,
    }));
}

/** 我的床是否正留着睡痕（宽限已过、人已离线）。走唯一索引 `owner_user_id` 取一行。 */
export function findTraceBed(sql: SqlStorage, userId: string): number | undefined {
  return sql
    .exec<{ bed_no: number }>("SELECT bed_no FROM bed WHERE owner_user_id = ? AND state = 'trace'", userId)
    .toArray()[0]?.bed_no;
}

export interface RestoreBedInput {
  bedNo: number;
  name: string;
  appearance: Appearance;
  timezone: string;
  now: number;
}

/**
 * 从睡痕恢复：床重新被占用（清醒）。**不是新的一次上床**——归属与 `sleep_started_at` 都不动，
 * 只刷新名字快照（见 `docs/db/schema.md` §5）。
 */
export function restoreBedOccupancy(sql: SqlStorage, input: RestoreBedInput): void {
  sql.exec(
    `UPDATE bed SET state = 'lying', owner_name = ?, owner_appearance = ?, owner_tz = ?,
      last_seen_at = ?, updated_at = ?
     WHERE bed_no = ?`,
    input.name,
    input.appearance,
    input.timezone,
    input.now,
    input.now,
    input.bedNo,
  );
}

/** 起身 / 睡痕清理：床变空，**归属保留**（`sleep_started_at` 清空）。 */
export function clearBed(sql: SqlStorage, bedNo: number, now: number): void {
  sql.exec("UPDATE bed SET state = 'empty', sleep_started_at = NULL, updated_at = ? WHERE bed_no = ?", now, bedNo);
}
