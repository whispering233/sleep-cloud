import { describe, expect, it } from 'vitest';

import { HALL_LEVELS } from '../layout';
import { APPEARANCES, DOWNSTREAM_TYPES, EMOTE_IDS, UPSTREAM_TYPES, decodeOwnedBeds, encodeOwnedBeds } from '../protocol';
import { readDoc, tableRows } from './doc';

const wsDoc = readDoc('api/20-api-ws.md');

/** 抽出某段落里第一个表格首列的消息名（首列形如 `` `walk` ``，可为粗体 `` **`bed`** ``）。 */
function messageNames(from: string, to: string): string[] {
  return tableRows(wsDoc, from, to)
    .map(([first]) => first.replaceAll(/[`*]/g, ''))
    .filter((name) => /^[a-z]+$/.test(name));
}

const docUpstream = messageNames('## 3. 上行消息', '## 4. 下行消息');
const docDownstream = messageNames('## 4. 下行消息', '### 4.1');

describe('协议类型覆盖 docs/api/20-api-ws.md 的全部消息', () => {
  it('上行消息与文档一致（8 种）', () => {
    expect(docUpstream).toEqual(['hello', 'walk', 'lie', 'rise', 'sleep', 'chat', 'whisper', 'emote']);
    expect([...UPSTREAM_TYPES]).toEqual(docUpstream);
  });

  it('下行消息与文档一致（11 种，含 resize）', () => {
    expect(docDownstream).toEqual([
      'snapshot',
      'join',
      'leave',
      'state',
      'pos',
      'bed',
      'resize',
      'chat',
      'whisper',
      'emote',
      'error',
    ]);
    expect([...DOWNSTREAM_TYPES]).toEqual(docDownstream);
  });
});

describe('枚举取值与 docs/api/20-api-ws.md §3.1 一致', () => {
  /** `### 3.1 枚举值` 表格的第二列（形如 `` `wave` / `zzz` ``）→ 取值数组。 */
  function enumValues(key: string): string[] {
    const row = tableRows(wsDoc, '### 3.1 枚举值', '## 4. 下行消息').find(([first]) =>
      (first ?? '').replaceAll('`', '').endsWith(key),
    );
    if (!row) throw new Error(`文档里找不到枚举：${key}`);
    return (row[1] ?? '').split('/').map((value) => value.trim().replaceAll('`', ''));
  }

  it('外观是 `boy` / `girl`（由 user_id 派生）', () => {
    expect(enumValues('appearance')).toEqual(['boy', 'girl']);
    expect([...APPEARANCES]).toEqual(enumValues('appearance'));
  });

  it('表情枚举与文档一致', () => {
    expect(enumValues('emote.id')).toEqual(['wave', 'zzz', 'heart', 'cry', 'hug']);
    expect([...EMOTE_IDS]).toEqual(enumValues('emote.id'));
  });
});

describe('归属位图（docs/api/20-api-ws.md §4.2）', () => {
  it('第 bedNo 位为 1；字节数 = ceil(bedCount/8)', () => {
    const first = (HALL_LEVELS[0] as { capacity: number }).capacity;
    const encoded = encodeOwnedBeds([0, 7, 8], first);
    expect(atob(encoded)).toHaveLength(Math.ceil(first / 8));
    expect(decodeOwnedBeds(encoded, first)).toEqual([0, 7, 8]);
  });

  it('跨字节与容量顶端的边界都对（第 1 档的最后一床是 first−1；末档的最后一床是 top−1）', () => {
    const first = (HALL_LEVELS[0] as { capacity: number }).capacity;
    const top = (HALL_LEVELS[HALL_LEVELS.length - 1] as { capacity: number }).capacity;
    expect(decodeOwnedBeds(encodeOwnedBeds([first - 2, first - 1], first), first)).toEqual([first - 2, first - 1]);
    expect(decodeOwnedBeds(encodeOwnedBeds([top - 1], top), top)).toEqual([top - 1]);
    // 位图只编码到 bedCount−1：超出的位一律丢掉
    expect(decodeOwnedBeds(encodeOwnedBeds([top], top), top)).toEqual([]);
    expect(decodeOwnedBeds(encodeOwnedBeds([200], first), first)).toEqual([]);
  });

  it('空集合也编成固定长度：升级新增的位天然都是 0，不需要服务端补', () => {
    const top = (HALL_LEVELS[HALL_LEVELS.length - 1] as { capacity: number }).capacity;
    const encoded = encodeOwnedBeds([], top);
    expect(atob(encoded)).toHaveLength(Math.ceil(top / 8));
    expect(decodeOwnedBeds(encoded, top)).toEqual([]);
  });
});
