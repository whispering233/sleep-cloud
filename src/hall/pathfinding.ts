import {
  STREET_BELT,
  isWalkable,
  levelIndexOfBedCount,
  streetBandAt,
  streetBandCount,
  streetBlockAt,
  streetBlockCount,
  streetPointAt,
  wallRegionOf,
} from '../shared/layout';
import type { Point } from '../shared/layout';

/**
 * 街网寻路（见 `docs/design/10-hall-runtime.md` §5.1）。
 *
 * 「街网长什么样」全在 `layout` 里定义——街行 / 街列的编号、节点坐标、某个点落在哪一条街行 /
 * 街列、一个档里有几条（`docs/design/config.md` §7）。这里只用它做搜索：街行 × 街列的节点图
 * （含贴墙那一条 `STREET_BELT`），减去每张床的占用矩形；可走性一律由 `layout.isWalkable` 给出
 * （没有场景文件、没有整片地板）。
 *
 * 这张网是**完备均匀网格**：任意街行 × 任意街列都是节点，每条横走道横贯整厅、每条竖走道纵贯
 * 整厅，相邻节点的间距恒定（贴墙那一条也一样，街列 `STREET_BELT` 与街列 `0` 正好差一格）。
 * 于是**节点之间的最短路 = 坐标曼哈顿距离**，全程无需搜索：总代价 = min over (源节点, 目标节点)
 * 的「起点→源节点 + 曼哈顿(源, 目标) + 目标节点→终点」，源/目标集合各 ≤ 一行的节点数
 * （最高档 ≈ 46），约两千次算术——纳秒级。「完备且均匀」这条假设有
 * `src/hall/tests/pathfinding.test.ts` 的「护城河」测试兜底。
 *
 * **目标点不在街网上 → 返回 `null`**（调用方回 `3006`），服务端不吸附——吸附会让「点床躺下」
 * 与「点地面走动」的判定出现意外。
 */

/** 街网上的一个节点：街行 × 街列（两者都从 `STREET_BELT` 起，那一条是贴墙的余量）。 */
interface StreetNode {
  band: number;
  block: number;
}

interface StreetGraph {
  /** 街行的条数（**不含**上侧那条余量：街行 `STREET_BELT` 就是它；含右/下余量里那几条） */
  bands: number;
  /** 街列的条数（**不含**左侧那条余量：街列 `STREET_BELT` 就是它；含右/下余量里那几条） */
  blocks: number;
}

/** 走道范围：街行与街列的编号都从 `STREET_BELT` 起，格线取到**地板矩形**里。 */
function graphFor(bedCount: number): StreetGraph {
  const wall = wallRegionOf(levelIndexOfBedCount(bedCount));
  return { bands: streetBandCount(wall), blocks: streetBlockCount(wall) };
}

/**
 * 从某个点出发/结束能**一条直线段**走到的节点：同一条街行里可以横向走到任一节点，
 * 同一街列里可以纵向走到任一节点（都是轴对齐的一整段，沿途必在街网上）。
 * 贴墙那一条（`STREET_BELT`）横贯 / 纵贯整厅，与其它走道一样是完备网格的一部分。
 */
function nodesAround(graph: StreetGraph, point: Point): StreetNode[] {
  const nodes: StreetNode[] = [];
  const band = streetBandAt(point.y);
  if (band !== undefined && band < graph.bands) {
    for (let block = STREET_BELT; block < graph.blocks; block += 1) nodes.push({ band, block });
  }
  const block = streetBlockAt(point.x);
  if (block !== undefined && block < graph.blocks) {
    for (let eachBand = STREET_BELT; eachBand < graph.bands; eachBand += 1) nodes.push({ band: eachBand, block });
  }
  return nodes;
}

/** 两点是否在同一条街行 / 街列里（同一条 = 一条轴对齐的直线段，沿途必可走）。 */
function sameBand(from: Point, to: Point): boolean {
  const row = streetBandAt(from.y);
  if (row !== undefined && row === streetBandAt(to.y)) return true;
  const block = streetBlockAt(from.x);
  return block !== undefined && block === streetBlockAt(to.x);
}

/**
 * 从 `from` 走到 `to` 的街网折线（**不含起点、含终点**）。目标点不在街网上或走不到时返回 `null`。
 * 两点已经在同一条走道带里时就是一条直线段（没有中间的节点拐弯）。
 */
export function findPath(from: Point, to: Point, bedCount: number): Point[] | null {
  if (!isWalkable(to.x, to.y, bedCount)) return null;
  if (!isWalkable(from.x, from.y, bedCount)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  if (sameBand(from, to)) return [to];

  const graph = graphFor(bedCount);
  const sources = nodesAround(graph, from);
  const goals = nodesAround(graph, to);

  // 闭式最短路：节点间 = 曼哈顿距离（网格完备均匀），只枚举两条端点直线段的落点。
  let bestSource: StreetNode | undefined;
  let bestGoal: StreetNode | undefined;
  let bestTotal = Infinity;
  for (const source of sources) {
    const sourcePoint = streetPointAt(source.band, source.block);
    for (const goal of goals) {
      const goalPoint = streetPointAt(goal.band, goal.block);
      const total =
        Math.hypot(sourcePoint.x - from.x, sourcePoint.y - from.y) +
        Math.abs(goalPoint.x - sourcePoint.x) +
        Math.abs(goalPoint.y - sourcePoint.y) +
        Math.hypot(goalPoint.x - to.x, goalPoint.y - to.y);
      if (total < bestTotal) {
        bestTotal = total;
        bestSource = source;
        bestGoal = goal;
      }
    }
  }
  if (bestSource === undefined || bestGoal === undefined) return null;

  // 起点——源节点——拐点（目标街列 × 源街行）——目标节点——终点；相邻重复点（拐点可能重合）去掉。
  const polyline = [
    streetPointAt(bestSource.band, bestSource.block),
    streetPointAt(bestSource.band, bestGoal.block),
    streetPointAt(bestGoal.band, bestGoal.block),
    to,
  ];
  return polyline.filter(
    (point, index) => index === 0 || point.x !== polyline[index - 1]?.x || point.y !== polyline[index - 1]?.y,
  );
}
