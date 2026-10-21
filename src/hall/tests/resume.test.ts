import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `broadcast.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { BED_OWNERSHIP_TTL_MS, HALL_ID } from '../../shared/constants';
import { frontPointOf } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import type { DownstreamMessage } from '../../shared/protocol';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql, insertBed, rawRow } from './sqlite';

/** 别人那条连接：只实现广播需要的那三件事（与 `broadcast.test.ts` 同一个形状）。 */
class FakeSocket {
  readonly received: string[] = [];
  private attachment: unknown = { ready: true, userId: 'u_other', name: '旁观者', appearance: 'boy' };

  constructor(readonly readyState = 1) {}

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(payload: string): void {
    this.received.push(payload);
  }

  /** 广播只读附加数据，不写；留着只为形状完整 */
  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }
}

/**
 * 重连恢复（`10-hall-runtime.md` §6、§13）：**床位行是唯一权威**——行上的状态原样还原，
 * 行本是睡痕的还原成睡着并广播一次。没行的人才按归属站床脚、或落到最小可认领床。
 */
function newHall(sockets: FakeSocket[] = []): { hall: Hall; sql: SqlStorage } {
  const sql = freshSql();
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql },
    getWebSockets: () => sockets,
  };
  return { hall: new Hall(ctx as never, {} as never), sql };
}

/** 一条刚建好、还没握手的连接（位置是握手时的占位点）。 */
function connection(userId = 'u_me'): ConnectionState {
  return {
    userId,
    name: '夜猫',
    appearance: 'boy',
    x: 0,
    y: 0,
    state: 'roaming',
    lastInputAt: 0,
    ready: false,
  };
}

/** `resumeSession` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function resume(hall: Hall, me: ConnectionState): ConnectionState | undefined {
  return (hall as unknown as { resumeSession: (c: ConnectionState) => ConnectionState | undefined }).resumeSession(me);
}

function point(spot: Point | undefined): { x: number; y: number } {
  return { x: (spot as Point).x, y: (spot as Point).y };
}

test('我的床归属未过期：落在自己床脚前，且不占床、不写床位行', () => {
  const { hall, sql } = newHall();
  insertBed(sql, 42, { state: 'empty', ownerUserId: 'u_me', lastSeenAt: Date.now(), updatedAt: Date.now() });

  const resumed = resume(hall, connection());

  expect(resumed).toBeDefined();
  expect({ x: (resumed as ConnectionState).x, y: (resumed as ConnectionState).y }).toEqual(point(frontPointOf(42)));
  expect((resumed as ConnectionState).state).toBe('roaming');
  expect((resumed as ConnectionState).bedNo).toBeUndefined();
  // 站位不是上床：那张床仍是一条 `empty` 的有主行（`last_seen_at` 没被这次入场改写）
  expect(rawRow(sql, 42)?.state).toBe('empty');
});

test('我的床归属已过期：落到最小可认领床，不是过期那张', () => {
  const { hall, sql } = newHall();
  const now = Date.now();
  insertBed(sql, 5, { state: 'empty', ownerUserId: 'u_me', lastSeenAt: now - BED_OWNERSHIP_TTL_MS - 1, updatedAt: now });

  const resumed = resume(hall, connection()) as ConnectionState;

  // 没有别的行 → 最小可认领床是 0 号，过期归属的那张（5 号）不算可认领但也不是我的床
  expect({ x: resumed.x, y: resumed.y }).toEqual(point(frontPointOf(0)));
  expect({ x: resumed.x, y: resumed.y }).not.toEqual(point(frontPointOf(5)));
  expect(resumed.state).toBe('roaming');
});

test('宽限内重连（床上睁眼躺着）：状态原样是 lying', () => {
  const { hall, sql } = newHall();
  const now = Date.now();
  insertBed(sql, 2, { state: 'lying', ownerUserId: 'u_me', lastSeenAt: now - 1000, updatedAt: now - 1000 });

  const resumed = resume(hall, connection()) as ConnectionState;

  expect(resumed.state).toBe('lying');
  expect(resumed.bedNo).toBe(2);
});

test('归属已过期但行仍占着：按新人处理，落到出生点（不拿过期行续命）', () => {
  const { hall, sql } = newHall();
  const now = Date.now();
  insertBed(sql, 5, { state: 'asleep', ownerUserId: 'u_me', lastSeenAt: now - BED_OWNERSHIP_TTL_MS - 1, updatedAt: now });

  const resumed = resume(hall, connection()) as ConnectionState;

  expect(resumed.state).toBe('roaming');
  expect(resumed.bedNo).toBeUndefined();
  expect(rawRow(sql, 5)?.state).toBe('asleep'); // 行不动：清理由每日唤醒做
});

test('宽限内重连（床上睡着）：状态原样是 asleep，不退成 lying，也不广播', () => {
  const watcher = new FakeSocket();
  const { hall, sql } = newHall([watcher]);
  const now = Date.now();
  insertBed(sql, 3, { state: 'asleep', ownerUserId: 'u_me', lastSeenAt: now - 1000, updatedAt: now - 1000 });

  const resumed = resume(hall, connection()) as ConnectionState;

  expect(resumed.state).toBe('asleep');
  expect(resumed.bedNo).toBe(3);
  expect({ x: resumed.x, y: resumed.y }).toEqual(point(frontPointOf(3)));
  expect(rawRow(sql, 3)?.state).toBe('asleep'); // 行不变色：睡眠不因一次重连丢掉
  expect(watcher.received).toEqual([]); // 别人的画面上本来就是睡着的他：没有可播的变化
});

test('宽限已过重连（睡痕行）：回来是睡着，且推一次 state 广播', () => {
  const watcher = new FakeSocket();
  const { hall, sql } = newHall([watcher]);
  const now = Date.now();
  insertBed(sql, 7, { state: 'trace', ownerUserId: 'u_me', lastSeenAt: now - 120_000, updatedAt: now - 60_000 });

  const resumed = resume(hall, connection()) as ConnectionState;

  expect(resumed.state).toBe('asleep');
  expect(resumed.bedNo).toBe(7);
  expect({ x: resumed.x, y: resumed.y }).toEqual(point(frontPointOf(7)));
  expect(rawRow(sql, 7)).toMatchObject({
    state: 'asleep', // 睡痕恢复 = 睡着的还原（`docs/db/schema.md` §7）
    owner_user_id: 'u_me', // 归属不动
    sleep_started_at: now, // 睡眠起点从「回来这一刻」重算（否则 dwellMs 会含离线那段）
  });
  expect(watcher.received).toHaveLength(1);
  const message = JSON.parse(watcher.received[0] as string) as DownstreamMessage;
  expect(message).toMatchObject({ t: 'state', id: 'u_me', state: 'asleep', bedNo: 7 }); // 别人那边本是暗的
});
