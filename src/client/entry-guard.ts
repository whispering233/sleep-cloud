import type { ApiResponse, SessionView } from '../shared/http-api';

/** 入场前的三种拦截：厅满只剩最小档也满了；封禁带 `untilAt`（`null` = 永久）；会话没留住 = cookie 没落地。 */
export type EntryBlock =
  | { code: '2002' }
  | { code: '5002'; untilAt: number | null }
  | { code: 'no-session' };

/**
 * 进厅前那次复核（`GET /api/me`）的结论：拦下（`block`）或放行（带要用的会话）。
 *
 * 为什么不直接用 `/api/ws` 的失败来拦：浏览器的 WebSocket API **读不到升级失败的响应体**，
 * `1001` / `1003` 与断网长得一样，前端只会按退避无限重连。所以身份有没有留住要在建连前问清楚
 * （`docs/api/10-api-http.md` §2.1 第 6 步）。
 */
export function entryVerdictOf(
  previous: SessionView,
  /** `undefined` = 复核那次请求本身失败（断网）：与 `9001` 同等对待 */
  check: ApiResponse<SessionView> | undefined,
): { block?: EntryBlock; session: SessionView } {
  const data = check?.data;
  // 复核本身失败（网络 / `9001`）是抖动，不是身份问题：沿用上一次的会话，照旧进厅
  if (data === undefined) return { session: previous };
  if (check?.code === '5002') return { block: { code: '5002', untilAt: data.untilAt ?? null }, session: data };
  if (check?.code === '2002') return { block: { code: '2002' }, session: data };
  // 能走到这里说明昵称刚写成功过（写失败会在入场层当场抛错），所以它为真 = 浏览器没把会话留住：
  // cookie 不落地时 `/api/ws` 只会给 `error` + `close(1006)`，这一支是唯一能说清楚原因的时机
  if (data.needsNickname) return { block: { code: 'no-session' }, session: data };
  return { session: data };
}
