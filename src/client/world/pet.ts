import { isWalkable, nearestStreetPoint, reserveBlockOf } from '../../shared/layout';
import type { Point } from '../../shared/layout';
import { findPath } from '../../shared/pathfinding';
import type { SelfPerson } from '../../shared/protocol';

/**
 * 我床尾那只猫的纯规则（`docs/design/80-reserve-decor.md` §3，常量见 §5）。与 Phaser 无关，可单测。
 *
 * 它**绑「我」不绑床**：没有床的时候也有猫（首次进厅就是这种状态，§3.5）。每个状态都由「我的显示态」
 * 直接决定，不自己攒状态——所以这里没有状态机，只有两种持续目标、一个首次落位点、一条折线、
 * 两条换算，以及摸猫那一下的两个纯判据（命中圆、随机挑一个动作，§3.6）。
 * 坐标一律是**世界像素**。
 */

/** 速度系数：速度按剩余**折线长度**算（不按时间），所以任何距离都在约 2 秒内追上，不需要追赶模式（§3.3）。 */
export const PET_SPEED_FACTOR = 1.2;
/** 速度下限：近了也收着走，不会原地抖（§3.3）。 */
export const PET_SPEED_MIN = 260;
/** 速度上限（px/s）：末档跨厅约 1.9 秒（§3.3）。 */
export const PET_SPEED_MAX = 1320;
/** 跑动阈值（px/s）：超过它才跑（§3.3）。 */
export const PET_RUN_THRESHOLD = 300;
/** 跟在我**身后**多远：两条贴图都不重叠的距离。
 * 小人与猫都是脚底锚点，前者 48.5×56.5、后者 46.5×58.5 —— 走道只 56 宽，并排放不下（需 47.5 中心距），
 * 所以只能沿**同一轴**拉开：`60 > 58.5` 就够，且在竖走道与横走道里都能找到可走点。 */
export const PET_TRAIL_DISTANCE = 60;

/** 走道轴：街网只有四向，所以「身后」只需两个轴 × 两个符号。 */
export type PetAxis = 'x' | 'y';

export interface PetTrail {
  axis: PetAxis;
  sign: 1 | -1;
}

/** 单个候选点：沿某轴、某方向拉开 `PET_TRAIL_DISTANCE`。 */
function trailPoint(self: Point, trail: PetTrail): Point {
  return trail.axis === 'y'
    ? { x: self.x, y: self.y + trail.sign * PET_TRAIL_DISTANCE }
    : { x: self.x + trail.sign * PET_TRAIL_DISTANCE, y: self.y };
}

/**
 * 「身后」候选（**顺序即优先级**）：沿当前轴的反侧 → 同轴另一侧 → 另一轴两侧。
 * 竖走道里 y 轴优先，横走道里那个 y 候选会出界，自动落到 x 轴的候选上——所以不需要单独的「判断我在哪种走道」分支。
 */
export function petTrailSpots(self: Point, trail: PetTrail | undefined): { point: Point; trail: PetTrail }[] {
  const first: PetTrail = trail ?? { axis: 'y', sign: -1 };
  const flip: PetTrail = { axis: first.axis, sign: first.sign === 1 ? -1 : 1 };
  const other: PetAxis = first.axis === 'y' ? 'x' : 'y';
  const candidates: PetTrail[] = [first, flip, { axis: other, sign: 1 }, { axis: other, sign: -1 }];
  return candidates.map((each) => ({ point: trailPoint(self, each), trail: each }));
}
/** 到位容差（px）：剩余路程小于它就算站定——不给它「来回抽一步」的机会（§3.3）。 */
export const PET_ARRIVE_PX = 6;
/** 重算阈值：目标点移动超过它才重算折线（§3.3）。 */
export const PET_REPATH_PX = 24;
/** 无窝起跑距离：沿街网、从我旁边 120px 处起跑（§3.5）。 */
export const PET_SPAWN_DISTANCE = 120;
/** 起跑点贴墙夹取后离我不到这么远就改用「我 + 120」本身——否则猫等于原地出现（§3.5）。 */
export const PET_SPAWN_MIN_GAP = 40;
/** 问候的时长（毫秒）：到点由渲染时比较时间戳决定，**不挂定时器**（§3.4）。 */
export const PET_GREET_MS = 4_000;
/** 问候说什么（§3.4）：只有这一句，没有轮换、不带名字。 */
export const PET_GREET_TEXT = '欢迎回来';

/** 摸猫那一下的时长：6 帧 @ 4fps = 1.5s（素材 fps 就是 4）。在此之前它不移动、不换动作。 */
export const PET_AFFECTION_MS = 1_500;
/** 摸猫的命中半径（世界像素）：猫 46.5×58.5，圆心在脚点上方 28——既罩得住身体，又不至于把旁边半张床抢走。 */
export const PET_HIT_PX = 26;
/** 命中圆心离脚点多高（世界像素）：猫贴图高 58.5，取一半略低。 */
export const PET_BODY_LIFT_PX = 28;

/** 猫身体中心的那个点：命中判定用它（脚点是锚点，不是身体中心）。 */
export function petBodyPoint(pet: Point): Point {
  return { x: pet.x, y: pet.y - PET_BODY_LIFT_PX };
}

/** 点到猫身上了吗（世界像素，圆判据——与「点人」同一个形状，只是半径大一点）。 */
export function petHitAt(point: Point, pet: Point): boolean {
  const body = petBodyPoint(pet);
  return Math.hypot(body.x - point.x, body.y - point.y) <= PET_HIT_PX;
}

/** 摸一下该演哪一个：`random` 是 [0,1) 的随机数，由调用方给（纯函数才可测）。 */
export function petAffectionPick(random: number): 'cat-pat' | 'cat-nuzzle' {
  return random < 0.5 ? 'cat-pat' : 'cat-nuzzle';
}

/** 剩余**折线**长度（不是直线距离）：绕过拐角时速度与动画都按真正要走的路算（§3.3）。 */
export function petRemainingOf(mover: { x: number; y: number; path: Point[] }): number {
  let total = 0;
  let x = mover.x;
  let y = mover.y;
  for (const point of mover.path) {
    total += Math.hypot(point.x - x, point.y - y);
    x = point.x;
    y = point.y;
  }
  return total;
}

/** 持续目标的种类：窝里（我躺下）与跟在我身后（其余情形，含还没有床）。 */
export type PetTargetKind = 'home' | 'user';

export interface PetTarget {
  kind: PetTargetKind;
  point: Point;
  /** `user` 那一支选中的身后方向；调用方存下来，下一帧优先沿它，否则猫会在两条轴之间反复横跳 */
  trail?: PetTrail;
}

/** 六个动画的 key（与图集帧前缀同名，`views.createPetAnims` 按它注册）：idle / walk / run / sleep 循环，
 * `cat-pat` / `cat-nuzzle` 是**摸猫那一下**的一次性动作（不循环）。 */
export type PetAnim = 'cat-idle' | 'cat-walk' | 'cat-run' | 'cat-sleep' | 'cat-pat' | 'cat-nuzzle';

/** 我的窝：我那张床的**床尾块底边中心**；没有床就没有窝（§3.1）。 */
export function petHomeOf(me: SelfPerson | undefined): Point | undefined {
  if (me?.ownedBedNo === undefined) return undefined;
  const foot = reserveBlockOf(me.ownedBedNo, 'foot');
  return foot === undefined ? undefined : { x: foot.x + foot.width / 2, y: foot.y + foot.height };
}

/**
 * 猫此刻该去哪（§3.2、§3.3）：
 * - `lying` / `asleep` 且有窝 → 回窝；其余（`roaming`、还没有床、以及没有窝的异常态）→ 我身后 60px（`petTrailSpots`）；
 * - 没有 `me` → 没有目标（不画）。
 *
 * 跟随点正好压在走道边界上（不可走）时退回**我自己的位置**，而不是让 `findPath` 落空（§3.3）。
 */
export function petTargetFor(input: {
  me: SelfPerson | undefined;
  self: Point;
  bedCount: number;
  trail?: PetTrail;
}): PetTarget | undefined {
  const { me, self, bedCount, trail } = input;
  if (me === undefined) return undefined;

  if (me.state === 'lying' || me.state === 'asleep') {
    const home = petHomeOf(me);
    if (home !== undefined) return { kind: 'home', point: home };
  }

  const spot = petTrailSpots(self, trail).find((candidate) =>
    isWalkable(candidate.point.x, candidate.point.y, bedCount),
  );
  return { kind: 'user', point: spot?.point ?? { x: self.x, y: self.y }, trail: spot?.trail };
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

/** 到位后睡不睡：只有「窝」这一支睡（§3.2）；跟随时到位只是站着。 */
export function petShouldSleep(target: PetTarget | undefined): boolean {
  return target?.kind === 'home';
}

/**
 * 问候此刻还画不画（§3.4）：**到期即 false**（`now === until` 已经算过期），还没问候过（`undefined`）也是 false。
 * 过期靠「到期时刻 vs 现在」推导，不在任何地方挂定时器——重连不重发也靠调用方不重新置 `until`。
 */
export function petGreetVisible(until: number | undefined, now: number): boolean {
  return until !== undefined && now < until;
}
