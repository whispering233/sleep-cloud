import { afterEach, expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它。基类不做别的，只把平台注入的 `ctx` / `env` 挂上去。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { HALL_ID } from '../../shared/constants';
import type { DownstreamMessage, UpstreamMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql } from './sqlite';

/**
 * 广播出站守卫（`Hall.send`）：一条已经关掉的连接不能打断整次广播。
 *
 * 假 socket 只实现被用到的那三件事：报 `readyState`、给 `readConnection` 一份附加数据、收下 `send`。
 * 后半部分守入口的静默降级（`docs/design/100-log.md` §3）：两种丢弃、限流、被拒意图、唤醒异常。
 */
class FakeSocket {
  readonly received: string[] = [];
  sendCalls = 0;
  private attachment: unknown = { ready: true };

  constructor(readonly readyState = 1) {}

  /** 生产里这里是「一条已握手连接」的附加数据；守卫不读它的内容以外的字段。 */
  deserializeAttachment(): unknown {
    return this.attachment;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  send(payload: string): void {
    this.sendCalls += 1;
    this.received.push(payload);
  }
}

/** 平台上的死连接：`send()` 抛，而附加数据里的 `ready` 还是真——实测就是这个组合。 */
class DeadSocket extends FakeSocket {
  send(): never {
    this.sendCalls += 1;
    throw new TypeError("Can't call WebSocket send() after close().");
  }
}

function newHall(sockets: FakeSocket[], HallClass: typeof Hall = Hall): Hall {
  const ctx = {
    id: { name: HALL_ID }, // 构造函数会校验厅标识并建表，两项都得给
    // 唤醒槽位那三个方法也得给：`ensureSchedule` / `syncAlarm` 会与它们对账（不 await）
    storage: {
      sql: freshSql(),
      getAlarm: async () => null,
      setAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
    },
    getWebSockets: () => sockets,
  };
  return new HallClass(ctx as never, {} as never);
}

/** `broadcast` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function broadcast(hall: Hall, message: DownstreamMessage): unknown {
  let thrown: unknown;
  try {
    (hall as unknown as { broadcast: (message: DownstreamMessage) => void }).broadcast(message);
  } catch (error) {
    thrown = error;
  }
  return thrown;
}

const leave: DownstreamMessage = { t: 'leave', id: 'u_x', online: 1 };

/** 一条站在厅里、已握手的连接（`ping` 的判定不碰几何，占位坐标够用）。 */
function handshook(userId: string, lastInputAt: number): ConnectionState {
  return {
    userId,
    name: userId,
    appearance: 'boy',
    x: 0,
    y: 0,
    state: 'roaming',
    lastInputAt,
    ready: true,
  };
}

/** `handleIntent` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function feed(hall: Hall, ws: FakeSocket, connection: ConnectionState, message: UpstreamMessage): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, connection: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, connection, message);
}

/**
 * 日志的闸门与聚合计数活在 `../log` 的模块内存里（`100-log.md` §4.3）：要断言条数与 `n`，
 * 每个用例都得拿一副全新的模块图（`Hall` 还是同一个实现，只是没有前面用例攒下的桶）。
 */
async function freshHallClass(): Promise<typeof Hall> {
  vi.resetModules();
  const { Hall: FreshHall } = await import('../hall');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return FreshHall;
}

/** 出口写的是 `console.log(一个对象)`（`shared/log.ts` 的 `write`），这里按原样取出来。 */
function rows(): Array<Record<string, unknown>> {
  return vi.mocked(console.log).mock.calls.map((call) => call[0] as Record<string, unknown>);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('中间一条连接发送会抛：后面的连接照样收到，整次广播不抛', () => {
  const first = new FakeSocket();
  const dead = new DeadSocket(1); // readyState 还是 OPEN，但 send 抛（检查与发送之间的窗口）
  const last = new FakeSocket();
  const hall = newHall([first, dead, last]);

  const thrown = broadcast(hall, leave);

  expect(dead.sendCalls).toBe(1); // 试过了
  expect(first.received).toEqual([JSON.stringify(leave)]);
  expect(last.received).toEqual([JSON.stringify(leave)]);
  expect(thrown).toBeUndefined();
});

test('readyState 不是 OPEN 的连接直接跳过：不发、不抛、不影响别人', () => {
  const closed = new DeadSocket(3); // WebSocket.CLOSED
  const live = new FakeSocket();
  const hall = newHall([closed, live]);

  const thrown = broadcast(hall, leave);

  expect(closed.sendCalls).toBe(0); // 守卫在 send 之前就返回了
  expect(live.received).toEqual([JSON.stringify(leave)]);
  expect(thrown).toBeUndefined();
});

test('ping 只回发起方一条 pong：不广播、不刷新 lastInputAt、吃一条限流额度', () => {
  const me = new FakeSocket();
  const other = new FakeSocket();
  const hall = newHall([me, other]);
  const connection = handshook('u_me', 1000);
  me.serializeAttachment(connection);

  // 无载荷的意图（`ping` / `rise` / `sleep`）与 `Record<string, never>` 相交，字面量只能断言构造
  feed(hall, me, connection, { t: 'ping' } as UpstreamMessage);

  expect(me.received).toHaveLength(1);
  expect(JSON.parse(me.received[0] as string) as DownstreamMessage).toEqual({ t: 'pong', ts: expect.any(Number) });
  expect(other.received).toEqual([]); // 对方零消息：pong 是单播
  const after = me.deserializeAttachment() as ConnectionState;
  expect(after.lastInputAt).toBe(1000); // ping 不是输入，自动睡着不因此顺延
  expect(after.rate).toEqual({ windowStart: expect.any(Number), count: 1 }); // 但吃一条额度：探活不能变成绕过限流的口子
});

test('ping 超出限流时静默丢弃：不回 pong，也不回 4002', () => {
  const me = new FakeSocket();
  const hall = newHall([me]);

  for (let i = 0; i < 6; i += 1) {
    const current = me.deserializeAttachment() as ConnectionState;
    feed(hall, me, current, { t: 'ping' } as UpstreamMessage);
  }

  expect(me.received).toHaveLength(5); // 第 6 条被限流
  expect(me.received.every((raw) => (JSON.parse(raw) as DownstreamMessage).t === 'pong')).toBe(true);
});

test('连接已关：20 次跳过攒成一条 drop{kind:skip,n:20}，不记成 send', async () => {
  const FreshHall = await freshHallClass();
  const closed = new FakeSocket(3); // WebSocket.CLOSED
  const hall = newHall([closed], FreshHall);

  for (let i = 0; i < 20; i += 1) broadcast(hall, leave);

  expect(closed.sendCalls).toBe(0); // 一次都没「试发」
  expect(rows()).toEqual([{ ev: 'drop', kind: 'skip', n: 20 }]);
});

test('send 抛：20 次失败攒成一条 drop{kind:send,n:20}，与 skip 分开攒', async () => {
  const FreshHall = await freshHallClass();
  const dead = new DeadSocket(1);
  const hall = newHall([dead], FreshHall);

  for (let i = 0; i < 20; i += 1) broadcast(hall, leave);

  expect(dead.sendCalls).toBe(20); // 每次都在「检查与发送之间」抛
  expect(rows()).toEqual([{ ev: 'drop', kind: 'send', n: 20 }]);
});

test('限流丢弃攒成一条 drop{kind:limit,n:20}：25 次 ping 只回 5 条 pong', async () => {
  const FreshHall = await freshHallClass();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000); // 冻住时间：25 条 ping 全落在同一个 1 秒窗口里
  const me = new FakeSocket();
  const hall = newHall([me], FreshHall);
  me.serializeAttachment(handshook('u_me', 1000));

  for (let i = 0; i < 25; i += 1) {
    feed(hall, me, me.deserializeAttachment() as ConnectionState, { t: 'ping' } as UpstreamMessage);
  }

  expect(me.received).toHaveLength(5); // 前 5 条被放行
  expect(rows()).toEqual([{ ev: 'drop', kind: 'limit', n: 20 }]);
});

test('被拒意图：日志多一条 reject{code,intent}，下行 error 报文一字不变', async () => {
  const FreshHall = await freshHallClass();
  const me = new FakeSocket();
  const hall = newHall([me], FreshHall);
  const connection = handshook('u_me', 1000);
  me.serializeAttachment(connection);

  // 目标点不是有限数：`walk` 落到 `3006`（静默类错误，不断开）
  feed(hall, me, connection, { t: 'walk', x: Number.NaN, y: 0 } as UpstreamMessage);

  expect(rows()).toEqual([{ ev: 'reject', code: '3006', intent: 'walk' }]);
  expect(me.received.map((raw) => JSON.parse(raw) as DownstreamMessage)).toEqual([{ t: 'error', code: '3006' }]);
});

test('唤醒里的事件抛：alarm 照旧抛给平台（至少一次的重试不能丢），并留一条 err{where:alarm}', async () => {
  const FreshHall = await freshHallClass();
  const hall = newHall([], FreshHall);
  // `runDueEvents` 是私有的：按名字取到实例上再换成会抛的那一版
  const internal = hall as unknown as { runDueEvents: () => void };
  vi.spyOn(internal, 'runDueEvents').mockImplementation(() => {
    throw new Error('boom');
  });

  await expect(hall.alarm()).rejects.toThrow('boom');

  expect(rows()).toEqual([{ ev: 'err', where: 'alarm', code: '9001' }]);
});
