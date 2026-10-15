import {
  AISLE,
  BED_H,
  PITCH_Y,
} from '../shared/constants';
import {
  CORRIDOR_BLOCK,
  CORRIDOR_START,
  isWalkable,
  levelIndexOfBedCount,
  wallRegionOf,
} from '../shared/layout';
import type { Point, WallRegion } from '../shared/layout';

/**
 * 街网寻路（见 `docs/design/10-hall-runtime.md` §5.1）。
 *
 * 可行走区域是**规则正交街网**：横向走道带（每行的床脚前）× 竖向走道带（每 `CORRIDOR_EVERY` 床一条），
 * 加上**边界那一条走道余量**（左 = 又一个块、上 = 又一条带），减去每张床的占用矩形；
 * 可走性一律由 `layout.isWalkable` 给出（没有场景文件、没有整片地板）。
 *
 * 这张网是**完备均匀网格**：任意横走道带 × 任意竖走道块都是节点，每条横走道横贯整厅、每条
 * 竖走道纵贯整厅，相邻节点间距恒为 `CORRIDOR_BLOCK` / `PITCH_Y`（贴墙那一圈也一样，
 * `nodeX(-1)` 与 `nodeX(0)` 正好差一个 `CORRIDOR_BLOCK`）。于是**节点之间的最短路 = 坐标曼哈顿
 * 距离**，全程无需搜索：总代价 = min over (源节点, 目标节点) 的「起点→源节点 + 曼哈顿(源, 目标)
 * + 目标节点→终点」，源/目标集合各 ≤ 一行的节点数（最高档 ≈ 46），约两千次算术——纳秒级。
 * 「完备且均匀」这条假设有 `src/hall/tests/pathfinding.test.ts` 的「护城河」测试兜底。
 *
 * **目标点不在街网上 → 返回 `null`**（调用方回 `3006`），服务端不吸附——吸附会让「点床躺下」
 * 与「点地面走动」的判定出现意外。
 */

/** 边界余量那一圈的编号：左 = 块 `-1`、上 = 带 `-1`（与 `layout.wallRegionOf` 同一条）。 */
const BELT = -1;

/** 一条竖走道（块）里的节点 x：块起点 + 走道半宽；块 `-1` 是左侧那条余量。 */
function nodeX(block: number): number {
  return block === BELT ? -AISLE / 2 : block * CORRIDOR_BLOCK + CORRIDOR_START + AISLE / 2;
}

/** 一条横走道（带）里的节点 y：行起点 + 床高 + 走道半宽；带 `-1` 是上侧那条余量。 */
function nodeY(band: number): number {
  return band === BELT ? -AISLE / 2 : band * PITCH_Y + BED_H + AISLE / 2;
}

/** `y` 落在哪一条横走道带里；不在任何带里（床的占用矩形那一档）返回空。 */
function rowBandOf(y: number): number | undefined {
  if (y < 0) return BELT;
  if (y % PITCH_Y < BED_H) return undefined;
  return Math.floor(y / PITCH_Y);
}

/** `x` 落在哪一条竖走道里；不在走道里返回空。 */
function blockOf(x: number): number | undefined {
  if (x < 0) return BELT;
  if (x % CORRIDOR_BLOCK < CORRIDOR_START) return undefined;
  return Math.floor(x / CORRIDOR_BLOCK);
}

/** 街网上的一个节点：横走道带 × 竖走道块（两者都从 `-1` 起，`-1` = 贴墙那条余量）。 */
interface StreetNode {
  band: number;
  block: number;
}

interface StreetGraph {
  /** 横走道带的条数（**不含**上侧那条余量：带号 `-1` 就是它；含右/下余量里那几条） */
  bands: number;
  /** 竖走道块的条数（**不含**左侧那条余量：块号 `-1` 就是它；含右/下余量里那几条） */
  blocks: number;
}

/** 地板矩形里有几条横走道带：带 `r` 的走道落在 `[r·156 + 100, r·156 + 156)`。 */
function bandCount(wall: WallRegion): number {
  let count = 0;
  while (count * PITCH_Y + BED_H < wall.y + wall.height) count += 1;
  return count;
}

/** 地板矩形里有几条竖走道：块 `b` 的走道落在 `[b·316 + 260, b·316 + 316)`。 */
function blockCount(wall: WallRegion): number {
  let count = 0;
  while (count * CORRIDOR_BLOCK + CORRIDOR_START < wall.x + wall.width) count += 1;
  return count;
}

/** 走道范围：带号与块号都从 `-1` 起（`-1` = 贴墙那条余量），格线取到**地板矩形**里。 */
function graphFor(bedCount: number): StreetGraph {
  const wall = wallRegionOf(levelIndexOfBedCount(bedCount));
  return { bands: bandCount(wall), blocks: blockCount(wall) };
}

/** 节点 → 世界像素坐标。 */
function pointOf(node: StreetNode): Point {
  return { x: nodeX(node.block), y: nodeY(node.band) };
}

/**
 * 从某个点出发/结束能**一条直线段**走到的节点：同一横走道带上可以横向走到任一节点，
 * 同一竖走道里可以纵向走到任一节点（都是轴对齐的一整段，沿途必在街网上）。
 * 贴墙那圈（带 / 块 `-1`）横贯 / 纵贯整厅，与其它走道一样是完备网格的一部分。
 */
function nodesAround(graph: StreetGraph, point: Point): StreetNode[] {
  const nodes: StreetNode[] = [];
  const band = rowBandOf(point.y);
  if (band !== undefined && band < graph.bands) {
    for (let block = BELT; block < graph.blocks; block += 1) nodes.push({ band, block });
  }
  const block = blockOf(point.x);
  if (block !== undefined && block < graph.blocks) {
    for (let eachBand = BELT; eachBand < graph.bands; eachBand += 1) nodes.push({ band: eachBand, block });
  }
  return nodes;
}

/** 两点是否在同一条走道带里（同带 = 一条轴对齐的直线段，沿途必可走）。 */
function sameBand(from: Point, to: Point): boolean {
  const row = rowBandOf(from.y);
  if (row !== undefined && row === rowBandOf(to.y)) return true;
  const block = blockOf(from.x);
  return block !== undefined && block === blockOf(to.x);
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
    const intoSource = Math.hypot(nodeX(source.block) - from.x, nodeY(source.band) - from.y);
    for (const goal of goals) {
      const fromGoal = Math.hypot(nodeX(goal.block) - to.x, nodeY(goal.band) - to.y);
      const total =
        intoSource +
        Math.abs(nodeX(goal.block) - nodeX(source.block)) +
        Math.abs(nodeY(goal.band) - nodeY(source.band)) +
        fromGoal;
      if (total < bestTotal) {
        bestTotal = total;
        bestSource = source;
        bestGoal = goal;
      }
    }
  }
  if (bestSource === undefined || bestGoal === undefined) return null;

  // 起点——源节点——拐点（目标块 × 源带）——目标节点——终点；相邻重复点（拐点可能重合）去掉。
  const polyline = [
    pointOf(bestSource),
    { x: nodeX(bestGoal.block), y: nodeY(bestSource.band) },
    pointOf(bestGoal),
    to,
  ];
  return polyline.filter(
    (point, index) => index === 0 || point.x !== polyline[index - 1]?.x || point.y !== polyline[index - 1]?.y,
  );
}
