import { describe, expect, it } from 'vitest';

import { readDoc, tableRows } from '../../shared/tests/doc';
import * as schema from '../schema';
import { BED_INDEX_SQL, BED_TABLE_SQL, META_KEYS, META_TABLE_SQL } from '../schema';

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