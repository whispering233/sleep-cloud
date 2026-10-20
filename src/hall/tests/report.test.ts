import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `entry.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { mask } from '../../shared/content-filter';
import { HALL_ID, REPORT_DEDUP_MS, REPORT_REASON_MAX_LEN, REPORT_TTL_MS } from '../../shared/constants';
import { LAYOUT_VERSION } from '../../shared/layout';
import type { ErrorMessage, UpstreamMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { listReports, purgeExpiredReports, recordReport } from '../report';
import { freshSql } from './sqlite';

/** 假 socket：只用到这里用到的四件事（附加数据、发送、关闭、就绪态）。 */
class FakeSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  readonly readyState = 1;
  private attachment: unknown;

  constructor(attachment: unknown) {
    this.attachment = attachment;
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
  }
}

function newHall(sockets: FakeSocket[] = []): { hall: Hall; sql: SqlStorage } {
  const sql = freshSql();
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql, getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined },
    getWebSockets: () => sockets,
  };
  return { hall: new Hall(ctx as never, {} as never), sql };
}

function connection(userId: string): ConnectionState {
  return { userId, name: '夜猫', appearance: 'boy', x: 0, y: 0, state: 'roaming', lastInputAt: 0, ready: false };
}

const hello = (hall: Hall, ws: FakeSocket): Promise<void> =>
  hall.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ t: 'hello', layoutVersion: LAYOUT_VERSION }));

const send = (hall: Hall, ws: FakeSocket, message: UpstreamMessage): Promise<void> =>
  hall.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(message));

const lastError = (ws: FakeSocket): unknown => JSON.parse(ws.sent[ws.sent.length - 1] as string) as ErrorMessage;

/**
 * 直接喂一条意图并**绕开限流窗口**（每句都换一个新窗口）：测的是发言缓冲的条数与归属，
 * 不是 5 条/秒。走 `webSocketMessage` 连发十几句会被限流丢掉，那测的就变成别的东西了。
 */
function speak(hall: Hall, ws: FakeSocket, message: UpstreamMessage): void {
  const connection = ws.deserializeAttachment() as ConnectionState;
  const intent = (hall as unknown as {
    handleIntent: (ws: WebSocket, connection: ConnectionState, message: UpstreamMessage) => void;
  }).handleIntent;
  intent.call(hall, ws as unknown as WebSocket, { ...connection, rate: undefined }, message);
}

const report = (reporter: string, target: string, reason = '刷屏', evidence: { text: string; at: number }[] = []) => ({
  reporterUserId: reporter,
  targetUserId: target,
  reason,
  evidence,
});

test('首次举报落一行：事由、证据原样入库，count 从 1 起', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;

  expect(recordReport(sql, report('u_a', 'u_b', '他骂人', [{ text: '你*', at: now - 5 }]), now)).toBe('created');

  expect(listReports(sql, { limit: 10 })).toEqual([
    {
      id: 1,
      createdAt: now,
      lastAt: now,
      reporterUserId: 'u_a',
      targetUserId: 'u_b',
      reason: '他骂人',
      evidence: [{ text: '你*', at: now - 5 }],
      count: 1,
    },
  ]);
});

test('24 小时内重复举报同一人：只有一行，count 加一，事由与证据保持第一次那份', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;

  recordReport(sql, report('u_a', 'u_b', '第一次', [{ text: '第一句', at: now }]), now);
  expect(recordReport(sql, report('u_a', 'u_b', '第二次', [{ text: '第二句', at: now + 1 }]), now + 1000)).toBe('merged');

  const rows = listReports(sql, { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reason: '第一次', evidence: [{ text: '第一句', at: now }], count: 2 });
  expect(rows[0]?.lastAt).toBe(now + 1000);
});

test('超过 24 小时窗口（按 last_at 滑动）：另起一行', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;

  recordReport(sql, report('u_a', 'u_b'), now - REPORT_DEDUP_MS - 1);
  expect(recordReport(sql, report('u_a', 'u_b'), now)).toBe('created');

  expect(listReports(sql, { limit: 10 }).map((row) => row.count)).toEqual([1, 1]);
});

test('listReports：id 倒序，before 是排他游标', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;
  recordReport(sql, report('u_a', 'u_1'), now);
  recordReport(sql, report('u_a', 'u_2'), now);
  recordReport(sql, report('u_a', 'u_3'), now);

  const firstPage = listReports(sql, { limit: 2 });
  expect(firstPage.map((row) => row.targetUserId)).toEqual(['u_3', 'u_2']);
  expect(listReports(sql, { limit: 2, before: firstPage[1]?.id }).map((row) => row.targetUserId)).toEqual(['u_1']);
  expect(listReports(sql, { limit: 2, before: 3 })).toHaveLength(2);
});

test('purgeExpiredReports：只删 last_at 超过 90 天的行', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;
  recordReport(sql, report('u_a', 'u_old'), now - REPORT_TTL_MS - 1);
  recordReport(sql, report('u_a', 'u_edge'), now - REPORT_TTL_MS + 1);
  recordReport(sql, report('u_a', 'u_new'), now);

  purgeExpiredReports(sql, now);

  expect(listReports(sql, { limit: 10 }).map((row) => row.targetUserId)).toEqual(['u_new', 'u_edge']);
});

test('report 端到端：落一行、回 5003；证据是被举报人发言的**打码后**逐字副本', async () => {
  const target = new FakeSocket(connection('u_target'));
  const reporter = new FakeSocket(connection('u_reporter'));
  const { hall, sql } = newHall([target, reporter]);
  await hello(hall, target);
  await hello(hall, reporter);
  const said = '加我 13800138000';
  await send(hall, target, { t: 'chat', text: said });
  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: ' 刷屏 ' });

  expect(lastError(reporter)).toEqual({ t: 'error', code: '5003' });
  const rows = listReports(sql, { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    reporterUserId: 'u_reporter',
    targetUserId: 'u_target',
    reason: '刷屏',
    count: 1,
  });
  expect(rows[0]?.evidence.map((item) => item.text)).toEqual([mask(said)]);
  // 证据与广播出去的那一条**逐字一致**（不是另存一份原文）
  expect(mask(said)).toContain('*');
  const chat = reporter.sent.map((payload) => JSON.parse(payload) as { t: string; text: string }).find((m) => m.t === 'chat');
  expect(rows[0]?.evidence[0]?.text).toBe(chat?.text);
});

test('report 拒绝分支：空事由 4003、超长 4001、举报自己 4003，三条都不落库', async () => {
  const target = new FakeSocket(connection('u_target'));
  const reporter = new FakeSocket(connection('u_reporter'));
  const { hall, sql } = newHall([target, reporter]);
  await hello(hall, target);
  await hello(hall, reporter);

  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '   ' });
  expect(lastError(reporter)).toEqual({ t: 'error', code: '4003' });

  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '好'.repeat(REPORT_REASON_MAX_LEN + 1) });
  expect(lastError(reporter)).toEqual({ t: 'error', code: '4001' });

  await send(hall, reporter, { t: 'report', toId: 'u_reporter', reason: '举报自己' });
  expect(lastError(reporter)).toEqual({ t: 'error', code: '4003' });

  expect(listReports(sql, { limit: 10 })).toEqual([]);
});

test('24 小时内两次举报同一人：库里仍一行，count=2', async () => {
  const target = new FakeSocket(connection('u_target'));
  const reporter = new FakeSocket(connection('u_reporter'));
  const { hall, sql } = newHall([target, reporter]);
  await hello(hall, target);
  await hello(hall, reporter);

  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '第一次' });
  expect(lastError(reporter)).toEqual({ t: 'error', code: '5003' });
  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '第二次' });
  expect(lastError(reporter)).toEqual({ t: 'error', code: '5003' });

  const rows = listReports(sql, { limit: 10 });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reason: '第一次', count: 2 });
});

test('证据只拷被举报人最近的 10 条，不含举报人自己的话', async () => {
  const target = new FakeSocket(connection('u_target'));
  const reporter = new FakeSocket(connection('u_reporter'));
  const { hall, sql } = newHall([target, reporter]);
  await hello(hall, target);
  await hello(hall, reporter);

  for (let index = 0; index < 12; index += 1) speak(hall, target, { t: 'chat', text: `第${index}句` });
  speak(hall, reporter, { t: 'chat', text: '举报人自己的话' });
  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '刷屏' });

  const [row] = listReports(sql, { limit: 1 });
  expect(row?.evidence.map((item) => item.text)).toEqual([
    '第2句',
    '第3句',
    '第4句',
    '第5句',
    '第6句',
    '第7句',
    '第8句',
    '第9句',
    '第10句',
    '第11句',
  ]);
  expect(row?.evidence.some((item) => item.text === '举报人自己的话')).toBe(false);
});

test('每日唤醒：删掉超过 90 天的举报行，并清空发言缓冲', async () => {
  const target = new FakeSocket(connection('u_target'));
  const reporter = new FakeSocket(connection('u_reporter'));
  const { hall, sql } = newHall([target, reporter]);
  const now = Date.now();
  await hello(hall, target);
  await hello(hall, reporter);
  recordReport(sql, report('u_a', 'u_old'), now - REPORT_TTL_MS - 1);
  speak(hall, target, { t: 'chat', text: '昨晚说的话' });
  await send(hall, reporter, { t: 'report', toId: 'u_target', reason: '刷屏' });
  expect(listReports(sql, { limit: 10 }).map((row) => row.targetUserId)).toEqual(['u_target', 'u_old']);

  (hall as unknown as { runDailyWake: () => void }).runDailyWake();

  // 只删过期行；过期行消失后未过期的那行带着当时的证据仍在
  const rows = listReports(sql, { limit: 10 });
  expect(rows.map((row) => row.targetUserId)).toEqual(['u_target']);
  expect(rows[0]?.evidence.map((item) => item.text)).toEqual(['昨晚说的话']);
  // 发言缓冲不留过夜（厅实例内存里那一份当场清掉）
  expect((hall as unknown as { speech: Map<string, unknown> }).speech.size).toBe(0);
});
