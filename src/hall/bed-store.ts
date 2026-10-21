import { BED_OWNERSHIP_TTL_MS } from '../shared/constants';
import { HALL_LEVELS, levelIndexOfBedCount } from '../shared/layout';
import type { HallLevel } from '../shared/layout';
import type { Appearance } from '../shared/protocol';
import type { OccupiedBedRow } from './grace';
import { META_KEYS } from './schema';

/**
 * 床位存取（见 `docs/db/schema.md`）。
 *
 * 两条纪律贯穿本文件：
 * 1. **惰性行**：只有「有主或有占用」的床才有一行，没有行 = 无主空床；行数 ≈ 有主床数（几百）；
 * 2. **过期是读取时推导**：归属过期（`last_seen_at + BED_OWNERSHIP_TTL_MS`）视为无主，**不写库**；
 *    只有每日唤醒才真正清行。**睡痕没有 TTL**——它跟归属同寿（见 `docs/db/schema.md` §7）。
 */

/** 床位占用状态（主体是**一张床**）。没有 `roaming`——人不在床上时那张床就是 `empty`。 */
type BedState = 'empty' | 'lying' | 'asleep' | 'trace';

/** 一张床此刻的**制度事实**（过期已按时间戳推导掉，不是库里的原始值）。 */
export interface BedRow {
  bedNo: number;
  state: BedState;
  /** 有效归属；为空表示无主（可能是过期归属） */
  ownerUserId: string | null;
  ownerName: string | null;
  ownerAppearance: string | null;
}

/** 库里的原始行（推导的输入）。`SqlStorage` 游标要求行类型满足 `Record<string, SqlStorageValue>`。 */
interface RawBedRow {
  [key: string]: string | number | null;
  bed_no: number;
  state: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_appearance: string | null;
  last_seen_at: number | null;
  updated_at: number;
}

/** 归属还在不在：`last_seen_at` 为空 = 已过期（认领必然写 `last_seen_at`，空只可能是历史/异常行）。 */
export function ownershipAlive(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && lastSeenAt >= now - BED_OWNERSHIP_TTL_MS;
}

/** 有效归属：归属未过期。睡痕不会过期，所以它不影响归属（**到期只靠 30 天归属释放**）。 */
export function effectivelyOwned(raw: RawBedRow, now: number): boolean {
  return ownershipAlive(raw.last_seen_at, now);
}

/** 这张床此刻算不算「有主或有占用」（升级/降级与出生点共用这一条判据）。 */
export function bedBusy(raw: RawBedRow, now: number): boolean {
  return effectivelyOwned(raw, now) || raw.state !== 'empty';
}

/** 读取时推导：原始行 → 此刻的制度事实。**这是全系统唯一一处拼写「过期」的地方**。 */
export function effectiveBed(raw: RawBedRow, now: number): BedRow {
  const owned = effectivelyOwned(raw, now);
  return {
    bedNo: raw.bed_no,
    state: raw.state as BedState,
    ownerUserId: owned ? raw.owner_user_id : null,
    ownerName: owned ? raw.owner_name : null,
    ownerAppearance: owned ? raw.owner_appearance : null,
  };
}

/** 按主键读单行（**不做全表读取**：行读取是最容易被放大到超额的维度）。没有行 = 无主空床。 */
export function readBed(sql: SqlStorage, bedNo: number, now: number): BedRow | undefined {
  const row = sql
    .exec<RawBedRow>(`SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed WHERE bed_no = ?`, bedNo)
    .toArray()[0];
  return row ? effectiveBed(row, now) : undefined;
}

/** 我名下的一张床：床号 + 认领时刻（换床冷却由 `claimed_at` 推导）。 */
export interface OwnedBed {
  bedNo: number;
  /** `null` = 历史行没写过这一列，视为无冷却 */
  claimedAt: number | null;
}

/**
 * 我当前拥有的床（**有效归属**）。走唯一索引取一行；没有 = 我还没有床。
 * 谓词与 `effectivelyOwned` 逐字对应（两处必须一起改）。
 */
export function findOwnedBed(sql: SqlStorage, userId: string, now: number): OwnedBed | undefined {
  const row = sql
    .exec<{ bed_no: number; claimed_at: number | null }>(
      `SELECT bed_no, claimed_at FROM bed WHERE owner_user_id = ?
        AND last_seen_at IS NOT NULL AND last_seen_at >= ?
       ORDER BY bed_no`,
      userId,
      now - BED_OWNERSHIP_TTL_MS,
    )
    .toArray()[0];
  return row ? { bedNo: row.bed_no, claimedAt: row.claimed_at } : undefined;
}

/** 我名下正占着的床位行（`trace` 也在内）：重连恢复的**唯一判据**。 */
export interface OwnedOccupiedBed {
  bedNo: number;
  state: 'lying' | 'asleep' | 'trace';
}

/**
 * 我名下**正占着**的那张床（含睡痕）。走 `owner_user_id` 唯一索引取一行；没有 = 我没在床上
 * （可能还有归属，但床是空的）。行上的 `state` 就是重连回来的状态（`10-hall-runtime.md` §6）。
 * **归属过期就不算数**（与 `findOwnedBed` 同一条边）：过期后按新人处理，落在出生点。
 */
export function findOccupiedBedByOwner(sql: SqlStorage, userId: string, now: number): OwnedOccupiedBed | undefined {
  const row = sql
    .exec<{ bed_no: number; state: OwnedOccupiedBed['state'] }>(
      `SELECT bed_no, state FROM bed WHERE owner_user_id = ?
        AND state IN ('lying', 'asleep', 'trace')
        AND last_seen_at IS NOT NULL AND last_seen_at >= ?`,
      userId,
      now - BED_OWNERSHIP_TTL_MS,
    )
    .toArray()[0];
  return row ? { bedNo: row.bed_no, state: row.state } : undefined;
}

/**
 * 有占用者的床位行（行数 ≈ 当前并发，**不是全表**）：宽限推导与快照补录共用。
 * 睡痕不在其中——它们走 `listTraceBeds`。
 */
export function listOccupiedBeds(sql: SqlStorage): OccupiedBedRow[] {
  return sql
    .exec<RawBedRow>(
      `SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed
        WHERE state IN ('lying', 'asleep') AND owner_user_id IS NOT NULL ORDER BY bed_no`,
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

/** 睡痕行（人已离线）：走 `state` 索引，**没有时间过滤**（睡痕没有 TTL，见 `docs/db/schema.md` §7）。 */
export interface TraceBedRow {
  bedNo: number;
  /** 睡痕的「人」由归属快照给出：内存里已经没有他了 */
  userId: string;
  name: string | null;
  appearance: string | null;
}

export function listTraceBeds(sql: SqlStorage): TraceBedRow[] {
  return sql
    .exec<RawBedRow>(
      `SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed
        WHERE state = 'trace' AND owner_user_id IS NOT NULL
        ORDER BY bed_no`,
    )
    .toArray()
    .map((row) => ({
      bedNo: row.bed_no,
      userId: row.owner_user_id as string,
      name: row.owner_name,
      appearance: row.owner_appearance,
    }));
}

/**
 * 超期归属的床（`last_seen_at` 为空或距今超过 30 天）。谓词与 `ownershipAlive` 是同一条边。
 * `state` 顺带取出（同一次查询多一列）：结算要知道这一批里几条原本是睡痕（`settle{traces}`）。
 */
export function listExpiredOwnerships(sql: SqlStorage, now: number): { bedNo: number; state: BedState }[] {
  return sql
    .exec<{ bed_no: number; state: string }>(
      `SELECT bed_no, state FROM bed WHERE owner_user_id IS NOT NULL AND (last_seen_at IS NULL OR last_seen_at < ?)`,
      now - BED_OWNERSHIP_TTL_MS,
    )
    .toArray()
    .map((row) => ({ bedNo: row.bed_no, state: row.state as BedState }));
}

/**
 * 归属释放：一条 `UPDATE` 清空归属与占用，床回到可认领池。
 * 与 `listExpiredOwnerships` 用**同一条判定**（两处写法必须一起改）。
 */
export function releaseExpiredOwnerships(sql: SqlStorage, now: number): void {
  sql.exec(
    `UPDATE bed SET owner_user_id = NULL, owner_name = NULL, owner_appearance = NULL,
      claimed_at = NULL, last_seen_at = NULL, sleep_started_at = NULL, state = 'empty', updated_at = ?
     WHERE owner_user_id IS NOT NULL AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    now,
    now - BED_OWNERSHIP_TTL_MS,
  );
}

/**
 * **有效归属**的有主床号（快照的归属位图用它）：过期归属不算有主
 * ——谓词与 `effectivelyOwned` 逐字对应（快照里的归属与「能不能躺」必须给同一个答案）。
 */
export function listOwnedBeds(sql: SqlStorage, now: number): number[] {
  return sql
    .exec<{ bed_no: number }>(
      `SELECT bed_no FROM bed WHERE owner_user_id IS NOT NULL
        AND last_seen_at IS NOT NULL AND last_seen_at >= ?
       ORDER BY bed_no`,
      now - BED_OWNERSHIP_TTL_MS,
    )
    .toArray()
    .map((row) => row.bed_no);
}

export interface Meta {
  /** 当前级容量：决定世界里存在哪些床 */
  bedCount: number;
  /** 已结算过的每日唤醒边界（UTC 20:00 的 epoch 毫秒）；`undefined` = 从未结算 */
  dailyWakeAt: number | undefined;
}

/** 级表里能装下 `bedCount` 张床的最小那一档的容量；高于末档夹到末档。**反查档只此一处**。 */
function levelCapacityFor(bedCount: number): number {
  return (HALL_LEVELS[levelIndexOfBedCount(bedCount)] as HallLevel).capacity;
}

/** `MAX(bed_no)`：一行都没有返回 `-1`（没有床号 ≥ 0 的行）。 */
function maxBedNo(sql: SqlStorage): number {
  return sql.exec<{ max_bed: number | null }>('SELECT MAX(bed_no) AS max_bed FROM bed').one().max_bed ?? -1;
}

/** `bed_count` 正好是级表里的一档（在表里就原样用，**不写库**）。 */
function isHallLevelCapacity(bedCount: number): boolean {
  return HALL_LEVELS.some((level) => level.capacity === bedCount);
}

function writeMeta(sql: SqlStorage, key: string, value: number): void {
  sql.exec(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/**
 * 读 `meta`（每个 key 一行，一次读完）。
 *
 * `bed_count` 必须**正好是级表里的一档**，否则归一并写回（`10-hall-runtime.md` §3）：在表里 → 原样用、
 * 不写库；**不在表里**（级表改过之后的残留，如旧表的 114）→ 取能装下它的最小那一档，且**不小于
 * `MAX(bed_no) + 1`**（既有床不因此失去几何）；高于末档 → 夹到末档，多出来的床位行会变成
 * **不可见、不可用**的残留（pre-launch 的取舍，真要收拾得走降级那条路径）；**缺失** → 由 `MAX(bed_no)`
 * 反推，一行都没有就是第 1 级。`daily_wake_at` 缺失不算异常——它是「从未结算」。
 */
export function readMeta(sql: SqlStorage): Meta {
  const stored = new Map<string, number>();
  for (const row of sql.exec<{ key: string; value: number }>('SELECT key, value FROM meta').toArray()) {
    stored.set(row.key, row.value);
  }
  const dailyWakeAt = stored.get(META_KEYS.dailyWakeAt);
  const storedBedCount = stored.get(META_KEYS.bedCount);
  if (storedBedCount !== undefined && isHallLevelCapacity(storedBedCount)) {
    return { bedCount: storedBedCount, dailyWakeAt };
  }

  // 缺失时没有下限：能装下 1 张床的那一档就是第 1 档
  const bedCount = levelCapacityFor(Math.max(storedBedCount ?? 1, maxBedNo(sql) + 1));
  writeBedCount(sql, bedCount);
  return { bedCount, dailyWakeAt };
}

/** 升级 / 降级：写 `bed_count`。**不写任何床位行**（新增的床全是无主空床）。 */
export function writeBedCount(sql: SqlStorage, bedCount: number): void {
  writeMeta(sql, META_KEYS.bedCount, bedCount);
}

/** 每日唤醒结算完写回边界（`meta.daily_wake_at`）：**即使这一轮只做了归属释放也要写**。 */
export function writeDailyWakeAt(sql: SqlStorage, at: number): void {
  writeMeta(sql, META_KEYS.dailyWakeAt, at);
}

export interface PutInBedInput {
  bedNo: number;
  userId: string;
  /** 当前会话昵称：**每次上床都刷新快照**（它只在被显示时才需要准确，空床不显示名字） */
  name: string;
  appearance: Appearance;
  now: number;
  /** 首次认领（含「上一行只有过期归属」）：写归属字段 */
  claiming: boolean;
}

/**
 * 上床：占用置 `lying`。认领时写归属字段。**不写任何计数**（没有「有主床数」这个量）。
 */
export function putInBed(sql: SqlStorage, input: PutInBedInput): void {
  if (input.claiming) {
    // 一人一床靠唯一索引兜底：我名下若还留着别的床的行（归属已过期、那行还没被释放），必须先让开，
    // 否则这次认领会撞唯一索引。
    sql.exec(
      `UPDATE bed SET owner_user_id = NULL, owner_name = NULL, owner_appearance = NULL,
        claimed_at = NULL, sleep_started_at = NULL, state = 'empty', updated_at = ?
       WHERE owner_user_id = ? AND bed_no <> ?`,
      input.now,
      input.userId,
      input.bedNo,
    );
    sql.exec(
      `INSERT INTO bed (bed_no, state, owner_user_id, owner_name, owner_appearance,
        claimed_at, last_seen_at, sleep_started_at, updated_at)
       VALUES (?, 'lying', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bed_no) DO UPDATE SET
         state = 'lying', owner_user_id = excluded.owner_user_id, owner_name = excluded.owner_name,
         owner_appearance = excluded.owner_appearance, claimed_at = excluded.claimed_at,
         last_seen_at = excluded.last_seen_at, sleep_started_at = excluded.sleep_started_at,
         updated_at = excluded.updated_at`,
      input.bedNo,
      input.userId,
      input.name,
      input.appearance,
      input.now,
      input.now,
      input.now,
      input.now,
    );
    return;
  }

  sql.exec(
    `UPDATE bed SET owner_name = ?, owner_appearance = ?, last_seen_at = ?,
      state = 'lying', sleep_started_at = ?, updated_at = ?
     WHERE bed_no = ?`,
    input.name,
    input.appearance,
    input.now,
    input.now,
    input.now,
    input.bedNo,
  );
}

/** 占用状态变化：清醒度（`lying` ↔ `asleep`）或转睡痕（`trace`）。 */
export function setBedOccupancy(sql: SqlStorage, bedNo: number, state: 'lying' | 'asleep' | 'trace', at: number): void {
  sql.exec('UPDATE bed SET state = ?, updated_at = ? WHERE bed_no = ?', state, at, bedNo);
}

export interface RestoreBedInput {
  bedNo: number;
  name: string;
  appearance: Appearance;
  now: number;
}

/**
 * 从睡痕恢复：**睡着的还原**（`state = 'asleep'`）。归属不动，只刷新名字快照（见 `docs/db/schema.md` §7「宽限已过后重连」）。
 *
 * `sleep_started_at` **重新从这一刻起算**：不清的话，`wake.dwellMs` 会把「人不在线的那段」也算进去，
 * 手机后台被杀的常态会话会变成几小时的假样本、隔几天回来一次就是几万小时（`100-log.md` §3）。
 */
export function restoreBedOccupancy(sql: SqlStorage, input: RestoreBedInput): void {
  sql.exec(
    `UPDATE bed SET state = 'asleep', owner_name = ?, owner_appearance = ?, last_seen_at = ?, updated_at = ?,
      sleep_started_at = ?
     WHERE bed_no = ?`,
    input.name,
    input.appearance,
    input.now,
    input.now,
    input.now,
    input.bedNo,
  );
}

/**
 * 起身：床变空，**归属保留**（`sleep_started_at` 清空），并返回清空前的 `sleep_started_at`
 * （这次在床上睡了多久由它算，见 `wake{dwellMs}`）。
 *
 * shortcut: 多一次行读, `UPDATE … RETURNING` 给的是**更新后**的行（`sleep_started_at` 那时已经是 NULL）,
 * 旧值只能先单独读一下；这一次行读已经在 `docs/design/100-log.md` §7 的额度里（起身几百/天）。
 */
export function clearBed(sql: SqlStorage, bedNo: number, now: number): number | undefined {
  const startedAt = sql
    .exec<{ sleep_started_at: number | null }>('SELECT sleep_started_at FROM bed WHERE bed_no = ?', bedNo)
    .toArray()[0]?.sleep_started_at;
  sql.exec("UPDATE bed SET state = 'empty', sleep_started_at = NULL, updated_at = ? WHERE bed_no = ?", now, bedNo);
  return startedAt ?? undefined;
}

/**
 * **已用床数**（有行且 `bedBusy`：有主或有占用）：升级/降级判据的输入（`10-hall-runtime.md` §8）。
 * 与 `smallestClaimableBed` 同一次全表读的形状——“有没有可认领的床”就是「已用床数 < 本档容量」。
 */
export function usedBedCount(sql: SqlStorage, now: number): number {
  let used = 0;
  for (const row of sql.exec<RawBedRow>(`SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed`).toArray()) {
    if (bedBusy(row, now)) used += 1;
  }
  return used;
}

/**
 * 编号最小的**可认领床**（出生点用，见 `10-hall-runtime.md` §9）：无行 = 无主空床，过期归属也算无主。
 * 一次读取全部床位行（几百行量级）后线性找空缺——比逐床号查一次库便宜得多。
 */
export function smallestClaimableBed(sql: SqlStorage, bedCount: number, now: number): number | undefined {
  const taken = new Set<number>();
  for (const row of sql.exec<RawBedRow>(`SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed`).toArray()) {
    if (bedBusy(row, now)) taken.add(row.bed_no);
  }
  for (let bedNo = 0; bedNo < bedCount; bedNo += 1) {
    if (!taken.has(bedNo)) return bedNo;
  }
  return undefined;
}

/**
 * 降级判据：`[from, bedCount)` 这一圈床**全部无主且无占用**（睡痕也算占用）→ 可以缩到上一档。
 * 没有行 = 空床，所以只看有没有行是「忙」的。
 */
export function outerRingBusy(sql: SqlStorage, from: number, bedCount: number, now: number): boolean {
  for (const row of sql
    .exec<RawBedRow>(
      `SELECT bed_no, state, owner_user_id, owner_name, owner_appearance, last_seen_at, updated_at FROM bed
        WHERE bed_no >= ? AND bed_no < ?`,
      from,
      bedCount,
    )
    .toArray()) {
    if (bedBusy(row, now)) return true;
  }
  return false;
}