import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Scene } from '../../../shared/scene';
import { HALLS } from '../../../shared/hall-registry';
import { buildSceneIndex } from '../scene';

/** 三个厅的场景数据就在仓库里：`一份数据，两个读者`，客户端索引必须与服务端网格同语义。 */
/** 清单**从厅注册表推导**：新增厅时这些测试自动覆盖它的场景，不需第二处人工维护。 */
const SCENE_GUIDS = HALLS.map((hall) => hall.sceneGuid);

function readScene(guid: string): Scene {
  const file = join(process.cwd(), 'public', 'scenes', `${guid}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Scene;
}

describe.each(SCENE_GUIDS)('场景索引：%s', (guid) => {
  const scene = readScene(guid);
  const index = buildSceneIndex(scene);

  it('每张床的格子都不可行走，且能反查回同一个床号', () => {
    expect(scene.beds).toHaveLength(256);
    for (const bed of scene.beds) {
      expect(index.isWalkable(bed.x, bed.y)).toBe(false);
      expect(index.bedNoAt(bed.x, bed.y)).toBe(bed.bedNo);
      expect(index.bedAt(bed.bedNo)).toEqual({ x: bed.x, y: bed.y });
    }
  });

  it('障碍格、出界格与非整数格都不可行走', () => {
    for (const [x, y] of scene.blocked) expect(index.isWalkable(x, y)).toBe(false);
    expect(index.isWalkable(-1, 1)).toBe(false);
    expect(index.isWalkable(1, -1)).toBe(false);
    expect(index.isWalkable(scene.width, 1)).toBe(false);
    expect(index.isWalkable(1, scene.height)).toBe(false);
    expect(index.isWalkable(1.5, 1)).toBe(false);
  });

  it('可行走格都不是床格（床只能从格→床号反查出来）', () => {
    const walkable: Array<[number, number]> = [];
    for (let y = 0; y < scene.height; y += 1) {
      for (let x = 0; x < scene.width; x += 1) {
        if (index.isWalkable(x, y)) walkable.push([x, y]);
      }
    }
    expect(walkable.length).toBeGreaterThan(scene.beds.length);
    for (const [x, y] of walkable) expect(index.bedNoAt(x, y)).toBeUndefined();
  });
});
