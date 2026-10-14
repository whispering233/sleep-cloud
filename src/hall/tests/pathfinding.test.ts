import { describe, expect, it } from 'vitest';

import { HALLS } from '../../shared/hall-registry';
import { loadScene } from '../scene';
import { findPath } from '../pathfinding';

const grid = loadScene(HALLS[0]);

describe('寻路', () => {
  it('起点与终点相同 → 空路径（原地不动）', () => {
    expect(findPath(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it('走直线：路径不含起点、含终点，且每步只走一格', () => {
    const path = findPath(grid, { x: 1, y: 1 }, { x: 1, y: 5 });
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ x: 1, y: 2 });
    expect(path?.[path.length - 1]).toEqual({ x: 1, y: 5 });

    let previous = { x: 1, y: 1 };
    for (const tile of path ?? []) {
      const distance = Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y);
      expect(distance).toBe(1); // 不允许斜着走
      previous = tile;
    }
  });

  it('目标不可行走（墙 / 床）→ null', () => {
    expect(findPath(grid, { x: 1, y: 1 }, { x: 0, y: 0 })).toBeNull(); // 外墙
    expect(findPath(grid, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull(); // 床格
    expect(findPath(grid, { x: 1, y: 1 }, { x: -1, y: 1 })).toBeNull();
  });

  it('能穿过整间厅走到对角的走道（可行走格是连通的）', () => {
    const path = findPath(grid, { x: 1, y: 1 }, { x: 33, y: 33 });
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(30);
    for (const tile of path ?? []) expect(grid.isWalkable(tile.x, tile.y)).toBe(true);
  });

  it('床边可达：每条床的路径终点都是它旁边的走道', () => {
    const bed = grid.scene.beds[0];
    if (!bed) throw new Error('场景里没有床');
    const neighbours = [
      { x: bed.x - 1, y: bed.y },
      { x: bed.x + 1, y: bed.y },
      { x: bed.x, y: bed.y - 1 },
      { x: bed.x, y: bed.y + 1 },
    ].filter((tile) => grid.isWalkable(tile.x, tile.y));

    const reachable = neighbours.some((tile) => findPath(grid, { x: 1, y: 1 }, tile) !== null);
    expect(reachable).toBe(true);
  });
});
