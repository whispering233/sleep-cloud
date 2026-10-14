import { describe, expect, it } from 'vitest';

import { consumeUpstream } from '../rate-limit';

const LIMIT = 5;
const AT = 1_000_000;

describe('上行限流（固定 1 秒窗口）', () => {
  it('没有窗口时放行，并从这条开始计数', () => {
    expect(consumeUpstream({ window: undefined, now: AT, limit: LIMIT })).toEqual({
      allowed: true,
      window: { windowStart: AT, count: 1 },
    });
  });

  it('窗口内第 1~5 条放行，第 6 条起丢弃且计数继续累加', () => {
    let window = consumeUpstream({ window: undefined, now: AT, limit: LIMIT }).window;

    for (let n = 2; n <= LIMIT; n += 1) {
      const step = consumeUpstream({ window, now: AT + n, limit: LIMIT });
      expect(step.allowed).toBe(true);
      expect(step.window.count).toBe(n);
      window = step.window;
    }

    const sixth = consumeUpstream({ window, now: AT + 6, limit: LIMIT });
    expect(sixth.allowed).toBe(false);
    expect(sixth.window).toEqual({ windowStart: AT, count: 6 });

    // 丢弃不重置计数：第 7 条仍在同一个窗口里被丢弃
    const seventh = consumeUpstream({ window: sixth.window, now: AT + 7, limit: LIMIT });
    expect(seventh.allowed).toBe(false);
    expect(seventh.window).toEqual({ windowStart: AT, count: 7 });
  });

  it('窗口起点满 1000ms 时开新窗口，即使上一条被丢弃过', () => {
    const full = { windowStart: AT, count: 6 };
    expect(consumeUpstream({ window: full, now: AT + 999, limit: LIMIT })).toEqual({
      allowed: false,
      window: { windowStart: AT, count: 7 },
    });
    expect(consumeUpstream({ window: full, now: AT + 1000, limit: LIMIT })).toEqual({
      allowed: true,
      window: { windowStart: AT + 1000, count: 1 },
    });
  });
});
