import { describe, expect, it } from 'vitest';

import {
  INTERPOLATION_DELAY_MS,
  MOTION_SLACK_MS,
  anyInterpolating,
  isInterpolating,
  nextMotion,
  positionAt,
} from '../motion';

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

  it('收到新批次的那一刻，画的是上一格（往后坐一个节拍 = 平滑而不是跳格）', () => {
    const first = nextMotion(undefined, 0, 0, 1000);
    const second = nextMotion(first, 0, 1, 1200);

    // 不延迟就是「到点即跳」：1200 的时刻已经在新位置
    expect(positionAt(second, 1200)).toEqual({ x: 0, y: 1 });
    // 按设计往后坐一个节拍：同一时刻画面还走在半路上
    const drawn = positionAt(second, 1200 - INTERPOLATION_DELAY_MS);
    expect(drawn.y).toBeGreaterThan(0);
    expect(drawn.y).toBeLessThan(1);
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
