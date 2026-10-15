import type { Person, PersonState } from '../../shared/protocol';
import { TILE } from './scene';

/**
 * 世界画布的纯规则：与 Pixi 无关，可单测。
 * 这些判断是「床位真值表」的直接翻译（见 `docs/ui/DESIGN.md` Components 节）。
 */

/**
 * 轮廓梯次：床上有人 → `line`；睡痕 → `trace`；空床 → `claimed`。
 * 梯次只有三档颜色，**归属走线型**这条正交通道：无主空床虚线、有主实线。
 */
export interface BedOutline {
  tier: 'line' | 'trace' | 'claimed';
  dashed: boolean;
}

/** 占用优先于归属；无主空床**不返回空值**——它是「这里可以躺」的唯一提示。 */
export function bedOutline(input: { owned: boolean; occupant?: PersonState }): BedOutline {
  if (input.occupant === 'lying' || input.occupant === 'asleep') return { tier: 'line', dashed: false };
  if (input.occupant === 'trace') return { tier: 'trace', dashed: false };
  return { tier: 'claimed', dashed: !input.owned };
}

/**
 * 床位画法签名：占用走梯次首字母（l/t/c）、归属走 d，加上昼夜、缩放与床数。
 * 任何一项变了画法就变（线宽与虚线按屏幕像素给、描边色随昼夜），签名不变才能跳过整段重建。
 */
export function bedPaintSignature(input: {
  mode: 'day' | 'night';
  scale: number;
  outlines: readonly BedOutline[];
}): string {
  const { mode, scale, outlines } = input;
  // 每床一个字符本来已隐含床数，但显式写出来，签名才不依赖「一床一字符」这条编码约定
  return `${mode}|${scale}|${outlines.length}|${outlines
    .map((outline) => (outline.dashed ? 'd' : outline.tier.charAt(0)))
    .join('')}`;
}

/** 一条虚线段（世界坐标）。 */
export interface DashSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 把一条边切成虚线：首段从起点开始、末段正好落在终点（不悬挂半段），覆盖长度等于这条边。
 * 段数由「实线段 + 间隔」的周期推出，再把间隔均摊到两端对齐——虚线的可辨性靠对齐，不靠凑节拍。
 */
export function dashSegments(input: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  dash: number;
  gap: number;
}): DashSegment[] {
  const { from, to, dash, gap } = input;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0 || dash <= 0) return [];

  // n 段实线 + (n-1) 个间隔 = 边长，两个端点因此必然贴边
  const count = Math.min(Math.max(Math.round((length + gap) / (dash + gap)), 1), Math.max(1, Math.floor(length / dash)));
  const dashLength = count === 1 ? length : Math.min(dash, length / count);
  const gapLength = count === 1 ? 0 : (length - count * dashLength) / (count - 1);

  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  return Array.from({ length: count }, (_, index) => {
    const start = index * (dashLength + gapLength);
    return {
      x1: from.x + ux * start,
      y1: from.y + uy * start,
      x2: from.x + ux * (start + dashLength),
      y2: from.y + uy * (start + dashLength),
    };
  });
}

/**
 * 一张床的四条边各切成虚线：矩形由四条边首尾相接围成，每条边独立分段（虚线节奏不跨角延续）。
 * 圆角矩形不做（虚线画圆角成本高）；圆角只出现在界面控件上。
 */
export function bedDashSegments(input: {
  x: number;
  y: number;
  size: number;
  dash: number;
  gap: number;
}): DashSegment[] {
  const { x, y, size, dash, gap } = input;
  const corners = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return corners.flatMap((corner, index) =>
    dashSegments({ from: corner, to: corners[(index + 1) % corners.length], dash, gap }),
  );
}

/** 世界像素矩形。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一个尺寸对（视口用 CSS 像素、场景用世界像素，形状相同）。 */
export interface Size {
  width: number;
  height: number;
}

/**
 * 世界相机（见 `docs/ui/DESIGN.md`「世界相机」）：默认缩放、夹取、回中、跟随判定。
 * 相机位置 = 屏幕左上角对应的世界坐标，于是「可见区」就是 `[viewport, scene * scale]` 这两条线的关系。
 */

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** 默认缩放的下限 = 设计像素 1:1（一格 `TILE` 世界像素正好落在 `TILE` CSS 像素上）。 */
export const DEFAULT_SCALE_FLOOR = 1;

/**
 * 默认缩放 = `max(整厅刚好放得下, 1.0)`。
 * 手机竖屏整厅 fit≈0.35，按 fit 铺满就得把 35 格塞进一屏，人看不清、也点不中；
 * 写成 `max` 而不是断点分支，是因为断点在旋屏时会从 1.66 直接掉到 0.57，镜头一次跳三级。
 */
export function defaultScale(input: { viewport: Size; scene: Size }): number {
  const fit = Math.min(input.viewport.width / input.scene.width, input.viewport.height / input.scene.height);
  return Math.max(fit, DEFAULT_SCALE_FLOOR);
}

/**
 * 相机夹取：不越过场景边界（禁止拖出大厅看到一片空白）；可见区大于场景时居中。
 * 能拖的范围因此是 `[viewport - scene * scale, 0]`，越界值回夹到端点，而不是把画面留白。
 */
export function clampCamera(input: {
  x: number;
  y: number;
  scale: number;
  viewport: Size;
  scene: Size;
}): { x: number; y: number } {
  const axis = (value: number, view: number, span: number): number => {
    const scaled = span * input.scale;
    return scaled <= view ? (view - scaled) / 2 : clamp(value, view - scaled, 0);
  };
  return {
    x: axis(input.x, input.viewport.width, input.scene.width),
    y: axis(input.y, input.viewport.height, input.scene.height),
  };
}

/** 让某个世界坐标落在屏幕正中的相机位置（已夹取）：初始对准、点自己回中、跟随共用一套算法。 */
export function cameraFor(input: {
  scale: number;
  focus: { x: number; y: number };
  viewport: Size;
  scene: Size;
}): { x: number; y: number } {
  return clampCamera({
    x: input.viewport.width / 2 - input.focus.x * input.scale,
    y: input.viewport.height / 2 - input.focus.y * input.scale,
    scale: input.scale,
    viewport: input.viewport,
    scene: input.scene,
  });
}

/** 屏幕中央区（占屏幕的比例）。放在这一块里的自己不值得动镜头，否则一走动画面就晃。 */
export const CENTER_BAND = 0.4;

/** 这个屏幕点是否已在中央区之外（跟随的触发条件）。 */
export function outsideCenterBand(input: { point: { x: number; y: number }; viewport: Size }): boolean {
  const { point, viewport } = input;
  return (
    Math.abs(point.x - viewport.width / 2) > (viewport.width * CENTER_BAND) / 2 ||
    Math.abs(point.y - viewport.height / 2) > (viewport.height * CENTER_BAND) / 2
  );
}

/** 墙的几何：`band` 是环带的外沿（场景范围），`inner` 是墙围出的地面。 */
export interface WallGeometry {
  band: Rect;
  inner: Rect;
}

/**
 * 墙 = 场景最外侧**整行 / 整列**全被 `blocked` 占满的那几圈。
 * 只认整行整列，是因为内部障碍（柱子、家具）不围成环带——把它们当墙会凭空造出一间房。
 * 厚度由扫描得出（不写死 1 格）：某侧厚度为 0 时该侧内沿就贴合场景边界，
 * 整圈都没有厚度时 `band` 退化成空矩形，调用方据此不画墙。
 */
export function wallGeometry(input: {
  width: number;
  height: number;
  blocked: readonly (readonly [number, number])[];
}): WallGeometry {
  const { width, height, blocked } = input;
  const wall = new Set(blocked.map(([x, y]) => `${x},${y}`));
  const rowFull = (y: number): boolean => {
    for (let x = 0; x < width; x += 1) if (!wall.has(`${x},${y}`)) return false;
    return width > 0;
  };
  const colFull = (x: number): boolean => {
    for (let y = 0; y < height; y += 1) if (!wall.has(`${x},${y}`)) return false;
    return height > 0;
  };

  // 相对两边的扫描要互相让位（`- top` / `- left`），否则整场景被占满时会重复计数
  let top = 0;
  while (top < height && rowFull(top)) top += 1;
  let bottom = 0;
  while (bottom < height - top && rowFull(height - 1 - bottom)) bottom += 1;
  let left = 0;
  while (left < width && colFull(left)) left += 1;
  let right = 0;
  while (right < width - left && colFull(width - 1 - right)) right += 1;

  const inner: Rect = {
    x: left * TILE,
    y: top * TILE,
    width: (width - left - right) * TILE,
    height: (height - top - bottom) * TILE,
  };
  // 环带画成「整块铺 band + 用 inner 盖回地板色」两次矩形填充（Pixi 没有孔洞填充 API），
  // 所以 band 取环带的外沿而不是环带本身。
  const band: Rect =
    left + right + top + bottom > 0
      ? { x: 0, y: 0, width: width * TILE, height: height * TILE }
      : { x: 0, y: 0, width: 0, height: 0 };
  return { band, inner };
}

/** 名字只出现在**有人的床上**，且自己一律不画（地上的自己更不画）。 */
export function shouldDrawName(person: Person, meId: string | undefined): boolean {
  return person.state !== 'roaming' && person.id !== meId;
}

/** 睡痕的小人整体降不透明度：不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色。 */
export function personAlpha(state: PersonState): number {
  return state === 'trace' ? 0.45 : 1;
}

/**
 * 暖灯标记的半径：**有最小屏幕尺寸下限**（缩小时不得消隐，否则找不到我的床）。
 * 上限只用来避免「比床还大」的荒唐值，所以下限优先于上限。
 */
export function markerRadius(scale: number, tile: number): number {
  const minScreenPx = 5;
  const floorRadius = minScreenPx / Math.max(scale, 0.01);
  const ceilingRadius = tile * 0.6;
  return Math.min(Math.max(floorRadius, tile * 0.12), ceilingRadius);
}

/**
 * 轻点命中（屏幕点已换算成**格坐标的浮点值**）：人 > 空床 > 地面（见 `docs/ui/DESIGN.md`）。
 * 命中判定与 Pixi 无关，可单测。
 */

/** 人物当前位置（格坐标的浮点值；整数部分是格子号）。 */
export interface PersonSpot {
  id: string;
  x: number;
  y: number;
}

/** 轻点的命中半径（格）。比一格小得多：点人是有意为之，不是「附近有人就算」。 */
export const PERSON_HIT_TILES = 0.6;

const inReach = (spot: PersonSpot, point: { x: number; y: number }, radiusTiles: number): boolean =>
  Math.hypot(spot.x - point.x, spot.y - point.y) <= radiusTiles;

/** 半径内的人：命中多个时取 **y 最大**者（画面上更靠下 = 更靠前，与按 y 排序的遮挡一致）。 */
export function personHit(
  spots: readonly PersonSpot[],
  point: { x: number; y: number },
  radiusTiles: number,
): PersonSpot | undefined {
  let best: PersonSpot | undefined;
  for (const spot of spots) {
    if (!inReach(spot, point, radiusTiles)) continue;
    if (!best || spot.y > best.y) best = spot;
  }
  return best;
}

export type TapTarget =
  | { kind: 'select'; id: string }
  | { kind: 'lie'; bedNo: number }
  | { kind: 'walk'; x: number; y: number }
  | { kind: 'recenter' }
  | { kind: 'none' };

interface TapInput {
  /** 轻点的格坐标浮点值 */
  point: { x: number; y: number };
  spots: readonly PersonSpot[];
  selfId?: string;
  /** 该格床上的占用者 id（含自己）；空床为 `undefined` */
  residentId?: string;
  bedNo?: number;
  walkable: boolean;
}

/**
 * 轻点该干什么：① 半径内的别人 → 选中；② 点自己 → 相机居中自己（不是「什么都不做」）；
 * ③ 空床 → 躺下；④ 床上有人（含自己）→ 什么都不做；⑤ 可走的地面 → 走过去；⑥ 其余 → 什么都不做。
 * ② 与 ④ 都要点到自己：前者是「把镜头拉回自己」，后者是床上那个位置本来就没有动作可做，别把两者合成一个 `none`。
 *
 * **床格绝不能落成 `walk`**：服务端会回 `3006`，等于点了个空气。
 * `walk` 的 x/y 已向下取整成格号（意图是「我要去这一格」）。
 */
export function tapTargetFor(input: TapInput): TapTarget {
  const { point, spots, selfId, residentId, bedNo, walkable } = input;

  const other = personHit(
    spots.filter((spot) => spot.id !== selfId),
    point,
    PERSON_HIT_TILES,
  );
  if (other) return { kind: 'select', id: other.id };

  // 点自己：相机居中自己——我知道我是谁，但常想找回自己在哪
  if (selfId !== undefined && spots.some((spot) => spot.id === selfId && inReach(spot, point, PERSON_HIT_TILES))) {
    return { kind: 'recenter' };
  }

  if (bedNo !== undefined) return residentId === undefined ? { kind: 'lie', bedNo } : { kind: 'none' };
  return walkable ? { kind: 'walk', x: Math.floor(point.x), y: Math.floor(point.y) } : { kind: 'none' };
}

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** 厅时区里的小时数（时区名非法时回落到 UTC）。 */
export function hourIn(timezone: string, now: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '');
    return Number.isFinite(hour) ? hour % 24 : new Date(now).getUTCHours();
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** 昼夜只看**厅的时区**：厅是共享空间，物理上只能有一片天空。 */
export function isDaytime(timezone: string, now: number): boolean {
  const hour = hourIn(timezone, now);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}
