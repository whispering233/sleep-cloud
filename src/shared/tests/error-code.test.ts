import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGES } from '../error-code';
import { readDoc, tableRows } from './doc';

/** 文档里的错误码表（`docs/api/error-code.md` §2） */
const docRows = tableRows(readDoc('api/error-code.md'), '## 2. 错误码表', '## 3. 使用规则').map(
  ([code, msg]) => [code.replaceAll('"', ''), msg.replaceAll('"', '')] as const,
);

const enumEntries = Object.entries(ERROR_MESSAGES) as Array<[string, string]>;

describe('错误码表与 docs/api/error-code.md 逐条一致', () => {
  it('文档里的每个码都在枚举里，且 msg 相同', () => {
    for (const [code, msg] of docRows) {
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES], `缺少错误码 ${code}`).toBe(msg);
    }
  });

  it('枚举里没有文档之外的码', () => {
    const docCodes = new Set(docRows.map(([code]) => code));
    expect(enumEntries.map(([code]) => code).filter((code) => !docCodes.has(code))).toEqual([]);
  });

  it('两边行数相同（无漏读）', () => {
    expect(enumEntries).toHaveLength(docRows.length);
  });

  it('5xxx 风控段已预留（第一版不返回，但枚举必须存在）', () => {
    const reserved = enumEntries.filter(([code]) => code.startsWith('5'));
    expect(reserved.length).toBeGreaterThan(0);
    expect(reserved.map(([, msg]) => msg)).toContain('muted');
  });
});
