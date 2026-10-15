/**
 * 床位表 DDL（唯一权威，见 `docs/db/schema.md` §2）。
 *
 * **惰性行**：只有「有主或有占用」的床才有一行，没有行 = 无主空床。行数 ≈ 有主床数（几百），
 * 远小于级容量（114 ~ 9790）——一次性预建 9790 行会吃掉每日行写额度的一成。
 *
 * 词表提醒：本表的 `state` 是**一张床**的占用（`empty` / `lying` / `asleep` / `trace`），
 * 没有 `roaming`——人不在床上时那张床就是 `empty`。**已删 `owner_tz`**（时区概念整体删除）。
 */
export const BED_TABLE_SQL = `CREATE TABLE IF NOT EXISTS bed (
  bed_no INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  owner_user_id TEXT,
  owner_name TEXT,
  owner_appearance TEXT,
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
 * 厅级元信息（见 `docs/db/schema.md` §3）：键值表，每个 key 一行。
 * `bed_count` = 当前级容量；`daily_wake_at` = 已结算过的那个 UTC 20:00 边界。只在升级 / 降级 / 每日唤醒后写。
 */
export const META_TABLE_SQL = `CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
)`;

/** 键名（DDL 与读写共用同一份拼写）。**没有「有主床数」**：判据是与出生点同一个「有没有可认领的床」查询。 */
export const META_KEYS = { bedCount: 'bed_count', dailyWakeAt: 'daily_wake_at' } as const;