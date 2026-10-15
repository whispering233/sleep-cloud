/**
 * 厅的布局：几何是**程序化生成的纯函数**（契约见 `docs/design/config.md` §7）。
 * 前端与厅服务引用同一份；没有场景文件，也不许在别处散落坐标常量。
 *
 * 床号是**建成顺序**：第 1 级（114 床）整片先按行优先编完，此后每一级只给新增的那圈
 * （本级区域 − 上一级区域）按行优先继续编。于是升级只在外圈加床，**任何既有床的位置与床号
 * 都不变**；降级砍掉的正是最大的那些床号。
 */

import { AISLE, BED_GAP, BED_H, BED_W, CORRIDOR_EVERY, PITCH_X, PITCH_Y } from './constants';

/** 布局版本号：几何是程序化生成的，一致性校验的对象是它（`docs/design/config.md` §1）。 */
export const LAYOUT_VERSION = 'dorm-1';

/** 一档的几何：行列数、容量与像素尺寸（左上角锚定在世界原点）。 */
export interface HallLevel {
  readonly rows: number;
  readonly cols: number;
  readonly capacity: number;
  readonly width: number;
  readonly height: number;
}

/** 床位的格子坐标。 */
export interface Cell {
  row: number;
  col: number;
}

/** 世界像素坐标。 */
export interface Point {
  x: number;
  y: number;
}

/** 级表里**唯一需要人工维护**的部分：每档的行数 `R` 与每行床数 `C`（`docs/design/config.md` §2）。 */
const LEVEL_SHAPE: ReadonlyArray<readonly [rows: number, cols: number]> = [
  [6, 19],
  [7, 23],
  [8, 26],
  [9, 29],
  [11, 36],
  [13, 42],
  [15, 49],
  [18, 58],
  [21, 68],
  [25, 81],
  [29, 94],
  [34, 110],
  [40, 129],
  [47, 152],
  [55, 178],
];

/** `W(C) = 61C + 4(C−1) + 56⌊C/4⌋`：床宽 + 床间距 + 每 4 床一条竖走道。 */
function widthOfCols(cols: number): number {
  return BED_W * cols + BED_GAP * (cols - 1) + AISLE * Math.floor(cols / CORRIDOR_EVERY);
}

/** `H(R) = 156R`：床高 100 + 床脚前走道 56，行行如此。 */
function heightOfRows(rows: number): number {
  return PITCH_Y * rows;
}

/** 15 档级表：容量 114（6×19）~ 9790（55×178）。触顶后不再生长。 */
export const HALL_LEVELS: readonly HallLevel[] = LEVEL_SHAPE.map(([rows, cols]) => ({
  rows,
  cols,
  capacity: rows * cols,
  width: widthOfCols(cols),
  height: heightOfRows(rows),
}));

const TOP_LEVEL = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

/** 4 床 + 1 条竖走道的横向周期：一格块 = 260px 床位区 + 56px 走道。 */
export const CORRIDOR_BLOCK = CORRIDOR_EVERY * PITCH_X + AISLE;

/** 一格块内床位区的宽度（超过它就是竖走道）。 */
export const CORRIDOR_START = CORRIDOR_EVERY * PITCH_X;

/** 级 → 该档的几何。索引越界时夹到两端（超出上限返回最后一档）。 */
export function levelOf(index: number): HallLevel {
  // NaN / Infinity：返回最小那一档（fail-safe）——绝不要让下标变成 NaN 再被断言成 HallLevel
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  const clamped = Math.min(Math.max(safe, 0), HALL_LEVELS.length - 1);
  return HALL_LEVELS[clamped] as HallLevel;
}

/** 级 → 床位数。 */
export function bedCountOf(index: number): number {
  return levelOf(index).capacity;
}

/** 级 → 该级的区域（行列数与像素尺寸）。 */
export function regionOf(index: number): HallLevel {
  return levelOf(index);
}

/** 当前床位数 → 它在级表里的下标（床位数不是正好一档时取能装下它的最小那档）。 */
export function levelIndexOfBedCount(bedCount: number): number {
  const found = HALL_LEVELS.findIndex((level) => level.capacity >= bedCount);
  return found === -1 ? HALL_LEVELS.length - 1 : found;
}

/** 床的左上角在厅里的 x：列距 × 列号 + 前面那些竖走道。 */
function colX(col: number): number {
  return col * PITCH_X + Math.floor(col / CORRIDOR_EVERY) * AISLE;
}

/** 床号 → 格子坐标。越界或非整数床号返回空。 */
export function cellOf(bedNo: number): Cell | undefined {
  if (!Number.isInteger(bedNo) || bedNo < 0 || bedNo >= TOP_LEVEL.capacity) return undefined;

  const index = levelIndexOfBedCount(bedNo + 1);
  const level = HALL_LEVELS[index] as HallLevel;
  const previous = index > 0 ? (HALL_LEVELS[index - 1] as HallLevel) : undefined;
  const prevRows = previous?.rows ?? 0;
  const prevCols = previous?.cols ?? 0;

  // 在「本级区域 − 上一级区域」这一圈里按行优先数：先上边那些行右侧的新增列，再整行的新增行
  let offset = bedNo - (previous?.capacity ?? 0);
  for (let row = 0; row < level.rows; row += 1) {
    const width = row < prevRows ? level.cols - prevCols : level.cols;
    if (offset < width) return { row, col: row < prevRows ? prevCols + offset : offset };
    offset -= width;
  }
  return undefined;
}

/** 某格的床号（`cellOf` 的反向）。该格不在任何级里时返回空。 */
function bedNoOfCell(row: number, col: number): number | undefined {
  if (row < 0 || col < 0) return undefined;
  const index = HALL_LEVELS.findIndex((level) => row < level.rows && col < level.cols);
  if (index === -1) return undefined;

  const level = HALL_LEVELS[index] as HallLevel;
  const previous = index > 0 ? (HALL_LEVELS[index - 1] as HallLevel) : undefined;
  const prevRows = previous?.rows ?? 0;
  const prevCols = previous?.cols ?? 0;

  const offset =
    row < prevRows
      ? row * (level.cols - prevCols) + (col - prevCols)
      : prevRows * (level.cols - prevCols) + (row - prevRows) * level.cols + col;
  return (previous?.capacity ?? 0) + offset;
}

/** 床号 → 床的绘制锚点（左上角，世界像素）。 */
export function positionOf(bedNo: number): Point | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return { x: colX(cell.col), y: cell.row * PITCH_Y };
}

/** 床号 → 床脚前那条横走道的中心点：行走目标与出生点都用它。 */
export function frontPointOf(bedNo: number): Point | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return { x: colX(cell.col) + BED_W / 2, y: cell.row * PITCH_Y + BED_H + AISLE / 2 };
}

/**
 * 世界像素 → 床号（命中判定）。
 *
 * 不传 `bedCount` 时按**整张表**判定（最高档的区域）；传了当前床位数，则越过它的床不算床
 * （降级之后旧外圈不该再被点到）。
 */
export function bedNoAt(x: number, y: number, bedCount?: number): number | undefined {
  if (!(x >= 0) || !(y >= 0)) return undefined;

  const row = Math.floor(y / PITCH_Y);
  if (y - row * PITCH_Y >= BED_H) return undefined; // 床脚前走道

  const block = Math.floor(x / CORRIDOR_BLOCK);
  const within = x - block * CORRIDOR_BLOCK;
  if (within >= CORRIDOR_START) return undefined; // 竖走道
  const col = block * CORRIDOR_EVERY + Math.floor(within / PITCH_X);
  if (within - Math.floor(within / PITCH_X) * PITCH_X >= BED_W) return undefined; // 床间距

  const bedNo = bedNoOfCell(row, col);
  if (bedNo === undefined) return undefined;
  return bedCount === undefined || bedNo < bedCount ? bedNo : undefined;
}

/**
 * 世界像素 → 能不能走。街网 = 床脚前横走道带 ∪ 竖向走道带。
 *
 * 走道带与床的占用矩形按构造互不相交：横走道只覆盖 `y % 156 ∈ [100, 156)`，而床占着
 * `[0, 100)`；竖走道落在两组 4 床之间，那里没有床格只有床间距。
 *
 * 同 `bedNoAt`：不传 `bedCount` 按整张表判定。
 */
export function isWalkable(x: number, y: number, bedCount?: number): boolean {
  const region = levelOf(bedCount === undefined ? HALL_LEVELS.length - 1 : levelIndexOfBedCount(bedCount));
  if (!(x >= 0) || !(y >= 0) || x >= region.width || y >= region.height) return false;

  const inRowAisle = y % PITCH_Y >= BED_H;
  const inColumnAisle = x % CORRIDOR_BLOCK >= CORRIDOR_START;
  return inRowAisle || inColumnAisle;
}

/**
 * 离给定点最近的街网点（沿竖直方向找最近的横走道带；找不到就夹到区域里再找一次）。
 *
 * 两个消费者，语义不同但几何是同一条：
 * 1. **客户端**在点地面时把目标吸附到街网（服务端只校验、不吸附，见 `docs/api/20-api-ws.md` §7）；
 * 2. 服务端在降级之后把落在区域外的旧位置拉回街上（那是恢复，不是对意图的静默吸附）。
 */
export function nearestStreetPoint(point: Point, bedCount: number): Point | undefined {
  const region = levelOf(levelIndexOfBedCount(bedCount));
  const x = Math.min(Math.max(point.x, 0), region.width - 1);
  for (let distance = 0; distance <= PITCH_Y; distance += 1) {
    for (const y of [point.y - distance, point.y + distance]) {
      if (y >= 0 && y < region.height && isWalkable(x, y, bedCount)) return { x, y };
    }
  }
  return undefined;
}