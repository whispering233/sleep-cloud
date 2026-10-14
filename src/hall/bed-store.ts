import type { Appearance } from '../shared/protocol';

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

/** 清醒度变化（`lying` ↔ `asleep`）。 */
export function setBedOccupancy(sql: SqlStorage, bedNo: number, state: 'lying' | 'asleep', now: number): void {
  sql.exec('UPDATE bed SET state = ?, updated_at = ? WHERE bed_no = ?', state, now, bedNo);
}

/** 起身 / 睡痕清理：床变空，**归属保留**（`sleep_started_at` 清空）。 */
export function clearBed(sql: SqlStorage, bedNo: number, now: number): void {
  sql.exec("UPDATE bed SET state = 'empty', sleep_started_at = NULL, updated_at = ? WHERE bed_no = ?", now, bedNo);
}
