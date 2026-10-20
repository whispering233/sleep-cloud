import { describe, expect, it } from 'vitest';

import { AISLE, BED_H, BED_W, CELL_H, CELL_W } from '../../../shared/constants';
import { isWalkable, positionOf, reserveBlockOf } from '../../../shared/layout';
import type { Point } from '../../../shared/layout';
import type { SelfPerson } from '../../../shared/protocol';
import {
  PET_ARRIVE_PX,
  PET_FOLLOW_BACK,
  PET_FOLLOW_FRONT,
  PET_FOLLOW_SIDE_X,
  PET_FOLLOW_SIDE_Y,
  PET_GREET_MS,
  PET_GREET_TEXT,
  PET_RUN_THRESHOLD,
  PET_SPAWN_DISTANCE,
  PET_SPEED_FACTOR,
  PET_SPEED_MAX,
  PET_SPEED_MIN,
  petAnimFor,
  petFollowCandidates,
  petGreetVisible,
  petHomeOf,
  petPathFor,
  petRemainingOf,
  petShouldSleep,
  petSpawnPoint,
  petSpeedFor,
  petTargetFor,
} from '../pet';
import type { PetTarget } from '../pet';

/** 第一档（9 × 13 = 117 张床）：够放下面这些格号。 */
const BED_COUNT = 117;

/** 竖走道里、街行上的一个点（x 在街列里 → 任意 y 都可走，用它当「我」的站立点）。 */
const STREET: Point = { x: AISLE / 2, y: 2 * CELL_H };

/** 街行上、但 x 落在**房间**那一列的点：再往下 16px 就压进下一行的床位区（不可走）。 */
const IN_ROW: Point = { x: CELL_W + AISLE + 10, y: CELL_H + BED_H + 40 };

function roamingAt(point: Point, ownedBedNo?: number): SelfPerson {
  return { id: 'u_me', name: '我', appearance: 'boy', state: 'roaming', x: point.x, y: point.y, ownedBedNo };
}

const lying: SelfPerson = { id: 'u_me', name: '我', appearance: 'boy', state: 'lying', bedNo: 7, ownedBedNo: 7 };

const homeOf = (me: SelfPerson): Point => {
  const home = petHomeOf(me);
  if (home === undefined) throw new Error('这张床应该有窝');
  return home;
};

describe('猫的持续目标：由我的显示态直接决定（§3.2）', () => {
  it('躺下 / 睡着 → 回窝：我那张床的床尾块底边中心，且它本身就在街网上', () => {
    const foot = reserveBlockOf(7, 'foot');
    if (!foot) throw new Error('床 7 应该有预留位');
    const home = { x: foot.x + foot.width / 2, y: foot.y + foot.height };
    expect(petTargetFor({ me: lying, self: { x: 0, y: 0 }, bedCount: BED_COUNT })).toEqual({ kind: 'home', point: home });
    expect(petTargetFor({ me: { ...lying, state: 'asleep' }, self: { x: 0, y: 0 }, bedCount: BED_COUNT })).toEqual({
      kind: 'home',
      point: home,
    });
    // 窝的锚点正好落在床脚前那条横走道的边界上：猫因此不必额外开一个「门口」节点（§3.3）
    expect(home.y % CELL_H).toBe(BED_H);
    expect(isWalkable(home.x, home.y, BED_COUNT)).toBe(true);
  });

  it('漫游且有窝 → 站我旁边（右侧候选：不遮我的脸）', () => {
    expect(petTargetFor({ me: roamingAt(STREET, 7), self: STREET, bedCount: BED_COUNT })).toEqual({
      kind: 'user',
      point: { x: STREET.x + PET_FOLLOW_SIDE_X, y: STREET.y + PET_FOLLOW_SIDE_Y },
    });
  });

  it('还没有床 → 同样站我旁边（它会从起跑点跑过来）', () => {
    expect(petTargetFor({ me: roamingAt(STREET), self: STREET, bedCount: BED_COUNT })).toEqual({
      kind: 'user',
      point: { x: STREET.x + PET_FOLLOW_SIDE_X, y: STREET.y + PET_FOLLOW_SIDE_Y },
    });
  });

  it('右侧候选落在床上（不可走）→ 改取左侧候选：**四个方向真的要试**', () => {
    // 横走道里、靠右半边的点：右侧 +26 已经进了房间列，左侧仍在走道里
    expect(isWalkable(IN_ROW.x, IN_ROW.y, BED_COUNT)).toBe(true);
    expect(isWalkable(IN_ROW.x + PET_FOLLOW_SIDE_X, IN_ROW.y + PET_FOLLOW_SIDE_Y, BED_COUNT)).toBe(false);
    expect(petTargetFor({ me: roamingAt(IN_ROW, 7), self: IN_ROW, bedCount: BED_COUNT })).toEqual({
      kind: 'user',
      point: { x: IN_ROW.x - PET_FOLLOW_SIDE_X, y: IN_ROW.y + PET_FOLLOW_SIDE_Y },
    });
  });

  it('候选顺序就是优先级：右 → 左 → 前 → 后（猫站在旁边，不站在我身上）', () => {
    expect(petFollowCandidates(STREET)).toEqual([
      { x: STREET.x + PET_FOLLOW_SIDE_X, y: STREET.y + PET_FOLLOW_SIDE_Y },
      { x: STREET.x - PET_FOLLOW_SIDE_X, y: STREET.y + PET_FOLLOW_SIDE_Y },
      { x: STREET.x, y: STREET.y + PET_FOLLOW_FRONT },
      { x: STREET.x, y: STREET.y - PET_FOLLOW_BACK },
    ]);
    // 每个候选都离我足够远，不会把小人盖住
    for (const point of petFollowCandidates(STREET)) {
      expect(Math.hypot(point.x - STREET.x, point.y - STREET.y)).toBeGreaterThanOrEqual(26);
    }
  });

  it('剩余路程按折线算；到位容差是正数，不给碎步留机会', () => {
    expect(petRemainingOf({ x: 0, y: 0, path: [] })).toBe(0);
    expect(petRemainingOf({ x: 0, y: 0, path: [{ x: 3, y: 4 }] })).toBeCloseTo(5);
    expect(
      petRemainingOf({
        x: 0,
        y: 0,
        path: [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
      }),
    ).toBeCloseTo(20);
    expect(PET_ARRIVE_PX).toBeGreaterThan(0);
  });

  it('没有 me → 没有目标（不画）；没有床就没有窝', () => {
    expect(petTargetFor({ me: undefined, self: STREET, bedCount: BED_COUNT })).toBeUndefined();
    expect(petHomeOf(undefined)).toBeUndefined();
    expect(petHomeOf(roamingAt(STREET))).toBeUndefined();
  });
});

describe('猫的首次落位（§3.5）', () => {
  it('有窝 → 从窝里开始（我躺下时它本来就在那儿）', () => {
    const home = homeOf(lying);
    expect(petSpawnPoint({ self: STREET, bedCount: BED_COUNT, home })).toEqual(home);
  });

  it('无窝 → 沿街网 120px 起跑点', () => {
    const spawn = petSpawnPoint({ self: STREET, bedCount: BED_COUNT });
    expect(Math.hypot(spawn.x - STREET.x, spawn.y - STREET.y)).toBeCloseTo(PET_SPAWN_DISTANCE, 6);
  });

  it('贴墙夹取把起跑点拉得离我不到 40px → 改用「我 + 120」本身，不贴脸', () => {
    // 贴着下侧墙、站在街列里：往下的 120px 越过可走区，`nearestStreetPoint` 只能夹到十几 px 外
    const nearWall: Point = { x: AISLE / 2, y: 1420 };
    expect(isWalkable(nearWall.x, nearWall.y, BED_COUNT)).toBe(true);
    const spawn = petSpawnPoint({ self: nearWall, bedCount: BED_COUNT });
    expect(spawn).toEqual({ x: nearWall.x, y: nearWall.y + PET_SPAWN_DISTANCE });
  });
});

describe('猫的折线：寻路失败也要能回来（§3.3）', () => {
  const target: PetTarget = { kind: 'home', point: homeOf(lying) };

  it('正常寻路：折线非空，且最后一点就是目标点（窝）', () => {
    const path = petPathFor(STREET, target, BED_COUNT);
    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual(target.point);
  });

  it('起点不在街网上（寻路返回 null）→ 直接给目标点这一段，不消失也不抛错', () => {
    const position = positionOf(7);
    if (!position) throw new Error('床 7 应该有位置');
    const insideBed = { x: position.x + BED_W / 2, y: position.y + BED_H / 2 };
    expect(isWalkable(insideBed.x, insideBed.y, BED_COUNT)).toBe(false);
    expect(petPathFor(insideBed, target, BED_COUNT)).toEqual([target.point]);
  });
});

describe('猫的速度与动画（§3.3、§4）', () => {
  it('速度 = clamp(1.2 × 距离, 260, 1320)：单调不减、夹在上下限内', () => {
    const distances = [0, 50, 100, 200, 500, 1000, 2000, 10000];
    const speeds = distances.map(petSpeedFor);
    expect(speeds[0]).toBe(PET_SPEED_MIN);
    expect(speeds.at(-1)).toBe(PET_SPEED_MAX);
    expect(petSpeedFor(500)).toBe(PET_SPEED_FACTOR * 500);
    for (let i = 1; i < speeds.length; i += 1) {
      expect(speeds[i] as number).toBeGreaterThanOrEqual(speeds[i - 1] as number);
    }
  });

  it('动画三档：> 300 跑、> 0 走、否则 idle', () => {
    expect(petAnimFor(0)).toBe('cat-idle');
    expect(petAnimFor(1)).toBe('cat-walk');
    expect(petAnimFor(PET_RUN_THRESHOLD)).toBe('cat-walk');
    expect(petAnimFor(PET_RUN_THRESHOLD + 1)).toBe('cat-run');
  });

  it('到位睡不睡只看目标种类：只有窝才睡，我脚前到位只是站着', () => {
    expect(petShouldSleep({ kind: 'home', point: STREET })).toBe(true);
    expect(petShouldSleep({ kind: 'user', point: STREET })).toBe(false);
    expect(petShouldSleep(undefined)).toBe(false);
  });
});

describe('猫的问候（§3.4）', () => {
  it('说「欢迎进来」、停 4 秒', () => {
    expect(PET_GREET_MS).toBe(4000);
    expect(PET_GREET_TEXT).toBe('欢迎进来');
  });

  it('到期前画、到期即不画、还没问候过也不画', () => {
    const until = 10_000;
    expect(petGreetVisible(until, until - 1)).toBe(true);
    expect(petGreetVisible(until, until)).toBe(false);
    expect(petGreetVisible(until, until + 1)).toBe(false);
    expect(petGreetVisible(undefined, until - 1)).toBe(false);
  });
});
