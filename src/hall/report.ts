/**
 * 举报（见 `docs/db/schema.md` §4.4、`docs/api/20-api-ws.md` §4.9）：一条举报 = 一行，
 * 同一对 `(举报人, 被举报人)` 在 24 小时内只占一行——否则一次连点就能把后台刷满。
 *
 * **证据只覆盖那一刻的 ≤10 条**：全量聊天日志不存（见 `docs/design/70-privacy-risk.md` §3.2），
 * 发言缓冲只在厅实例的内存里，驱逐即丢。
 */

import { REPORT_DEDUP_MS, REPORT_TTL_MS } from '../shared/constants';

/** 一条证据：被举报人自己发出的某句话（`text` 是**已打码的那一份**）。 */
export interface ReportEvidence {
  text: string;
  at: number;
}

export interface ReportInput {
  reporterUserId: string;
  targetUserId: string;
  /** 举报人写的事由，**不过内容过滤**（不是广播内容，只有运维看得到）。 */
  reason: string;
  evidence: ReportEvidence[];
}

export interface ReportRecord {
  id: number;
  createdAt: number;
  lastAt: number;
  reporterUserId: string;
  targetUserId: string;
  reason: string;
  evidence: ReportEvidence[];
  count: number;
}

interface RawReportRow {
  [key: string]: string | number | null;
  id: number;
  created_at: number;
  last_at: number;
  reporter_user_id: string;
  target_user_id: string;
  reason: string;
  evidence: string;
  count: number;
}

function toReport(row: RawReportRow): ReportRecord {
  let evidence: ReportEvidence[] = [];
  try {
    // 解析成功也可能是 `null` / `{}` —— 非数组照样当没有，后台直接 `.map` 它
    const parsed: unknown = JSON.parse(row.evidence);
    evidence = Array.isArray(parsed) ? (parsed as ReportEvidence[]) : [];
  } catch {
    // 脏行宁可丢掉证据，也不要让整个后台请求 500（那会把所有举报一起藏起来）
    evidence = [];
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    lastAt: row.last_at,
    reporterUserId: row.reporter_user_id,
    targetUserId: row.target_user_id,
    reason: row.reason,
    evidence,
    count: row.count,
  };
}

/**
 * 落一条举报：24 小时内同一对已经有一行 → 只 `count + 1` 并刷新 `last_at`，
 * **事由与证据保持第一次的那份**（它们是「当时他这么说了」的证据，后来的重复举报改不动它）。
 */
export function recordReport(sql: SqlStorage, input: ReportInput, now: number): 'merged' | 'created' {
  const merged = sql
    .exec<{ id: number }>(
      `SELECT id FROM report
        WHERE reporter_user_id = ? AND target_user_id = ? AND last_at > ?
        ORDER BY last_at DESC LIMIT 1`,
      input.reporterUserId,
      input.targetUserId,
      now - REPORT_DEDUP_MS,
    )
    .toArray()[0];
  if (merged) {
    sql.exec('UPDATE report SET count = count + 1, last_at = ? WHERE id = ?', now, merged.id);
    return 'merged';
  }
  sql.exec(
    `INSERT INTO report (created_at, last_at, reporter_user_id, target_user_id, reason, evidence, count)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    now,
    now,
    input.reporterUserId,
    input.targetUserId,
    input.reason,
    JSON.stringify(input.evidence),
  );
  return 'created';
}

/** 一页举报：`id DESC`（自增主键就是游标，翻页只看 `before`）。行数由举报次数决定。 */
export function listReports(sql: SqlStorage, query: { limit: number; before?: number }): ReportRecord[] {
  return sql
    .exec<RawReportRow>(
      `SELECT id, created_at, last_at, reporter_user_id, target_user_id, reason, evidence, count FROM report
        WHERE (? IS NULL OR id < ?)
        ORDER BY id DESC LIMIT ?`,
      query.before ?? null,
      query.before ?? null,
      query.limit,
    )
    .toArray()
    .map(toReport);
}

/** 90 天清理（并入每日唤醒，不新开唤醒）：只删过期行，没被举报过的文本从来就不在库里。 */
export function purgeExpiredReports(sql: SqlStorage, now: number): void {
  sql.exec('DELETE FROM report WHERE last_at < ?', now - REPORT_TTL_MS);
}
