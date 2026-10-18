import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `bed-switch.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { HALL_ID } from '../../shared/constants';
import { streetPointAt } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import { advanceMover, moverPosition } from '../../shared/movement';
import type { MoverState } from '../../shared/movement';
import type { UpstreamMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql } from './sqlite';

/** 一条先横后竖的折线（街网路径本来就只有轴对齐的段）。 */
function mover(path: Array<{ x: number; y: number }>): MoverState {
  return { x: 0, y: 0, path };
}

describe('按实际经过的时间推进（不是按拍数，也不量化到格）', () => {
  it('位置是连续像素：100ms 走 22px，不是整格', () => {
    const state = mover([{ x: 130, y: 0 }]);
    expect(advanceMover(state, 100)).toEqual({ moved: true, arrived: false });
    expect(moverPosition(state)).toEqual({ x: 22, y: 0 });
  });

  it('节拍抖动不影响速度：把同样的总时长拆成多拍，位移一致', () => {
    const jittery = mover([{ x: 220, y: 0 }]);
    for (const elapsed of [30, 70, 10, 90, 5, 145, 100, 250, 300]) {
      advanceMover(jittery, elapsed);
    }
    expect(moverPosition(jittery)).toEqual({ x: 220, y: 0 }); // 合计 1000ms × 220px/s

    const steady = mover([{ x: 220, y: 0 }]);
    advanceMover(steady, 1000);
    expect(moverPosition(steady)).toEqual({ x: 220, y: 0 });
  });

  it('事件循环被阻塞一大截：一次性补齐，速度不变（并且不会越过途经点）', () => {
    const blocked = mover([
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ]);
    const result = advanceMover(blocked, 1000); // 220px：先走完 100，再走 120
    expect(result).toEqual({ moved: true, arrived: false });
    expect(moverPosition(blocked)).toEqual({ x: 100, y: 120 });
  });

  it('走完整条折线就到达，且不再多走（没有残留的“本格进度”）', () => {
    const state = mover([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(advanceMover(state, 10_000)).toEqual({ moved: true, arrived: true });
    expect(moverPosition(state)).toEqual({ x: 50, y: 50 });
    expect(state.path).toEqual([]);
    expect(advanceMover(state, 10_000)).toEqual({ moved: false, arrived: true });
  });

  it('刚好走完的边界不算“到达前一刻”', () => {
    const state = mover([{ x: 22, y: 0 }]);
    expect(advanceMover(state, 100)).toEqual({ moved: true, arrived: true });
  });

  it('负数或零时长不动（时钟回拨之类的防御）', () => {
    const state = mover([{ x: 130, y: 0 }]);
    expect(advanceMover(state, 0)).toEqual({ moved: false, arrived: false });
    expect(advanceMover(state, -500)).toEqual({ moved: false, arrived: false });
    expect(moverPosition(state)).toEqual({ x: 0, y: 0 });
  });

  it('空路径：原地不动，且立刻算「到达」（复合意图的“原地躺下”靠它）', () => {
    const state = mover([]);
    expect(advanceMover(state, 1000)).toEqual({ moved: false, arrived: true });
    expect(moverPosition(state)).toEqual({ x: 0, y: 0 });
  });

  it('速度是显式参数（默认 220px/s），单位是「世界像素/秒」', () => {
    const state = mover([{ x: 1000, y: 0 }]);
    advanceMover(state, 1000, 500);
    expect(moverPosition(state)).toEqual({ x: 500, y: 0 });
  });

  it('位置允许小数（半像素）：客户端按服务端时间戳插值，不按格号', () => {
    const state = mover([{ x: 61, y: 0 }]);
    advanceMover(state, 75); // 16.5px
    expect(moverPosition(state)).toEqual({ x: 16.5, y: 0 });
  });
});
/** 一条已握手、能收下广播的假连接（与 `bed-hop.test.ts` 同一个形状）。 */
class FakeSocket {
  readonly received: string[] = [];
  readonly readyState = 1;
  private attachment: unknown;

  constructor(connection: ConnectionState) {
    this.attachment = connection;
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

  get connection(): ConnectionState {
    return this.attachment as ConnectionState;
  }
}

function newHall(sockets: FakeSocket[]): Hall {
  const ctx = {
    id: { name: HALL_ID },
    storage: {
      sql: freshSql(),
      getAlarm: async () => null,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    getWebSockets: () => sockets,
  };
  return new Hall(ctx as never, {} as never);
}

function standAt(userId: string, at: Point): ConnectionState {
  return {
    userId,
    name: '夜猫',
    appearance: 'boy',
    x: at.x,
    y: at.y,
    state: 'roaming',
    lastInputAt: Date.now(),
    ready: true,
  };
}

/** 走「我要去这个世界像素点」：路径由服务端算（与真实链路同一条）。 */
function walk(hall: Hall, ws: FakeSocket, target: Point): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, c: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, ws.connection, { t: 'walk', x: target.x, y: target.y });
}

/** 这条连接收到的所有关于某人的位置（`pos` 一批一条，按到达顺序）。 */
function positionsIn(ws: FakeSocket, userId: string): Point[] {
  return ws.received
    .map((raw) => JSON.parse(raw) as { t: string; items?: Array<[string, number, number]> })
    .flatMap((message) => message.items ?? [])
    .filter(([id]) => id === userId)
    .map(([, x, y]) => ({ x, y }));
}

function lastPosition(ws: FakeSocket, userId: string): Point {
  return positionsIn(ws, userId).at(-1) as Point;
}

describe('节拍已在跑时新起步的人不补走一拍', () => {
  // 0 号床脚前那条横走道的左端（街网节点）与远/近两个目标点：都在同一条走道上，路径就是一条直线段
  const START: Point = streetPointAt(0, 0, 9);
  const FAR: Point = streetPointAt(0, 12, 9); // 2076px：够走好几秒
  const NEAR: Point = streetPointAt(0, 1, 9); // 173px：约 787ms 就到

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('一拍已过 80ms 时新增的移动者只走 20ms（4.4px），既有移动者照旧走 22px', () => {
    const a = new FakeSocket(standAt('u_a', START));
    const b = new FakeSocket(standAt('u_b', START));
    const hall = newHall([a, b]);

    walk(hall, a, FAR); // t=0：A 起步，节拍从此刻开始
    vi.advanceTimersByTime(80); // t=80：这一拍还没到
    walk(hall, b, FAR); // B 此刻才起步

    vi.advanceTimersByTime(20); // t=100：唯一的一次节拍

    expect(lastPosition(a, 'u_a')).toEqual({ x: START.x + 22, y: START.y });
    expect(lastPosition(a, 'u_b').x).toBeCloseTo(START.x + 4.4, 6);
  });

  it('短路径跑到终点：正好停在终点，不越界', () => {
    const a = new FakeSocket(standAt('u_a', START));
    const hall = newHall([a]);

    walk(hall, a, NEAR);
    vi.advanceTimersByTime(2000);

    expect(lastPosition(a, 'u_a')).toEqual(NEAR);
    expect(positionsIn(a, 'u_a').every((point) => point.x <= NEAR.x)).toBe(true);
  });

  it('移除后同一用户再走一次，不带上一次的起步时刻', () => {
    const a = new FakeSocket(standAt('u_a', START));
    const b = new FakeSocket(standAt('u_b', START)); // 让别人一直走着：循环不停，`lastTickAt` 才不会重置
    const hall = newHall([a, b]);

    walk(hall, a, FAR);
    walk(hall, b, FAR);
    vi.advanceTimersByTime(100); // t=100：A 走到 x=50
    expect(lastPosition(a, 'u_a').x).toBe(START.x + 22);

    vi.advanceTimersByTime(50); // t=150
    walk(hall, a, { x: START.x + 22, y: START.y }); // 目标就是当前点 = 停止走动（移除移动者）
    expect(lastPosition(a, 'u_a')).toEqual({ x: START.x + 22, y: START.y });

    vi.advanceTimersByTime(10); // t=160
    walk(hall, a, FAR); // 同一用户再走一次，此刻才是新的起步时刻

    vi.advanceTimersByTime(40); // t=200：这一拍只该推进 40ms
    expect(lastPosition(a, 'u_a').x).toBeCloseTo(START.x + 22 + 8.8, 6);
  });
});
