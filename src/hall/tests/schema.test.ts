import { describe, expect, it } from 'vitest';

import { readDoc, tableRows } from '../../shared/tests/doc';
import * as schema from '../schema';
import {
  ADMIN_AUDIT_TABLE_SQL,
  BED_INDEX_SQL,
  BED_TABLE_SQL,
  BLOCK_TABLE_SQL,
  IDENTITY_INDEX_SQL,
  IDENTITY_TABLE_SQL,
  META_KEYS,
  META_TABLE_SQL,
} from '../schema';

/** 文档里的 `bed` 表字段（`docs/db/schema.md` §2） */
const docFields = tableRows(readDoc('db/schema.md'), '## 2. 表：`bed`', '### 状态取值语义').map(
  ([field, required, type]) => ({
    name: (field ?? '').replaceAll('`', ''),
    required: required ?? '',
    type: (type ?? '').toUpperCase(),
  }),
);

/** 从 DDL 里取出列名与类型（按声明顺序） */
const ddlFields = [...BED_TABLE_SQL.matchAll(/^\s*(\w+)\s+(INTEGER|TEXT)/gm)].map(([, name, type]) => ({
  name: name as string,
  type: type as string,
}));

describe('床位表 DDL 与 docs/db/schema.md 一致', () => {
  it('字段逐个对齐（名称、顺序、类型）', () => {
    expect(ddlFields).toEqual(docFields.map(({ name, type }) => ({ name, type })));
  });

  it('已删 `owner_tz`（时区概念整体删除）', () => {
    expect(BED_TABLE_SQL).not.toContain('owner_tz');
    expect(docFields.map(({ name }) => name)).not.toContain('owner_tz');
  });

  it('必选字段都是 NOT NULL，可选字段都可为空', () => {
    for (const field of docFields) {
      const nullable = new RegExp(`${field.name}\\s+(INTEGER|TEXT)\\s*(,|\\n)`).test(BED_TABLE_SQL);
      expect(nullable, `${field.name} 的可空性与文档「是否必选=${field.required}」不符`).toBe(
        field.required !== '是',
      );
    }
  });

  it('三个索引都在（唯一索引保证一个用户只有一张床）', () => {
    const sql = BED_INDEX_SQL.join('\n');
    expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS bed_owner_user_id');
    expect(sql).toContain('bed_last_seen_at');
    expect(sql).toContain('bed_state');
  });

  it('惰性行：没有「预建级别容量那么多行」的补种语句', () => {
    expect(Object.keys(schema)).not.toContain('BED_SEED_SQL');
    expect(readDoc('db/schema.md')).toContain('惰性行');
  });
});

describe('meta 表与 docs/db/schema.md §3 一致', () => {
  const docKeys = tableRows(readDoc('db/schema.md'), '## 3. 表：`meta`', '## 4. 为什么不建用户表').map(
    ([key]) => (key ?? '').replaceAll('`', ''),
  );

  it('键名逐字来自文档（床位数 + 每日唤醒边界）', () => {
    expect(docKeys).toEqual(['bed_count', 'daily_wake_at']);
    expect(Object.values(META_KEYS).sort()).toEqual(['bed_count', 'daily_wake_at']);
  });

  it('没有「有主床数」这个计数（升级判据是与出生点同一个查询）', () => {
    expect(readDoc('db/schema.md')).not.toContain('owned_count');
    expect(Object.values(META_KEYS)).not.toContain('owned_count');
  });

  it('DDL 是每个 key 一行的键值表', () => {
    expect(META_TABLE_SQL).toMatch(/key TEXT PRIMARY KEY/);
    expect(META_TABLE_SQL).toMatch(/value INTEGER NOT NULL/);
  });
});

describe('风控与台账三张表与 docs/db/schema.md §4 一致', () => {
  const section = (from: string, to: string) =>
    tableRows(readDoc('db/schema.md'), from, to).map(([field, required, type]) => ({
      name: (field ?? '').replaceAll('`', ''),
      required: required ?? '',
      type: (type ?? '').toUpperCase(),
    }));

  const ddlFieldsOf = (ddl: string) =>
    [...ddl.matchAll(/^\s*(\w+)\s+(INTEGER|TEXT)/gm)].map(([, name, type]) => ({ name: name as string, type: type as string }));

  it.each([
    ['identity', IDENTITY_TABLE_SQL, '### 4.1 表：`identity`', '### 4.2 表：`block`'],
    ['block', BLOCK_TABLE_SQL, '### 4.2 表：`block`', '### 4.3 表：`admin_audit`'],
    ['admin_audit', ADMIN_AUDIT_TABLE_SQL, '### 4.3 表：`admin_audit`', '### 4.4 三张表的读写点'],
  ])('%s：字段逐个对齐（名称、顺序、类型）与可空性', (_table, ddl, from, to) => {
    // 文档里 `kind` / `value` 共用一个单元格（它们总是成对出现），DDL 里是两列
    const fields = section(from, to).flatMap(({ name, type, required }) =>
      name.split(' / ').map((part) => ({ name: part, type, required })),
    );
    expect(ddlFieldsOf(ddl)).toEqual(fields.map(({ name, type }) => ({ name, type })));
    for (const field of fields) {
      const nullable = new RegExp(`^\\s*${field.name}\\s+(INTEGER|TEXT)\\s*(,|$)`, 'm').test(ddl);
      expect(nullable, `${field.name} 的可空性与文档「是否必选=${field.required}」不符`).toBe(field.required !== '是');
    }
  });

  it('索引与主键：identity 两个索引，block 的联合主键就是判定路径', () => {
    const indexes = IDENTITY_INDEX_SQL.join('\n');
    expect(indexes).toContain('identity_last_ip');
    expect(indexes).toContain('identity_last_seen_at');
    expect(BLOCK_TABLE_SQL).toContain('PRIMARY KEY (kind, value)');
    expect(ADMIN_AUDIT_TABLE_SQL).toContain('id INTEGER PRIMARY KEY');
  });
});