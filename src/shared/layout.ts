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

/**
 * 地板与墙的矩形（世界像素）：**比床位区大一圈**——左/上各一条走道、右/下是下一级与本级之差。
 * 床位区仍锚在世界原点，所以左/上那一条余量落在负坐标一侧（`docs/design/config.md` §7）。
 */
export interface WallRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

/** 行列数 → 一档的几何：`W(C)` 与 `H(R)` 是唯一的两条尺寸公式。 */
function shapeOf([rows, cols]: readonly [number, number]): HallLevel {
  return { rows, cols, capacity: rows * cols, width: widthOfCols(cols), height: heightOfRows(rows) };
}

/** 15 档级表：容量 114（6×19）~ 9790（55×178）。触顶后不再生长。 */
export const HALL_LEVELS: readonly HallLevel[] = LEVEL_SHAPE.map(shapeOf);

const TOP_LEVEL = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

/** 理论下一档（64×207）：**只给最后一档的地板与墙用**，不进级表、也不补床位（`docs/design/config.md` §2）。 */
const TOP_WALL_LEVEL = shapeOf([64, 207]);

/** 4 床 + 1 条竖走道的横向周期：一格块 = 260px 床位区 + 56px 走道。 */
export const CORRIDOR_BLOCK = CORRIDOR_EVERY * PITCH_X + AISLE;

/** 一格块内床位区的宽度（超过它就是竖走道）。 */
export const CORRIDOR_START = CORRIDOR_EVERY * PITCH_X;

/**
 * 街网：横走道带（**街行**，每行的床脚前）× 竖走道带（**街列**，每 `CORRIDOR_EVERY` 床一条），
 * 加上**贴墙那一圈余量**（左 = 又一街列、上 = 又一街行）。
 *
 * 街行与街列的编号都从 `STREET_BELT` 起。寻路只按这套编号拼图，几何一律从下面几个函数要
 * （`docs/design/config.md` §7）。
 */

/** 街网里「贴墙那一圈余量」的编号：街列 = 左余量、街行 = 上余量（与 `wallRegionOf` 同一条）。 */
export const STREET_BELT = -1;

/** 街行 × 街列 → 街网节点的世界坐标（走道中心；`STREET_BELT` 那一条取墙内半条走道）。 */
export function streetPointAt(band: number, block: number): Point {
  const x = block === STREET_BELT ? -AISLE / 2 : block * CORRIDOR_BLOCK + CORRIDOR_START + AISLE / 2;
  const y = band === STREET_BELT ? -AISLE / 2 : band * PITCH_Y + BED_H + AISLE / 2;
  return { x, y };
}

/** `y` 落在哪一条街行（横走道带）里；落在床的占用行里（`y % 156 ∈ [0, 100)`）返回空。 */
export function streetBandAt(y: number): number | undefined {
  if (y < 0) return STREET_BELT;
  if (y % PITCH_Y < BED_H) return undefined;
  return Math.floor(y / PITCH_Y);
}

/** `x` 落在哪一条街列（竖走道）里；不在走道里（`x % 316 < 260`，即床与床间距那一档）返回空。 */
export function streetBlockAt(x: number): number | undefined {
  if (x < 0) return STREET_BELT;
  if (x % CORRIDOR_BLOCK < CORRIDOR_START) return undefined;
  return Math.floor(x / CORRIDOR_BLOCK);
}

/** 地板矩形里有几条街行（**不含**上侧那条余量：街行 `STREET_BELT` 就是它）。 */
export function streetBandCount(wall: WallRegion): number {
  let count = 0;
  while (count * PITCH_Y + BED_H < wall.y + wall.height) count += 1;
  return count;
}

/** 地板矩形里有几条街列（**不含**左侧那条余量：街列 `STREET_BELT` 就是它）。 */
export function streetBlockCount(wall: WallRegion): number {
  let count = 0;
  while (count * CORRIDOR_BLOCK + CORRIDOR_START < wall.x + wall.width) count += 1;
  return count;
}

/** 级 → 级表下标。越界时夹到两端（超出上限返回最后一档）。 */
function levelIndex(index: number): number {
  // NaN / Infinity：返回最小那一档（fail-safe）——绝不要让下标变成 NaN 再被断言成 HallLevel
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(safe, 0), HALL_LEVELS.length - 1);
}

/** 级 → 该档的几何。索引越界时夹到两端（超出上限返回最后一档）。 */
export function levelOf(index: number): HallLevel {
  return HALL_LEVELS[levelIndex(index)] as HallLevel;
}

/** 级 → 床位数。 */
export function bedCountOf(index: number): number {
  return levelOf(index).capacity;
}

/** 级 → 该级的**床位区**（行列数与像素尺寸，左上角锚在世界原点）。 */
export function regionOf(index: number): HallLevel {
  return levelOf(index);
}

/**
 * 级 → **地板与墙**的矩形：取**下一级**的床位区，再向左上各留一条走道（最后一档用理论下一档 64×207）。
 *
 * 为什么不是「本级床位区」：床位区的最外圈原本正好贴着边界（0px），最外侧是墙、绕不过去。
 * 留出一档之后每一侧都有走道：右/下来自级差，左/上来自负坐标那一条（`docs/design/config.md` §7）。
 */
export function wallRegionOf(index: number): WallRegion {
  const next = HALL_LEVELS[levelIndex(index) + 1] ?? TOP_WALL_LEVEL;
  return { x: -AISLE, y: -AISLE, width: next.width + AISLE, height: next.height + AISLE };
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
 * 世界像素 → 能不能走。街网 = 床脚前横走道带 ∪ 竖向走道带 ∪ **边界那一条走道余量**。
 *
 * 走道带与床的占用矩形按构造互不相交：横走道只覆盖 `y % 156 ∈ [100, 156)`，而床占着
 * `[0, 100)`；竖走道落在两组 4 床之间，那里没有床格只有床间距。
 *
 * 边界 = `wallRegionOf`（下一级 + 左/上各一条走道）：最外圈的床四侧都有走道，**降级后旧外圈
 * 落回地板区、变成可走的余量**。左/上那一条在负坐标一侧，整条都是走道（街网在边界闭合）。
 *
 * 同 `bedNoAt`：不传 `bedCount` 按整张表判定。
 */
export function isWalkable(x: number, y: number, bedCount?: number): boolean {
  const region = wallRegionOf(bedCount === undefined ? HALL_LEVELS.length - 1 : levelIndexOfBedCount(bedCount));
  if (!(x >= region.x) || !(y >= region.y) || x >= region.x + region.width || y >= region.y + region.height) {
    return false;
  }
  // 落在某条街行或某条街列里就是街网；`x<0` / `y<0` 那两条贴墙余量整条都算（两个函数都返回 `STREET_BELT`）
  return streetBandAt(y) !== undefined || streetBlockAt(x) !== undefined;
}

/**
 * 离给定点最近的街网点（沿竖直方向找最近的横走道带；找不到就夹到区域里再找一次）。
 *
 * 两个消费者，语义不同但几何是同一条：
 * 1. **客户端**在点地面时把目标吸附到街网（服务端只校验、不吸附，见 `docs/api/20-api-ws.md` §7）；
 * 2. 服务端在降级之后把落在区域外的旧位置拉回街上（那是恢复，不是对意图的静默吸附）。
 */
export function nearestStreetPoint(point: Point, bedCount: number): Point | undefined {
  // 夹取按**地板区**：否则站在（或点在）余量里的人会被拉回床位区，与「余量是可走的地板」相冲
  const region = wallRegionOf(levelIndexOfBedCount(bedCount));
  const x = Math.min(Math.max(point.x, region.x), region.x + region.width - 1);
  for (let distance = 0; distance <= PITCH_Y; distance += 1) {
    for (const y of [point.y - distance, point.y + distance]) {
      if (y >= region.y && y < region.y + region.height && isWalkable(x, y, bedCount)) return { x, y };
    }
  }
  return undefined;
}