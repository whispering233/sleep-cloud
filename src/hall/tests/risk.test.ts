import { describe, expect, it } from 'vitest';

import {
  blockStateOf,
  listAudit,
  listBlocks,
  recordIdentity,
  removeBlock,
  upsertBlock,
  writeAudit,
} from '../risk';
import { freshSql } from './sqlite';

const NOW = 1_700_000_000_000;

/** 一张只含单条封禁的库（每次新建：判定不依赖跨用例的共享状态）。 */
function blockedSql(kind: 'user' | 'ip', value: string, untilAt: number | null): SqlStorage {
  const sql = freshSql();
  upsertBlock(sql, { kind, value, untilAt, reason: '刷屏' }, NOW);
  return sql;
}

describe('blockStateOf：两种维度任一命中取更严的那条', () => {
  it('没有记录 → 不封', () => {
    expect(blockStateOf(freshSql(), { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toBeNull();
  });

  it('user 维度：永久 / 未到期 / 已到期', () => {
    expect(blockStateOf(blockedSql('user', 'u_a', null), { userId: 'u_a' }, NOW)).toEqual({
      kind: 'user',
      untilAt: null,
    });
    expect(blockStateOf(blockedSql('user', 'u_a', NOW + 60_000), { userId: 'u_a' }, NOW)).toEqual({
      kind: 'user',
      untilAt: NOW + 60_000,
    });
    // `until_at > now` 才算生效：正好到点就是「已到期」
    expect(blockStateOf(blockedSql('user', 'u_a', NOW), { userId: 'u_a' }, NOW)).toBeNull();
    expect(blockStateOf(blockedSql('user', 'u_a', NOW - 1), { userId: 'u_a' }, NOW)).toBeNull();
  });

  it('ip 维度：永久 / 未到期 / 已到期', () => {
    expect(blockStateOf(blockedSql('ip', '1.1.1.1', null), { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toEqual({
      kind: 'ip',
      untilAt: null,
    });
    expect(blockStateOf(blockedSql('ip', '1.1.1.1', NOW + 60_000), { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toEqual({
      kind: 'ip',
      untilAt: NOW + 60_000,
    });
    expect(blockStateOf(blockedSql('ip', '1.1.1.1', NOW - 1), { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toBeNull();
  });

  it('来源未知（拿不到 IP）时跳过 ip 维度，user 维度照判', () => {
    const sql = blockedSql('ip', '1.1.1.1', null);
    expect(blockStateOf(sql, { userId: 'u_a' }, NOW)).toBeNull();
    // 后半句要有断言，否则这个用例只证明了「ip 维度没命中」
    upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: null, reason: '刷屏' }, NOW);
    expect(blockStateOf(sql, { userId: 'u_a' }, NOW)).toEqual({ kind: 'user', untilAt: null });
  });

  it('两个维度都命中时取更严的：永久 > 更晚到期 > 更早到期', () => {
    const sql = freshSql();
    upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: NOW + 1_000, reason: '刷屏' }, NOW);
    upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: NOW + 60_000, reason: '刷屏' }, NOW);
    expect(blockStateOf(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toEqual({ kind: 'ip', untilAt: NOW + 60_000 });

    upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: null, reason: '改判为永久' }, NOW + 1);
    expect(blockStateOf(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW)).toEqual({ kind: 'user', untilAt: null });
  });
});

describe('recordIdentity：入场台账 UPSERT', () => {
  const identityRows = (sql: SqlStorage) =>
    sql
      .exec<{ [key: string]: string | number | null }>(
        'SELECT user_id, first_seen_at, last_seen_at, last_ip, last_country, ua_hash FROM identity ORDER BY user_id',
      )
      .toArray();

  it('新行：首见与最近一见都是此刻，来源三项照写', () => {
    const sql = freshSql();
    recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1', country: 'CN', uaHash: '0123456789abcdef' }, NOW);

    expect(identityRows(sql)).toEqual([
      {
        user_id: 'u_a',
        first_seen_at: NOW,
        last_seen_at: NOW,
        last_ip: '1.1.1.1',
        last_country: 'CN',
        ua_hash: '0123456789abcdef',
      },
    ]);
  });

  it('同一个 user 换 IP：首见不动，最近一见与来源刷新', () => {
    const sql = freshSql();
    recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1', country: 'CN', uaHash: 'a' }, NOW);
    recordIdentity(sql, { userId: 'u_a', ip: '2.2.2.2', country: 'JP', uaHash: 'b' }, NOW + 1_000);

    expect(identityRows(sql)).toEqual([
      {
        user_id: 'u_a',
        first_seen_at: NOW,
        last_seen_at: NOW + 1_000,
        last_ip: '2.2.2.2',
        last_country: 'JP',
        ua_hash: 'b',
      },
    ]);
  });

  it('同一 IP 两个 user：一行一人，互不覆盖', () => {
    const sql = freshSql();
    recordIdentity(sql, { userId: 'u_a', ip: '1.1.1.1' }, NOW);
    recordIdentity(sql, { userId: 'u_b', ip: '1.1.1.1' }, NOW + 1);

    expect(identityRows(sql).map((row) => row.user_id)).toEqual(['u_a', 'u_b']);
    expect(identityRows(sql).map((row) => row.last_ip)).toEqual(['1.1.1.1', '1.1.1.1']);
  });

  it('来源未知时写 null（与 90 天留存期清空同一种空值语义）', () => {
    const sql = freshSql();
    recordIdentity(sql, { userId: 'u_a' }, NOW);
    expect(identityRows(sql)[0]).toMatchObject({ last_ip: null, last_country: null, ua_hash: null });
  });
});

describe('黑名单与审计的单行读写', () => {
  it('upsertBlock 覆盖同一 (kind, value)，并刷新 created_at', () => {
    const sql = freshSql();
    upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: NOW + 1, reason: '刷屏' }, NOW);
    upsertBlock(sql, { kind: 'user', value: 'u_a', untilAt: null, reason: '改判' }, NOW + 1);

    expect(listBlocks(sql)).toEqual([{ kind: 'user', value: 'u_a', untilAt: null, reason: '改判', createdAt: NOW + 1 }]);
  });

  it('removeBlock：删到返回 true，重复删返回 false', () => {
    const sql = freshSql();
    upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '刷屏' }, NOW);

    expect(removeBlock(sql, 'ip', '1.1.1.1')).toBe(true);
    expect(removeBlock(sql, 'ip', '1.1.1.1')).toBe(false);
    expect(listBlocks(sql)).toEqual([]);
  });

  it('审计只写不改：倒序取前 limit 条，actor 恒为 admin', () => {
    const sql = freshSql();
    writeAudit(sql, { action: 'block', kind: 'user', value: 'u_a', untilAt: null, reason: '刷屏' }, NOW);
    writeAudit(sql, { action: 'unblock', kind: 'user', value: 'u_a', untilAt: null }, NOW + 1);

    expect(listAudit(sql, 10).map(({ action, actor, reason }) => ({ action, actor, reason }))).toEqual([
      { action: 'unblock', actor: 'admin', reason: null },
      { action: 'block', actor: 'admin', reason: '刷屏' },
    ]);
    expect(listAudit(sql, 1)).toHaveLength(1);
  });
});
