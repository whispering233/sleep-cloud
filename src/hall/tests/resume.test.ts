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
import type { ConnectionState } from '../connection';
import { Hall } from '../hall';
import { freshSql, insertBed, rawRow } from './sqlite';

/**
 * 出生点（`10-hall-runtime.md` §9）：已有归属的人落在**自己床脚前**，
 * 已有睡痕的人回床上躺着，都没有的人才落到最小可认领床。
 */
function newHall(): { hall: Hall; sql: SqlStorage } {
  const sql = freshSql();
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql },
    getWebSockets: () => [],
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

test('我有睡痕：仍回床上躺着（既有分支的回归）', () => {
  const { hall, sql } = newHall();
  const now = Date.now();
  insertBed(sql, 7, { state: 'trace', ownerUserId: 'u_me', lastSeenAt: now, updatedAt: now });

  const resumed = resume(hall, connection()) as ConnectionState;

  expect(resumed.state).toBe('lying');
  expect(resumed.bedNo).toBe(7);
  expect({ x: resumed.x, y: resumed.y }).toEqual(point(frontPointOf(7)));
  expect(rawRow(sql, 7)?.state).toBe('lying'); // 睡痕恢复照样落库
});