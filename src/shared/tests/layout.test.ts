import { describe, expect, it } from 'vitest';

import { AISLE, BED_H, BED_W, CELL_H, CELL_W, OUTSIDE_MARGIN, RESERVE_W, WALL_BODY, WALL_WIDTH } from '../constants';
import {
  HALL_LEVELS,
  LAYOUT_VERSION,
  bedCountOf,
  bedNoAt,
  cellOf,
  frontPointOf,
  isWalkable,
  levelOf,
  nearestStreetPoint,
  positionOf,
  regionOf,
  reserveOf,
  roomOf,
  scrollRegionOf,
  streetBandAt,
  wallRegionOf,
  type Cell,
  type HallLevel,
  type Point,
  type Rect,
} from '../layout';
import { readDoc, tableRows } from './doc';

const TOP = HALL_LEVELS[HALL_LEVELS.length - 1] as HallLevel;

/** 独立的床锚点公式：与 `layout.ts` 内部那份是同一公式的第二次实现，用来验证「位置不依赖级表」。 */
function bedAnchor(row: number, col: number): Point {
  return { x: col * CELL_W + AISLE + (row % 2 === 0 ? 0 : RESERVE_W), y: row * CELL_H };
}

function signatureOf(bedNo: number): string {
  const cell = cellOf(bedNo);
  const point = positionOf(bedNo);
  if (!cell || !point) return 'undefined';
  return `${cell.row},${cell.col}@${point.x},${point.y}`;
}

/** 该床在**新增外圈**（本级区域 − 上一级区域）里是本行第几列。 */
function ringRow(levelIndex: number, row: number): { firstCol: number; width: number } {
  const level = HALL_LEVELS[levelIndex] as HallLevel;
  const previous = levelIndex > 0 ? (HALL_LEVELS[levelIndex - 1] as HallLevel) : undefined;
  const prevRows = previous?.rows ?? 0;
  const prevCols = previous?.cols ?? 0;
  return row < prevRows
    ? { firstCol: prevCols, width: level.cols - prevCols }
    : { firstCol: 0, width: level.cols };
}

/** 逐档逐床走一遍（容量最大的那档 9558 也跑得起）。 */
function everyBed(check: (level: HallLevel, bedNo: number) => void): void {
  for (const level of HALL_LEVELS) {
    for (let bedNo = 0; bedNo < level.capacity; bedNo += 1) check(level, bedNo);
  }
}

// ————————————————————————— 级表（`docs/design/config.md` §2） —————————————————————————

describe('级表与 docs/design/config.md §2 逐档一致', () => {
  const docLevels = tableRows(readDoc('design/config.md'), '## 2. 级表', '## 3. 时间常量');

  it('级数、行列、容量、W×H、y:x、步长逐档对齐', () => {
    expect(HALL_LEVELS.length).toBe(docLevels.length);

    const mismatches: string[] = [];
    docLevels.forEach((row, index) => {
      mismatches.push(...levelMismatches(row, index));
    });

    expect(mismatches).toEqual([]);
  });

  it('不变式 ⑤：行列单调不减（后一级区域完全包含前一级）', () => {
    const violations: string[] = [];
    for (let index = 1; index < HALL_LEVELS.length; index += 1) {
      const previous = HALL_LEVELS[index - 1] as HallLevel;
      const level = HALL_LEVELS[index] as HallLevel;
      if (level.rows <= previous.rows || level.cols <= previous.cols || level.capacity <= previous.capacity) {
        violations.push(`第 ${index + 1} 级不再包含第 ${index} 级`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('触顶：最后一级 9558 ≤ 9999，再上一档（保持步长 ≥ 1.25）已越界', () => {
    expect(TOP.capacity).toBe(9558);
    expect(TOP.capacity).toBeLessThanOrEqual(9999);
    expect(Math.ceil(TOP.capacity * 1.25)).toBeGreaterThan(9999);

    expect(levelOf(HALL_LEVELS.length)).toBe(TOP);
    expect(levelOf(999)).toBe(TOP);
    expect(levelOf(-1)).toBe(HALL_LEVELS[0]);
    expect(bedCountOf(HALL_LEVELS.length - 1)).toBe(9558);
    expect(levelOf(0).capacity).toBe(117);
  });

  it('几何常量互不矛盾，布局版本号写在文档里', () => {
    expect(CELL_W).toBe(AISLE + BED_W + RESERVE_W);
    expect(CELL_H).toBe(BED_H + AISLE);
    expect(readDoc('design/config.md')).toContain(`\`${LAYOUT_VERSION}\``);
  });
});

/** 文档一行 vs 级表一档：把对不上的地方列出来。 */
function levelMismatches(row: string[], index: number): string[] {
  const [no, rows, cols, capacity, size, ratio, step] = row as [string, string, string, string, string, string, string];
  const level = HALL_LEVELS[index] as HallLevel;
  const previous = index > 0 ? (HALL_LEVELS[index - 1] as HallLevel) : undefined;
  const [width, height] = size.split('×').map((part) => Number(part));
  const out: string[] = [];
  const note = (detail: string): void => void out.push(`第 ${no} 级：${detail}`);
  const num = (cell: string): number => Number(cell.replaceAll('*', ''));

  if (level.rows !== num(rows) || level.cols !== num(cols)) note('行列数不符');
  if (level.capacity !== num(capacity)) note('容量与文档不符');
  if (level.capacity !== level.rows * level.cols) note('容量 ≠ R×C');
  if (level.width !== width || level.height !== height) note('W×H 与文档不符');
  if (level.width !== CELL_W * level.cols) note('W(C) 公式不符');
  if (level.height !== CELL_H * level.rows) note('H(R) 公式不符');

  const actualRatio = level.height / level.width;
  // 表格里的 y:x 是三位小数的显示值（第 1 级 0.6242 显示为 0.624），区间判据按显示值
  if (Number(actualRatio.toFixed(3)) !== Number(ratio)) note('y:x 与文档不符');
  if (Number(ratio) < 0.6 || Number(ratio) > 0.63) note(`y:x = ${ratio} 越出 0.60 ~ 0.63`);

  if (previous) {
    // 步长列是**两位小数的显示值**（例：第 4 级真值 1.2548 显示为 1.25），所以区间判据必须用
    // **容量比值**，不能用表里的显示值：真值下界是 1.25，不是 1.26
    const stepRatio = level.capacity / previous.capacity;
    if (Math.abs(stepRatio - Number(step)) > 0.01) note('容量步长与文档不符');
    if (stepRatio < 1.25 || stepRatio > 1.52) note(`容量步长 ${stepRatio.toFixed(4)} 越出 1.25 ~ 1.52`);
  }
  return out;
}

// ————————————————————————— 不变式 ②：墙（地板与墙 = 本级格网 + 四侧各一条走道） —————————————————————————

describe('不变式 ②：墙四侧各距格网 56px，且四侧互相相等', () => {
  it('逐档：墙矩形 = 本级格网外扩一条走道，四侧余量都等于 AISLE', () => {
    const bad: string[] = [];
    HALL_LEVELS.forEach((level, index) => {
      const wall = wallRegionOf(index);
      const note = (detail: string): void => void bad.push(`第 ${index + 1} 级：${detail}`);
      const margins = [
        ['左', 0 - wall.x],
        ['上', 0 - wall.y],
        ['右', wall.x + wall.width - level.width],
        ['下', wall.y + wall.height - level.height],
      ] as Array<[string, number]>;

      if (wall.x !== -AISLE || wall.y !== -AISLE) note(`左/上余量不在负坐标那一侧（${wall.x}, ${wall.y}）`);
      if (wall.width !== level.width + 2 * AISLE || wall.height !== level.height + 2 * AISLE) {
        note('宽高不是「本级格网 + 四侧各一条走道」');
      }
      for (const [side, margin] of margins) {
        if (margin !== AISLE) note(`${side}侧余量不是 ${AISLE}px（${margin}）`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('第一档与末档的黄金值（文档 §2）；越界的级号夹到两端', () => {
    expect(wallRegionOf(0)).toEqual({ x: -56, y: -56, width: 2361, height: 1516 });
    expect(wallRegionOf(HALL_LEVELS.length - 1)).toEqual({ x: -56, y: -56, width: 20526, height: 12748 });
    expect(wallRegionOf(HALL_LEVELS.length)).toEqual(wallRegionOf(HALL_LEVELS.length - 1));
    expect(wallRegionOf(-1)).toEqual(wallRegionOf(0));
  });

  it('逐档四侧余量里都有真的可走的点（左/上取负坐标带里的点，右/下取贴墙那一条）', () => {
    const bad: string[] = [];
    HALL_LEVELS.forEach((level, index) => {
      for (const point of marginProbes(level)) {
        if (!isWalkable(point.x, point.y, level.capacity)) {
          bad.push(`第 ${index + 1} 级余量里的点 (${point.x}, ${point.y}) 不可走`);
        }
      }
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 不变式 ④：取景范围（地板区 + 墙带 + 墙外一圈） —————————————————————————

describe('取景范围：地板区 + 墙带 + 墙外一圈（比厅大，多出来的那圈不可走）', () => {
  it('逐档：四边各外扩 WALL_WIDTH + OUTSIDE_MARGIN，且取景范围比地板区大', () => {
    const bad: string[] = [];
    HALL_LEVELS.forEach((level, index) => {
      const wall = wallRegionOf(index);
      const scroll = scrollRegionOf(index);
      const margin = WALL_WIDTH + OUTSIDE_MARGIN;
      const note = (detail: string): void => void bad.push(`第 ${index + 1} 级：${detail}`);

      if (scroll.x !== wall.x - margin || scroll.y !== wall.y - margin) note('左/上不是「地板区 + 墙带 + 墙外一圈」');
      if (scroll.width !== wall.width + 2 * margin || scroll.height !== wall.height + 2 * margin) {
        note('宽高不是「地板区 + 墙带 + 墙外一圈」');
      }
      if (scroll.width <= wall.width || scroll.height <= wall.height) note('取景范围没比地板区大');
    });
    expect(bad).toEqual([]);
  });

  it('第一档与末档的黄金值（文档 §2）；越界的级号夹到两端', () => {
    expect(scrollRegionOf(0)).toEqual({ x: -115, y: -115, width: 2479, height: 1634 });
    expect(scrollRegionOf(HALL_LEVELS.length - 1)).toEqual({ x: -115, y: -115, width: 20644, height: 12866 });
    expect(scrollRegionOf(HALL_LEVELS.length)).toEqual(scrollRegionOf(HALL_LEVELS.length - 1));
    expect(scrollRegionOf(-1)).toEqual(scrollRegionOf(0));
  });

  it('不变式 ④「可走范围 = 地板区」：取景范围的四角与四边中点那一圈都不可走', () => {
    const bad: string[] = [];
    HALL_LEVELS.forEach((level, index) => {
      const wall = wallRegionOf(index);
      const scroll = scrollRegionOf(index);
      const half = OUTSIDE_MARGIN / 2;
      const midX = wall.x + wall.width / 2;
      const midY = wall.y + wall.height / 2;
      const probes = [
        ['左上角', scroll.x, scroll.y],
        ['右上角', scroll.x + scroll.width, scroll.y],
        ['左下角', scroll.x, scroll.y + scroll.height],
        ['右下角', scroll.x + scroll.width, scroll.y + scroll.height],
        ['左边中点', wall.x - half, midY],
        ['右边中点', wall.x + wall.width + half, midY],
        ['上边中点', midX, wall.y - half],
        ['下边中点', midX, wall.y + wall.height + half],
      ] as Array<[string, number, number]>;

      for (const [side, x, y] of probes) {
        if (isWalkable(x, y, level.capacity)) bad.push(`第 ${index + 1} 级${side} (${x}, ${y}) 在墙外却是可走的`);
      }
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 不变式 ③：每张床左右各 56、床脚前 56 —————————————————————————

describe('不变式 ③：每张床左右各有 56px（一侧走道、一侧预留位），床脚前有 56px 横走道', () => {
  it('逐档逐床：床紧贴房间里的一侧、另一侧正好留下一个预留位，旁边那条竖走道可走', () => {
    const bad: string[] = [];
    everyBed((level, bedNo) => {
      const cell = cellOf(bedNo) as Cell;
      const position = positionOf(bedNo) as Point;
      const room = roomOf(bedNo) as Rect;
      const reserve = reserveOf(bedNo) as Rect;
      const left = position.x - room.x;
      const right = room.x + room.width - (position.x + BED_W);
      const aisleY = position.y + BED_H / 2;

      if (left + right !== RESERVE_W) bad.push(`床 ${bedNo} 另一侧不是一条预留位（${left} + ${right}）`);
      if (left !== 0 && left !== RESERVE_W) bad.push(`床 ${bedNo} 没靠在房间的一侧（${left}）`);
      if (reserve.x !== (left === 0 ? position.x + BED_W : position.x - RESERVE_W)) {
        bad.push(`床 ${bedNo} 的预留位不在床的另一侧`);
      }
      if (reserve.width !== RESERVE_W || reserve.height !== BED_H) bad.push(`床 ${bedNo} 的预留位尺寸不对`);

      // 走道永远在靠走道的那一侧（偶行在左、奇行在右；最后一列右边那条就是右贴墙走道）
      const aisleX = left === 0 ? room.x - AISLE / 2 : room.x + room.width + AISLE / 2;
      if (!isWalkable(aisleX, aisleY, level.capacity)) bad.push(`床 ${bedNo} 旁边那条竖走道不可走`);

      // 床脚前那条横走道带：中心点可走，且落在一条街行里
      const front = frontPointOf(bedNo) as Point;
      if (front.x !== position.x + BED_W / 2) bad.push(`床 ${bedNo} 的前方走道不在床脚正前`);
      if (position.y + CELL_H - front.y !== AISLE / 2) bad.push(`床 ${bedNo} 的前方走道不在带中心`);
      if (!isWalkable(front.x, front.y, level.capacity)) bad.push(`床 ${bedNo} 的床脚前走道不可走`);
      if (streetBandAt(front.y, level.rows) === undefined) bad.push(`床 ${bedNo} 的床脚前走道不在街行上`);
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 不变式 ⑥：房间内部（床 + 预留位）不可走 —————————————————————————

describe('不变式 ⑥：房间内部（床 + 预留位）不可走', () => {
  it('逐档逐床：床与预留位的四角都不可走，预留位也不是床', () => {
    const bad: string[] = [];
    everyBed((level, bedNo) => {
      const room = roomOf(bedNo) as Rect;
      const reserve = reserveOf(bedNo) as Rect;
      for (const [name, rect] of [
        ['房间', room],
        ['预留位', reserve],
      ] as Array<[string, Rect]>) {
        for (const [dx, dy] of [
          [0.5, 0.5],
          [rect.width - 0.5, 0.5],
          [0.5, rect.height - 0.5],
          [rect.width - 0.5, rect.height - 0.5],
        ] as Array<[number, number]>) {
          if (isWalkable(rect.x + dx, rect.y + dy, level.capacity)) {
            bad.push(`床 ${bedNo} 的${name}角 (${rect.x + dx}, ${rect.y + dy}) 落在街网上`);
          }
        }
      }
      if (bedNoAt(reserve.x + reserve.width / 2, reserve.y + reserve.height / 2, level.capacity) !== undefined) {
        bad.push(`床 ${bedNo} 的预留位被当成了床`);
      }
      if (room.width !== BED_W + RESERVE_W || room.height !== BED_H) bad.push(`床 ${bedNo} 的房间矩形不对`);
      if (room.x !== cellOf(bedNo)?.col! * CELL_W + AISLE) bad.push(`床 ${bedNo} 的房间不在格里`);
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 降级：旧外圈落在墙外 —————————————————————————

describe('降级：旧外圈落在墙外（区域即真相，由 recoverPosition 拉回街网）', () => {
  it('旧外圈的床不再算床；新列那一圈落在新墙之外，床心也不再是街', () => {
    const bad: string[] = [];
    for (let index = 1; index < HALL_LEVELS.length; index += 1) {
      const bedCount = bedCountOf(index - 1);
      const level = HALL_LEVELS[index] as HallLevel;
      const wall = wallRegionOf(index - 1);
      const note = (detail: string): void => void bad.push(`第 ${index + 1} 级：${detail}`);

      // 新增外圈的第一张床必然落在新列的起点上 = 新墙的右边界
      const first = positionOf(bedCount) as Point;
      if (first.x < wall.x + wall.width) note(`旧外圈的第一张床（${bedCount}）还在新墙之内`);

      for (const bedNo of [bedCount, Math.floor((bedCount + level.capacity) / 2), level.capacity - 1]) {
        const position = positionOf(bedNo) as Point;
        const center = { x: position.x + BED_W / 2, y: position.y + BED_H / 2 };
        const outside =
          center.x < wall.x ||
          center.y < wall.y ||
          center.x >= wall.x + wall.width ||
          center.y >= wall.y + wall.height;
        if (bedNoAt(center.x, center.y, bedCount) !== undefined) note(`降级后床 ${bedNo} 还算一张床`);
        if (!outside && isWalkable(center.x, center.y, bedCount)) note(`降级后床 ${bedNo} 的床心成了可走的街`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 不变式 ① ②：位置与床位数无关 —————————————————————————

describe('不变式 ① ②：床的位置与当前床位数无关', () => {
  const signaturesByLevel = HALL_LEVELS.map((level) =>
    Array.from({ length: level.capacity }, (_, bedNo) => signatureOf(bedNo)),
  );

  it('同一 bedNo 在任何级下都给出同一个格子与位置（全级交叉比对）', () => {
    for (let index = 0; index < signaturesByLevel.length; index += 1) {
      for (let higher = index + 1; higher < signaturesByLevel.length; higher += 1) {
        expect(signaturesByLevel[index]).toEqual(
          (signaturesByLevel[higher] as string[]).slice(0, (HALL_LEVELS[index] as HallLevel).capacity),
        );
      }
    }
  });

  it('位置由几何常量独立算出（含行奇偶错位），且每张床都在本级区域内', () => {
    const bad: string[] = [];
    everyBed((level, bedNo) => {
      const cell = cellOf(bedNo);
      const point = positionOf(bedNo);
      if (!cell || !point) {
        bad.push(`床 ${bedNo} 在第 ${level.capacity} 档没有格子`);
        return;
      }
      if (cell.row >= level.rows || cell.col >= level.cols) bad.push(`床 ${bedNo} 落在第 ${level.capacity} 档区域外`);
      const anchor = bedAnchor(cell.row, cell.col);
      if (point.x !== anchor.x || point.y !== anchor.y) bad.push(`床 ${bedNo} 的位置不是它格子的锚点`);
    });
    expect(bad).toEqual([]);
  });

  it('越界或不存在的床号返回空（房间与预留位也返回空）', () => {
    expect(cellOf(-1)).toBeUndefined();
    expect(cellOf(1.5)).toBeUndefined();
    expect(cellOf(TOP.capacity)).toBeUndefined();
    expect(positionOf(TOP.capacity)).toBeUndefined();
    expect(frontPointOf(TOP.capacity)).toBeUndefined();
    expect(roomOf(TOP.capacity)).toBeUndefined();
    expect(reserveOf(TOP.capacity)).toBeUndefined();
  });
});

// ————————————————————————— 不变式 ⑦：建成顺序编号 —————————————————————————

describe('不变式 ⑦：编号连续，且降级砍掉的正是最大那些编号', () => {
  it('每一级新增的床号恰为 [上一级容量, 本级容量)，且恰好落在新增外圈上', () => {
    const seenCells = new Set<string>();
    const bad: string[] = [];
    let previousCapacity = 0;

    for (const [index, level] of HALL_LEVELS.entries()) {
      const previous = index > 0 ? (HALL_LEVELS[index - 1] as HallLevel) : undefined;
      const ring: Array<{ row: number; col: number }> = [];

      for (let bedNo = previousCapacity; bedNo < level.capacity; bedNo += 1) {
        const cell = cellOf(bedNo);
        if (!cell) {
          bad.push(`床 ${bedNo} 没有格子`);
          continue;
        }
        if (cell.row >= level.rows || cell.col >= level.cols) bad.push(`床 ${bedNo} 落在第 ${index + 1} 级区域外`);
        if (previous && cell.row < previous.rows && cell.col < previous.cols) {
          bad.push(`床 ${bedNo} 落在上一级区域里（不是新增外圈）`);
        }
        const key = `${cell.row},${cell.col}`;
        if (seenCells.has(key)) bad.push(`格子 ${key} 被编成了两张床`);
        seenCells.add(key);
        ring.push(cell);
      }

      // 行优先：行不回头，行内列递增，行首从外圈该行的第一列起
      ring.forEach((cell, offset) => {
        const expected = ringRow(index, cell.row);
        if (offset > 0) {
          const last = ring[offset - 1] as { row: number; col: number };
          if (cell.row === last.row ? cell.col <= last.col : cell.row !== last.row + 1) {
            bad.push(`第 ${index + 1} 级的新增外圈不是行优先`);
          }
        }
        if (cell.col < expected.firstCol || cell.col >= expected.firstCol + expected.width) {
          bad.push(`床号 ${previousCapacity + offset} 不在该行的外圈列区间里`);
        }
      });

      ringMatchesRegionDifference(index, ring, bad);
      previousCapacity = level.capacity;
    }

    expect(bad).toEqual([]);
    expect(seenCells.size).toBe(TOP.capacity);

    // 单射：全部床号两两不同格
    const all = new Set(Array.from({ length: TOP.capacity }, (_, bedNo) => signatureOf(bedNo).split('@')[0] as string));
    expect(all.size).toBe(TOP.capacity);
  });

  it('降级只砍掉最大那些编号：任一级内 bedNo < capacity 的床都还在', () => {
    const bad: number[] = [];
    for (let index = 1; index < HALL_LEVELS.length; index += 1) {
      for (let bedNo = 0; bedNo < bedCountOf(index - 1); bedNo += 1) {
        if (bedNo >= bedCountOf(index) || cellOf(bedNo) === undefined) bad.push(bedNo);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** 新增外圈恰好等于「本级区域 − 上一级区域」：格数相等，且（配合调用方的区域内/外判据）不重不漏。 */
function ringMatchesRegionDifference(index: number, ring: Array<{ row: number; col: number }>, bad: string[]): void {
  const level = HALL_LEVELS[index] as HallLevel;
  const previous = index > 0 ? (HALL_LEVELS[index - 1] as HallLevel) : { rows: 0, cols: 0 };
  let expectedCount = 0;
  for (let row = 0; row < level.rows; row += 1) {
    for (let col = 0; col < level.cols; col += 1) {
      if (row < previous.rows && col < previous.cols) continue;
      expectedCount += 1;
    }
  }
  if (ring.length !== expectedCount) bad.push(`第 ${index + 1} 级外圈格数 ${ring.length} ≠ ${expectedCount}`);
}

// ————————————————————————— 不变式 ⑤：街网连通（逐级 BFS，路径只走街网） —————————————————————————

/** 街网上的采样边长：走道带 56 宽、横竖都够采样（14 = 56 / 4）。 */
const STEP = 14;

interface StreetGraph {
  cols: number;
  rows: number;
  visited: Uint8Array;
  from: Int32Array;
  start: number;
}

/** 该级**地板与墙**的矩形：采样格子的原点（左/上那条余量因此是格子的第 0 行 / 第 0 列）。 */
function wallRectOf(level: HallLevel): Rect {
  return wallRegionOf(HALL_LEVELS.indexOf(level));
}

/** 采样格子 (i, j) → 世界点。 */
function nodePoint(level: HallLevel, i: number, j: number): { x: number; y: number } {
  const wall = wallRectOf(level);
  return { x: wall.x + i * STEP, y: wall.y + j * STEP };
}

function nodeWalkable(level: HallLevel, i: number, j: number): boolean {
  const point = nodePoint(level, i, j);
  return isWalkable(point.x, point.y, level.capacity);
}

function graphCols(level: HallLevel): number {
  return Math.ceil(wallRectOf(level).width / STEP);
}

function graphRows(level: HallLevel): number {
  return Math.ceil(wallRectOf(level).height / STEP);
}

/** 世界点 → 最近的一个街网采样节点（同一行带 / 走道里，所以两者之间只走街网）。 */
function nodeOf(level: HallLevel, x: number, y: number): number {
  const wall = wallRectOf(level);
  return Math.floor((y - wall.y) / STEP) * graphCols(level) + Math.floor((x - wall.x) / STEP);
}

/** 采样节点可不可走。 */
function nodeWalkableAt(level: HallLevel, node: number): boolean {
  const cols = graphCols(level);
  const i = node % cols;
  return nodeWalkable(level, i, (node - i) / cols);
}

/** 四侧的地板余量里各取一点：左/上在负坐标那一侧，右/下在贴墙那一条（`docs/design/config.md` §7 不变式 ②）。 */
function marginProbes(level: HallLevel): Array<{ x: number; y: number }> {
  const wall = wallRectOf(level);
  return [
    { x: -AISLE / 2, y: 0 },
    { x: AISLE / 2, y: -AISLE / 2 },
    { x: level.width + AISLE / 2, y: BED_H + AISLE / 2 },
    { x: AISLE / 2, y: level.height + AISLE / 2 },
  ].filter((point) => point.x >= wall.x + WALL_BODY && point.y >= wall.y + WALL_BODY);
}

function bfs(level: HallLevel, start: number): StreetGraph {
  const cols = graphCols(level);
  const rows = graphRows(level);
  const visited = new Uint8Array(cols * rows);
  const from = new Int32Array(cols * rows).fill(-1);
  const queue: number[] = [start];
  visited[start] = 1;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    const i = current % cols;
    const j = (current - i) / cols;
    for (const [ni, nj] of [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1],
    ] as Array<[number, number]>) {
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const index = nj * cols + ni;
      if (visited[index] === 1 || !nodeWalkable(level, ni, nj)) continue;
      visited[index] = 1;
      from[index] = current;
      queue.push(index);
    }
  }
  return { cols, rows, visited, from, start };
}

/** 回溯出 start → target 的节点序列（并逐节点校验它只走街网、每一步只挪一格）。 */
function streetPath(level: HallLevel, graph: StreetGraph, target: number, bad: string[]): number[] {
  const path: number[] = [];
  for (let index = target; index !== -1; index = graph.from[index] as number) {
    path.push(index);
    if (index === graph.start) break;
  }
  path.reverse();

  if (path[0] !== graph.start) {
    bad.push('回溯不出路径');
    return [];
  }
  path.forEach((node, offset) => {
    const i = node % graph.cols;
    const j = (node - i) / graph.cols;
    if (!nodeWalkable(level, i, j)) bad.push(`路径第 ${offset} 步离开了街网`);
    if (offset > 0) {
      const previous = path[offset - 1] as number;
      const pi = previous % graph.cols;
      const pj = (previous - pi) / graph.cols;
      if (Math.abs(i - pi) + Math.abs(j - pj) !== 1) bad.push(`路径第 ${offset} 步不是相邻格`);
    }
  });
  return path;
}

/** 取若干张床：首尾、每行带的两端、级界上的床（降级最先消失的那些）。 */
function sampledBedNos(level: HallLevel): number[] {
  const { capacity, cols } = level;
  const index = HALL_LEVELS.indexOf(level);
  const nos = [0, 1, Math.floor(capacity / 2), capacity - cols, capacity - cols + 1, capacity - 2, capacity - 1];
  if (index > 0) nos.push(bedCountOf(index - 1), bedCountOf(index - 1) + 1);
  return [...new Set(nos)].filter((bedNo) => bedNo >= 0 && bedNo < capacity).sort((a, b) => a - b);
}

describe('不变式 ⑤：街网连通（逐级 BFS，路径只走街网）', () => {
  it('任取若干张床（含边界与最高级），它们的前方走道两两可达', () => {
    const bad: string[] = [];
    const stats = { beds: 0, searches: 0, paths: 0, reached: 0, longestPath: 0 };

    for (const level of HALL_LEVELS) {
      const bedNos = sampledBedNos(level);
      stats.beds += bedNos.length;

      const nodes = bedNos.map((bedNo) => {
        const front = frontPointOf(bedNo);
        if (!front || !isWalkable(front.x, front.y, level.capacity)) bad.push(`床 ${bedNo} 的前方走道不可走`);
        const center = positionOf(bedNo);
        if (center && isWalkable(center.x + BED_W / 2, center.y + BED_H / 2, level.capacity)) {
          bad.push(`床 ${bedNo} 自己变成了可走的格子`);
        }
        if (!front) return -1;
        const node = nodeOf(level, front.x, front.y);
        if (!nodeWalkableAt(level, node)) bad.push(`床 ${bedNo} 的前方走道不在街网采样上`);
        return node;
      });

      // 从最前与最后一张床各搜一次，其余每一张都必须可达
      for (const origin of [0, nodes.length - 1]) {
        const start = nodes[origin] as number;
        const graph = bfs(level, start);
        stats.searches += 1;
        let reached = 0;
        for (let offset = 0; offset < nodes.length; offset += 1) {
          if (graph.visited[nodes[offset] as number] === 1) reached += 1;
          else bad.push(`床 ${bedNos[offset]} 从床 ${bedNos[origin]} 走不到`);
        }
        stats.reached += reached;

        // 四侧余量里的点也必须在同一片街网上（地板区比床位区大一圈）
        for (const probe of marginProbes(level)) {
          const node = nodeOf(level, probe.x, probe.y);
          if (!nodeWalkableAt(level, node)) bad.push(`余量里的点 (${probe.x}, ${probe.y}) 不在街网采样上`);
          else if (graph.visited[node] !== 1) bad.push(`余量里的点 (${probe.x}, ${probe.y}) 从床 ${bedNos[origin]} 走不到`);
        }

        const target = nodes[nodes.length - 1 - origin] as number;
        const path = streetPath(level, graph, target, bad);
        if (path.length > 0) {
          stats.paths += 1;
          stats.longestPath = Math.max(stats.longestPath, path.length);
        }
      }
    }

    expect(bad).toEqual([]);
    expect(stats.beds).toBeGreaterThan(0);
    expect(stats.searches).toBe(HALL_LEVELS.length * 2);
    expect(stats.paths).toBe(HALL_LEVELS.length * 2);
    // 每次搜索都要看见该级全部采样床（两张边界床各搜一次，所以是两倍）
    expect(stats.reached).toBe(stats.beds * 2);
    // 最高级里，最远的两张床之间是一条比整个厅还长的路径（不是只测相邻两格）
    expect(stats.longestPath * STEP).toBeGreaterThan(TOP.width);
  });

  it('不变式 ②：贴墙那一圈是**连通的环形走道**（四侧采样点全可走）', () => {
    const bad: string[] = [];
    HALL_LEVELS.forEach((level, index) => {
      const wall = wallRegionOf(index);
      const left = wall.x + WALL_BODY + 2;
      const right = wall.x + wall.width - WALL_BODY - 1;
      const top = wall.y + WALL_BODY + 2;
      const bottom = wall.y + wall.height - WALL_BODY - 1;
      const ring: Array<[number, number]> = [];
      for (let x = left; x <= right; x += 16) ring.push([x, top], [x, bottom]);
      for (let y = top; y <= bottom; y += 16) ring.push([left, y], [right, y]);

      for (const [x, y] of ring) {
        if (!isWalkable(x, y, level.capacity)) bad.push(`第 ${index + 1} 级：环形走道上的 (${x}, ${y}) 不可走`);
      }
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 命中判定与世界几何 —————————————————————————

describe('命中判定与世界几何', () => {
  const sample = [0, 5, 116, 117, 149, 150, 500, 5000, TOP.capacity - 1];

  it(`整张表 ${TOP.capacity} 张床的床心都能命中自己，床的占用矩形都不可走`, () => {
    const bad: string[] = [];
    everyBed((_level, bedNo) => {
      const position = positionOf(bedNo) as Point;
      if (bedNoAt(position.x + BED_W / 2, position.y + BED_H / 2) !== bedNo) bad.push(`床 ${bedNo} 的床心命不中`);
      for (const [dx, dy] of [
        [0.5, 0.5],
        [BED_W - 0.5, 0.5],
        [0.5, BED_H - 0.5],
        [BED_W - 0.5, BED_H - 0.5],
      ] as Array<[number, number]>) {
        if (isWalkable(position.x + dx, position.y + dy)) bad.push(`床 ${bedNo} 的占用矩形落在街网上`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('床心命中自己那张床，床脚前走道不可命中', () => {
    const bad: string[] = [];
    for (const bedNo of sample) {
      const position = positionOf(bedNo) as Point;
      const center = bedNoAt(position.x + BED_W / 2, position.y + BED_H / 2);
      if (center !== bedNo) bad.push(`床 ${bedNo} 的床心命中了 ${center}`);

      const front = frontPointOf(bedNo) as Point;
      if (bedNoAt(front.x, front.y) !== undefined) bad.push(`床 ${bedNo} 的走道被当成了床`);
      if (!isWalkable(front.x, front.y)) bad.push(`床 ${bedNo} 的走道不可走`);
      if (isWalkable(position.x + BED_W / 2, position.y + BED_H / 2)) bad.push(`床 ${bedNo} 的床心可走`);
    }
    expect(bad).toEqual([]);
  });

  it('竖走道可走不可命中；房间里的预留位既不可走也不可命中', () => {
    const position = positionOf(3) as Point;
    const aisleX = (positionOf(4) as Point).x - AISLE / 2; // 床 4 左边那条竖走道
    expect(isWalkable(aisleX, position.y + BED_H / 2)).toBe(true);
    expect(bedNoAt(aisleX, position.y + BED_H / 2)).toBeUndefined();

    const reserve = reserveOf(3) as Rect;
    const reserveCenter = { x: reserve.x + reserve.width / 2, y: reserve.y + reserve.height / 2 };
    expect(isWalkable(reserveCenter.x, reserveCenter.y)).toBe(false);
    expect(bedNoAt(reserveCenter.x, reserveCenter.y)).toBeUndefined();
  });

  it('传了 bedCount 时，越过当前容量的床不算床；它落在新墙之外（要靠恢复拉回街网）', () => {
    const first = bedCountOf(0);
    const second = bedCountOf(1);
    const outer = positionOf(first) as Point; // 第 2 级才有的床
    const center = { x: outer.x + BED_W / 2, y: outer.y + BED_H / 2 };
    expect(bedNoAt(center.x, center.y, first)).toBeUndefined();
    expect(bedNoAt(center.x, center.y, second)).toBe(first);
    expect(isWalkable(center.x, center.y, first)).toBe(false);
    // 床心按整张表判定也不是街
    expect(isWalkable(center.x, center.y)).toBe(false);
  });

  it('墙之外一律不是床也不可走', () => {
    const wall = wallRegionOf(HALL_LEVELS.length - 1);
    expect(bedNoAt(-1, -1)).toBeUndefined();
    expect(isWalkable(wall.x - 1, 0)).toBe(false);
    expect(isWalkable(0, wall.y - 1)).toBe(false);
    expect(isWalkable(wall.x + wall.width, 0)).toBe(false);
    expect(isWalkable(0, wall.y + wall.height)).toBe(false);
  });
});

// ————————————————————————— 不变式 ⑥：positionOf 与 bedNoAt 互为逆 —————————————————————————

describe('不变式 ⑥：`positionOf` 与 `bedNoAt` 互为逆（含行奇偶错位）', () => {
  it('逐档逐床：床心命中自己；错位量 = 预留位宽，偶行靠走道侧、奇行靠另一侧', () => {
    const bad: string[] = [];
    everyBed((level, bedNo) => {
      const cell = cellOf(bedNo) as Cell;
      const room = roomOf(bedNo) as Rect;
      const position = positionOf(bedNo) as Point;
      const offset = position.x - room.x;
      if (offset !== (cell.row % 2 === 0 ? 0 : RESERVE_W)) bad.push(`床 ${bedNo} 的行奇偶错位不对（${offset}）`);
      if (position.y !== cell.row * CELL_H) bad.push(`床 ${bedNo} 的行锚点不对`);

      const center = { x: position.x + BED_W / 2, y: position.y + BED_H / 2 };
      if (bedNoAt(center.x, center.y, level.capacity) !== bedNo) bad.push(`床 ${bedNo} 的床心没命中自己`);
      if (bedNoAt(center.x, center.y) !== bedNo) bad.push(`床 ${bedNo} 的床心在整表判定下没命中自己`);
    });
    expect(bad).toEqual([]);
  });
});

// ————————————————————————— 吸附到街网（客户端点地面 / 服务端位置恢复） —————————————————————————

describe('`nearestStreetPoint`：离给定点最近的街网点', () => {
  const capacity = bedCountOf(0);

  it('已经在街网上就原样返回（客户端点走道不该被挪动）', () => {
    const front = frontPointOf(3) as Point;
    expect(nearestStreetPoint(front, capacity)).toEqual(front);
  });

  it('点在床上 → 竖直方向吸到最近的那条横走道（仍在本级区域内）', () => {
    const position = positionOf(3) as Point;
    const center = { x: position.x + BED_W / 2, y: position.y + BED_H / 2 };
    const snapped = nearestStreetPoint(center, capacity) as Point;

    expect(snapped.x).toBe(center.x);
    expect(snapped.y).toBeGreaterThanOrEqual(position.y + BED_H);
    expect(snapped.y).toBeLessThan(position.y + CELL_H);
    expect(isWalkable(snapped.x, snapped.y, capacity)).toBe(true);
  });

  it('吸附结果永远可走（随机点扫一遍，含边界与厅外）', () => {
    const level = levelOf(0);
    for (let x = -20; x <= level.width + 20; x += 37) {
      for (let y = -20; y <= level.height + 20; y += 23) {
        const snapped = nearestStreetPoint({ x, y }, level.capacity);
        expect(snapped, `(${x}, ${y}) 找不到街网点`).toBeDefined();
        expect(isWalkable((snapped as Point).x, (snapped as Point).y, level.capacity)).toBe(true);
      }
    }
  });

  it('降级之后：旧外圈的旧位置被拉回可走的街网（墙已经收回来了）', () => {
    const wall = wallRegionOf(0);
    const outer = positionOf(bedCountOf(1)) as Point; // 第 2 级才有的第一张床
    const snapped = nearestStreetPoint({ x: outer.x + BED_W / 2, y: outer.y + BED_H / 2 }, capacity) as Point;

    expect(isWalkable(snapped.x, snapped.y, capacity)).toBe(true);
    expect(snapped.x).toBeGreaterThanOrEqual(wall.x + WALL_BODY);
    expect(snapped.x).toBeLessThan(wall.x + wall.width - WALL_BODY);
  });

  it('点在右/下余量里的地面：目标留在余量里，不被拉回床位区', () => {
    const level = levelOf(0);
    const point = { x: level.width + AISLE / 2, y: BED_H + AISLE / 2 };
    expect(nearestStreetPoint(point, capacity)).toEqual(point);
  });
});

// ————————————————————————— 世界几何的黄金值 —————————————————————————

describe('世界几何的黄金值（新几何的钉点）', () => {
  it('抽几条：格子、床的锚点、床脚前走道中心、房间与预留位', () => {
    expect(cellOf(0)).toEqual({ row: 0, col: 0 });
    expect(cellOf(116)).toEqual({ row: 8, col: 12 });
    expect(cellOf(117)).toEqual({ row: 0, col: 13 });
    expect(positionOf(0)).toEqual({ x: 56, y: 0 }); // 偶行靠走道侧
    expect(positionOf(14)).toEqual({ x: CELL_W + AISLE + RESERVE_W, y: CELL_H }); // 奇行靠另一侧
    expect(frontPointOf(0)).toEqual({ x: 86.5, y: 128 });
    expect(bedNoAt(86.5, 50)).toBe(0);
    expect(roomOf(0)).toEqual({ x: 56, y: 0, width: BED_W + RESERVE_W, height: BED_H });
    expect(reserveOf(0)).toEqual({ x: 56 + BED_W, y: 0, width: RESERVE_W, height: BED_H });
    expect(reserveOf(14)).toEqual({ x: CELL_W + AISLE, y: CELL_H, width: RESERVE_W, height: BED_H });
  });

  it('第一档的床位区与墙矩形（地板区是它四侧各外扩一条走道）', () => {
    expect(regionOf(0)).toMatchObject({ rows: 9, cols: 13, width: 2249, height: 1404 });
    expect(wallRegionOf(0)).toEqual({ x: -56, y: -56, width: 2361, height: 1516 });
  });
});
