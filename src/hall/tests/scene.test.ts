import { describe, expect, it } from 'vitest';

import { HALLS } from '../../shared/hall-registry';
import type { Scene } from '../../shared/scene';
import { assertSceneMatchesHall, loadScene } from '../scene';
import type { SceneGrid } from '../scene';

function walkableTiles(grid: SceneGrid): Array<[number, number]> {
  const tiles: Array<[number, number]> = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (grid.isWalkable(x, y)) tiles.push([x, y]);
    }
  }
  return tiles;
}

describe('场景数据与可行走网格', () => {
  for (const hall of HALLS) {
    describe(hall.id, () => {
      const grid = loadScene(hall);

      it('床位数等于厅容量，床号覆盖 0 ~ capacity-1', () => {
        expect(grid.scene.beds).toHaveLength(hall.capacity);
        const bedNos = grid.scene.beds.map((bed) => bed.bedNo).sort((a, b) => a - b);
        expect(bedNos).toEqual([...Array(hall.capacity).keys()]);
      });

      it('每张床都能按床号取到坐标，且床格不是可行走格', () => {
        for (const bed of grid.scene.beds) {
          expect(grid.bedPosition(bed.bedNo)).toEqual({ x: bed.x, y: bed.y });
          expect(grid.bedNoAt(bed.x, bed.y)).toBe(bed.bedNo);
          expect(grid.isWalkable(bed.x, bed.y)).toBe(false);
        }
      });

      it('每张床都紧邻至少一个可行走格（否则走不到床边，躺不下）', () => {
        for (const bed of grid.scene.beds) {
          const neighbours = [
            [bed.x - 1, bed.y],
            [bed.x + 1, bed.y],
            [bed.x, bed.y - 1],
            [bed.x, bed.y + 1],
          ];
          expect(
            neighbours.some(([x, y]) => grid.isWalkable(x as number, y as number)),
            `床 ${bed.bedNo} 四周都是障碍`,
          ).toBe(true);
        }
      });

      it('可行走格是连通的（不存在走不到的区域）', () => {
        const tiles = walkableTiles(grid);
        expect(tiles.length).toBeGreaterThan(0);

        const [startX, startY] = tiles[0] as [number, number];
        const seen = new Set<string>([`${startX},${startY}`]);
        const queue: Array<[number, number]> = [[startX, startY]];
        while (queue.length > 0) {
          const [x, y] = queue.pop() as [number, number];
          for (const [nx, ny] of [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ] as Array<[number, number]>) {
            const key = `${nx},${ny}`;
            if (seen.has(key) || !grid.isWalkable(nx, ny)) continue;
            seen.add(key);
            queue.push([nx, ny]);
          }
        }
        expect(seen.size).toBe(tiles.length);
      });
    });
  }

  it('场景与厅不一致时直接报错（配置错误不留到运行期）', () => {
    const hall = HALLS[0];
    const scene = loadScene(hall).scene;

    expect(() => assertSceneMatchesHall({ ...scene, guid: 'other' }, hall)).toThrow(/场景标识不符/);
    expect(() => assertSceneMatchesHall({ ...scene, beds: scene.beds.slice(1) }, hall)).toThrow(
      /场景床位数/,
    );
    expect(() =>
      assertSceneMatchesHall(
        { ...scene, beds: [...scene.beds.slice(1), { bedNo: 999, x: 0, y: 0 }] } as Scene,
        hall,
      ),
    ).toThrow(/床号越界/);
    expect(() => assertSceneMatchesHall({ ...scene, blocked: [[-1, 0]] }, hall)).toThrow(
      /障碍格坐标越界/,
    );
  });
});
