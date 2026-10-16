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
import type { UpstreamMessage } from '../../shared/protocol';
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

/** 同样按名字取私有的 `handleIntent`：这里测的是 `case 'lie'` 那条复合意图。 */
function feed(hall: Hall, ws: FakeSocket, connection: ConnectionState, message: UpstreamMessage): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, connection: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, connection, message);
}

/** 一条躺在床上（站姿就位在床脚前）的连接。 */
function lyingInBed(now: number, bedNo = 7): ConnectionState {
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

test('在床上点别的空床：第一条消息是 state(roaming)（自动起身），随后才走上新床', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  // 我正躺在 7 号床；3 号床没有行 = 无主空床
  insertBed(sql, 7, {
    state: 'lying',
    ownerUserId: 'u_me',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });
  const connection = lyingInBed(now);

  feed(hall, socket, connection, { t: 'lie', bedNo: 3 });

  const sent = socket.received.map((raw) => JSON.parse(raw) as { t: string });
  // 起身在前：状态先变成 `roaming`（位置还在床脚前），随后才是走上新床的那条位置
  expect(sent[0]).toEqual({
    t: 'state',
    id: 'u_me',
    state: 'roaming',
    x: connection.x,
    y: connection.y,
    online: 1,
  });
  expect(sent.map((message) => message.t)).toEqual(['state', 'pos']);
  // 旧床的占用当场释放（归属保留到躺下那一刻才释放：换床是「先释放旧床、再认领新床」）
  expect(rawRow(sql, 7)?.state).toBe('empty');
  expect(rawRow(sql, 7)?.owner_user_id).toBe('u_me');
  // 走的是「到 3 号床边躺下」这条复合意图，不是又一次拒绝
  const walked = socket.deserializeAttachment() as ConnectionState;
  expect(walked.state).toBe('roaming');
  expect(walked.target).toEqual(frontPointOf(3));
  expect(walked.arrivalAction).toBe('lie');
  expect(walked.arrivalBedNo).toBe(3);
});

test('在床上点别人的床：只收到 error 3003，一条 state 都没有（判定不通过就没白站起来）', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  insertBed(sql, 7, { state: 'lying', ownerUserId: 'u_me', claimedAt: now - 60_000, lastSeenAt: now, updatedAt: now });
  insertBed(sql, 5, {
    state: 'empty',
    ownerUserId: 'u_other',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });

  feed(hall, socket, lyingInBed(now), { t: 'lie', bedNo: 5 });

  expect(socket.received.map((raw) => JSON.parse(raw) as unknown)).toEqual([{ t: 'error', code: '3003' }]);
  // 还躺着：失败的动作不留副作用（`10-hall-runtime.md` §5.1）
  expect(rawRow(sql, 7)?.state).toBe('lying');
});