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
import { frontPointOf } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql, insertBed, rawRow } from './sqlite';

/** 一条已握手、能收下广播的假连接（与 `broadcast.test.ts` 同一个形状，另加附件读写）。 */
class FakeSocket {
  readonly received: string[] = [];
  readonly readyState = 1;
  private attachment: unknown = { ready: true };

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  send(payload: string): void {
    this.received.push(payload);
  }
}

function newHall(sql: SqlStorage, sockets: FakeSocket[]): Hall {
  const ctx = {
    id: { name: HALL_ID },
    storage: {
      sql,
      getAlarm: async () => null,
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    getWebSockets: () => sockets,
  };
  return new Hall(ctx as never, {} as never);
}

/** `lieDown` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function lieDown(hall: Hall, ws: FakeSocket, connection: ConnectionState, bedNo: number): void {
  (
    hall as unknown as { lieDown: (ws: WebSocket, connection: ConnectionState, bedNo: number) => void }
  ).lieDown(ws as never, connection, bedNo);
}

test('换床：旧床当场释放、新床认领，广播顺序 = 旧床(owned:false) → 新床(owned:true) → state', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  // 我名下 7 号床，认领于 60 秒前（冷却早过）；3 号床没有行 = 无主空床
  insertBed(sql, 7, {
    state: 'empty',
    ownerUserId: 'u_me',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });
  const spot = frontPointOf(3) as Point;
  const connection: ConnectionState = {
    userId: 'u_me',
    name: '夜猫',
    appearance: 'boy',
    x: spot.x,
    y: spot.y,
    state: 'roaming',
    lastInputAt: now,
    ready: true,
  };

  lieDown(hall, socket, connection, 3);

  // 释放必须走在认领之前：否则客户端会瞬时持有两张有主床（`api/20-api-ws.md` §4.5）
  expect(socket.received.map((raw) => JSON.parse(raw) as unknown)).toEqual([
    { t: 'bed', bedNo: 7, owned: false },
    { t: 'bed', bedNo: 3, owned: true },
    { t: 'state', id: 'u_me', state: 'lying', bedNo: 3, online: 1 },
  ]);
  // 同一个事务的两半都落地：旧床归属被清、新床有主
  expect(rawRow(sql, 7)?.owner_user_id).toBeNull();
  expect(rawRow(sql, 3)?.owner_user_id).toBe('u_me');
});