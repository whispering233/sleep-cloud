import { afterEach, describe, expect, it, vi } from 'vitest';

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
 * 活动声明 `act`（见 `docs/design/140-games-page.md` §6）：
 * 它不进任何业务判定，变化时复用一条 `state` 报文发给所有人（含本人）。
 */
class FakeSocket {
  readonly received: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  readyState = 1;
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
    this.received.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = 3;
  }
}

function newHall(sockets: FakeSocket[]): Hall {
  const ctx = {
    id: { name: HALL_ID }, // 构造函数会校验厅标识并建表，两项都得给
    storage: {
      sql: freshSql(),
      getAlarm: async () => null,
      setAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
    },
    getWebSockets: () => sockets,
  };
  return new Hall(ctx as never, {} as never);
}

/** 一条站在厅里、已握手的连接（`act` 的判定不碰几何，占位坐标够用）。 */
function handshook(userId: string, lastInputAt: number, extra: Partial<ConnectionState> = {}): ConnectionState {
  return {
    userId,
    name: userId,
    appearance: 'boy',
    x: 0,
    y: 0,
    state: 'roaming',
    lastInputAt,
    ready: true,
    ...extra,
  };
}

/** `handleIntent` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function feed(hall: Hall, ws: FakeSocket, connection: ConnectionState, message: UpstreamMessage): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, connection: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, connection, message);
}

function act(act: unknown): UpstreamMessage {
  return { t: 'act', act } as UpstreamMessage;
}

const parsed = (ws: FakeSocket): DownstreamMessage[] =>
  ws.received.map((raw) => JSON.parse(raw) as DownstreamMessage);

afterEach(() => {
  vi.useRealTimers();
});

describe('act：活动声明（docs/design/140-games-page.md §6）', () => {
  it("'game' → 附加数据记住，state 报文发给所有人（含本人）并带 act", () => {
    const me = new FakeSocket(handshook('u_me', 1000));
    const other = new FakeSocket(handshook('u_other', 1000));
    const hall = newHall([me, other]);
    const connection = me.deserializeAttachment() as ConnectionState;

    feed(hall, me, connection, act('game'));

    const state = {
      t: 'state',
      id: 'u_me',
      name: 'u_me',
      appearance: 'boy',
      state: 'roaming',
      x: 0,
      y: 0,
      online: 2,
      act: 'game',
    };
    expect(parsed(me)).toEqual([state]);
    expect(parsed(other)).toEqual([state]); // 别人也看得见，否则后缀无从画
    const after = me.deserializeAttachment() as ConnectionState;
    expect(after.act).toBe('game');
    // 与 `state` 正交：不刷新 `lastInputAt`（它不影响睡眠），也不碰位置与占用
    expect(after.lastInputAt).toBe(1000);
    expect({ x: after.x, y: after.y, state: after.state, bedNo: after.bedNo }).toEqual({
      x: 0,
      y: 0,
      state: 'roaming',
      bedNo: undefined,
    });
  });

  it("'hall' → 字段消失：附加数据与报文里都没有 act", () => {
    const me = new FakeSocket(handshook('u_me', 1000, { act: 'game' }));
    const hall = newHall([me]);
    feed(hall, me, me.deserializeAttachment() as ConnectionState, act('hall'));

    const after = me.deserializeAttachment() as ConnectionState;
    expect(Object.hasOwn(after, 'act')).toBe(false);
    const [state] = parsed(me);
    expect(Object.hasOwn(state as object, 'act')).toBe(false);
  });

  it('非法值被静默忽略：零下行、附加数据不变、连接不断', () => {
    const me = new FakeSocket(handshook('u_me', 1000));
    const hall = newHall([me]);

    feed(hall, me, me.deserializeAttachment() as ConnectionState, act('sleeping'));

    expect(me.received).toEqual([]); // 不回错误码
    expect(me.closed).toEqual([]); // 也不断线
    expect(me.deserializeAttachment()).toEqual(handshook('u_me', 1000));
  });

  it('与业务意图共用 5 条/秒窗口：第 6 条静默丢弃（不回 4002）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // 冻住时间：6 条 act 全落在同一个 1 秒窗口里
    const me = new FakeSocket(handshook('u_me', 1000));
    const hall = newHall([me]);

    for (let i = 0; i < 6; i += 1) feed(hall, me, me.deserializeAttachment() as ConnectionState, act('game'));

    expect(parsed(me)).toHaveLength(5);
    expect(parsed(me).every((message) => message.t === 'state')).toBe(true);
  });
});
