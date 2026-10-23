import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `broadcast.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { HALL_ID } from '../../shared/constants';
import { LAYOUT_VERSION } from '../../shared/layout';
import type { ErrorMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { writeBedCount, writeDailyWakeAt } from '../bed-store';
import { upsertBlock } from '../risk';
import { META_KEYS } from '../schema';
import { insertBed, freshSql, rawRow } from './sqlite';

/** 假 socket：只用到这里用到的五件事（附加数据、发送、关闭、就绪态）。 */
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
    // `ensureSchedule` 会与平台唤醒槽位对账（不 await）：给一套能用的空实现，免得刷错误日志
    storage: { sql, getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined },
    getWebSockets: () => sockets,
  };
  return { hall: new Hall(ctx as never, {} as never), sql };
}

/** 刚建好、还没握手的连接（来源三项来自 Worker 写入的内部头）。 */
function connection(userId: string, ip?: string): ConnectionState {
  return {
    userId,
    name: '夜猫',
    appearance: 'boy',
    ip,
    x: 0,
    y: 0,
    state: 'roaming',
    lastInputAt: 0,
    ready: false,
  };
}

const countBeds = (sql: SqlStorage): number =>
  (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM bed').toArray()[0] as { n: number }).n;

const countIdentities = (sql: SqlStorage): number =>
  (sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM identity').toArray()[0] as { n: number }).n;

/** 库里存着的 `meta.bed_count`（没写过就是 `undefined`）。 */
const bedCountMeta = (sql: SqlStorage): number | undefined =>
  sql.exec<{ value: number }>('SELECT value FROM meta WHERE key = ?', META_KEYS.bedCount).toArray()[0]?.value;

/** 铺 `count` 张有主空床：他们就是「已用床」。 */
function seedOwnedBeds(sql: SqlStorage, count: number): void {
  const now = Date.now();
  for (let bedNo = 0; bedNo < count; bedNo += 1) {
    insertBed(sql, bedNo, { state: 'empty', ownerUserId: `u_seed_${bedNo}`, lastSeenAt: now, updatedAt: now });
  }
  writeBedCount(sql, 117);
}

/** `webSocketMessage` 只用到附加数据、发送与关闭三件事，假 socket 直接当真的用。 */
const hello = (hall: Hall, ws: FakeSocket, layoutVersion = LAYOUT_VERSION): Promise<void> =>
  hall.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ t: 'hello', layoutVersion }));

test('entryStatus：没被封时 blocked 为 null，厅满判定照旧', async () => {
  const { hall } = newHall();
  const status = await hall.entryStatus({ userId: 'u_a' });

  expect(status.blocked).toBeNull();
  expect(status.full).toBe(false);
  expect(status.bedCount).toBe(117);
});

test('entryStatus 的 untilAt 与库里一致（永久则是 null），两个维度都判', async () => {
  const untilAt = Date.now() + 8 * 60_000;
  const { hall, sql } = newHall();
  upsertBlock(sql, { kind: 'user', value: 'u_blocked', untilAt, reason: '刷屏' }, Date.now());
  upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '刷屏' }, Date.now());

  expect((await hall.entryStatus({ userId: 'u_blocked' })).blocked).toEqual({ untilAt });
  expect((await hall.entryStatus({ userId: 'u_other', ip: '1.1.1.1' })).blocked).toEqual({ untilAt: null });
  expect((await hall.entryStatus({ userId: 'u_other', ip: '2.2.2.2' })).blocked).toBeNull();
});

test('hello 命中封禁（user 维度）：回 5002 + untilAt，close(1008, blocked)，不下发快照、不写床位行', async () => {
  const untilAt = Date.now() + 60_000;
  const blocked = connection('u_blocked');
  const ws = new FakeSocket(blocked);
  const { hall, sql } = newHall([ws]);
  upsertBlock(sql, { kind: 'user', value: 'u_blocked', untilAt, reason: '刷屏' }, Date.now());
  const bedsBefore = countBeds(sql);

  await hello(hall, ws);

  const [only] = ws.sent.map((payload) => JSON.parse(payload) as { t: string } & ErrorMessage);
  expect(only).toMatchObject({ t: 'error', code: '5002', untilAt });
  expect(ws.sent.some((payload) => payload.includes('"t":"snapshot"'))).toBe(false);
  expect(ws.closed).toEqual({ code: 1008, reason: 'blocked' });
  expect(countBeds(sql)).toBe(bedsBefore);
  // 被拒的人不该在台账里留下「最近一见」
  expect(countIdentities(sql)).toBe(0);
});

test('hello 命中封禁（ip 维度）：来源未知时跳过这一维', async () => {
  const ws = new FakeSocket(connection('u_other', '1.1.1.1'));
  const { hall, sql } = newHall([ws]);
  upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '刷屏' }, Date.now());

  await hello(hall, ws);

  expect(ws.closed).toEqual({ code: 1008, reason: 'blocked' });
  expect(JSON.parse(ws.sent[0] as string)).toMatchObject({ code: '5002', untilAt: null });

  // 没带 IP 的同一个人不该被 ip 维度命中（同一份库里那一行依旧在）
  const noIp = new FakeSocket(connection('u_other'));
  await hello(hall, noIp);
  expect(noIp.closed).toBeNull();
});

test('其余拒绝保持 close(1000) + 码（封禁才用带语义的 close）', async () => {
  const ws = new FakeSocket(connection('u_a'));
  const { hall } = newHall([ws]);

  await hello(hall, ws, 'stale');

  expect(JSON.parse(ws.sent[0] as string)).toMatchObject({ t: 'error', code: '2003' });
  expect(JSON.parse(ws.sent[0] as string)).not.toHaveProperty('untilAt');
  expect(ws.closed).toEqual({ code: 1000, reason: '2003' });
});

test('成功入场写一行台账（来源三项随之落库）', async () => {
  const ws = new FakeSocket(connection('u_new', '1.1.1.1'));
  const { hall, sql } = newHall([ws]);

  await hello(hall, ws);

  expect(ws.closed).toBeNull();
  expect(ws.sent.some((payload) => payload.includes('"t":"snapshot"'))).toBe(true);
  expect(sql.exec('SELECT user_id, last_ip FROM identity').toArray()).toEqual([
    { user_id: 'u_new', last_ip: '1.1.1.1' },
  ]);
  // 台账与床位是两张表：入场本身不写床位行
  expect(countBeds(sql)).toBe(0);
});

test('hello 命中封禁时不触发升级（判定排在 growIfNeeded 之前）', async () => {
  // 88 张有主床 = 117 的 75.2%：没被封的人在这个库上一定会升一级
  const blockedWs = new FakeSocket(connection('u_blocked'));
  const blocked = newHall([blockedWs]);
  seedOwnedBeds(blocked.sql, 88);
  upsertBlock(blocked.sql, { kind: 'user', value: 'u_blocked', untilAt: null, reason: '刷屏' }, Date.now());

  await hello(blocked.hall, blockedWs);

  expect(blockedWs.closed).toEqual({ code: 1008, reason: 'blocked' });
  expect(bedCountMeta(blocked.sql)).toBe(117);

  // 对照组：同规模的库里没被封的人确实会升级——否则上面那条断言恒真
  const openWs = new FakeSocket(connection('u_open'));
  const open = newHall([openWs]);
  seedOwnedBeds(open.sql, 88);

  await hello(open.hall, openWs);

  expect(bedCountMeta(open.sql)).toBe(150);
});

test('hello：归属已过期但行还没释放，先写 last_seen_at 再判定——恢复的仍是自己那张睡痕床', async () => {
  const userId = 'u_stale';
  const ws = new FakeSocket(connection(userId));
  const { hall, sql } = newHall([ws]);
  const lastSeenAt = Date.now() - 31 * 24 * 3600 * 1000;
  // 今天的 20:00 已经结算过：否则入场重建会当场补跑每日唤醒，先把这条过期行释放掉
  writeDailyWakeAt(sql, Date.now());
  // 3 号床是过期但还没被每日唤醒释放的睡痕行；没有别的行 → 最小可认领床（出生点）是 0 号
  insertBed(sql, 3, {
    state: 'trace',
    ownerUserId: userId,
    lastSeenAt,
    sleepStartedAt: lastSeenAt - 3600_000,
    updatedAt: lastSeenAt,
  });
  const before = Date.now();

  await hello(hall, ws);

  const row = rawRow(sql, 3) ?? {};
  expect(row.owner_user_id).toBe(userId); // 没被当成生人
  expect((ws.deserializeAttachment() as ConnectionState).bedNo).toBe(3); // 恢复的是 3 号床，不是最小可认领床（出生点）
  expect(row.state).toBe('asleep'); // 睡痕恢复 = 睡着的还原
  expect(Number(row.last_seen_at)).toBeGreaterThanOrEqual(before); // 入场那一写把 30 天重新起算
});
