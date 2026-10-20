import { describe, expect, it } from 'vitest';

import { AISLE, BED_H, BED_W, CELL_H, WALL_BODY } from '../../shared/constants';
import {
  HALL_LEVELS,
  frontPointOf,
  isWalkable,
  levelIndexOfBedCount,
  positionOf,
  reserveOf,
  streetPointAt,
  wallRegionOf,
} from '../../shared/layout';
import type { HallLevel, Point, Rect } from '../../shared/layout';
import { findPath } from '../../shared/pathfinding';

const CAPACITY = (HALL_LEVELS[0] as HallLevel).capacity;
const TOP = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

const front = (bedNo: number): Point => frontPointOf(bedNo) as Point;

/**
 * 街网节点（横走道带 × 竖走道块）的世界坐标；用公共几何函数推导，不依赖 `pathfinding.ts` 的内部函数。
 * `streetPointAt` 自己的黄金值在 `src/shared/tests/layout.test.ts` 里钉住。
 */
const streetNode = (band: number, block: number, rows: number): Point => streetPointAt(band, block, rows);

/** 折线总长（含起点到第一个途经点、最后一个途经点到终点两段）。 */
function pathLength(from: Point, path: Point[]): number {
  let total = 0;
  let previous = from;
  for (const point of path) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

/**
 * 绕行感知的「曼哈顿下界」（路径长度判据的分母）。
 *
 * **行切换只能发生在竖走道上**（横走道带上只有 x 落在竖走道里才连得上别的行），所以同列相邻
 * 两行的正确走法是「横到最近竖走道 → 竖走 → 横回来」——朴素的 `|Δx| + |Δy|` 在这个网格上
 * 本来就不可达（实测同列相邻两行的 路径长/L1 = 1.8 ~ 2.6）。
 *
 * `s` = 在起点那条**床占位行**（不是横走道带：带里处处可走、看不出竖走道在哪）上用
 * `isWalkable` 向左右扫出的**最近可走竖走道区间的边缘**（只用公共 API）。
 * `AISLE` 是「拐点取在走道中线」的余量：每个拐点最多多走半条走道，两个拐点合计约一条。
 */
function streetLowerBound(from: Point, to: Point, bedCount: number): number {
  const region = wallRegionOf(levelIndexOfBedCount(bedCount));
  const scanY = from.y + CELL_H / 2;
  let edge = from.x;
  for (let distance = 0; distance <= region.width; distance += 1) {
    const left = from.x - distance;
    if (left >= region.x && isWalkable(left, scanY, bedCount)) {
      edge = left;
      break;
    }
    const right = from.x + distance;
    if (right < region.x + region.width && isWalkable(right, scanY, bedCount)) {
      edge = right;
      break;
    }
  }
  return Math.abs(from.y - to.y) + Math.abs(from.x - edge) + Math.abs(to.x - edge) + AISLE;
}

/** 折线必须全程落在街网上（每一段轴对齐、每个途经点可走、终点就是目标点本身）。 */
function expectStreetPath(from: Point, to: Point, bedCount: number): Point[] {
  const path = findPath(from, to, bedCount);
  expect(path, `床前走道 → 床前走道走不到`).not.toBeNull();
  const points = path as Point[];
  let previous = from;
  for (const point of points) {
    expect(isWalkable(point.x, point.y, bedCount), `途经点 (${point.x}, ${point.y}) 不在街网上`).toBe(true);
    expect(previous.x === point.x || previous.y === point.y).toBe(true);
    previous = point;
  }
  expect(previous).toEqual(to);
  return points;
}

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
    const to = { x: from.x, y: from.y + CELL_H * 2 };
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
    expect(findPath(from, { x: wallRegionOf(0).x - 1, y: from.y }, CAPACITY)).toBeNull(); // 左侧墙外
    expect(findPath(from, { x: from.x, y: wallRegionOf(0).y - 1 }, CAPACITY)).toBeNull(); // 上侧墙外
    const top = { x: TOP.width - 1, y: front(0).y };
    expect(findPath(from, top, CAPACITY)).toBeNull(); // 越过当前级的右边界
    // 房间里的预留位（床 + 预留位都不可走）
    const reserve = reserveOf(3) as Rect;
    const reserveCenter = { x: reserve.x + reserve.width / 2, y: reserve.y + reserve.height / 2 };
    expect(findPath(from, reserveCenter, CAPACITY)).toBeNull();
  });

  it('起点不在街网上（降级后落在外圈的旧位置）→ null', () => {
    const outside = { x: TOP.width - 1, y: front(0).y };
    expect(findPath(outside, front(0), CAPACITY)).toBeNull();
  });

  it('降级后旧外圈的那张床不再是床，它的位置落在墙外（要靠恢复拉回街网）', () => {
    const outerFront = front(CAPACITY); // 第 2 级才有的床
    const outerCenter = positionOf(CAPACITY) as Point;
    const bedPoint = { x: outerCenter.x + BED_W / 2, y: outerCenter.y + BED_H / 2 };
    expect(findPath(front(0), bedPoint, CAPACITY)).toBeNull(); // 床心不在街网上
    expect(findPath(front(0), outerFront, CAPACITY)).toBeNull(); // 旧外圈落在墙外
    expect(findPath(front(0), outerFront, TOP.capacity)).not.toBeNull(); // 按整张表判定时它是街
  });

  it('四侧的贴墙走道都走得到（左/上那条在负坐标一侧）', () => {
    const wall = wallRegionOf(0);
    const level = HALL_LEVELS[0] as HallLevel;
    const from = front(0);
    const probes = [
      { x: wall.x + WALL_BODY + 2, y: from.y }, // 左侧贴墙走道
      { x: -AISLE / 2, y: BED_H / 2 }, // 左余量里、紧贴着最左列床的那一段
      { x: AISLE / 2, y: wall.y + WALL_BODY + 2 }, // 上侧贴墙走道
      { x: level.width + AISLE / 2, y: from.y }, // 右侧贴墙走道
      { x: from.x, y: level.height + AISLE / 2 }, // 下侧贴墙走道
    ];
    for (const point of probes) {
      expect(isWalkable(point.x, point.y, CAPACITY), `(${point.x}, ${point.y}) 不可走`).toBe(true);
      expect(findPath(from, point, CAPACITY), `床 0 → (${point.x}, ${point.y}) 走不到`).not.toBeNull();
    }
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

  it('回归：同一床列相邻两行不再「绕左边缘」（旧纯跳数 BFS 会横穿到左边界再折回）', () => {
    const col = 6;
    const from = front(col); // 第 0 行 · 第 6 列
    const to = front(col + (HALL_LEVELS[0] as HallLevel).cols); // 第 1 行 · 同一列（相邻两行）
    const path = findPath(from, to, CAPACITY);
    expect(path).not.toBeNull();

    const bound = streetLowerBound(from, to, CAPACITY);
    expect(pathLength(from, path as Point[])).toBeLessThanOrEqual(bound * 1.6);
    // 短到不可能是「绕到最左余量」那条：后者 = from.x + AISLE/2 + |Δy| + to.x + AISLE/2
    const aroundLeftEdge = from.x + AISLE / 2 + Math.abs(to.y - from.y) + to.x + AISLE / 2;
    expect(pathLength(from, path as Point[])).toBeLessThan(aroundLeftEdge / 2);
  });

  it('抽样床对：路径总长 ≤ 绕行下界 × 1.6，且折线每一步都在街网上', () => {
    for (const level of HALL_LEVELS) {
      const capacity = level.capacity;
      // 起点取**中列**的床：床 0 在最左列（x ≈ 86，左余量 x = −28），从它出发「绕左边缘」
      // 反而不是绕路，旧实现的兜圈抽不出来；中列才看得见。
      const fromBedNo = Math.floor(level.cols / 2);
      const from = front(fromBedNo);
      // 中列 → 同一列的相邻下一行（回归对的通式）；其余是左端、厅中与右端
      const samples = [0, 1, fromBedNo + level.cols, Math.floor(capacity / 2), capacity - 2, capacity - 1];
      for (const bedNo of samples) {
        const to = front(bedNo);
        const points = expectStreetPath(from, to, capacity);
        const bound = streetLowerBound(from, to, capacity);
        expect(pathLength(from, points), `第 ${capacity} 档：床 ${fromBedNo} → 床 ${bedNo}`).toBeLessThanOrEqual(
          bound * 1.6,
        );
      }
    }
  });

  // 这条是**穷举**扫描（每档级表 × 每对街节点 × 8px 采样）：本机空载约 5s，机器被占满（并行 worktree /
  // headless 浏览器）时会被 5s 默认值误杀（实测 8s）。放宽到 20s —— 这里断的是几何正确性，不是耗时。
  it('护城河：任意两节点的路径总长 === 坐标曼哈顿距离，且折线全程落在街网上（街网是完备的网格）', { timeout: 20_000 }, () => {
    // 这条假设一变红，就说明有人把街网改成了非完备网格（闭式最短路的前提没了）。
    // 断言分两半：
    // ① 「总长 === 曼哈顿距离」只挡得住「闭式不再构造那条折线」（例如退回跳数 BFS）；
    // ② 「折线全程落在街网上」才是「完备」的等价断言：某条横走道不再横贯整厅、某个 带×块
    //    不再是节点时，`findPath` 仍会返回一条长度 === 曼哈顿距离的折线，但它会**穿过床** → 红。
    // 节点编号：街行 −1…R、街列 −1…C（贴墙那一圈也是一带 / 一块）→ 共 (C+2)·(R+2) 个。
    for (const level of HALL_LEVELS) {
      const bands: number[] = [];
      for (let band = -1; band <= level.rows; band += 1) bands.push(band);
      const blocks: number[] = [];
      for (let block = -1; block <= level.cols; block += 1) blocks.push(block);

      const pick = (list: number[]): number[] => [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]] as number[];
      const nodes = pick(bands).flatMap((band) => pick(blocks).map((block) => streetNode(band, block, level.rows)));

      for (const from of nodes) {
        for (const to of nodes) {
          expect(isWalkable(from.x, from.y, level.capacity), JSON.stringify(from)).toBe(true);
          expect(isWalkable(to.x, to.y, level.capacity), JSON.stringify(to)).toBe(true);
          const manhattan = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
          if (manhattan === 0) continue;
          const path = findPath(from, to, level.capacity);
          expect(path, `节点 ${JSON.stringify(from)} → ${JSON.stringify(to)}`).not.toBeNull();
          expect(pathLength(from, path as Point[]), `第 ${level.capacity} 档`).toBeCloseTo(manhattan, 9);

          // ② 折线全程在街网上：每个途经点可走，且每一段按 ≤ 8px 密集采样后也都可走
          let previous = from;
          for (const waypoint of path as Point[]) {
            const steps = Math.ceil(Math.max(Math.abs(waypoint.x - previous.x), Math.abs(waypoint.y - previous.y)) / 8);
            for (let step = 0; step <= steps; step += 1) {
              const ratio = steps === 0 ? 0 : step / steps;
              const x = previous.x + (waypoint.x - previous.x) * ratio;
              const y = previous.y + (waypoint.y - previous.y) * ratio;
              expect(
                isWalkable(x, y, level.capacity),
                `第 ${level.capacity} 档：${JSON.stringify(previous)} → ${JSON.stringify(waypoint)} 途中的 (${x}, ${y}) 不在街网上`,
              ).toBe(true);
            }
            previous = waypoint;
          }
        }
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
