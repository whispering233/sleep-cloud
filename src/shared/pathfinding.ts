import {
  isWalkable,
  levelIndexOfBedCount,
  nearStreetBands,
  nearStreetBlocks,
  streetBandAt,
  streetBandCount,
  streetBlockAt,
  streetBlockCount,
  streetPointAt,
  wallRegionOf,
} from './layout';
import type { Point } from './layout';

/**
 * 街网寻路（见 `docs/design/hall-runtime.md` §5.1）。
 *
 * 「街网长什么样」全在 `layout` 里定义——街行 / 街列的编号、节点坐标、某个点落在哪一条街行 /
 * 街列、一个档里有几条、离某个坐标最近的 ≤2 条（`docs/design/20-layout.md` §4）。这里只用它做
 * 搜索：街行 × 街列的节点图（含贴墙那一圈 `STREET_BELT`）；可走性一律由 `layout.isWalkable`
 * 给出（没有场景文件、没有整片地板）。
 *
 * 沿走道走的最短路 = **坐标曼哈顿距离**：每条街行横贯整厅、每条街列纵贯整厅，任意
 * 「街行 × 街列」都是节点（含贴墙那一圈），所以 `源 → (源街行 × 目标街列) → 目标` 一定可走，
 * 而且没有比 `|Δx| + |Δy|` 更短的路（贴墙那两条街只有一条走道宽、与邻节点不等距，但单调
 * 走完的边权和恰好等于坐标差，所以不影响这条结论）。于是寻路是**闭式**：总代价 = 起点→源节点 +
 * 曼哈顿(源, 目标) + 目标节点→终点，**无搜索、无优先队列**。**不是按跳数**（按跳数会让
 * 「跨街行」的点对绕到边界去），也不保证最少拐弯。
 *
 * **候选剪枝（性能的关键）**：两个端点各只保留 **≤4 个**候选节点——它所在那条街行上最近的
 * ≤2 条街列、以及它所在那条街列上最近的 ≤2 条街行。这是**近似**：总代价对拐点坐标是凸的，但
 * 拐点的最优位置一般落在两端之间，而不是「各自最近的那条街」上，所以少数点对会少走一个更优
 * 拐点。偏差上限约**一条走道（56px ≈ 0.43s 步程）**（「各自最近的那条街」最多各差半条走道），
 * 实测最坏 **52px**（档 294、2 万组随机可走点对）；**床脚前走道中心这类中线端点（出生点、
 * 躺下目标）偏差为 0**。换来的是代价**与节点总数无关**：最高档（120 × 83 ≈ 1 万个节点）也只是一次
 * ≤16 组的算术。
 *
 * 「街网完备」这条假设有 `src/hall/tests/pathfinding.test.ts` 的「护城河」测试兜底：折线的每一
 * 段按 ≤8px 密集采样后必须全程在街网上——某条横走道不再横贯整厅时，闭式照样会返回一条长度正确、
 * 但**穿过床**的折线，那条测试会红。
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
  /** 本级的行数：下侧贴墙那条街行的编号就是它（`streetBandAt` / `streetPointAt` 要它） */
  rows: number;
  /** 本级的列数：右贴墙那条街列的编号就是它 */
  cols: number;
}

/** 走道范围：街行与街列的编号都从 `STREET_BELT` 起，格线取到**地板矩形**里。 */
function graphFor(bedCount: number): StreetGraph {
  const wall = wallRegionOf(levelIndexOfBedCount(bedCount));
  // 条数含右/下贴墙那一条、不含 `STREET_BELT` 那一条 → 最后一条的编号就是行列数
  return { rows: streetBandCount(wall) - 1, cols: streetBlockCount(wall) - 1 };
}

/**
 * 从某个点出发/结束能**一条直线段**走到的候选节点（≤4 个，理由见文件头）。
 * 同一条街行里可以横向走到任一节点、同一条街列里可以纵向走到任一节点，都是轴对齐的一整段，
 * 沿途必在街网上（街行横贯整厅、街列纵贯整厅）。
 */
function candidateNodes(graph: StreetGraph, point: Point): StreetNode[] {
  const nodes: StreetNode[] = [];
  const band = streetBandAt(point.y, graph.rows);
  if (band !== undefined) {
    for (const block of nearStreetBlocks(point.x, graph.cols)) nodes.push({ band, block });
  }
  const block = streetBlockAt(point.x);
  if (block !== undefined) {
    for (const eachBand of nearStreetBands(point.y, graph.rows)) nodes.push({ band: eachBand, block });
  }
  return nodes;
}

/** 两点是否在同一条街行 / 街列里（同一条 = 一条轴对齐的直线段，沿途必可走）。 */
function sameBand(graph: StreetGraph, from: Point, to: Point): boolean {
  const band = streetBandAt(from.y, graph.rows);
  if (band !== undefined && band === streetBandAt(to.y, graph.rows)) return true;
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

  const graph = graphFor(bedCount);
  if (sameBand(graph, from, to)) return [to];

  const sources = candidateNodes(graph, from);
  const goals = candidateNodes(graph, to);

  // 闭式最短路：节点间 = 曼哈顿距离（网格完备），只枚举两端各自的常数个候选（≤4 × ≤4）。
  let bestSource: StreetNode | undefined;
  let bestGoal: StreetNode | undefined;
  let bestTotal = Infinity;
  for (const source of sources) {
    const sourcePoint = streetPointAt(source.band, source.block, graph.rows);
    for (const goal of goals) {
      const goalPoint = streetPointAt(goal.band, goal.block, graph.rows);
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
    streetPointAt(bestSource.band, bestSource.block, graph.rows),
    streetPointAt(bestSource.band, bestGoal.block, graph.rows),
    streetPointAt(bestGoal.band, bestGoal.block, graph.rows),
    to,
  ];
  return polyline.filter(
    (point, index) => index === 0 || point.x !== polyline[index - 1]?.x || point.y !== polyline[index - 1]?.y,
  );
}
