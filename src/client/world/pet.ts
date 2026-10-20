import { isWalkable, nearestStreetPoint, reserveBlockOf } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import { findPath } from '../../shared/pathfinding';
import type { SelfPerson } from '../../shared/protocol';

/**
 * 我床尾那只猫的纯规则（`docs/design/70-reserve-decor.md` §3，常量见 §4）。与 Phaser 无关，可单测。
 *
 * 它**绑「我」不绑床**：没有床的时候也有猫（首次进厅就是这种状态，§3.5）。每个状态都由「我的显示态」
 * 直接决定，不自己攒状态——所以这里没有状态机，只有两种持续目标、一个首次落位点、一条折线与两条换算。
 * 坐标一律是**世界像素**。
 */

/** 速度系数：速度按剩余**直线距离**算（不按时间），所以任何距离都在约 2 秒内追上，不需要追赶模式（§3.3）。 */
export const PET_SPEED_FACTOR = 1.2;
/** 速度下限：近了也收着走，不会原地抖（§3.3）。 */
export const PET_SPEED_MIN = 260;
/** 速度上限（px/s）：末档跨厅约 1.9 秒（§3.3）。 */
export const PET_SPEED_MAX = 1320;
/** 跑动阈值（px/s）：超过它才跑（§3.3）。 */
export const PET_RUN_THRESHOLD = 300;
/** 跟随偏移：目标点在我的**脚前**（床脚方向）16px（§3.3）。 */
export const PET_FOLLOW_OFFSET = 16;
/** 重算阈值：目标点移动超过它才重算折线（§3.3）。 */
export const PET_REPATH_PX = 24;
/** 无窝起跑距离：沿街网、从我旁边 120px 处起跑（§3.5）。 */
export const PET_SPAWN_DISTANCE = 120;
/** 起跑点贴墙夹取后离我不到这么远就改用「我 + 120」本身——否则猫等于原地出现（§3.5）。 */
export const PET_SPAWN_MIN_GAP = 40;

/** 持续目标的种类：窝里（我躺下）与我脚前（其余情形，含还没有床）。 */
export type PetTargetKind = 'home' | 'user';

export interface PetTarget {
  kind: PetTargetKind;
  point: Point;
}

/** 四组循环动画的 key（与图集帧前缀同名，`views.createPetAnims` 按它注册）。`cat-sleep` 只在窝里到位时播。 */
export type PetAnim = 'cat-idle' | 'cat-walk' | 'cat-run' | 'cat-sleep';

/** 我的窝：我那张床的**床尾块底边中心**；没有床就没有窝（§3.1）。 */
export function petHomeOf(me: SelfPerson | undefined): Point | undefined {
  if (me?.ownedBedNo === undefined) return undefined;
  const foot = reserveBlockOf(me.ownedBedNo, 'foot');
  return foot === undefined ? undefined : { x: foot.x + foot.width / 2, y: foot.y + foot.height };
}

/**
 * 猫此刻该去哪（§3.2、§3.3）：
 * - `lying` / `asleep` 且有窝 → 回窝；其余（`roaming`、还没有床、以及没有窝的异常态）→ 我脚前 16px；
 * - 没有 `me` → 没有目标（不画）。
 *
 * 跟随点正好压在走道边界上（不可走）时退回**我自己的位置**，而不是让 `findPath` 落空（§3.3）。
 */
export function petTargetFor(input: { me: SelfPerson | undefined; self: Point; bedCount: number }): PetTarget | undefined {
  const { me, self, bedCount } = input;
  if (me === undefined) return undefined;

  if (me.state === 'lying' || me.state === 'asleep') {
    const home = petHomeOf(me);
    if (home !== undefined) return { kind: 'home', point: home };
  }

  const ahead = { x: self.x, y: self.y + PET_FOLLOW_OFFSET };
  return { kind: 'user', point: isWalkable(ahead.x, ahead.y, bedCount) ? ahead : { x: self.x, y: self.y } };
}

/**
 * **首次落位**用的起跑点（§3.5）：只在「还没有上一次位置」时用一次，之后一律走持续目标 + 推进。
 * 有窝 → 从窝里开始（我躺下时它本来就在那儿）；没有窝 → 沿街网、从我旁边 120px 处开始。
 *
 * 贴墙夹取后那个点可能离我不到 40px（等于原地出现），这时改用「我 + 120」本身。
 */
export function petSpawnPoint(input: { self: Point; bedCount: number; home?: Point }): Point {
  if (input.home !== undefined) return input.home;
  const behind = { x: input.self.x, y: input.self.y + PET_SPAWN_DISTANCE };
  const street = nearestStreetPoint(behind, input.bedCount);
  if (street === undefined) return behind;
  const gap = Math.hypot(street.x - input.self.x, street.y - input.self.y);
  return gap < PET_SPAWN_MIN_GAP ? behind : street;
}

/**
 * 从当前位置到目标点的折线（共享街网，§3.3）。**猫是本地装饰，寻路失败也要能回来**：
 * 失败时直接给目标点这一段（它会从当前位置直线过去），不许消失、也不许抛错。
 */
export function petPathFor(from: Point, target: PetTarget, bedCount: number): Point[] {
  return findPath(from, target.point, bedCount) ?? [target.point];
}

/** 速度 = `clamp(1.2 × 剩余直线距离, 260, 1320)` px/s：远处飞奔、近处收步（§3.3）。 */
export function petSpeedFor(distance: number): number {
  return Math.min(PET_SPEED_MAX, Math.max(PET_SPEED_MIN, PET_SPEED_FACTOR * distance));
}

/** 移动中的动画：超过跑动阈值 → 跑，否则走，停下 → idle（§3.3）。**睡着不在这里**（由目标种类决定）。 */
export function petAnimFor(speed: number): PetAnim {
  if (speed > PET_RUN_THRESHOLD) return 'cat-run';
  if (speed > 0) return 'cat-walk';
  return 'cat-idle';
}

/** 到位后睡不睡：只有「窝」这一支睡（§3.2）；我脚前到位只是站着。 */
export function petShouldSleep(target: PetTarget | undefined): boolean {
  return target?.kind === 'home';
}
