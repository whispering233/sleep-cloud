import { describe, expect, it } from 'vitest';

import {
  INTERPOLATION_DELAY_MS,
  MAX_INTERPOLATION_DELAY_MS,
  MOTION_SLACK_MS,
  anyInterpolating,
  interpolationDelay,
  isInterpolating,
  nextMotion,
  positionAt,
} from '../motion';

/** 两点的距离（位置连续性的判据：≤1px 即「没有跳」）。 */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('位置插值', () => {
  it('第一次收到位置：直接落位，不插值', () => {
    const motion = nextMotion(undefined, 4, 6, 1000);
    expect(positionAt(motion, 1000)).toEqual({ x: 4, y: 6 });
    expect(positionAt(motion, 1500)).toEqual({ x: 4, y: 6 });
  });

  it('插值窗口是【上一批, 本批】，两端与中点都按服务端时间戳算', () => {
    const first = nextMotion(undefined, 0, 0, 1000);
    const second = nextMotion(first, 0, 1, 1200);

    expect(second).toMatchObject({ fromX: 0, fromY: 0, toX: 0, toY: 1, fromTs: 1000, toTs: 1200 });
    expect(positionAt(second, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(second, 1100)).toEqual({ x: 0, y: 0.5 });
    expect(positionAt(second, 1200)).toEqual({ x: 0, y: 1 });
  });

  it('超出窗口就夹在两端，不越界', () => {
    const motion = nextMotion(nextMotion(undefined, 0, 0, 1000), 0, 1, 1200);
    expect(positionAt(motion, 900)).toEqual({ x: 0, y: 0 });
    expect(positionAt(motion, 9999)).toEqual({ x: 0, y: 1 });
  });

  it('等长跨度下滞后 = 跨度：100ms 的一拍 → 100ms', () => {
    const first = nextMotion(undefined, 0, 0, 0);
    const second = nextMotion(first, 10, 0, 100);

    expect(interpolationDelay(second)).toBe(100);
  });

  it('相邻窗口跨度由 305 变短成 203：新批到达的那一帧位置连续（即上一窗口的终点）', () => {
    // 服务端每拍必发，跨度仍会随节拍抖动：305ms 的窗口后面跟一个 203ms 的窗口
    const first = nextMotion(undefined, 0, 0, 0);
    const second = nextMotion(first, 0, 10, 305);
    const third = nextMotion(second, 0, 20, 508);

    expect(third.toTs - third.fromTs).toBe(203);
    expect(interpolationDelay(third)).toBe(203);

    // 到达帧算出来的位置必须落在上一窗口的终点上，否则就是「补跳」
    const arrivalFrame = third.toTs - interpolationDelay(third);
    expect(arrivalFrame).toBe(third.fromTs);
    expect(distance(positionAt(third, arrivalFrame), { x: second.toX, y: second.toY })).toBeLessThanOrEqual(1);
    // 上一窗口在同一时刻算出来也是同一点：两边对齐，跨批次的那一帧没有台阶
    expect(distance(positionAt(third, arrivalFrame), positionAt(second, arrivalFrame))).toBeLessThanOrEqual(1);
  });

  it('陈旧窗口（跨度 30s、两端同点）下起步无瞬移：到达帧取窗口起点', () => {
    // 人停下时的最后一批，与 30 秒后重新起步时服务端立即补发的起点同点
    const stopped = nextMotion(nextMotion(undefined, 300, 480, 0), 300, 480, 100);
    const resumed = nextMotion(stopped, 300, 480, 30_100);

    expect(resumed.toTs - resumed.fromTs).toBe(30_000); // 跨度远超滞后上限
    const arrivalFrame = resumed.toTs - interpolationDelay(resumed);
    expect(distance(positionAt(resumed, arrivalFrame), { x: 300, y: 480 })).toBeLessThanOrEqual(1);

    // 跨长窗口插值就是「快进一格」：那一侧一律取端点，不做线性推进
    expect(positionAt(resumed, resumed.fromTs + 1000)).toEqual({ x: 300, y: 480 });
    expect(positionAt(resumed, resumed.toTs - 1)).toEqual({ x: 300, y: 480 });
    expect(positionAt(resumed, resumed.toTs)).toEqual({ x: 300, y: 480 });
  });

  it('滞后夹在 [100ms, 400ms]；跨度 ≤ 0 取下限', () => {
    const alone = nextMotion(undefined, 0, 0, 1000); // 刚进厅：fromTs === toTs
    expect(interpolationDelay(alone)).toBe(INTERPOLATION_DELAY_MS);
    expect(interpolationDelay(nextMotion(alone, 0, 1, 1050))).toBe(INTERPOLATION_DELAY_MS); // 50ms，夹到下限
    expect(interpolationDelay(nextMotion(alone, 0, 1, 1250))).toBe(250);
    expect(interpolationDelay(nextMotion(alone, 0, 1, 1900))).toBe(MAX_INTERPOLATION_DELAY_MS); // 900ms，夹到上限
  });

  it('乱序或重复的批次被忽略，保留已有窗口', () => {
    const first = nextMotion(undefined, 0, 0, 1000);
    const current = nextMotion(first, 1, 1, 1200);

    expect(nextMotion(current, 9, 9, 1100)).toBe(current); // 旧的 ts
    expect(nextMotion(current, 9, 9, 1200)).toBe(current); // 同一个 ts
  });

  it('没有条目 = 没在插值', () => {
    expect(isInterpolating(undefined, 1000)).toBe(false);
  });

  it('窗口内 = 在插值；恰在 `toTs` 也算（服务端节拍是尽力而为，边界上不能判停）', () => {
    const motion = nextMotion(nextMotion(undefined, 0, 0, 1000), 0, 1, 1200);
    expect(isInterpolating(motion, 1000)).toBe(true);
    expect(isInterpolating(motion, 1100)).toBe(true);
    expect(isInterpolating(motion, 1200)).toBe(true);
    expect(isInterpolating(motion, 1200 + MOTION_SLACK_MS)).toBe(false);
    expect(isInterpolating(motion, 1200 + MOTION_SLACK_MS + 1)).toBe(false);
  });

  it('空集合没有人在插值', () => {
    expect(anyInterpolating([], 1000)).toBe(false);
  });

  it('只剩走完的残留条目 = 没人在动（不为它每帧重画）', () => {
    const stale = nextMotion(nextMotion(undefined, 0, 0, 1000), 0, 1, 1200);
    expect(anyInterpolating([stale], 5000)).toBe(false);
    expect(anyInterpolating(new Map([['a', stale]]).values(), 5000)).toBe(false);
  });

  it('有一条开着 = 有人在动', () => {
    const stale = nextMotion(nextMotion(undefined, 0, 0, 1000), 0, 1, 1200);
    const live = nextMotion(nextMotion(undefined, 5, 5, 4900), 5, 6, 5100);
    expect(anyInterpolating([stale, live], 5100)).toBe(true);
  });

  it('连续两批：新窗口从上一批的终点接上，不跳格', () => {
    const a = nextMotion(undefined, 0, 0, 1000);
    const b = nextMotion(a, 0, 1, 1200);
    const c = nextMotion(b, 0, 2, 1400);

    expect(c).toMatchObject({ fromX: 0, fromY: 1, toX: 0, toY: 2, fromTs: 1200, toTs: 1400 });
    expect(positionAt(c, 1300)).toEqual({ x: 0, y: 1.5 });
  });
});