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
 * 图很小：节点 = 横走道 × 竖走道的交叉点，最高档约 56 × 45 ≈ 2500 个，BFS 是微秒级。
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

interface StreetGraph {
  /** 横走道带的条数（**不含**上侧那条余量：带号 `-1` 就是它；含右/下余量里那几条） */
  bands: number;
  /** 竖走道块的条数（**不含**左侧那条余量：块号 `-1` 就是它；含右/下余量里那几条） */
  blocks: number;
  /** 节点数（`(bands + 1) × (blocks + 1)`，多出的是左右 / 上下那两条余量） */
  size: number;
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

/**
 * 走道图：节点 = 横走道带 × 竖走道块。带号与块号都从 `-1` 起（`-1` = 左/上那条余量），
 * 所以图下标 = `(带 + 1) × (blocks + 1) + (块 + 1)`；格线取到**地板矩形**里，
 * 于是右/下余量里那几条格线也是节点（否则点在余量里时找不到街网）。
 */
function graphFor(bedCount: number): StreetGraph {
  const wall = wallRegionOf(levelIndexOfBedCount(bedCount));
  const bands = bandCount(wall);
  const blocks = blockCount(wall);
  return { bands, blocks, size: (bands + 1) * (blocks + 1) };
}

/** 带号 / 块号 → 图下标（两者都从 `-1` 起，所以统一下标 +1）。 */
const indexOf = (graph: StreetGraph, band: number, block: number): number =>
  (band + 1) * (graph.blocks + 1) + (block + 1);

/** 图下标 → 带号。 */
const bandOfIndex = (graph: StreetGraph, index: number): number => Math.floor(index / (graph.blocks + 1)) - 1;

/** 图下标 → 块号。 */
const blockOfIndex = (graph: StreetGraph, index: number): number => (index % (graph.blocks + 1)) - 1;

/** 离 `x` 最近的竖走道块（含左侧那条余量）。 */
function nearestBlock(graph: StreetGraph, x: number): number {
  const block = Math.round((x - nodeX(0)) / CORRIDOR_BLOCK);
  return Math.min(Math.max(block, BELT), graph.blocks - 1);
}

/**
 * 从某个点出发/结束能直接连上的节点：同一横走道带上可以横向走到任一节点，
 * 同一竖走道里可以纵向走到任一节点。西段与东段都是**轴对齐的一整段**，所以沿途必在街网上。
 *
 * 上侧那条余量横贯整个厅，只连**最近的那一个块**：连上整条带时路径会先绕到左上角再走回来。
 */
function nodesAround(graph: StreetGraph, point: Point): number[] {
  const nodes: number[] = [];
  const band = rowBandOf(point.y);
  if (band !== undefined && band < graph.bands) {
    if (band === BELT) nodes.push(indexOf(graph, BELT, nearestBlock(graph, point.x)));
    else for (let block = BELT; block < graph.blocks; block += 1) nodes.push(indexOf(graph, band, block));
  }
  const block = blockOf(point.x);
  if (block !== undefined && block < graph.blocks) {
    for (let eachBand = BELT; eachBand < graph.bands; eachBand += 1) nodes.push(indexOf(graph, eachBand, block));
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
  const goals = new Set(nodesAround(graph, to));

  const cameFrom = new Int32Array(graph.size).fill(-1);
  const seen = new Uint8Array(graph.size);
  const queue: number[] = [];
  for (const source of sources) {
    if (seen[source] === 1) continue;
    seen[source] = 1;
    queue.push(source);
  }

  let found = -1;
  for (let head = 0; head < queue.length && found === -1; head += 1) {
    const current = queue[head] as number;
    if (goals.has(current)) {
      found = current;
      break;
    }
    const band = bandOfIndex(graph, current);
    const block = blockOfIndex(graph, current);
    for (const [nextBand, nextBlock] of [
      [band, block - 1],
      [band, block + 1],
      [band - 1, block],
      [band + 1, block],
    ] as Array<[number, number]>) {
      if (nextBand < BELT || nextBlock < BELT || nextBand >= graph.bands || nextBlock >= graph.blocks) continue;
      const index = indexOf(graph, nextBand, nextBlock);
      if (seen[index] === 1) continue;
      seen[index] = 1;
      cameFrom[index] = current;
      queue.push(index);
    }
  }
  if (found === -1) return null;

  const nodes: number[] = [];
  for (let index = found; index !== -1; index = cameFrom[index] as number) nodes.push(index);
  nodes.reverse();

  const path: Point[] = nodes.map((index) => ({
    x: nodeX(blockOfIndex(graph, index)),
    y: nodeY(bandOfIndex(graph, index)),
  }));
  path.push(to);
  return path;
}