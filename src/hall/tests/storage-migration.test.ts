import { expect, test, vi } from 'vitest';

// `cloudflare:workers` 只有 workerd 认识，Node 上跑单测得替掉它（与 `entry.test.ts` 同一招）。
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx: unknown, env: unknown) {
      Object.assign(this, { ctx, env });
    }
  },
}));

import { HALL_ID } from '../../shared/constants';
import { Hall } from '../hall';
import { recordIdentity } from '../risk';
import { freshSql } from './sqlite';

/** 建厅就是跑一遍 `initializeStorage`：同一份库上再来一次 = 部署之后的重启。 */
function newHall(sql: SqlStorage): Hall {
  const ctx = {
    id: { name: HALL_ID },
    storage: { sql, getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined },
    getWebSockets: () => [],
  };
  return new Hall(ctx as never, {} as never);
}

const NOW = 1_700_000_000_000;

const nicknameOf = (sql: SqlStorage, userId: string): string | null =>
  sql.exec<{ nickname: string | null }>('SELECT nickname FROM identity WHERE user_id = ?', userId).toArray()[0]
    ?.nickname ?? null;

/** `try/catch` 会连真实语法错误一起吞掉，所以补列之后必须真的写进去再读出来。 */
test('身份表补 nickname 列：旧库连跑两次不抛，之后这一列可读可写', () => {
  const sql = freshSql();
  // 模拟已部署的库：建表语句早于 nickname 这一列（`CREATE TABLE IF NOT EXISTS` 不会改它）
  sql.exec('ALTER TABLE identity DROP COLUMN nickname');

  expect(() => newHall(sql)).not.toThrow();
  recordIdentity(sql, { userId: 'u_a', nickname: '夜猫' }, NOW);
  expect(nicknameOf(sql, 'u_a')).toBe('夜猫');

  // 第二次同一个库：补列的语句必须自己吞掉「重复加列」
  expect(() => newHall(sql)).not.toThrow();
  recordIdentity(sql, { userId: 'u_b', nickname: '早睡' }, NOW + 1);
  expect(nicknameOf(sql, 'u_b')).toBe('早睡');
  expect(nicknameOf(sql, 'u_a')).toBe('夜猫');
});
