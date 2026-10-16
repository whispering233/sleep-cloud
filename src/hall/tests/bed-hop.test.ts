import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `bed-switch.test.ts` 同一招）。
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

/** 一条已握手、能收下广播的假连接（与 `bed-switch.test.ts` 同一个形状）。 */
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

/** `handleIntent` 是私有的：运行时按名字取，不为测试放宽成 public。 */
function feed(hall: Hall, ws: FakeSocket, connection: ConnectionState, message: UpstreamMessage): void {
  (
    hall as unknown as { handleIntent: (ws: WebSocket, connection: ConnectionState, m: UpstreamMessage) => void }
  ).handleIntent(ws as never, connection, message);
}

/** 一条站在 3 号床脚前、在厅里走动的连接；`bedNo` 给了就是躺在床上。 */
function connectionAt(now: number, bedNo?: number): ConnectionState {
  const spot = frontPointOf(bedNo ?? 3) as Point;
  return {
    userId: 'u_me',
    name: '夜猫',
    appearance: 'boy',
    x: spot.x,
    y: spot.y,
    state: bedNo === undefined ? 'roaming' : 'lying',
    bedNo,
    lastInputAt: now,
    ready: true,
  };
}

/** 7 号床归我（认领于 60 秒前，冷却早过）。 */
function ownBedSeven(sql: SqlStorage, now: number, state: string): void {
  insertBed(sql, 7, {
    state,
    ownerUserId: 'u_me',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });
}

test('不带床号：落在我自己那张床脚前（一条 pos，不寻路、不进移动者集合）', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  ownBedSeven(sql, now, 'empty');

  feed(hall, socket, connectionAt(now), { t: 'hop' });

  expect(socket.received.map((raw) => JSON.parse(raw) as unknown)).toEqual([
    { t: 'pos', ts: expect.any(Number), items: [['u_me', frontPointOf(7)?.x, frontPointOf(7)?.y]] },
  ]);
  const hopped = socket.deserializeAttachment() as ConnectionState;
  expect([hopped.x, hopped.y]).toEqual([frontPointOf(7)?.x, frontPointOf(7)?.y]);
  expect(hopped.target).toBeUndefined();
});

test('带床号：落到那张床脚前——那张床有主又有人占用也照样跳（与归属和占用无关）', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  // 5 号床是别人的、正躺着一个人
  insertBed(sql, 5, {
    state: 'asleep',
    ownerUserId: 'u_other',
    claimedAt: now - 60_000,
    lastSeenAt: now,
    updatedAt: now,
  });

  feed(hall, socket, connectionAt(now), { t: 'hop', bedNo: 5 });

  expect(socket.received.map((raw) => JSON.parse(raw) as unknown)).toEqual([
    { t: 'pos', ts: expect.any(Number), items: [['u_me', frontPointOf(5)?.x, frontPointOf(5)?.y]] },
  ]);
  // 跳过去只是站位：不碰那张床的占用行
  expect(rawRow(sql, 5)?.state).toBe('asleep');
});

test('床号越界（= bedCount）：静默类错误 3001，一条 pos 都没有、位置不变', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  const connection = connectionAt(now);
  const bedCount = (hall as unknown as { bedCount: () => number }).bedCount();

  feed(hall, socket, connection, { t: 'hop', bedNo: bedCount });

  expect(socket.received.map((raw) => JSON.parse(raw) as unknown)).toEqual([{ t: 'error', code: '3001' }]);
  const unchanged = socket.deserializeAttachment() as ConnectionState;
  expect([unchanged.x, unchanged.y]).toEqual([connection.x, connection.y]);
});

test('在床上发 hop：先 state(roaming)（起身、保留归属），随后才是那条 pos', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);
  ownBedSeven(sql, now, 'lying');

  feed(hall, socket, connectionAt(now, 7), { t: 'hop', bedNo: 3 });

  const sent = socket.received.map((raw) => JSON.parse(raw) as { t: string });
  expect(sent.map((message) => message.t)).toEqual(['state', 'pos']);
  expect(sent[0]).toEqual({ t: 'state', id: 'u_me', state: 'roaming', x: frontPointOf(7)?.x, y: frontPointOf(7)?.y, online: 1 });
  expect(sent[1]).toMatchObject({ items: [['u_me', frontPointOf(3)?.x, frontPointOf(3)?.y]] });
  // 起身释放占用、归属保留；跳过去落在 3 号床脚前
  expect(rawRow(sql, 7)?.state).toBe('empty');
  expect(rawRow(sql, 7)?.owner_user_id).toBe('u_me');
  const hopped = socket.deserializeAttachment() as ConnectionState;
  expect([hopped.x, hopped.y]).toEqual([frontPointOf(3)?.x, frontPointOf(3)?.y]);
  expect(hopped.state).toBe('roaming');
});

test('不带床号而我无归属：静默忽略，一条消息都没有', () => {
  const now = Date.now();
  const socket = new FakeSocket();
  const sql = freshSql();
  const hall = newHall(sql, [socket]);

  feed(hall, socket, connectionAt(now), { t: 'hop' });

  expect(socket.received).toEqual([]);
});