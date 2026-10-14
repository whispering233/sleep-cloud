/**
 * 床位表 DDL（唯一权威，见 `docs/db/schema.md` §2）。
 * 行数恒定等于厅容量：初始化后不再增删行，只改字段。
 *
 * 词表提醒：本表的 `state` 是**一张床**的占用（`empty` / `lying` / `asleep` / `trace`），
 * 没有 `roaming`——人不在床上时那张床就是 `empty`。
 */
export const BED_TABLE_SQL = `CREATE TABLE IF NOT EXISTS bed (
  bed_no INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  owner_user_id TEXT,
  owner_name TEXT,
  owner_appearance TEXT,
  owner_tz TEXT,
  claimed_at INTEGER,
  last_seen_at INTEGER,
  sleep_started_at INTEGER,
  updated_at INTEGER NOT NULL
)`;

/** 索引：唯一索引保证「一个用户只能认领一张床」；`last_seen_at` 服务于 30 天释放；`state` 服务于睡痕查询。 */
export const BED_INDEX_SQL: readonly string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS bed_owner_user_id ON bed (owner_user_id)',
  'CREATE INDEX IF NOT EXISTS bed_last_seen_at ON bed (last_seen_at)',
  'CREATE INDEX IF NOT EXISTS bed_state ON bed (state)',
];

/**
 * 补足床位行（0 ~ capacity-1）。`OR IGNORE` + 主键让重复执行幂等：
 * 首次冷启动写一次 256 行，之后每次启动都只是空转（没有行写入）。
 */
export const BED_SEED_SQL = `WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
INSERT OR IGNORE INTO bed (bed_no, state, updated_at) SELECT n, 'empty', ? FROM seq`;
