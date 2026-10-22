import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `report.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { FEEDBACK_DAILY_MAX, FEEDBACK_MAX_LEN, FEEDBACK_TTL_MS, HALL_ID } from '../../shared/constants';
import { LAYOUT_VERSION } from '../../shared/layout';
import type { ErrorMessage, UpstreamMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { countRecentFeedback, purgeExpiredFeedback, recordFeedback } from '../feedback';
import { Hall } from '../hall';
import { freshSql } from './sqlite';

class FakeSocket {
  readonly sent: string[] = [];
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

  close(): void {}
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

test('落库：正文原样保存（不过内容过滤），配额只数该身份滚动 24 小时内的行', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;

  expect(recordFeedback(sql, 'u_a', '  希望有夜间白噪音  ', now)).toBe('created');
  expect(recordFeedback(sql, 'u_b', '别人的一条', now)).toBe('created');

  const rows = sql.exec<{ user_id: string; text: string; created_at: number }>('SELECT user_id, text, created_at FROM feedback').toArray();
  expect(rows).toEqual([
    { user_id: 'u_a', text: '  希望有夜间白噪音  ', created_at: now },
    { user_id: 'u_b', text: '别人的一条', created_at: now },
  ]);
  expect(countRecentFeedback(sql, 'u_a', now)).toBe(1);
  expect(countRecentFeedback(sql, 'u_a', now + 24 * 60 * 60 * 1000 + 1)).toBe(0);
});

test('配额：第 6 条返回 quota 且不写行；窗口滑过之后又能发', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;
  for (let index = 0; index < FEEDBACK_DAILY_MAX; index += 1) {
    expect(recordFeedback(sql, 'u_a', `第 ${index + 1} 条`, now)).toBe('created');
  }
  expect(recordFeedback(sql, 'u_a', '第 6 条', now)).toBe('quota');
  expect(countRecentFeedback(sql, 'u_a', now)).toBe(FEEDBACK_DAILY_MAX);

  expect(recordFeedback(sql, 'u_a', '明天再来', now + 24 * 60 * 60 * 1000 + 1)).toBe('created');
});

test('90 天清理只删过期行', () => {
  const sql = freshSql();
  const now = 1_700_000_000_000;
  recordFeedback(sql, 'u_old', '很久以前', now - FEEDBACK_TTL_MS - 1);
  recordFeedback(sql, 'u_new', '最近', now);

  purgeExpiredFeedback(sql, now);

  expect(sql.exec<{ user_id: string }>('SELECT user_id FROM feedback ORDER BY id').toArray()).toEqual([{ user_id: 'u_new' }]);
});

test('协议：空正文 4003、超长 4001、成功 5004，落库的是 trim 后那份', async () => {
  const ws = new FakeSocket(connection('u_a'));
  const { hall, sql } = newHall([ws]);
  await hello(hall, ws);

  await send(hall, ws, { t: 'feedback', text: '   ' });
  expect(lastError(ws)).toEqual({ t: 'error', code: '4003' });

  await send(hall, ws, { t: 'feedback', text: 'x'.repeat(FEEDBACK_MAX_LEN + 1) });
  expect(lastError(ws)).toEqual({ t: 'error', code: '4001' });

  await send(hall, ws, { t: 'feedback', text: `  ${'x'.repeat(FEEDBACK_MAX_LEN)}  ` });
  expect(lastError(ws)).toEqual({ t: 'error', code: '5004' });
  expect(sql.exec<{ text: string }>('SELECT text FROM feedback').toArray()).toEqual([
    { text: 'x'.repeat(FEEDBACK_MAX_LEN) },
  ]);
});

test('协议：超过每日上限回 4004，不再写行', async () => {
  const ws = new FakeSocket(connection('u_a'));
  const { hall, sql } = newHall([ws]);
  await hello(hall, ws);
  const userId = (ws.deserializeAttachment() as ConnectionState).userId;
  for (let index = 0; index < FEEDBACK_DAILY_MAX; index += 1) recordFeedback(sql, userId, `已有 ${index}`, Date.now());

  await send(hall, ws, { t: 'feedback', text: '再发一条' });
  expect(lastError(ws)).toEqual({ t: 'error', code: '4004' });
  expect(countRecentFeedback(sql, userId, Date.now())).toBe(FEEDBACK_DAILY_MAX);
});
