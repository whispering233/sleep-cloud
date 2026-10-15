import { BED_H, BED_W } from '../../shared/constants';
import type { Person, PersonState } from '../../shared/protocol';
import type { Point } from '../../shared/layout';
import { interpolationDelay, positionAt } from '../motion';
import type { Motion } from '../motion';

/**
 * 世界画布的纯规则：与 Phaser 无关，可单测。坐标一律是**世界像素**（1 世界像素 = 1 CSS 像素）。
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
 * 单张床的画法签名：占用走梯次首字母（l/t/c）、归属走线型（d/s）、我的床标记走 m。
 * 任何一项变了画法就变；签名不变才能跳过重建（床在视野里常驻，重建图形是每帧最贵的部分）。
 */
export function bedPaintSignature(input: { outline: BedOutline; mine: boolean }): string {
  const { outline, mine } = input;
  return `${outline.tier.charAt(0)}|${outline.dashed ? 'd' : 's'}|${mine ? 'm' : '-'}`;
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
  width: number;
  height: number;
  dash: number;
  gap: number;
}): DashSegment[] {
  const { x, y, width, height, dash, gap } = input;
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return corners.flatMap((corner, index) =>
    dashSegments({ from: corner, to: corners[(index + 1) % corners.length] as Point, dash, gap }),
  );
}

/**
 * 跟随的一步：朝目标**匀速**靠近，帧率无关（`docs/ui/DESIGN.md`「世界相机」的跟随行）。
 *
 * 不用 Phaser 的逐帧固定比例 lerp：那会让首帧步进正比于距离（实测跳 20~33px），且帧率一变速度就变。
 * 步长沿距离向量取而不是逐轴取，否则斜向靠近会比单轴快 √2 倍；`距离 ≤ 一步` 时直接落到目标，不越过。
 */
export function cameraStep(input: {
  scroll: { x: number; y: number };
  target: { x: number; y: number };
  dtMs: number;
  maxPxPerS: number;
}): { x: number; y: number } {
  const { scroll, target, dtMs, maxPxPerS } = input;
  const dx = target.x - scroll.x;
  const dy = target.y - scroll.y;
  const distance = Math.hypot(dx, dy);
  const step = (Math.max(0, maxPxPerS) * Math.max(0, dtMs)) / 1000;
  if (distance === 0 || distance <= step) return { x: target.x, y: target.y };
  return { x: scroll.x + (dx / distance) * step, y: scroll.y + (dy / distance) * step };
}

/**
 * 跟随的一步：朝**超出死区的那一段**靠近，而不是朝死区边缘靠近。
 *
 * 朝死区边缘靠：步长是「半个死区」，远大于小人一帧的位移，于是每拍都冲进死区、之后几帧一动不动——
 * 稳态走动时整幅画面每拍回跳一次（实测 28fps 与 38fps 都是 4 帧一个脉冲，幅值 = 单帧上限 500×dt）。
 * 靠「超出的那一段」正好把死区边缘钉在小人身上：稳态下相机步进 = 小人的步进，没有 0 帧；
 * 离得远（拖拽松手、点自己回中）时仍是 `maxPxPerS` 上限，追平段与修前一致。
 */
export function followStep(input: {
  /** 小人的取位点（渲染用的是**同一个**点，见 `personPoint`） */
  point: { x: number; y: number };
  /** 相机的视野中心（世界像素） */
  center: { x: number; y: number };
  halfWidth: number;
  halfHeight: number;
  dtMs: number;
  maxPxPerS: number;
}): { x: number; y: number } {
  const { point, center, halfWidth, halfHeight, dtMs, maxPxPerS } = input;
  const overshoot = {
    x: point.x - Math.min(Math.max(point.x, center.x - halfWidth), center.x + halfWidth),
    y: point.y - Math.min(Math.max(point.y, center.y - halfHeight), center.y + halfHeight),
  };
  if (overshoot.x === 0 && overshoot.y === 0) return center; // 还在死区里：镜头一动不动
  return cameraStep({
    scroll: center,
    target: { x: center.x + overshoot.x, y: center.y + overshoot.y },
    dtMs,
    maxPxPerS,
  });
}

/**
 * 一个人此刻画在哪（世界像素）：漫游中按插值（滞后取**这个窗口自己的跨度**），其余状态用给定的落位点。
 *
 * **渲染与相机跟随必须共用同一个返回值**：同一个人、同一帧、同一个 `serverNow` 只能取一次位。
 * 两处各取一次时，只要有一处用了上一次的窗口或另一个时刻，相机就会追着画面外的那个点走。
 */
export function personPoint(input: {
  person: Person;
  motion: Motion | undefined;
  /** 非漫游状态的落位点（自己的床 / 别人的床）；取不到就没得画 */
  bedPoint?: { x: number; y: number };
  serverNow: number;
}): { x: number; y: number } | undefined {
  const { person, motion, bedPoint, serverNow } = input;
  if (person.state !== 'roaming') return bedPoint;
  return motion ? positionAt(motion, serverNow - interpolationDelay(motion)) : { x: person.x, y: person.y };
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
 * 睡痕到期由**客户端**按快照里的 `traceUntil` 自行淡出：服务端不写库、不广播、不起定时器
 * （见 `docs/api/20-api-ws.md` §4.2）。到点之后这条条目就不该再画出来。
 */
export function isFaded(person: Person, serverNow: number): boolean {
  return person.traceUntil !== undefined && person.traceUntil <= serverNow;
}

/**
 * 轻点命中（屏幕点已换算成**世界像素**）：人 > 空床 > 地面（见 `docs/ui/DESIGN.md`）。
 * 命中判定与渲染器无关，可单测。
 */

/** 人物当前位置（世界像素）。 */
export interface PersonSpot {
  id: string;
  x: number;
  y: number;
}

/** 轻点的命中半径（世界像素）：比一张床（61×100）小得多，点人是有意为之，不是「附近有人就算」。 */
export const PERSON_HIT_PX = 22;

const inReach = (spot: PersonSpot, point: { x: number; y: number }, radiusPx: number): boolean =>
  Math.hypot(spot.x - point.x, spot.y - point.y) <= radiusPx;

/** 半径内的人：命中多个时取 **y 最大**者（画面上更靠下 = 更靠前，与按 y 排序的遮挡一致）。 */
export function personHit(
  spots: readonly PersonSpot[],
  point: { x: number; y: number },
  radiusPx: number,
): PersonSpot | undefined {
  let best: PersonSpot | undefined;
  for (const spot of spots) {
    if (!inReach(spot, point, radiusPx)) continue;
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

export interface TapInput {
  /** 轻点的世界像素 */
  point: { x: number; y: number };
  /** 视野内的人（世界像素） */
  spots: readonly PersonSpot[];
  selfId?: string;
  /** 点到的那张床的占用者 id（含自己）；空床为 `undefined` */
  residentId?: string;
  bedNo?: number;
  /**
   * 已经**吸附到街网**的目标点（`layout.nearestStreetPoint`）；那一带没有街网时为 `undefined`。
   * 服务端只校验街网、不做吸附，所以吸附必须发生在客户端（见 `docs/api/20-api-ws.md` §7）。
   */
  walkTarget?: { x: number; y: number };
}

/**
 * 轻点该干什么：① 半径内的别人 → 选中；② 点自己 → 相机居中自己（不是「什么都不做」）；
 * ③ 空床 → 躺下；④ 床上有人（含自己）→ 什么都不做；⑤ 可走的街网 → 走过去；⑥ 其余 → 什么都不做。
 * ② 与 ④ 都要点到自己：前者是「把镜头拉回自己」，后者是床上那个位置本来就没有动作可做，别把两者合成一个 `none`。
 *
 * **床格绝不能落成 `walk`**：服务端会回 `3006`，等于点了个空气。
 */
export function tapTargetFor(input: TapInput): TapTarget {
  const { point, spots, selfId, residentId, bedNo, walkTarget } = input;

  const other = personHit(
    spots.filter((spot) => spot.id !== selfId),
    point,
    PERSON_HIT_PX,
  );
  if (other) return { kind: 'select', id: other.id };

  // 点自己：相机居中自己——我知道我是谁，但常想找回自己在哪
  if (selfId !== undefined && spots.some((spot) => spot.id === selfId && inReach(spot, point, PERSON_HIT_PX))) {
    return { kind: 'recenter' };
  }

  if (bedNo !== undefined) return residentId === undefined ? { kind: 'lie', bedNo } : { kind: 'none' };
  return walkTarget ? { kind: 'walk', x: walkTarget.x, y: walkTarget.y } : { kind: 'none' };
}

/**
 * 床位轮廓的内缩与命中判定无关，但渲染与命中必须用同一套床尺寸：`BED_W × BED_H`（素材墨迹 × 0.5）。
 */
export const BED_SIZE = { width: BED_W, height: BED_H } as const;