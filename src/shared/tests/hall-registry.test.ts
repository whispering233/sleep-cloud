import { describe, expect, it } from 'vitest';

import { findHall, HALLS } from '../hall-registry';
import { readDoc, tableRows } from './doc';

/** 文档里的厅注册表（`docs/design/config.md` §1 的第二个表格） */
const docHalls = tableRows(readDoc('design/config.md'), '## 1. 厅注册表', '## 2. 时间常量', 1).map(
  ([id, name, timezone, sceneGuid, capacity]) => ({
    id: (id ?? '').replaceAll('`', ''),
    name: name ?? '',
    timezone: (timezone ?? '').replaceAll('`', ''),
    sceneGuid: (sceneGuid ?? '').replaceAll('`', ''),
    capacity: Number(capacity),
  }),
);

describe('厅注册表与 docs/design/config.md 一致', () => {
  it('逐条一致（id / name / timezone / sceneGuid / capacity）', () => {
    expect(HALLS).toEqual(docHalls);
  });

  it('第一个厅是本地开发的回落目标', () => {
    expect(HALLS[0]?.id).toBe('asia-1');
  });

  it('id 唯一，且可按 id 找到', () => {
    const ids = HALLS.map((hall) => hall.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findHall('asia-1')?.name).toBe('亚洲厅');
    expect(findHall('nope')).toBeUndefined();
  });
});
