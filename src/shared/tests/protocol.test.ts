import { describe, expect, it } from 'vitest';

import { DOWNSTREAM_TYPES, UPSTREAM_TYPES } from '../protocol';
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

  it('下行消息与文档一致（10 种）', () => {
    expect(docDownstream).toEqual([
      'snapshot',
      'join',
      'leave',
      'state',
      'pos',
      'bed',
      'chat',
      'whisper',
      'emote',
      'error',
    ]);
    expect([...DOWNSTREAM_TYPES]).toEqual(docDownstream);
  });
});
