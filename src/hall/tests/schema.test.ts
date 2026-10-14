import { describe, expect, it } from 'vitest';

import { readDoc, tableRows } from '../../shared/tests/doc';
import { BED_INDEX_SQL, BED_SEED_SQL, BED_TABLE_SQL } from '../schema';

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

  it('补行语句是幂等写法（OR IGNORE + 主键）', () => {
    expect(BED_SEED_SQL).toContain('INSERT OR IGNORE INTO bed');
    expect(BED_SEED_SQL).toContain('RECURSIVE');
  });
});
