import { displayBedNoOf } from '../shared/layout';
import * as log from '../shared/log';
import { findOwnedBed, countOwnedBeds } from './bed-store';
import { listFeedback } from './feedback';
import { countRecentReportTargets, listReports, listReportTargets } from './report';
import type { ReportRecord } from './report';
import {
  blockDetailOf,
  countActiveBlocks,
  countIdentitiesFor,
  findIdentity,
  hasBlock,
  listAudit,
  listAuditFor,
  listBlocks,
  listIdentities,
  listIpPeers,
  removeBlock,
  upsertBlock,
  writeAudit,
} from './risk';
import type { AuditRecord, BlockDetail, BlockKind, IdentityRecord } from './risk';

/**
 * 后台数据接口（见 `docs/api/30-api-admin.md` §5）：**只由 Worker 转发进来**。
 * 连接集合与唯一权威库都在厅对象里，所以路由、校验与踢连接都落在这一层；
 * SQL 一律写在 `risk.ts`（这里不另写一份）。
 *
 * 没有内部头的 `/admin/*` 由 `Hall.fetch` 显式回 404：客户端本来就到不了厅对象，那是第二道。
 */
export const ADMIN_HEADER = 'x-sleep-admin';

/** 分页上限（§4）：默认 50、上限 100。行数由历史身份数与运维动作决定。 */
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;

/** 详情页的「最多 20 条」（§5.2）：同网络的其他身份、该身份的审计。 */
const DETAIL_LIMIT = 20;

/** 一条已握手的连接：踢连接要在写库之后做，`close` 由厅注入（`close(1008, 'blocked')`）。 */
export interface LiveConnection {
  userId: string;
  ip: string | null;
  /** 关掉这条连接，**并把封禁到期时刻先发给它**（客户端靠它显示倒计时，见 §5.4）。 */
  close: (untilAt: number | null) => void;
}

export interface AdminContext {
  sql: SqlStorage;
  /** 已握手的连接（「在线」口径与 `onlineCount` 一致：只算握过手的） */
  live: LiveConnection[];
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function badRequest(): Response {
  return new Response(null, { status: 400 });
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

/** `limit` 默认 50、上限 100；非数字按默认（翻页参数由后台页面自己拼，不值得为它加错误码）。 */
function limitOf(url: URL): number {
  const parsed = Number(url.searchParams.get('limit') ?? '');
  if (!Number.isFinite(parsed) || parsed < 1) return PAGE_DEFAULT;
  return Math.min(Math.floor(parsed), PAGE_MAX);
}

/** 数字游标（`before` 是时刻或自增 id）：非数字视为没给。 */
function cursorOf(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

interface BlockView {
  kind: BlockKind;
  untilAt: number | null;
  reason: string;
}

function blockViewOf(hit: BlockDetail | null): BlockView | null {
  return hit && { kind: hit.kind, untilAt: hit.untilAt, reason: hit.reason };
}

/**
 * 台账一行（§5.1）：`bedNo` 是**显示床号**（内部值 +1），`block` 两维任一命中取更严的那条。
 * 床走 `owner_user_id` 唯一索引的单行读；「在线」只看已握手的连接。
 */
function identityView(row: IdentityRecord, ctx: AdminContext, now: number): Record<string, unknown> {
  const bedNo = findOwnedBed(ctx.sql, row.userId, now)?.bedNo;
  return {
    userId: row.userId,
    nickname: row.nickname,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    lastIp: row.lastIp,
    lastCountry: row.lastCountry,
    uaHash: row.uaHash,
    bedNo: bedNo === undefined ? null : displayBedNoOf(bedNo),
    online: ctx.live.some((live) => live.userId === row.userId),
    block: blockViewOf(blockDetailOf(ctx.sql, { userId: row.userId, ip: row.lastIp }, now)),
  };
}

function identitiesPage(url: URL, ctx: AdminContext): Response {
  const limit = limitOf(url);
  const before = cursorOf(url, 'before');
  const beforeId = url.searchParams.get('beforeId') ?? undefined;
  // 复合游标必须成对给：只给一半就分不清「没有下一页」还是「前端拼错了」，
  // 而静默当成第一页会让「下一页」原地打转（见 `docs/api/30-api-admin.md` §4）。
  if (before !== undefined && beforeId === undefined) return badRequest();
  const userId = url.searchParams.get('userId') || undefined;
  const ip = url.searchParams.get('ip') ?? undefined;
  const name = url.searchParams.get('name') ?? undefined;
  // 多取一行只用来判断「还有没有下一页」
  const rows = listIdentities(ctx.sql, {
    limit: limit + 1,
    ...(userId === undefined ? {} : { userId }),
    ...(ip === undefined ? {} : { ip }),
    ...(name === undefined ? {} : { name }),
    ...(before === undefined || beforeId === undefined ? {} : { before, beforeId }),
  });
  const now = Date.now();
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return json({
    items: items.map((row) => identityView(row, ctx, now)),
    next: rows.length > limit && last ? { before: last.lastSeenAt, beforeId: last.userId } : null,
  });
}

function identityDetail(rawUserId: string, ctx: AdminContext): Response {
  const userId = decodeURIComponent(rawUserId);
  const row = findIdentity(ctx.sql, userId);
  if (!row) return notFound();

  const now = Date.now();
  const peers = row.lastIp === null ? [] : listIpPeers(ctx.sql, row.lastIp, userId, DETAIL_LIMIT);
  return json({
    ...identityView(row, ctx, now),
    ipHistory: peers.map((peer) => ({
      userId: peer.userId,
      lastSeenAt: peer.lastSeenAt,
      block: blockViewOf(blockDetailOf(ctx.sql, { userId: peer.userId, ip: peer.lastIp }, now)),
    })),
    audit: listAuditFor(ctx.sql, 'user', userId, DETAIL_LIMIT),
  });
}

function blockMatches(live: LiveConnection, kind: BlockKind, value: string): boolean {
  return kind === 'user' ? live.userId === value : live.ip === value;
}

/** 写库 + 审计 → 踢掉命中的在线连接 → 回 `affected`（顺序见 `docs/design/70-privacy-risk.md` §5.3）。 */
async function createBlock(request: Request, ctx: AdminContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest();

  const kind = body.kind;
  if (kind !== 'user' && kind !== 'ip') return badRequest();
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  if ([...value].length < 1 || [...value].length > 255) return badRequest();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if ([...reason].length < 1 || [...reason].length > 64) return badRequest();

  const now = Date.now();
  let untilAt: number | null = null;
  if (body.untilAt !== undefined && body.untilAt !== null) {
    // 填成过去时间等于「点了封禁但没封上」→ 直接 400
    if (typeof body.untilAt !== 'number' || !Number.isFinite(body.untilAt) || body.untilAt <= now) {
      return badRequest();
    }
    untilAt = body.untilAt;
  }

  const created = !hasBlock(ctx.sql, kind, value);
  const identities = countIdentitiesFor(ctx.sql, kind, value);
  const matched = ctx.live.filter((live) => blockMatches(live, kind, value));

  // **先写库再踢**：踢成功但没落库 = 一次重连就回来
  upsertBlock(ctx.sql, { kind, value, untilAt, reason }, now);
  writeAudit(ctx.sql, { action: 'block', kind, value, untilAt, reason }, now);
  // 后台动作也留一条（`100-log.md` §3：`by='admin'`，永久写 0）。**不挂任何身份字段**：
  // 这里的主语是一个值（`value` 可能是 IP，L3 永不下发 / 不进日志），不是某个人。
  log.ev('block', { until: untilAt ?? 0, by: 'admin' });
  for (const live of matched) {
    // 一条死连接抛一次就会打断后面所有人（`AGENTS.md` 硬纪律 15）
    try {
      live.close(untilAt);
    } catch (error) {
      console.error('关闭被封连接失败：', error);
      log.err({ where: 'admin-close', code: '9001' });
    }
  }

  return json({
    block: { kind, value, untilAt, reason, createdAt: now },
    created,
    affected: { identities, online: matched.length },
  });
}

function deleteBlock(rawKind: string, rawValue: string, ctx: AdminContext): Response {
  const kind = decodeURIComponent(rawKind);
  if (kind !== 'user' && kind !== 'ip') return badRequest();
  const value = decodeURIComponent(rawValue);
  const removed = removeBlock(ctx.sql, kind, value);
  // 解封是幂等动作、没有 404。**没删到也记一条**：审计是「谁在什么时候点了什么」的流水，
  // 「解封一个本来不存在的值」正是要留痕的那类操作（重复点、看错、值已被改判）。
  writeAudit(ctx.sql, { action: 'unblock', kind, value, untilAt: null, reason: null }, Date.now());
  return json({ removed });
}

/** 举报里的一方（§5.6）：昵称**读时现补**——表里不存快照，过了留存期就是 `null`。 */
function partyOf(sql: SqlStorage, userId: string): { userId: string; nickname: string | null } {
  return { userId, nickname: findIdentity(sql, userId)?.nickname ?? null };
}

/** 反馈列表（§5.8）：只读、按 `id` 倒序；正文不渲染 `userId`（界面用昵称，删了身份就显示「未知」）。 */
function feedbackPage(url: URL, ctx: AdminContext): Response {
  const limit = limitOf(url);
  const before = cursorOf(url, 'before');
  const rows = listFeedback(ctx.sql, limit + 1, before);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return json({
    items: items.map((row) => ({ id: row.id, createdAt: row.createdAt, userId: row.userId, nickname: row.nickname, text: row.text })),
    next: rows.length > limit && last ? { before: last.id } : null,
  });
}

function reportsPage(url: URL, ctx: AdminContext): Response {
  const limit = limitOf(url);
  const before = cursorOf(url, 'before');
  const rows = listReports(ctx.sql, { limit: limit + 1, ...(before === undefined ? {} : { before }) });
  const items = rows.slice(0, limit);
  const last: ReportRecord | undefined = items.at(-1);
  return json({
    items: items.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastAt: row.lastAt,
      count: row.count,
      reporter: partyOf(ctx.sql, row.reporterUserId),
      target: partyOf(ctx.sql, row.targetUserId),
      reason: row.reason,
      evidence: row.evidence,
    })),
    next: rows.length > limit && last ? { before: last.id } : null,
  });
}

/** 被举报人折叠（§5.7）：无 `next`——排序键不是主键，游标翻页在这里会漏行。 */
function reportTargetsPage(url: URL, ctx: AdminContext): Response {
  return json({
    items: listReportTargets(ctx.sql, limitOf(url)).map((row) => ({
      target: partyOf(ctx.sql, row.targetUserId),
      count: row.count,
      reporters: row.reporters,
      lastAt: row.lastAt,
      reason: row.reason,
    })),
  });
}

function auditPage(url: URL, ctx: AdminContext): Response {
  const limit = limitOf(url);
  const rows = listAudit(ctx.sql, limit + 1, cursorOf(url, 'before'));
  const items = rows.slice(0, limit);
  const last: AuditRecord | undefined = items.at(-1);
  return json({ items, next: rows.length > limit && last ? { before: last.id } : null });
}

/** 数据接口的入口（`/admin/...`，由 `Hall.fetch` 在校验内部头之后调用）。 */
export async function handleAdminRequest(
  request: Request,
  url: URL,
  ctx: AdminContext,
): Promise<Response> {
  // 路径段是百分号编码的（路由是手写的 `split('/')`），畸形的 `%zz` 会让 `decodeURIComponent` 抛错。
  // 兜在这里而不是让它冒到 Worker：否则父应用会把它当成用户面错误回 `200 + {code:'9001'}`，
  // 违背后台面「用 HTTP 状态码」的契约（见 `docs/api/30-api-admin.md` §1、§6）。
  try {
    return routeAdminRequest(request, url, ctx);
  } catch (error) {
    console.error('后台接口处理失败：', error);
    log.err({ where: 'admin-request', code: '9001' });
    return new Response(null, { status: 500 });
  }
}

function routeAdminRequest(request: Request, url: URL, ctx: AdminContext): Response | Promise<Response> {
  const [resource, second, third] = url.pathname.split('/').slice(2);

  if (resource === 'identities' && request.method === 'GET') {
    return second === undefined ? identitiesPage(url, ctx) : identityDetail(second, ctx);
  }
  if (resource === 'blocks') {
    if (second === undefined && request.method === 'GET') return json({ items: listBlocks(ctx.sql) });
    if (second === undefined && request.method === 'POST') return createBlock(request, ctx);
    if (second !== undefined && third !== undefined && request.method === 'DELETE') {
      return deleteBlock(second, third, ctx);
    }
  }
  if (resource === 'audit' && second === undefined && request.method === 'GET') {
    return auditPage(url, ctx);
  }
  if (resource === 'stats' && second === undefined && request.method === 'GET') {
    return json(statsView(ctx));
  }
  if (resource === 'reports' && second === 'targets' && request.method === 'GET') {
    return reportTargetsPage(url, ctx);
  }
  if (resource === 'reports' && second === undefined && request.method === 'GET') {
    return reportsPage(url, ctx);
  }
  if (resource === 'feedback' && second === undefined && request.method === 'GET') {
    return feedbackPage(url, ctx);
  }
  return notFound();
}

/** 概览四条口径（`docs/design/120-admin-console.md` §2）：`online` 直接读内存连接集合，其余各一条聚合。 */
function statsView(ctx: AdminContext): Record<string, number> {
  const now = Date.now();
  return {
    online: ctx.live.length,
    ownedBeds: countOwnedBeds(ctx.sql, now),
    blocks: countActiveBlocks(ctx.sql, now),
    reports24h: countRecentReportTargets(ctx.sql, now),
  };
}
