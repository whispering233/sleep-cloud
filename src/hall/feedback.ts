/**
 * 反馈与建议（见 `docs/db/schema.md` §4.5、`docs/api/20-api-ws.md` §4.10）：
 * 一条反馈 = 一行（身份 + 正文 + 时刻）。**不收集联系方式、不支持回复**——开了回复就得存会话，
 * 那是另一件事；现在只有运维在后台看得到。
 *
 * 正文**不过内容过滤**：它不是广播内容，打码只会把要说的事毁掉。
 */

import { FEEDBACK_DAILY_MAX, FEEDBACK_TTL_MS } from '../shared/constants';

/** 滚动窗口：同一条记录在 24 小时内计入每日上限。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 该身份滚动 24 小时内已提交的反馈条数（配额判定用；`created_at` 上的索引）。 */
export function countRecentFeedback(sql: SqlStorage, userId: string, now: number): number {
  return sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at >= ?', userId, now - DAY_MS)
    .one().n;
}

/**
 * 落一条反馈：超每日上限不写行，返回 `'quota'`；否则写一行，返回 `'created'`。
 * 配额在**写入前**判：并发两条可能都看到 4 条，服务端单线程执行，这里不会交错。
 */
export function recordFeedback(sql: SqlStorage, userId: string, text: string, now: number): 'created' | 'quota' {
  if (countRecentFeedback(sql, userId, now) >= FEEDBACK_DAILY_MAX) return 'quota';
  sql.exec('INSERT INTO feedback (user_id, text, created_at) VALUES (?, ?, ?)', userId, text, now);
  return 'created';
}

/** 过期反馈整行删除（含正文），并入每日唤醒同批清理。 */
export function purgeExpiredFeedback(sql: SqlStorage, now: number): void {
  sql.exec('DELETE FROM feedback WHERE created_at < ?', now - FEEDBACK_TTL_MS);
}

/** 后台列表的一行：正文原样返回（换行由界面用 `white-space: pre-wrap` 保留）；昵称读时补。 */
export interface FeedbackRow {
  id: number;
  userId: string;
  nickname: string | null;
  text: string;
  createdAt: number;
}

/**
 * 倒序一页（`docs/api/30-api-admin.md` §5.8）：按 `id` 游标，`limit + 1` 用来判断还有没有下一页。
 * 昵称走身份表的联接；台账行被留存清理之后昵称就是 `null`，正文仍在（两张表分别到期）。
 */
export function listFeedback(sql: SqlStorage, limit: number, before?: number): FeedbackRow[] {
  const rows = sql
    .exec<{ id: number; user_id: string; nickname: string | null; text: string; created_at: number }>(
      `SELECT f.id, f.user_id, i.nickname, f.text, f.created_at
         FROM feedback f LEFT JOIN identity i ON i.user_id = f.user_id
        WHERE ? IS NULL OR f.id < ?
        ORDER BY f.id DESC
        LIMIT ?`,
      before ?? null,
      before ?? null,
      limit,
    )
    .toArray();
  return rows.map((row) => ({ id: row.id, userId: row.user_id, nickname: row.nickname, text: row.text, createdAt: row.created_at }));
}
