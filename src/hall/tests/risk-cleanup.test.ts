import { describe, expect, it } from 'vitest';

import {
  forgetStaleSources,
  listAudit,
  purgeExpiredAudit,
  purgeExpiredBlocks,
  recordIdentity,
  upsertBlock,
  writeAudit,
} from '../risk';
import { freshSql, insertBed, rawRow } from './sqlite';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** 一条身份（三个来源列与昵称都写满），`first_seen_at` 与 `last_seen_at` 都落在 `lastSeenAt`。 */
function identitySeenAt(sql: SqlStorage, userId: string, lastSeenAt: number): void {
  recordIdentity(
    sql,
    { userId, nickname: '夜猫', ip: '1.1.1.1', country: 'CN', uaHash: '0123456789abcdef' },
    lastSeenAt,
  );
}

function identityRow(sql: SqlStorage, userId: string): Record<string, unknown> | undefined {
  return sql
    .exec(
      `SELECT user_id, nickname, first_seen_at, last_seen_at, last_ip, last_country, ua_hash
         FROM identity WHERE user_id = ?`,
      userId,
    )
    .toArray()[0];
}

function blockValues(sql: SqlStorage): string[] {
  return sql
    .exec<{ value: string }>('SELECT value FROM block ORDER BY value')
    .toArray()
    .map((row) => row.value);
}

function auditValues(sql: SqlStorage): string[] {
  return listAudit(sql, 10).map((row) => row.value);
}

describe('forgetStaleSources：只清三个来源列与昵称，绝不删行', () => {
  it('89 天无访问 → 各列仍在', () => {
    const sql = freshSql();
    identitySeenAt(sql, 'u_a', NOW - 89 * DAY);

    forgetStaleSources(sql, NOW);

    expect(identityRow(sql, 'u_a')).toEqual({
      user_id: 'u_a',
      nickname: '夜猫',
      first_seen_at: NOW - 89 * DAY,
      last_seen_at: NOW - 89 * DAY,
      last_ip: '1.1.1.1',
      last_country: 'CN',
      ua_hash: '0123456789abcdef',
    });
  });

  it('91 天无访问 → 各列（含昵称）置空，行与 user_id / first_seen_at / last_seen_at 都不变', () => {
    const sql = freshSql();
    identitySeenAt(sql, 'u_a', NOW - 91 * DAY);

    forgetStaleSources(sql, NOW);

    expect(identityRow(sql, 'u_a')).toEqual({
      user_id: 'u_a',
      nickname: null,
      first_seen_at: NOW - 91 * DAY,
      last_seen_at: NOW - 91 * DAY,
      last_ip: null,
      last_country: null,
      ua_hash: null,
    });
  });

  it('只清过期的那些行：还活跃的那条来源照留（清空是可重复执行的）', () => {
    const sql = freshSql();
    identitySeenAt(sql, 'u_stale', NOW - 91 * DAY);
    identitySeenAt(sql, 'u_live', NOW - 89 * DAY);

    forgetStaleSources(sql, NOW);
    forgetStaleSources(sql, NOW + DAY); // 第二遍没有新增可清的：不重写已经清空的行

    expect(identityRow(sql, 'u_stale')).toMatchObject({ last_ip: null, last_country: null, ua_hash: null });
    expect(identityRow(sql, 'u_live')).toMatchObject({ last_ip: '1.1.1.1', last_country: 'CN' });
  });
});

describe('purgeExpiredBlocks：到期后再留 30 天才删', () => {
  it('until_at 为空（永久封禁）→ 无论过多久都不删', () => {
    const sql = freshSql();
    upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: null, reason: '刷屏' }, NOW - 10 * 365 * DAY);

    purgeExpiredBlocks(sql, NOW);

    expect(blockValues(sql)).toEqual(['1.1.1.1']);
  });

  it('到期 29 天不删、31 天删；还没到期的那条也不受影响', () => {
    const sql = freshSql();
    upsertBlock(sql, { kind: 'user', value: 'u_29', untilAt: NOW - 29 * DAY, reason: '刷屏' }, NOW);
    upsertBlock(sql, { kind: 'ip', value: '1.1.1.1', untilAt: NOW - 31 * DAY, reason: '刷屏' }, NOW);
    upsertBlock(sql, { kind: 'user', value: 'u_future', untilAt: NOW + DAY, reason: '刷屏' }, NOW);

    purgeExpiredBlocks(sql, NOW);

    expect(blockValues(sql)).toEqual(['u_29', 'u_future']);
  });
});

describe('purgeExpiredAudit：审计留一年', () => {
  it('364 天前不删、366 天前删', () => {
    const sql = freshSql();
    writeAudit(sql, { action: 'block', kind: 'user', value: 'u_364', untilAt: null }, NOW - 364 * DAY);
    writeAudit(sql, { action: 'block', kind: 'user', value: 'u_366', untilAt: null }, NOW - 366 * DAY);

    purgeExpiredAudit(sql, NOW);

    expect(auditValues(sql)).toEqual(['u_364']);
  });
});

describe('三条清理只碰自己那张表', () => {
  it('有主床的每一列保持原样（床位行与广播都不归它们管）', () => {
    const sql = freshSql();
    insertBed(sql, 3, {
      state: 'lying',
      ownerUserId: 'u_a',
      claimedAt: NOW - 1_000,
      lastSeenAt: NOW - 91 * DAY,
      sleepStartedAt: NOW - 500,
      updatedAt: NOW - 1_000,
    });
    identitySeenAt(sql, 'u_a', NOW - 91 * DAY);
    upsertBlock(sql, { kind: 'user', value: 'u_b', untilAt: NOW - 31 * DAY, reason: '刷屏' }, NOW);
    writeAudit(sql, { action: 'block', kind: 'user', value: 'u_b', untilAt: null }, NOW - 366 * DAY);
    const bedBefore = rawRow(sql, 3);

    forgetStaleSources(sql, NOW);
    purgeExpiredBlocks(sql, NOW);
    purgeExpiredAudit(sql, NOW);

    expect(rawRow(sql, 3)).toEqual(bedBefore);
    // 三条语句都真的执行过（否则上面那条断言等于没测）
    expect(identityRow(sql, 'u_a')).toMatchObject({ last_ip: null });
    expect(blockValues(sql)).toEqual([]);
    expect(auditValues(sql)).toEqual([]);
  });

  it('空库跑一遍不炸（没人可清时三条都是空操作）', () => {
    const sql = freshSql();

    expect(() => {
      forgetStaleSources(sql, NOW);
      purgeExpiredBlocks(sql, NOW);
      purgeExpiredAudit(sql, NOW);
    }).not.toThrow();
  });
});
