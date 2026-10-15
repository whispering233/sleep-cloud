import {
  AISLE,
  BED_H,
  CORRIDOR_EVERY,
  PITCH_Y,
} from '../shared/constants';
import {
  CORRIDOR_BLOCK,
  CORRIDOR_START,
  isWalkable,
  levelIndexOfBedCount,
  levelOf,
  type Point,
} from '../shared/layout';

/**
 * 街网寻路（见 `docs/design/10-hall-runtime.md` §5.1）。
 *
 * 可行走区域是**规则正交街网**：横向走道带（每行的床脚前）× 竖向走道带（每 `CORRIDOR_EVERY` 床一条），
 * 减去每张床的占用矩形；可走性一律由 `layout.isWalkable` 给出（没有场景文件、没有整片地板）。
 *
 * 图很小：节点 = 横走道 × 竖走道的交叉点，最高档约 55 × 44 ≈ 2400 个，BFS 是微秒级。
 * **目标点不在街网上 → 返回 `null`**（调用方回 `3006`），服务端不吸附——吸附会让「点床躺下」
 * 与「点地面走动」的判定出现意外。
 */

/** 一条竖走道（块）里的节点 x：块起点 + 走道半宽。 */
function nodeX(block: number): number {
  return block * CORRIDOR_BLOCK + CORRIDOR_START + AISLE / 2;
}

/** 一条横走道（行）里的节点 y：行起点 + 床高 + 走道半宽。 */
function nodeY(row: number): number {
  return row * PITCH_Y + BED_H + AISLE / 2;
}

/** `y` 落在哪一条横走道带里；不在任何带里（例如落在床的占用矩形里）返回空。 */
function rowBandOf(y: number): number | undefined {
  if (y < BED_H) return undefined;
  return Math.floor((y - BED_H) / PITCH_Y);
}

/** `x` 落在哪一条竖走道里；不在走道里返回空。 */
function blockOf(x: number): number | undefined {
  if (x % CORRIDOR_BLOCK < CORRIDOR_START) return undefined;
  return Math.floor(x / CORRIDOR_BLOCK);
}

interface StreetGraph {
  rows: number;
  blocks: number;
  /** 节点数（`rows × blocks`） */
  size: number;
}

function graphFor(bedCount: number): StreetGraph {
  const region = levelOf(levelIndexOfBedCount(bedCount));
  const blocks = Math.floor(region.cols / CORRIDOR_EVERY);
  return { rows: region.rows, blocks, size: region.rows * blocks };
}

const indexOf = (graph: StreetGraph, row: number, block: number): number => row * graph.blocks + block;

/**
 * 从某个点出发/结束能直接连上的节点：同一横走道带上可以横向走到任一节点，
 * 同一竖走道里可以纵向走到任一节点。西段与东段都是**轴对齐的一整段**，所以沿途必在街网上。
 */
function nodesAround(graph: StreetGraph, point: Point): number[] {
  const nodes: number[] = [];
  const row = rowBandOf(point.y);
  if (row !== undefined && row < graph.rows) {
    for (let block = 0; block < graph.blocks; block += 1) nodes.push(indexOf(graph, row, block));
  }
  const block = blockOf(point.x);
  if (block !== undefined && block < graph.blocks) {
    for (let eachRow = 0; eachRow < graph.rows; eachRow += 1) nodes.push(indexOf(graph, eachRow, block));
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
    const row = Math.floor(current / graph.blocks);
    const block = current - row * graph.blocks;
    for (const [nextRow, nextBlock] of [
      [row, block - 1],
      [row, block + 1],
      [row - 1, block],
      [row + 1, block],
    ] as Array<[number, number]>) {
      if (nextRow < 0 || nextBlock < 0 || nextRow >= graph.rows || nextBlock >= graph.blocks) continue;
      const index = indexOf(graph, nextRow, nextBlock);
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

  const path: Point[] = nodes.map((index) => {
    const row = Math.floor(index / graph.blocks);
    return { x: nodeX(index - row * graph.blocks), y: nodeY(row) };
  });
  path.push(to);
  return path;
}