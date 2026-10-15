import type { Appearance, Person, PersonState } from '../../shared/protocol';
import { interpolationDelay, isInterpolating, positionAt } from '../motion';
import type { Motion } from '../motion';

/**
 * 世界画布的纯规则：与 Phaser 无关，可单测。坐标一律是**世界像素**（1 世界像素 = 1 CSS 像素）。
 * 这些判断是「床位真值表」的直接翻译（见 `docs/ui/DESIGN.md` Components 节）。
 */

/** 单张贴图的名字（图集帧名，见 `docs/ui/DESIGN.md`「构建期要产出的变体」）。 */
export type BedFrame =
  | 'bed_empty_hollow'
  | 'bed_empty_owned'
  | 'bed_boy'
  | 'bed_girl'
  | 'bed_boy_trace'
  | 'bed_girl_trace';

export type PersonFrame = 'boy_stand' | 'girl_stand';

/** 占用一张床的人：画这张床要在图上铺谁，需要显示态与外观两项。 */
export interface Occupant {
  state: Exclude<PersonState, 'roaming'>;
  appearance: Appearance;
}

/**
 * 一张床此刻该用哪张贴图（`docs/ui/DESIGN.md` 的床位真值表）：
 * **占用**走墨色三档（`line` / `trace` / `claimed`）、**归属**走填充（空芯 / `paper`）。
 */
export interface BedLook {
  frame: BedFrame;
  /** 睡痕整张图降不透明度（不能只改轮廓与名字，否则「睡痕」与「睡着」只差颜色） */
  alpha: number;
  /** 清醒躺着：床图上只有闭眼的那一张，靠脸上叠两个点表达「睁着眼」（补画见 backlog） */
  eyes: boolean;
}

/** 睡痕的不透明度：床与小人共用同一个值（`personAlpha`）。 */
export const TRACE_ALPHA = 0.45;

/** 铺着人的两张床图：睡痕是同一张图换墨色档，清醒躺姿与睡着共用闭眼的那张。 */
const BED_FRAMES: Record<Appearance, { resting: BedFrame; trace: BedFrame }> = {
  boy: { resting: 'bed_boy', trace: 'bed_boy_trace' },
  girl: { resting: 'bed_girl', trace: 'bed_girl_trace' },
};

/** 占用优先于归属；无主空床**不返回空值**——它是「这里可以躺」的唯一提示。 */
export function bedLook(input: { owned: boolean; occupant?: Occupant }): BedLook {
  const occupant = input.occupant;
  if (!occupant) {
    return { frame: input.owned ? 'bed_empty_owned' : 'bed_empty_hollow', alpha: 1, eyes: false };
  }
  const trace = occupant.state === 'trace';
  const pair = BED_FRAMES[occupant.appearance];
  return {
    frame: trace ? pair.trace : pair.resting,
    alpha: trace ? TRACE_ALPHA : 1,
    eyes: occupant.state === 'lying',
  };
}

/** 站着的小人：外观（`boy` / `girl`）→ 贴图。**不做逐帧行走动画**，走动靠极轻微的缩放摆动。 */
export function personFrame(appearance: Appearance): PersonFrame {
  return appearance === 'girl' ? 'girl_stand' : 'boy_stand';
}

/**
 * 「这个人此刻还在走」：漫游中且插值窗口还没走完。渲染的摆动与相机跟随共用这一条判据
 * （两处各写一遍时，只要有处换了滞后口径，镜头与小人就会不同步）。
 */
export function isMoving(person: Person, motion: Motion | undefined, serverNow: number): boolean {
  return (
    person.state === 'roaming' && motion !== undefined && isInterpolating(motion, serverNow - interpolationDelay(motion))
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
  return state === 'trace' ? TRACE_ALPHA : 1;
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