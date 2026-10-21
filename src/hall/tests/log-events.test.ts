import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `broadcast.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { AUTO_SLEEP_MS, BED_OWNERSHIP_TTL_MS, HALL_ID } from '../../shared/constants';
import { frontPointOf, HALL_LEVELS, LAYOUT_VERSION } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import type { SnapshotMessage, UpstreamMessage } from '../../shared/protocol';
import { writeBedCount } from '../bed-store';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql, insertBed, rawRow } from './sqlite';

/**
 * 生命周期事件的取值契约（`docs/design/100-log.md` §3）：`enter` / `lie` / `sleep` / `wake` / `settle` /
 * `snapshot`。断言的是**事件本身**（出口写的那一个对象），不是下游的聚合口径。
 *
 * 这六个事件不在 §4 的四类闸门里（`reject` / `censor` / `drop` / `err`），所以不需要每个用例换一副模块图。
 */
class FakeSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  readonly readyState = 1;
  private attachment: unknown;

  constructor(attachment: unknown = {}) {
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

function newHall(sql: SqlStorage = freshSql(), sockets: FakeSocket[] = []): Hall {
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql, getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined },
    getWebSockets: () => sockets,
  };
  return new Hall(ctx as never, {} as never);
}

const FIRST = (HALL_LEVELS[0] as { capacity: number }).capacity;
const SECOND = (HALL_LEVELS[1] as { capacity: number }).capacity;
const NOW = Date.parse('2025-07-01T12:00:00Z');

/** 出口写的是 `console.log(一个对象)`（`shared/log.ts` 的 `write`）：按 `ev` 挑出这一类事件。 */
function events(name: string): Array<Record<string, unknown>> {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => call[0] as Record<string, unknown>)
    .filter((row) => row.ev === name);
}

const hello = (hall: Hall, ws: FakeSocket): Promise<void> =>
  hall.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ t: 'hello', layoutVersion: LAYOUT_VERSION }));

/** 刚建好、还没握手的连接（`entry.test.ts` 同一个形状）。 */
function connection(userId: string): ConnectionState {
  return { userId, name: '夜猫', appearance: 'boy', x: 0, y: 0, state: 'roaming', lastInputAt: 0, ready: false };
}

/** 站在厅里的自己（`u_me`）。 */
function roaming(now: number): ConnectionState {
  return { userId: 'u_me', name: '夜猫', appearance: 'boy', x: 0, y: 0, state: 'roaming', lastInputAt: now, ready: true };
}

/** 躺在床上、站姿就位在床脚前的自己。 */
function lying(now: number, bedNo = 7): ConnectionState {
  const spot = frontPointOf(bedNo) as Point;
  return {
    userId: 'u_me',
    name: '夜猫',
    appearance: 'boy',
    x: spot.x,
    y: spot.y,
    state: 'lying',
    bedNo,
    lastInputAt: now,
    ready: true,
  };
}

/** 私有方法一律运行时按名字取，不为测试放宽成 public。 */
function feed(hall: Hall, ws: FakeSocket, state: ConnectionState, message: UpstreamMessage): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, connection: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, state, message);
}

function lieDown(hall: Hall, ws: FakeSocket, state: ConnectionState, bedNo: number): void {
  (
    hall as unknown as { lieDown: (ws: WebSocket, connection: ConnectionState, bedNo: number) => void }
  ).lieDown(ws as never, state, bedNo);
}

function refreshDerived(hall: Hall): void {
  (hall as unknown as { refreshDerivedStates: () => void }).refreshDerivedStates();
}

function dailyWake(hall: Hall): void {
  (hall as unknown as { runDailyWake: () => void }).runDailyWake();
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('enter / snapshot：第一次入场 fresh=true，bytes 就是真正发出去那一条的长度', async () => {
  const ws = new FakeSocket(connection('u_new'));
  const hall = newHall(freshSql(), [ws]);

  await hello(hall, ws);

  const payload = ws.sent.find((raw) => raw.includes('"t":"snapshot"')) as string;
  const snapshot = JSON.parse(payload) as SnapshotMessage;
  expect(events('enter')).toEqual([{ ev: 'enter', uid: 'u_new', fresh: true, online: 1 }]);
  // 同一个字符串既发出去、也用来取长度：两个数必须相等（不能是另一次 stringify 的结果）
  expect(events('snapshot')).toEqual([
    { ev: 'snapshot', bytes: payload.length, people: snapshot.people.length, beds: snapshot.hall.bedCount },
  ]);
});

test('enter：同一个人再回厅时 fresh=false（台账里已有 `first_seen_at`）', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const first = new FakeSocket(connection('u_back'));
  const sockets = [first];
  const hall = newHall(freshSql(), sockets);
  await hello(hall, first);

  vi.setSystemTime(NOW + 3_600_000);
  const second = new FakeSocket(connection('u_back'));
  sockets.push(second);
  await hello(hall, second);

  expect(events('enter').map((row) => row.fresh)).toEqual([true, false]);
  expect(events('enter').map((row) => row.online)).toEqual([1, 1]); // 按人去重：旧连接被替换掉
});

test('lie：首次躺下 from=empty', () => {
  const now = Date.now();
  const ws = new FakeSocket();
  const hall = newHall(freshSql(), [ws]);

  lieDown(hall, ws, roaming(now), 7);

  expect(events('lie')).toEqual([{ ev: 'lie', uid: 'u_me', bed: 7, from: 'empty' }]);
});

test('lie：从自己名下另一张床换过来 from=swap（旧归属当场释放）', () => {
  const now = Date.now();
  const ws = new FakeSocket();
  const sql = freshSql();
  insertBed(sql, 7, {
    state: 'empty',
    ownerUserId: 'u_me',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });
  const hall = newHall(sql, [ws]);

  lieDown(hall, ws, roaming(now), 3);

  expect(events('lie')).toEqual([{ ev: 'lie', uid: 'u_me', bed: 3, from: 'swap' }]);
  expect(rawRow(sql, 7)?.owner_user_id).toBeNull();
});

test('sleep：手动点睡着 auto=false', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const ws = new FakeSocket();
  const sql = freshSql();
  insertBed(sql, 7, { state: 'lying', ownerUserId: 'u_me', lastSeenAt: NOW, updatedAt: NOW });
  const hall = newHall(sql, [ws]);
  const state = lying(NOW);
  ws.serializeAttachment(state);

  feed(hall, ws, state, { t: 'sleep' } as UpstreamMessage);

  expect(events('sleep')).toEqual([{ ev: 'sleep', uid: 'u_me', bed: 7, auto: false }]);
});

test('sleep：推导出来的自动睡着 auto=true（没有手动点过「睡着」）', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const ws = new FakeSocket();
  const sql = freshSql();
  insertBed(sql, 7, { state: 'lying', ownerUserId: 'u_me', lastSeenAt: NOW, updatedAt: NOW });
  const hall = newHall(sql, [ws]);
  const idleSince = NOW - AUTO_SLEEP_MS;
  ws.serializeAttachment(lying(idleSince));

  refreshDerived(hall);

  expect(events('sleep')).toEqual([{ ev: 'sleep', uid: 'u_me', bed: 7, auto: true }]);
  expect(rawRow(sql, 7)?.state).toBe('asleep');
});

test('wake：躺下 → 起身一次，dwellMs 等于两次时间戳之差（来源 = 上床时写的 `sleep_started_at`）', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const ws = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [ws]);

  lieDown(hall, ws, roaming(NOW), 7);
  vi.setSystemTime(NOW + 90_000);
  const state = ws.deserializeAttachment() as ConnectionState;
  feed(hall, ws, state, { t: 'rise' } as UpstreamMessage);

  expect(events('lie')).toHaveLength(1);
  expect(events('wake')).toEqual([{ ev: 'wake', uid: 'u_me', bed: 7, dwellMs: 90_000 }]);
  expect(rawRow(sql, 7)?.sleep_started_at).toBeNull(); // 起点被这一次起身消耗掉
});

test('wake：拿不到起点（`sleep_started_at` 为空）就不写这条，不编一个 0', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const ws = new FakeSocket();
  const sql = freshSql();
  insertBed(sql, 7, { state: 'lying', ownerUserId: 'u_me', lastSeenAt: NOW, updatedAt: NOW });
  const hall = newHall(sql, [ws]);
  const state = lying(NOW);
  ws.serializeAttachment(state);

  feed(hall, ws, state, { t: 'rise' } as UpstreamMessage);

  expect(rawRow(sql, 7)?.state).toBe('empty'); // 路径确实跑了（否则上面那条空断言自己就成立）
  expect(events('wake')).toEqual([]);
});

test('settle：一轮结算一条，wakes/traces 来自已取到的超期行，from/to 是结算前后的级容量', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const sql = freshSql();
  writeBedCount(sql, SECOND);
  const expiredAt = NOW - BED_OWNERSHIP_TTL_MS - 1;
  insertBed(sql, 140, { state: 'trace', ownerUserId: 'u_a', lastSeenAt: expiredAt, updatedAt: expiredAt });
  insertBed(sql, 141, { state: 'empty', ownerUserId: 'u_b', lastSeenAt: expiredAt, updatedAt: expiredAt });
  const hall = newHall(sql, []);

  dailyWake(hall);

  // 两张超期床（其一张是睡痕）；外圈释放后全空 → 从第二档缩回第一档
  expect(events('settle')).toEqual([{ ev: 'settle', wakes: 2, traces: 1, from: SECOND, to: FIRST, ms: 0 }]);
});