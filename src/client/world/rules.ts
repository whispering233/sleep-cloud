import type { Person, PersonState } from '../../shared/protocol';

/**
 * 世界画布的纯规则：与 Pixi 无关，可单测。
 * 这些判断是「床位真值表」的直接翻译（见 `docs/ui/DESIGN.md` Components 节）。
 */

/** 轮廓梯次：床上有人 → `line`；睡痕 → `trace`；有主空床 → `claimed`；无主 → 不画。 */
export type BedOutline = 'line' | 'trace' | 'claimed' | null;

export function bedOutline(input: { owned: boolean; occupant?: PersonState }): BedOutline {
  if (input.occupant === 'lying' || input.occupant === 'asleep') return 'line';
  if (input.occupant === 'trace') return 'trace';
  return input.owned ? 'claimed' : null;
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
 * 轻点该干什么：① 半径内的别人 → 选中；② 点自己 → 什么都不做；
 * ③ 空床 → 躺下；④ 床上有人（含自己）→ 什么都不做；⑤ 可走的地面 → 走过去；⑥ 其余 → 什么都不做。
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

  // 点自己：不做任何动作（我知道我是谁）
  if (selfId !== undefined && spots.some((spot) => spot.id === selfId && inReach(spot, point, PERSON_HIT_TILES))) {
    return { kind: 'none' };
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
