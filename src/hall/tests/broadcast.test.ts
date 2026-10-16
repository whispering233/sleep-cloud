import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它。基类不做别的，只把平台注入的 `ctx` / `env` 挂上去。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { HALL_ID } from '../../shared/constants';
import type { DownstreamMessage } from '../../shared/protocol';
import { Hall } from '../hall';
import { freshSql } from './sqlite';

/**
 * 广播出站守卫（`Hall.send`）：一条已经关掉的连接不能打断整次广播。
 *
 * 假 socket 只实现被用到的那三件事：报 `readyState`、给 `readConnection` 一份附加数据、收下 `send`。
 */
class FakeSocket {
  readonly received: string[] = [];
  sendCalls = 0;

  constructor(readonly readyState = 1) {}

  /** 生产里这里是「一条已握手连接」的附加数据；守卫不读它的内容以外的字段。 */
  deserializeAttachment(): unknown {
    return { ready: true };
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

function newHall(sockets: FakeSocket[]): Hall {
  const ctx = {
    id: { name: HALL_ID }, // 构造函数会校验厅标识并建表，两项都得给
    storage: { sql: freshSql() },
    getWebSockets: () => sockets,
  };
  return new Hall(ctx as never, {} as never);
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
