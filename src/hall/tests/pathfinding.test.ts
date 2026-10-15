import { describe, expect, it } from 'vitest';

import { BED_H, BED_W, PITCH_Y } from '../../shared/constants';
import { HALL_LEVELS, frontPointOf, isWalkable, positionOf } from '../../shared/layout';
import type { HallLevel, Point } from '../../shared/layout';
import { findPath } from '../pathfinding';

const CAPACITY = HALL_LEVELS.length > 0 ? (HALL_LEVELS[0] as { capacity: number }).capacity : 114;
const TOP = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

const front = (bedNo: number): Point => frontPointOf(bedNo) as Point;

describe('街网寻路', () => {
  it('起点与终点相同 → 空路径（原地不动）', () => {
    const point = front(0);
    expect(findPath(point, point, CAPACITY)).toEqual([]);
  });

  it('同一条横走道 → 一条直线段（不绕节点）', () => {
    const from = front(0);
    const to = front(1);
    expect(to.y).toBe(from.y);
    expect(findPath(from, to, CAPACITY)).toEqual([to]);
  });

  it('竖走道里上下移动 → 也是一条直线段', () => {
    const from = { x: front(4).x - BED_W, y: front(0).y }; // 竖走道里（床 4 左侧的走道）
    const to = { x: from.x, y: from.y + PITCH_Y * 2 };
    expect(isWalkable(from.x, from.y, CAPACITY)).toBe(true);
    expect(isWalkable(to.x, to.y, CAPACITY)).toBe(true);
    expect(findPath(from, to, CAPACITY)).toEqual([to]);
  });

  it('不同行不同列 → 折线，且**每一步都在街网上**', () => {
    const from = front(0);
    const to = front(CAPACITY - 1);
    const path = findPath(from, to, CAPACITY);
    expect(path).not.toBeNull();

    let previous = from;
    for (const point of path ?? []) {
      expect(isWalkable(point.x, point.y, CAPACITY), `途经点 (${point.x}, ${point.y}) 不在街网上`).toBe(true);
      // 每一段都是轴对齐的（街网是正交网格）
      expect(previous.x === point.x || previous.y === point.y).toBe(true);
      previous = point;
    }
    expect(previous).toEqual(to); // 终点就是目标点本身（含小数，服务端不吸附）
  });

  it('每条途经点与两个端点之间的整段都只有街网（密集采样）', () => {
    const from = front(0);
    const to = front(CAPACITY - 2);
    const path = findPath(from, to, CAPACITY) as Point[];
    let previous = from;
    for (const point of [path[path.length - 1] as Point]) {
      previous = from;
      for (const waypoint of path) {
        const steps = Math.ceil(Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y) / 4);
        for (let step = 0; step <= steps; step += 1) {
          const ratio = steps === 0 ? 0 : step / steps;
          const x = previous.x + (waypoint.x - previous.x) * ratio;
          const y = previous.y + (waypoint.y - previous.y) * ratio;
          expect(isWalkable(x, y, CAPACITY), `(${x}, ${y}) 不在街网上`).toBe(true);
        }
        previous = waypoint;
      }
      expect(point).toEqual(to);
    }
  });

  it('目标不在街网上 → null（调用方回 3006，**服务端不吸附**）', () => {
    const from = front(0);
    const bedCenter = positionOf(3) as Point;
    expect(findPath(from, { x: bedCenter.x + BED_W / 2, y: bedCenter.y + BED_H / 2 }, CAPACITY)).toBeNull(); // 床心
    expect(findPath(from, { x: -5, y: from.y }, CAPACITY)).toBeNull(); // 厅外
    expect(findPath(from, { x: from.x, y: -5 }, CAPACITY)).toBeNull();
    const top = { x: TOP.width - 1, y: front(0).y };
    expect(findPath(from, top, CAPACITY)).toBeNull(); // 越过当前级的右边界
    // 床与床之间的 4px 缝：不在街网上
    const gap = { x: (positionOf(3) as Point).x + BED_W + 2, y: (positionOf(3) as Point).y + BED_H / 2 };
    expect(findPath(from, gap, CAPACITY)).toBeNull();
  });

  it('起点不在街网上（降级后落在外圈的旧位置）→ null', () => {
    const outside = { x: TOP.width - 1, y: front(0).y };
    expect(findPath(outside, front(0), CAPACITY)).toBeNull();
  });

  it('降级后旧外圈的目标点也不再可达（区域即真相）', () => {
    const outerFront = front(CAPACITY); // 第 2 级才有的床
    expect(findPath(front(0), outerFront, CAPACITY)).toBeNull();
    expect(findPath(front(0), outerFront, TOP.capacity)).not.toBeNull();
  });

  it('任意两张床的前方走道都互相可达（逐档抽样，含最高档）', () => {
    for (const level of HALL_LEVELS) {
      const samples = [0, 1, Math.floor(level.capacity / 2), level.capacity - 2, level.capacity - 1];
      const from = front(samples[0] as number);
      for (const bedNo of samples) {
        const to = front(bedNo);
        const path = findPath(from, to, level.capacity);
        expect(path, `第 ${level.capacity} 档：床 ${samples[0]} → 床 ${bedNo} 走不到`).not.toBeNull();
      }
    }
  });

  it('路径长度与坐标无关地有界：不与厅的绝对尺寸挂钩（最高档也不爆）', () => {
    const from = front(0);
    const path = findPath(from, front(TOP.capacity - 1), TOP.capacity) as Point[];
    // 节点数 ≤ 行数 + 列数 + 两端各一个点
    expect(path.length).toBeLessThan(TOP.rows + TOP.cols + 2);
  });
});