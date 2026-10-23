import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `entry.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { BED_OWNERSHIP_TTL_MS, HALL_ID, IDENTITY_FORGET_MS, REPORT_DEDUP_MS } from '../../shared/constants';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { recordFeedback } from '../feedback';
import { recordReport } from '../report';
import { forgetStaleSources, listBlocks, recordIdentity, upsertBlock, writeAudit } from '../risk';
import { freshSql, insertBed } from './sqlite';

/** 假 socket：后台上只用到这里的三件事（附加数据、关闭、就绪态）。 */
class FakeSocket {
  closed: { code: number; reason: string } | null = null;
  /** 关之前发出去的那些报文（踢人时要先发 `5002`，客户端靠它拿倒计时）。 */
  readonly sent: string[] = [];
  readonly readyState = 1;
  private attachment: unknown;
  /** `close` 被调用**那一刻**的外部状态（用来钉住「先写库再踢」的顺序）。 */
  private readonly onClose: (() => void) | undefined;

  constructor(attachment: unknown, onClose?: () => void) {
    this.attachment = attachment;
    this.onClose = onClose;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
    this.onClose?.();
  }
}

/** 一关就抛的 socket：一条死连接抛一次不许打断后面所有人（`AGENTS.md` 硬纪律 15）。 */
class ThrowingSocket extends FakeSocket {
  override close(): void {
    throw new Error('这条连接已经死了');
  }
}

function newHall(sockets: FakeSocket[] = [], shared?: SqlStorage): { hall: Hall; sql: SqlStorage } {
  const sql = shared ?? freshSql();
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql, getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined },
    getWebSockets: () => sockets,
  };
  return { hall: new Hall(ctx as never, {} as never), sql };
}

/** 已握手的连接（后台的「在线」只看这一种）。 */
function liveConnection(userId: string, ip?: string): ConnectionState {
  return {
    userId,
    name: '夜猫',
    appearance: 'boy',
    ip,
    x: 0,
    y: 0,
    state: 'roaming',
    lastInputAt: 0,
    ready: true,
  };
}

const NOW = Date.now();

interface IdentityItem {
  userId: string;
  nickname: string | null;
  lastSeenAt: number;
  lastIp: string | null;
  bedNo: number | null;
  online: boolean;
  block: { kind: string; untilAt: number | null; reason: string } | null;
}

interface Page {
  items: IdentityItem[];
  next: { before: number; beforeId: string } | null;
}

interface AuditItem {
  id: number;
  action: string;
  kind: string;
  value: string;
  untilAt: number | null;
  reason: string | null;
  nickname: string | null;
  actor: string;
}

interface BlockItem {
  kind: string;
  value: string;
  untilAt: number | null;
  reason: string;
  createdAt: number;
  nickname: string | null;
}

interface ReportItem {
  id: number;
  createdAt: number;
  lastAt: number;
  count: number;
  reporter: { userId: string; nickname: string | null };
  target: { userId: string; nickname: string | null };
  reason: string;
  evidence: { text: string; at: number }[];
}

interface ReportPage {
  items: ReportItem[];
  next: { before: number } | null;
}

interface ReportTargetItem {
  target: { userId: string; nickname: string | null };
  count: number;
  reporters: number;
  lastAt: number;
  reason: string;
}

const adminGet = (hall: Hall, path: string): Promise<Response> =>
  hall.fetch(new Request(`https://hall.test${path}`, { headers: { 'x-sleep-admin': '1' } }));

function adminSend(hall: Hall, path: string, method: string, body?: unknown): Promise<Response> {
  return hall.fetch(
    new Request(`https://hall.test${path}`, {
      method,
      headers: { 'x-sleep-admin': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const pageOf = async (res: Response): Promise<Page> => (await res.json()) as Page;
const auditsOf = async (hall: Hall): Promise<AuditItem[]> =>
  ((await (await adminGet(hall, '/admin/audit')).json()) as { items: AuditItem[] }).items;
const blocksOf = async (hall: Hall): Promise<BlockItem[]> =>
  ((await (await adminGet(hall, '/admin/blocks')).json()) as { items: BlockItem[] }).items;

test('没有内部头的 `/admin/*` 一律 404（客户端到不了厅对象，这里是显式拒绝）', async () => {
  const { hall } = newHall();

  expect((await hall.fetch(new Request('https://hall.test/admin/identities'))).status).toBe(404);
  expect(
    (await hall.fetch(new Request('https://hall.test/admin/blocks', { headers: { 'x-sleep-admin': '0' } }))).status,
  ).toBe(404);
  // 对照组：带上头就能进——否则上面的断言恒真
  expect((await adminGet(hall, '/admin/blocks')).status).toBe(200);
});

test('台账两页：复合游标记住同一毫秒的那两条，不重不漏', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_c', ip: '1.1.1.1' }, NOW - 1_000);

  const first = await pageOf(await adminGet(hall, '/admin/identities?limit=2'));
  expect(first.items.map((item) => item.userId)).toEqual(['u_b', 'u_a']);
  expect(first.next).toEqual({ before: NOW, beforeId: 'u_a' });

  const second = await pageOf(
    await adminGet(hall, `/admin/identities?limit=2&before=${first.next?.before}&beforeId=${first.next?.beforeId}`),
  );
  expect(second.items.map((item) => item.userId)).toEqual(['u_c']);
  expect(second.next).toBeNull();
  // 合并两页：三条各一次（同一毫秒的那两条没有在翻页时被跳过）
  expect([...first.items, ...second.items].map((item) => item.userId).sort()).toEqual(['u_a', 'u_b', 'u_c']);
});

test('按 IP 反查只回该 IP 的行', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW + 1);
  recordIdentity(sql, { userId: 'u_c', ip: '2.2.2.2' }, NOW + 2);

  const page = await pageOf(await adminGet(hall, '/admin/identities?ip=1.1.1.1'));
  expect(page.items.map((item) => item.userId).sort()).toEqual(['u_a', 'u_b']);
  expect(page.items.every((item) => item.lastIp === '1.1.1.1')).toBe(true);
});

test('按昵称子串反查：命中 / 不命中，`%` 只是个百分号', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', nickname: '夜猫子' }, NOW + 3);
  recordIdentity(sql, { userId: 'u_b', nickname: '早睡' }, NOW + 2);
  recordIdentity(sql, { userId: 'u_c', nickname: '100%的人' }, NOW + 1);

  const hit = await pageOf(await adminGet(hall, `/admin/identities?name=${encodeURIComponent('夜猫')}`));
  expect(hit.items.map(({ userId, nickname }) => ({ userId, nickname }))).toEqual([
    { userId: 'u_a', nickname: '夜猫子' },
  ]);

  const miss = await pageOf(await adminGet(hall, `/admin/identities?name=${encodeURIComponent('猫夜')}`));
  expect(miss.items).toEqual([]);

  // 不转义的话 `%` 会当成通配符，把三条全返回
  const percent = await pageOf(await adminGet(hall, `/admin/identities?name=${encodeURIComponent('%')}`));
  expect(percent.items.map((item) => item.userId)).toEqual(['u_c']);
});

test('按 userId 精确查：只回那一行', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW + 1);

  const page = await pageOf(await adminGet(hall, '/admin/identities?userId=u_a'));
  expect(page.items.map((item) => item.userId)).toEqual(['u_a']);
  expect(page.next).toBeNull();
});

test('按 userId 精确查：不存在就回空页（不做前缀 / 子串匹配）', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_abc' }, NOW);

  expect((await pageOf(await adminGet(hall, '/admin/identities?userId=u_abcd'))).items).toEqual([]);
  expect((await pageOf(await adminGet(hall, '/admin/identities?userId=u_ab'))).items).toEqual([]);
});

test('userId 与 ip 同时给是 AND', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW + 1);

  const page = await pageOf(await adminGet(hall, '/admin/identities?ip=1.1.1.1&userId=u_a'));
  expect(page.items.map((item) => item.userId)).toEqual(['u_a']);
});

test('bedNo 是显示床号（内部 0 → 1），online 只对已握手的连接为真', async () => {
  const socket = new FakeSocket(liveConnection('u_a'));
  const { hall, sql } = newHall([socket]);
  recordIdentity(sql, { userId: 'u_a' }, NOW);
  recordIdentity(sql, { userId: 'u_b' }, NOW);
  insertBed(sql, 0, { state: 'empty', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });

  const page = await pageOf(await adminGet(hall, '/admin/identities'));
  const a = page.items.find((item) => item.userId === 'u_a');
  const b = page.items.find((item) => item.userId === 'u_b');
  expect(a).toMatchObject({ bedNo: 1, online: true });
  expect(b).toMatchObject({ bedNo: null, online: false });
});

test('封禁参数校验：kind 非法 / reason 空 / untilAt 在过去 → 400', async () => {
  const { hall } = newHall();

  const invalidKind = await adminSend(hall, '/admin/blocks', 'POST', { kind: 'hall', value: 'x', reason: '刷屏' });
  expect(invalidKind.status).toBe(400);

  const emptyReason = await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_a', reason: '  ' });
  expect(emptyReason.status).toBe(400);

  const past = await adminSend(hall, '/admin/blocks', 'POST', {
    kind: 'user',
    value: 'u_a',
    reason: '刷屏',
    untilAt: NOW - 1,
  });
  expect(past.status).toBe(400);
});

test('封禁命中在线连接：close(1008, blocked)，affected.online 计数正确', async () => {
  const hit = new FakeSocket(liveConnection('u_bad'));
  const other = new FakeSocket(liveConnection('u_ok'));
  const { hall, sql } = newHall([hit, other]);
  recordIdentity(sql, { userId: 'u_bad' }, NOW);

  const res = await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_bad', reason: '刷屏' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    block: { kind: string; value: string; untilAt: number | null; reason: string; createdAt: number };
    created: boolean;
    affected: { identities: number; online: number };
  };

  expect(body.block).toMatchObject({ kind: 'user', value: 'u_bad', untilAt: null, reason: '刷屏' });
  expect(body.created).toBe(true);
  expect(body.affected).toEqual({ identities: 1, online: 1 });
  // 关之前必须先告诉他什么时候到期，否则被踢的人拿不到倒计时（与刷新后被拦的文案不一致）
  expect(hit.sent.map((payload) => JSON.parse(payload))).toEqual([{ t: 'error', code: '5002', untilAt: null }]);
  expect(hit.closed).toEqual({ code: 1008, reason: 'blocked' });
  expect(other.closed).toBeNull();
  // 库里留下那一行（同时证明「先写库再踢」的顺序）
  expect(listBlocks(sql)).toEqual([expect.objectContaining({ kind: 'user', value: 'u_bad' })]);
});

test('封 IP 时 affected.identities = 该 IP 名下记录过的身份数', async () => {
  const socket = new FakeSocket(liveConnection('u_b', '1.1.1.1'));
  const { hall, sql } = newHall([socket]);
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_c', ip: '2.2.2.2' }, NOW);

  const res = await adminSend(hall, '/admin/blocks', 'POST', { kind: 'ip', value: '1.1.1.1', reason: '整段刷屏' });
  const body = (await res.json()) as { affected: { identities: number; online: number } };

  expect(body.affected).toEqual({ identities: 2, online: 1 });
  expect(socket.closed).toEqual({ code: 1008, reason: 'blocked' });
});

test('覆盖同一条封禁：created 为 false，仍只有一行', async () => {
  const { hall, sql } = newHall();

  await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_a', reason: '刷屏' });
  const again = await adminSend(hall, '/admin/blocks', 'POST', {
    kind: 'user',
    value: 'u_a',
    reason: '改判永久',
  });
  const body = (await again.json()) as { created: boolean; block: { reason: string } };

  expect(body.created).toBe(false);
  expect(body.block.reason).toBe('改判永久');
  expect(listBlocks(sql)).toHaveLength(1);
});

test('解封不存在的值：200 + removed:false，并且照样写一条审计', async () => {
  const { hall, sql } = newHall();

  const res = await adminSend(hall, '/admin/blocks/user/u_missing', 'DELETE');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ removed: false });
  // 审计是「谁在什么时候点了什么」的流水：没删到也是操作（重复点、看错、值已被改判），要留痕
  const rows = sql
    .exec<{ action: string; kind: string; value: string; actor: string }>(
      'SELECT action, kind, value, actor FROM admin_audit',
    )
    .toArray();
  expect(rows).toEqual([{ action: 'unblock', kind: 'user', value: 'u_missing', actor: 'admin' }]);
});

test('每个写操作都写一条审计：action / kind / value / actor=admin，倒序返回', async () => {
  const { hall } = newHall();

  await adminSend(hall, '/admin/blocks', 'POST', { kind: 'ip', value: '1.1.1.1', reason: '整段刷屏' });
  await adminSend(hall, '/admin/blocks/ip/1.1.1.1', 'DELETE');

  const items = await auditsOf(hall);
  expect(items.map((item) => item.action)).toEqual(['unblock', 'block']);
  expect(items[1]).toMatchObject({ kind: 'ip', value: '1.1.1.1', reason: '整段刷屏', actor: 'admin' });
  expect(items[0]).toMatchObject({ kind: 'ip', value: '1.1.1.1' });
});

test('黑名单列表：`user` 行的昵称读时现补，过了留存期与 `ip` 行都是 null', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_live', nickname: '夜猫子' }, NOW);
  recordIdentity(sql, { userId: 'u_gone', nickname: '早睡' }, NOW - IDENTITY_FORGET_MS - 1);
  forgetStaleSources(sql, NOW);
  upsertBlock(sql, { kind: 'user', value: 'u_live', untilAt: null, reason: '刷屏' }, NOW);
  upsertBlock(sql, { kind: 'user', value: 'u_gone', untilAt: null, reason: '刷屏' }, NOW + 1);
  upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '整段刷屏' }, NOW + 2);

  expect((await blocksOf(hall)).map(({ kind, value, nickname }) => ({ kind, value, nickname }))).toEqual([
    { kind: 'ip', value: '1.1.1.1', nickname: null },
    { kind: 'user', value: 'u_gone', nickname: null },
    { kind: 'user', value: 'u_live', nickname: '夜猫子' },
  ]);
});

test('身份详情：不存在 → 404；存在时给同网络的其他身份与该身份的审计', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
  recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW + 1);
  recordIdentity(sql, { userId: 'u_c', ip: '2.2.2.2' }, NOW + 2);
  upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: null, reason: '刷屏' }, NOW);
  writeAudit(sql, { action: 'block', kind: 'user', value: 'u_a', untilAt: null, reason: '刷屏' }, NOW);

  expect((await adminGet(hall, '/admin/identities/u_nobody')).status).toBe(404);

  const detail = (await (await adminGet(hall, '/admin/identities/u_a')).json()) as {
    userId: string;
    block: { reason: string } | null;
    ipHistory: { userId: string }[];
    audit: AuditItem[];
  };
  expect(detail.userId).toBe('u_a');
  expect(detail.block).toMatchObject({ reason: '刷屏' });
  expect(detail.ipHistory.map((peer) => peer.userId)).toEqual(['u_b']);
  expect(detail.audit.map((entry) => entry.action)).toEqual(['block']);
});

test('先写库再踢：close 被调用的那一刻，封禁行已经在库里', async () => {
  const sql = freshSql();
  let rowsWhenClosed = -1;
  const socket = new FakeSocket(liveConnection('u_bad'), () => {
    rowsWhenClosed = listBlocks(sql).length;
  });
  const { hall } = newHall([socket], sql);
  recordIdentity(sql, { userId: 'u_bad' }, NOW);

  await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_bad', reason: '刷屏' });

  // 把 close 挪到 upsertBlock 之前，这里就会读到 0
  expect(rowsWhenClosed).toBe(1);
});

test('限时封禁：踢之前发出去的 untilAt 就是这次写入的那一个', async () => {
  const socket = new FakeSocket(liveConnection('u_bad'));
  const { hall, sql } = newHall([socket]);
  recordIdentity(sql, { userId: 'u_bad' }, NOW);
  const untilAt = NOW + 8 * 60_000;

  await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_bad', reason: '刷屏', untilAt });

  expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([{ t: 'error', code: '5002', untilAt }]);
});

test('一条连接 close 抛异常，不影响后面的人被踢，接口仍回 200', async () => {
  const dead = new ThrowingSocket(liveConnection('u_bad'));
  const alive = new FakeSocket(liveConnection('u_bad'));
  const { hall, sql } = newHall([dead, alive]);
  recordIdentity(sql, { userId: 'u_bad' }, NOW);

  const res = await adminSend(hall, '/admin/blocks', 'POST', { kind: 'user', value: 'u_bad', reason: '刷屏' });

  expect(res.status).toBe(200);
  expect(alive.closed).toEqual({ code: 1008, reason: 'blocked' });
});

test('复合游标只给一半 → 400（静默当第一页会让「下一页」原地打转）', async () => {
  const { hall } = newHall();
  expect((await adminGet(hall, '/admin/identities?before=1')).status).toBe(400);
});

test('审计分页：next.before 是最后一条的 id，带 before 时只取更早的', async () => {
  const { hall, sql } = newHall();
  for (const index of [1, 2, 3]) {
    writeAudit(sql, { action: 'unblock', kind: 'user', value: `u_${index}`, untilAt: null }, NOW + index);
  }

  const first = (await (await adminGet(hall, '/admin/audit?limit=2')).json()) as {
    items: AuditItem[];
    next: { before: number } | null;
  };
  expect(first.items).toHaveLength(2);
  expect(first.next).toEqual({ before: first.items[1]?.id });

  const second = (await (
    await adminGet(hall, `/admin/audit?limit=2&before=${first.next?.before}`)
  ).json()) as { items: AuditItem[]; next: { before: number } | null };
  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
});

test('审计列表：`user` 行的昵称读时现补，过了留存期与 `ip` 行都是 null', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_live', nickname: '夜猫子' }, NOW);
  recordIdentity(sql, { userId: 'u_gone', nickname: '早睡' }, NOW - IDENTITY_FORGET_MS - 1);
  forgetStaleSources(sql, NOW);
  writeAudit(sql, { action: 'block', kind: 'user', value: 'u_live', untilAt: null, reason: '刷屏' }, NOW);
  writeAudit(sql, { action: 'block', kind: 'user', value: 'u_gone', untilAt: null, reason: '刷屏' }, NOW + 1);
  writeAudit(sql, { action: 'block', kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '整段刷屏' }, NOW + 2);

  expect((await auditsOf(hall)).map(({ kind, value, nickname }) => ({ kind, value, nickname }))).toEqual([
    { kind: 'ip', value: '1.1.1.1', nickname: null },
    { kind: 'user', value: 'u_gone', nickname: null },
    { kind: 'user', value: 'u_live', nickname: '夜猫子' },
  ]);
});

interface FeedbackItem {
  id: number;
  createdAt: number;
  userId: string;
  nickname: string | null;
  text: string;
}

const reportsOf = async (hall: Hall, query = ''): Promise<ReportPage> =>
  (await (await adminGet(hall, `/admin/reports${query}`)).json()) as ReportPage;

test('举报列表：字段齐全，昵称读时现补（写了查不到昵称的那一行 → null）', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_reporter' }, NOW);
  recordIdentity(sql, { userId: 'u_target', nickname: '夜猫子' }, NOW);
  recordReport(
    sql,
    { reporterUserId: 'u_reporter', targetUserId: 'u_target', reason: '刷屏', evidence: [{ text: '你*', at: NOW - 5 }] },
    NOW,
  );

  const page = await reportsOf(hall);
  expect(page.items).toEqual([
    {
      id: 1,
      createdAt: NOW,
      lastAt: NOW,
      count: 1,
      reporter: { userId: 'u_reporter', nickname: null },
      target: { userId: 'u_target', nickname: '夜猫子' },
      reason: '刷屏',
      evidence: [{ text: '你*', at: NOW - 5 }],
    },
  ]);
  expect(page.next).toBeNull();
});

test('举报证据：空数组原样透传，脏 JSON 降级为 []', async () => {
  const { hall, sql } = newHall();
  recordReport(sql, { reporterUserId: 'u_a', targetUserId: 'u_b', reason: '没人说话', evidence: [] }, NOW);
  recordReport(sql, { reporterUserId: 'u_a', targetUserId: 'u_c', reason: '脏行', evidence: [] }, NOW);
  recordReport(sql, { reporterUserId: 'u_a', targetUserId: 'u_d', reason: '不是数组', evidence: [] }, NOW);
  sql.exec("UPDATE report SET evidence = 'not json' WHERE target_user_id = 'u_c'");
  sql.exec("UPDATE report SET evidence = 'null' WHERE target_user_id = 'u_d'");

  const page = await reportsOf(hall);
  expect(page.items.map((item) => item.evidence)).toEqual([[], [], []]);
});

test('举报分页：id 倒序，before 排他，两页合起来不重不漏', async () => {
  const { hall, sql } = newHall();
  for (const target of ['u_1', 'u_2', 'u_3']) {
    recordReport(sql, { reporterUserId: 'u_a', targetUserId: target, reason: '刷屏', evidence: [] }, NOW);
  }

  const first = await reportsOf(hall, '?limit=2');
  expect(first.items.map((item) => item.target.userId)).toEqual(['u_3', 'u_2']);
  expect(first.next).toEqual({ before: first.items[1]?.id });

  const second = await reportsOf(hall, `?limit=2&before=${first.next?.before}`);
  expect(second.items.map((item) => item.target.userId)).toEqual(['u_1']);
  expect(second.next).toBeNull();

  const ids = [...first.items, ...second.items].map((item) => item.id);
  expect(ids).toEqual([3, 2, 1]);
});

const feedbackOf = async (hall: Hall, query = ''): Promise<{ items: FeedbackItem[]; next: { before: number } | null }> =>
  (await (await adminGet(hall, `/admin/feedback${query}`)).json()) as {
    items: FeedbackItem[];
    next: { before: number } | null;
  };

test('反馈列表：空表、字段与昵称读时补（删了身份就是 null），正文原样含换行', async () => {
  const { hall, sql } = newHall();
  expect(await feedbackOf(hall)).toEqual({ items: [], next: null });

  recordIdentity(sql, { userId: 'u_known', nickname: '夜猫子' }, NOW);
  recordFeedback(sql, 'u_known', '第一行\n第二行', NOW);
  recordFeedback(sql, 'u_gone', '没有台账的行', NOW);

  const page = await feedbackOf(hall);
  expect(page.items).toEqual([
    { id: 2, createdAt: NOW, userId: 'u_gone', nickname: null, text: '没有台账的行' },
    { id: 1, createdAt: NOW, userId: 'u_known', nickname: '夜猫子', text: '第一行\n第二行' },
  ]);
  expect(page.next).toBeNull();
});

test('反馈分页：id 倒序、before 排他；limit 夹到 100', async () => {
  const { hall, sql } = newHall();
  for (const text of ['一', '二', '三']) recordFeedback(sql, 'u_a', text, NOW);

  const first = await feedbackOf(hall, '?limit=2');
  expect(first.items.map((item) => item.text)).toEqual(['三', '二']);
  expect(first.next).toEqual({ before: first.items[1]?.id });

  const second = await feedbackOf(hall, `?limit=2&before=${first.next?.before}`);
  expect(second.items.map((item) => item.text)).toEqual(['一']);
  expect(second.next).toBeNull();

  const clamped = await feedbackOf(hall, '?limit=999');
  expect(clamped.items).toHaveLength(3);
  expect(clamped.next).toBeNull();
});

const reportTargetsOf = async (hall: Hall, query = ''): Promise<{ items: ReportTargetItem[] }> =>
  (await (await adminGet(hall, `/admin/reports/targets${query}`)).json()) as { items: ReportTargetItem[] };

test('按被举报人折叠：合计次数与举报人数对得上，次数多者在前，昵称为 null', async () => {
  const { hall, sql } = newHall();
  recordIdentity(sql, { userId: 'u_heavy', nickname: '夜猫子' }, NOW);

  // u_heavy：两个人报，其中一个连报两次（24 小时内并合成 count 2）
  recordReport(sql, { reporterUserId: 'u_r1', targetUserId: 'u_heavy', reason: '刷屏', evidence: [] }, NOW);
  recordReport(sql, { reporterUserId: 'u_r1', targetUserId: 'u_heavy', reason: '刷屏', evidence: [] }, NOW + 10);
  recordReport(sql, { reporterUserId: 'u_r2', targetUserId: 'u_heavy', reason: '最近的那条', evidence: [] }, NOW + 20);
  // u_light：一个人连报两次，合计 2 次但只有 1 个举报人，且最近一次比 u_heavy 晚
  recordReport(sql, { reporterUserId: 'u_r3', targetUserId: 'u_light', reason: '另一个人的事由', evidence: [] }, NOW + 30);
  recordReport(sql, { reporterUserId: 'u_r3', targetUserId: 'u_light', reason: '另一个人的事由', evidence: [] }, NOW + 40);

  const body = await reportTargetsOf(hall);
  expect(body.items).toEqual([
    {
      target: { userId: 'u_heavy', nickname: '夜猫子' },
      count: 3,
      reporters: 2,
      lastAt: NOW + 20,
      reason: '最近的那条',
    },
    {
      target: { userId: 'u_light', nickname: null },
      count: 2,
      reporters: 1,
      lastAt: NOW + 40,
      reason: '另一个人的事由',
    },
  ]);
  // 排序键不是主键：不分页，也就没有 `next`
  expect(body).not.toHaveProperty('next');
  // `limit` 照旧生效（默认 50、上限 100）
  expect((await reportTargetsOf(hall, '?limit=1')).items.map((item) => item.target.userId)).toEqual(['u_heavy']);
});

interface StatsBody {
  online: number;
  ownedBeds: number;
  blocks: number;
  reports24h: number;
}

const statsOf = async (hall: Hall): Promise<StatsBody> =>
  (await (await adminGet(hall, '/admin/stats')).json()) as StatsBody;

test('统计卡空库：四个 0（页面拿到的是数字，不是 undefined）', async () => {
  const { hall } = newHall();
  expect(await statsOf(hall)).toEqual({ online: 0, ownedBeds: 0, blocks: 0, reports24h: 0 });
});

test('统计卡四条口径：已握手连接 / 未过期归属 / 生效封禁 / 近 24 小时举报行数', async () => {
  const socket = new FakeSocket(liveConnection('u_live'));
  const { hall, sql } = newHall([socket]);

  insertBed(sql, 0, { state: 'empty', ownerUserId: 'u_a', lastSeenAt: NOW, updatedAt: NOW });
  // 归属过期 1ms：读时算无主，不进 `ownedBeds`
  insertBed(sql, 1, { state: 'empty', ownerUserId: 'u_b', lastSeenAt: NOW - BED_OWNERSHIP_TTL_MS - 1, updatedAt: NOW });
  // 只有占用、没有主：不是「有主床」
  insertBed(sql, 2, { state: 'lying', updatedAt: NOW });

  upsertBlock(sql, { kind: 'user', value: 'u_perm', untilAt: null, reason: '刷屏' }, NOW);
  upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: NOW + 1_000, reason: '刷屏' }, NOW);
  upsertBlock(sql, { kind: 'ip', value: '2.2.2.2', untilAt: NOW - 1_000, reason: '刷屏' }, NOW);

  recordReport(sql, { reporterUserId: 'u_r1', targetUserId: 'u_t', reason: '刷屏', evidence: [] }, NOW);
  recordReport(sql, { reporterUserId: 'u_r2', targetUserId: 'u_t', reason: '刷屏', evidence: [] }, NOW);
  // 刚好早过 24 小时窗口，不计入
  recordReport(sql, { reporterUserId: 'u_r3', targetUserId: 'u_old', reason: '刷屏', evidence: [] }, NOW - REPORT_DEDUP_MS - 1);

  // 两个人报同一个人 = 2 行
  expect(await statsOf(hall)).toEqual({ online: 1, ownedBeds: 1, blocks: 2, reports24h: 2 });
});
