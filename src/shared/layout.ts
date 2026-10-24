/**
 * 厅的布局：几何是**程序化生成的纯函数**（契约见 `docs/design/20-layout.md` §4）。
 * 前端与厅服务引用同一份；没有场景文件，也不许在别处散落坐标常量。
 *
 * 一座格 = 一条竖走道 + 一间房（房 = 床 + 预留位）：`cellX = col·CELL_W`，行距 = `CELL_H`。
 * 床在房内按**行奇偶左右错位**，于是每张床左右各是一条走道与一块预留位（都是 56）。
 *
 * 床号是**建成顺序**：第 1 级整片先按行优先编完，此后每一级只给新增的那圈
 * （本级区域 − 上一级区域）按行优先继续编。于是升级只在外圈加床，**任何既有床的位置与床号
 * 都不变**；降级砍掉的正是最大的那些床号——它们落在**墙外**（墙矩形只按本级算），
 * 要把人拉回街网的那条路径见 `docs/design/10-hall-runtime.md` §8。
 */

import { AISLE, BED_H, BED_W, CELL_H, CELL_W, OUTSIDE_MARGIN, RESERVE_W, WALL_BODY, WALL_WIDTH } from './constants';

/** 布局版本号：几何是程序化生成的，一致性校验的对象是它（`docs/design/config.md` §1）。 */
export const LAYOUT_VERSION = 'room-1';

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

/** 世界像素里的一个轴对齐矩形（床位区、地板与墙、房间、预留位都用它）。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 级表里**唯一需要人工维护**的部分：每档的行数 `R` 与每行床数 `C`（`docs/design/20-layout.md` §3.1）。 */
const LEVEL_SHAPE: ReadonlyArray<readonly [rows: number, cols: number]> = [
  [9, 13],
  [10, 15],
  [12, 18],
  [14, 21],
  [17, 25],
  [20, 29],
  [23, 34],
  [27, 39],
  [32, 46],
  [37, 54],
  [43, 63],
  [51, 74],
  [59, 86],
  [69, 101],
  [81, 118],
];

/** `W(C) = CELL_W·C`：格宽 = 竖走道 56 + 床 61 + 预留位 56。 */
function widthOfCols(cols: number): number {
  return CELL_W * cols;
}

/** `H(R) = CELL_H·R`：格高 = 床高 100 + 床脚前横走道 56，行行如此。 */
function heightOfRows(rows: number): number {
  return CELL_H * rows;
}

/** 行列数 → 一档的几何：`W(C)` 与 `H(R)` 是唯一的两条尺寸公式。 */
function shapeOf([rows, cols]: readonly [number, number]): HallLevel {
  return { rows, cols, capacity: rows * cols, width: widthOfCols(cols), height: heightOfRows(rows) };
}

/** 15 档级表：容量 117（9×13）~ 9558（81×118）。触顶后不再生长。 */
export const HALL_LEVELS: readonly HallLevel[] = LEVEL_SHAPE.map(shapeOf);

const TOP_LEVEL = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

/**
 * 街网：街行（横走道带）× 街列（竖走道）。编号都从 `STREET_BELT` 起：
 *
 * - 街列 `−1` = 左贴墙那条走道、`0…C−1` = 每格的竖走道、`C` = 右贴墙那条；
 * - 街行 `−1` = 上贴墙那条、`0…R−1` = 每格床脚前的横走道带、`R` = 下贴墙那条。
 *
 * 贴墙那一圈本身就是一条**环形走道**，所以它也算街：一档共有 `(C+2)·(R+2)` 个节点。
 * **几何只在这里定义**：寻路只按这套编号拼图（`docs/design/20-layout.md` §4）。
 */

/** 街网里「贴墙那一圈」的编号：街列 = 左余量、街行 = 上余量。 */
export const STREET_BELT = -1;

/** 街列 → 节点 `x`（走道中心；左贴墙那条取墙内半条走道）。 */
function streetColumnX(block: number): number {
  return block === STREET_BELT ? -AISLE / 2 : block * CELL_W + AISLE / 2;
}

/**
 * 街行 → 节点 `y`（走道中心）。下侧贴墙那条的编号就是本级的行数 `rows`：它只有一条走道宽，
 * 所以比均匀格距近一条走道（贴墙的余量是「四侧各一条走道」，不是一个整格）。
 */
function streetBandY(band: number, rows: number): number {
  if (band === STREET_BELT) return -AISLE / 2;
  return band === rows ? band * CELL_H + AISLE / 2 : band * CELL_H + BED_H + AISLE / 2;
}

/** 街行 × 街列 → 街网节点的世界坐标（走道中心）。`rows` = 本级的行数。 */
export function streetPointAt(band: number, block: number, rows: number): Point {
  return { x: streetColumnX(block), y: streetBandY(band, rows) };
}

/** `y` 落在哪一条街行（横走道带）里；落在床的占用行里（`y % CELL_H ∈ [0, BED_H)`）返回空。 */
export function streetBandAt(y: number, rows: number): number | undefined {
  if (y < 0) return STREET_BELT;
  if (y >= rows * CELL_H) return rows; // 下侧贴墙那条走道
  return y % CELL_H >= BED_H ? Math.floor(y / CELL_H) : undefined;
}

/** `x` 落在哪一条街列（竖走道）里；落在房间里（`x % CELL_W ∈ [AISLE, CELL_W)`）返回空。 */
export function streetBlockAt(x: number): number | undefined {
  if (x < 0) return STREET_BELT;
  return x % CELL_W < AISLE ? Math.floor(x / CELL_W) : undefined;
}

/** 地板矩形里有几条街行（**含**下侧贴墙那条；**不含**上侧那条——它就是 `STREET_BELT`）。 */
export function streetBandCount(wall: Rect): number {
  return (wall.height - 2 * AISLE) / CELL_H + 1;
}

/** 地板矩形里有几条街列（**含**右贴墙那条；**不含**左侧那条——它就是 `STREET_BELT`）。 */
export function streetBlockCount(wall: Rect): number {
  return (wall.width - 2 * AISLE) / CELL_W + 1;
}

/** 单调等距下标表里，`≤ value` 的最大下标与 `≥ value` 的最小下标（各夹到两端），去重后返回。 */
function nearIndices(value: number, origin: number, pitch: number, first: number, last: number): number[] {
  const before = Math.min(Math.max(Math.floor((value - origin) / pitch), first), last);
  const after = Math.min(before + 1, last);
  return before === after ? [before] : [before, after];
}

/**
 * 离 `y` 最近的 ≤2 条街行号（`streetBandAt` 那条街行上的候选节点）。
 *
 * 寻路的闭式只在两个端点上各留常数个候选：最短路在节点网格上是「首段 + 曼哈顿 + 末段」的
 * 形状，总代价关于拐点坐标是**分段线性的凸函数** → 极小点只会落在端点坐标两侧最近的这两个
 * 下标上（拐点取在两端之间时，两侧任意一条街都取到同一个值）。
 */
export function nearStreetBands(y: number, rows: number): number[] {
  return nearIndices(y, BED_H + AISLE / 2, CELL_H, STREET_BELT, rows);
}

/** 离 `x` 最近的 ≤2 条街列号（同上）。 */
export function nearStreetBlocks(x: number, cols: number): number[] {
  return nearIndices(x, AISLE / 2, CELL_W, STREET_BELT, cols);
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

/**
 * 内部床号 → **显示床号**（用户看到的第一张床是「1 号床」）。
 *
 * 内部编号一律 **0 起**（协议、归属位图、数据库、`bedNoAt` 的入参与返回值、`cellOf` 全都不动），
 * 这里是**唯一**一处显示换算：只有画在床角的数字与动作行那条「床号 N」吃它
 * （`docs/ui/DESIGN.md` 的 `bed-number`）。
 */
export function displayBedNoOf(bedNo: number): number {
  return bedNo + 1;
}

/** 级 → 该级的**床位区**（行列数与像素尺寸，左上角锚在世界原点）。 */
export function regionOf(index: number): HallLevel {
  return levelOf(index);
}

/**
 * 级 → **地板与墙**的矩形 = **本级格网 + 四侧各一条走道**（对称）。
 *
 * 床位区锚在世界原点不动（所以左/上余量落在负坐标一侧），四侧余量都是 `AISLE`：
 * 每张床四周都有可走的地板，**贴墙那一圈本身就是一条环形走道**，
 * 而且「墙到最外圈床的距离」在每一档都相同（`docs/design/20-layout.md` §3.2、§4）。
 */
export function wallRegionOf(index: number): Rect {
  const level = levelOf(index);
  return { x: -AISLE, y: -AISLE, width: level.width + 2 * AISLE, height: level.height + 2 * AISLE };
}

/**
 * 级 → **取景范围**（相机可滚到的矩形）= 地板区 + 墙带 + 墙外一圈 `OUTSIDE_MARGIN`。
 *
 * 它**比厅大**：多出来的那一圈是墙外的底（`secondary`），用来让「墙」读成一个实体边界 ——
 * 只夹到地板区，墙带会整条落在屏幕外；只夹到墙带外沿，墙又永远贴着屏幕最外圈、只像一条细线。
 * 那一圈**不铺地板、不可走**（可走范围仍是 `wallRegionOf` 内缩 `WALL_BODY`）。
 */
export function scrollRegionOf(index: number): Rect {
  const region = wallRegionOf(index);
  const margin = WALL_WIDTH + OUTSIDE_MARGIN;
  return {
    x: region.x - margin,
    y: region.y - margin,
    width: region.width + 2 * margin,
    height: region.height + 2 * margin,
  };
}

/** 当前床位数 → 它在级表里的下标（床位数不是正好一档时取能装下它的最小那档）。 */
export function levelIndexOfBedCount(bedCount: number): number {
  const found = HALL_LEVELS.findIndex((level) => level.capacity >= bedCount);
  return found === -1 ? HALL_LEVELS.length - 1 : found;
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

/** 一间房（床 + 预留位）的左边那条竖走道的内沿。 */
function roomX(col: number): number {
  return col * CELL_W + AISLE;
}

/** 床在这间房里的 x：**偶行靠走道侧、奇行靠另一侧**（错位 = `RESERVE_W`）。 */
function bedX(cell: Cell): number {
  return roomX(cell.col) + (cell.row % 2 === 0 ? 0 : RESERVE_W);
}

/** 床号 → 床的绘制锚点（左上角，世界像素）。 */
export function positionOf(bedNo: number): Point | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return { x: bedX(cell), y: cell.row * CELL_H };
}

/** 床号 → 床脚前那条横走道的中心点：行走目标与出生点都用它。 */
export function frontPointOf(bedNo: number): Point | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return { x: bedX(cell) + BED_W / 2, y: cell.row * CELL_H + BED_H + AISLE / 2 };
}

/**
 * 床号 → **房间**矩形（床 + 预留位）。**当前没有任何地方绘制它** —— 将来的「房间地面」吃它。
 * 高度只到床高：床脚前那条横走道是街，不属于任何一间房。
 */
export function roomOf(bedNo: number): Rect | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return { x: roomX(cell.col), y: cell.row * CELL_H, width: BED_W + RESERVE_W, height: BED_H };
}

/** 床号 → **预留位**矩形（房间里除床以外的那 56px 一条），将来放装饰物。同样无人绘制。 */
export function reserveOf(bedNo: number): Rect | undefined {
  const cell = cellOf(bedNo);
  if (!cell) return undefined;
  return {
    x: roomX(cell.col) + (cell.row % 2 === 0 ? BED_W : 0),
    y: cell.row * CELL_H,
    width: RESERVE_W,
    height: BED_H,
  };
}

/**
 * 床号 + 块 → **预留位的一块**：沿床长方向等分三块（`docs/design/20-layout.md` §2.1）。
 *
 * `head` 靠床头（y 最小一侧）、`foot` 靠床脚（y 最大一侧）；x 与宽跟着 `reserveOf` 走——
 * 行奇偶的左右镜像由预留位本身承担，这里不另写一套。每块的两条 y 边界用同一条式子算，
 * 所以相邻两块在边界上**逐位相等**（不留缝、不重叠），第三块的底边正好是预留位的底边。
 *
 * **这只是摆放锚点，不是包围盒**：素材允许超出自己那一块（猫 58.5 高、篝火燃烧时约 42 高、南瓜灯 50 高且宽 54，
 * 块只有 56×33.3），溢出方向一律向上。既有几何一个像素都没变，所以 `LAYOUT_VERSION` 不 bump。
 */
export function reserveBlockOf(bedNo: number, block: 'head' | 'middle' | 'foot'): Rect | undefined {
  const reserve = reserveOf(bedNo);
  if (!reserve) return undefined;
  const order = block === 'head' ? 0 : block === 'middle' ? 1 : 2;
  const top = reserve.y + (reserve.height * order) / 3;
  const bottom = reserve.y + (reserve.height * (order + 1)) / 3;
  return { x: reserve.x, y: top, width: reserve.width, height: bottom - top };
}

/**
 * 世界像素 → 床号（命中判定，含行奇偶错位）。
 *
 * 不传 `bedCount` 时按**整张表**判定（最高档的区域）；传了当前床位数，则越过它的床不算床
 * （降级之后旧外圈不该再被点到）。
 */
export function bedNoAt(x: number, y: number, bedCount?: number): number | undefined {
  if (!(x >= 0) || !(y >= 0)) return undefined;

  const row = Math.floor(y / CELL_H);
  if (y - row * CELL_H >= BED_H) return undefined; // 床脚前那条横走道带

  const col = Math.floor(x / CELL_W);
  const within = x - bedX({ row, col });
  if (within < 0 || within >= BED_W) return undefined; // 竖走道 / 预留位

  const bedNo = bedNoOfCell(row, col);
  if (bedNo === undefined) return undefined;
  return bedCount === undefined || bedNo < bedCount ? bedNo : undefined;
}

/**
 * 世界像素 → 能不能走。街网 = **街列**（每格一条竖走道）∪ **街行**（每格一条床脚前横走道带）
 * ∪ **贴墙那一圈环形走道**，再减掉「墙矩形向内缩 `WALL_BODY`」以外的部分。
 *
 * **房间内部（床 + 预留位）不是街**：于是将来往预留位里放装饰物**不可能堵住街网**，
 * 也就不需要阻挡集。降级之后旧外圈落在墙外，由 `nearestStreetPoint` 把人拉回街网（不是吸附意图）。
 *
 * 同 `bedNoAt`：不传 `bedCount` 按整张表判定。
 */
export function isWalkable(x: number, y: number, bedCount?: number): boolean {
  const index = bedCount === undefined ? HALL_LEVELS.length - 1 : levelIndexOfBedCount(bedCount);
  const level = HALL_LEVELS[index] as HallLevel;
  const region = wallRegionOf(index);
  if (x < region.x + WALL_BODY || y < region.y + WALL_BODY) return false;
  if (x >= region.x + region.width - WALL_BODY || y >= region.y + region.height - WALL_BODY) return false;
  // 贴墙那一圈整条都算走道；街列 / 街行按格距取模
  return x < 0 || y < 0 || x >= level.width || y >= level.height || x % CELL_W < AISLE || y % CELL_H >= BED_H;
}

/**
 * 离给定点最近的街网点（保留 x、只改 y：竖着找最近的那条街行）。
 *
 * 两个消费者，语义不同但几何是同一条：
 * 1. **客户端**在点地面时把目标吸附到街网（服务端只校验、不吸附，见 `docs/api/20-api-ws.md` §7）；
 * 2. 服务端在降级之后把落在墙外的旧位置拉回街上（那是恢复，不是对意图的静默吸附）。
 */
export function nearestStreetPoint(point: Point, bedCount: number): Point | undefined {
  // 夹取按**可走区**（墙矩形再内缩 `WALL_BODY`）：夹到墙上的话，整条竖线都不可走
  const region = wallRegionOf(levelIndexOfBedCount(bedCount));
  const left = region.x + WALL_BODY;
  const top = region.y + WALL_BODY;
  const right = region.x + region.width - WALL_BODY;
  const bottom = region.y + region.height - WALL_BODY;
  const x = Math.min(Math.max(point.x, left), right - 1);
  const y = Math.min(Math.max(point.y, top), bottom - 1);
  // 街行每 `CELL_H` 一条，且贴墙那两条一定在，所以 `CELL_H` 之内必有落点
  for (let distance = 0; distance <= CELL_H; distance += 1) {
    for (const candidate of [y - distance, y + distance]) {
      if (candidate < top || candidate >= bottom) continue;
      if (isWalkable(x, candidate, bedCount)) return { x, y: candidate };
    }
  }
  return undefined;
}
